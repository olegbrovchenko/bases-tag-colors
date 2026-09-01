import { MarkdownView, Plugin, TAbstractFile, TFile, WorkspaceLeaf } from 'obsidian';
import { getBasePath, tagLeaf, untagLeaf } from './src/base-view';
import { containsBasesEmbed, tagEmbeds } from './src/embed-view';
import { basePathFromColorsPath, loadConfig, sanitizeValue } from './src/config-io';
import { StyleManager } from './src/style-manager';
import { processBaseView } from './src/pill-processor';
import {
	cmdOpenColorConfig,
	cmdSeedFromCurrentBase,
	cmdReloadColorConfig,
	cmdMigrateFromOldPlugin,
} from './src/commands';
import { BasesTagColorsSettingTab } from './src/settings-tab';
import { DEFAULT_SETTINGS, PluginSettings } from './src/types';

interface LeafState {
	basePath: string;
	rootEl: HTMLElement;
	observer: MutationObserver;
}

interface EmbedLeafState {
	observer: MutationObserver;
}

function mutationsAddPills(mutations: MutationRecord[]): boolean {
	return mutations.some(m =>
		m.type === 'childList' &&
		Array.from(m.addedNodes).some(node => {
			if (node.nodeType !== Node.ELEMENT_NODE) return false;
			const el = node as HTMLElement;
			return el.classList.contains('multi-select-pill') ||
				el.querySelector?.('.multi-select-pill') !== null;
		})
	);
}

function mutationsAddBasesEmbeds(mutations: MutationRecord[]): boolean {
	return mutations.some(m =>
		m.type === 'childList' &&
		Array.from(m.addedNodes).some(node =>
			node.nodeType === Node.ELEMENT_NODE && containsBasesEmbed(node as HTMLElement)
		)
	);
}

export default class BasesTagColorsPlugin extends Plugin {
	private styles!: StyleManager;
	private activeLeaves: Map<WorkspaceLeaf, LeafState> = new Map();
	private embedLeaves: Map<WorkspaceLeaf, EmbedLeafState> = new Map();
	// Base paths whose colors were loaded because an embed shows them
	private embedBasePaths: Set<string> = new Set();
	private layoutDebounce: number | null = null;
	private colorsModifyDebounce: Map<string, number> = new Map();
	private propsObserver: MutationObserver | null = null;
	settings: PluginSettings = { ...DEFAULT_SETTINGS };

	async onload() {
		this.styles = new StyleManager();
		const stored = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
		// Guard against a hand-edited/corrupted data.json feeding NaN into sliders + CSS
		for (const key of ['paddingX', 'paddingY', 'borderRadius'] as const) {
			if (!Number.isFinite(stored[key])) stored[key] = DEFAULT_SETTINGS[key];
		}
		stored.customShape = !!stored.customShape;
		stored.autoColor = !!stored.autoColor;
		stored.propertiesColor = !!stored.propertiesColor;
		this.settings = stored;
		this.styles.setShape(this.settings);

		// B1/B2 + D3/D4: activate leaf when it becomes active
		this.registerEvent(
			this.app.workspace.on('active-leaf-change', (leaf) => {
				if (!leaf) return;
				if (leaf.view?.getViewType() === 'bases') {
					this.activateLeaf(leaf);
				} else if (leaf.view instanceof MarkdownView) {
					this.activateEmbedLeaf(leaf);
				}
			})
		);

		// B3: handle split panes
		this.registerEvent(
			this.app.workspace.on('layout-change', () => {
				if (this.layoutDebounce !== null) window.clearTimeout(this.layoutDebounce);
				this.layoutDebounce = window.setTimeout(() => {
					this.layoutDebounce = null;
					this.syncLeaves();
				}, 50);
			})
		);

		// C3: hot reload on *.colors.json save
		this.registerEvent(
			this.app.vault.on('modify', (file: TAbstractFile) => {
				if (!(file instanceof TFile)) return;
				if (!file.path.endsWith('.colors.json')) return;

				const prev = this.colorsModifyDebounce.get(file.path);
				if (prev !== undefined) window.clearTimeout(prev);

				const timer = window.setTimeout(() => {
					this.colorsModifyDebounce.delete(file.path);
					const basePath = basePathFromColorsPath(file.path);
					this.applyToBase(basePath);
					this.reloadPropertyConfigs();
				}, 100);

				this.colorsModifyDebounce.set(file.path, timer);
			})
		);

		this.addCommand({
			id: 'open-color-config',
			name: 'Open color config for current base',
			callback: () => cmdOpenColorConfig(this.app),
		});

		this.addCommand({
			id: 'seed-from-current-base',
			name: 'Seed config from current base values',
			callback: () => cmdSeedFromCurrentBase(this.app),
		});

		this.addCommand({
			id: 'reload-color-config',
			name: 'Reload color config',
			callback: () => cmdReloadColorConfig(this.app, this.applyToBase.bind(this)),
		});

		this.addCommand({
			id: 'migrate-from-colored-bases-properties',
			name: 'Migrate from colored-bases-properties (current base)',
			callback: () => cmdMigrateFromOldPlugin(this.app, this.applyToBase.bind(this)),
		});

		this.addSettingTab(new BasesTagColorsSettingTab(this.app, this));

		// Activate any bases leaves already open when the plugin is enabled.
		// layout-change does not fire on plugin toggle, so we must bootstrap manually.
		this.app.workspace.onLayoutReady(() => {
			this.syncLeaves();
			if (this.settings.propertiesColor) this.startPropertiesColoring();
		});
	}

	// Watch a view root for virtualised rows adding pills, re-stamp when they appear
	private createPillObserver(rootEl: HTMLElement, basePath: string): MutationObserver {
		const observer = new MutationObserver((mutations) => {
			if (mutationsAddPills(mutations)) this.refreshView(rootEl, basePath);
		});
		observer.observe(rootEl, { childList: true, subtree: true });
		return observer;
	}

	// D3: load config, register colors, stamp + paint pills, wire observer
	private async activateLeaf(leaf: WorkspaceLeaf): Promise<void> {
		const basePath = getBasePath(leaf);
		if (!basePath) {
			console.warn('[BasesTagColors] bases view active but path unavailable');
			return;
		}

		// Already tracking this exact leaf instance — just re-apply
		const existing = this.activeLeaves.get(leaf);
		if (existing && existing.basePath === basePath) {
			await this.applyToBase(basePath);
			return;
		}

		// Disconnect stale state if leaf was reused for a different base
		if (existing) this.deactivateLeaf(leaf);

		const rootEl = tagLeaf(leaf, basePath);
		if (!rootEl) return;

		const config = await loadConfig(this.app, basePath);

		// A concurrent activation (active-leaf-change + debounced layout-change)
		// may have finished while we awaited — a second observer here would leak.
		const raced = this.activeLeaves.get(leaf);
		if (raced && raced.basePath === basePath) return;

		this.styles.setColorsForBase(basePath, config);
		this.refreshView(rootEl, basePath);

		// D4: MutationObserver for virtualised rows
		const observer = this.createPillObserver(rootEl, basePath);

		this.activeLeaves.set(leaf, { basePath, rootEl, observer });
	}

	private deactivateLeaf(leaf: WorkspaceLeaf): void {
		const state = this.activeLeaves.get(leaf);
		if (!state) return;
		state.observer.disconnect();

		// Remove data-blc-* attrs and paint from all pills in this view
		state.rootEl
			.querySelectorAll<HTMLElement>('[data-blc-value], [data-blc-col]')
			.forEach(el => {
				this.styles.unpaintPill(el);
				el.removeAttribute('data-blc-value');
				el.removeAttribute('data-blc-col');
			});

		untagLeaf(leaf);
		this.activeLeaves.delete(leaf);

		// Drop the base's stored colors if no other leaf or embed is showing it
		const stillOpen = [...this.activeLeaves.values()].some(s => s.basePath === state.basePath) ||
			this.embedBasePaths.has(state.basePath);
		if (!stillOpen) this.styles.clearColorsForBase(state.basePath);
	}

	// Re-tag + re-apply all current bases leaves; clean up closed ones
	private syncLeaves(): void {
		const current = new Set(this.app.workspace.getLeavesOfType('bases'));

		// Deactivate leaves that no longer exist
		for (const leaf of [...this.activeLeaves.keys()]) {
			if (!current.has(leaf)) this.deactivateLeaf(leaf);
		}

		// Activate new ones
		for (const leaf of current) {
			if (!this.activeLeaves.has(leaf)) this.activateLeaf(leaf);
		}

		// Same dance for markdown leaves, which may hold embedded bases
		const mdCurrent = new Set(this.app.workspace.getLeavesOfType('markdown'));
		for (const leaf of [...this.embedLeaves.keys()]) {
			if (!mdCurrent.has(leaf)) this.deactivateEmbedLeaf(leaf);
		}
		for (const leaf of mdCurrent) {
			if (this.embedLeaves.has(leaf)) {
				this.refreshEmbedLeaf(leaf);
			} else {
				this.activateEmbedLeaf(leaf);
			}
		}
		this.pruneEmbedBasePaths();
	}

	// ── Embedded bases (![[Something.base]] inside notes) ────────────────

	// Every markdown leaf gets an observer: embeds render lazily on scroll and
	// appear when the user types one, so watching only leaves that currently
	// hold an embed would miss both.
	private activateEmbedLeaf(leaf: WorkspaceLeaf): void {
		if (this.embedLeaves.has(leaf)) {
			this.refreshEmbedLeaf(leaf);
			return;
		}
		const view = leaf.view;
		if (!(view instanceof MarkdownView)) return;

		const observer = new MutationObserver((mutations) => {
			if (mutationsAddPills(mutations) || mutationsAddBasesEmbeds(mutations)) {
				this.refreshEmbedLeaf(leaf);
			}
		});
		observer.observe(view.containerEl, { childList: true, subtree: true });
		this.embedLeaves.set(leaf, { observer });
		this.refreshEmbedLeaf(leaf);
	}

	private deactivateEmbedLeaf(leaf: WorkspaceLeaf): void {
		const state = this.embedLeaves.get(leaf);
		if (!state) return;
		state.observer.disconnect();

		// Only sweep the DOM while the leaf still shows a markdown view. When the
		// leaf morphed into another view type (e.g. the user opened a base in it),
		// containerEl belongs to the NEW view — sweeping would strip the tag the
		// bases activation just wrote. The old markdown DOM is discarded anyway.
		const containerEl = leaf.view instanceof MarkdownView ? leaf.view.containerEl : null;
		if (containerEl) {
			containerEl
				.querySelectorAll<HTMLElement>('[data-blc-value], [data-blc-col]')
				.forEach(el => {
					this.styles.unpaintPill(el);
					el.removeAttribute('data-blc-value');
					el.removeAttribute('data-blc-col');
				});
			containerEl
				.querySelectorAll('[data-bases-tag-colors-id]')
				.forEach(el => el.removeAttribute('data-bases-tag-colors-id'));
		}
		this.embedLeaves.delete(leaf);
	}

	// Tag every embed in the leaf, load config for bases seen the first time,
	// then stamp + paint. Keyed by base path, so the standalone view, split
	// panes and several embeds of one base all share the same colors.
	private async refreshEmbedLeaf(leaf: WorkspaceLeaf): Promise<void> {
		const view = leaf.view;
		if (!(view instanceof MarkdownView) || !view.file) return;

		const roots = tagEmbeds(this.app, view.containerEl, view.file.path);
		for (const [basePath, rootEls] of roots.entries()) {
			if (!this.embedBasePaths.has(basePath)) {
				this.embedBasePaths.add(basePath);
				const config = await loadConfig(this.app, basePath);
				this.styles.setColorsForBase(basePath, config);
			}
			for (const rootEl of rootEls) this.refreshView(rootEl, basePath);
		}
	}

	// Drop stored colors for bases no longer shown by any embed or leaf
	private pruneEmbedBasePaths(): void {
		const alive = new Set<string>();
		for (const leaf of this.embedLeaves.keys()) {
			const view = leaf.view;
			if (!(view instanceof MarkdownView)) continue;
			view.containerEl.querySelectorAll('[data-bases-tag-colors-id]').forEach(el => {
				const p = el.getAttribute('data-bases-tag-colors-id');
				if (p) alive.add(p);
			});
		}
		for (const basePath of [...this.embedBasePaths]) {
			if (alive.has(basePath)) continue;
			this.embedBasePaths.delete(basePath);
			const stillOpen = [...this.activeLeaves.values()].some(s => s.basePath === basePath);
			if (!stillOpen) this.styles.clearColorsForBase(basePath);
		}
	}

	// D3: re-apply styles + re-process pills for all leaves showing basePath.
	// Re-queries rootEl on every call — guards against DOM refresh (e.g. after Settings close).
	async applyToBase(basePath: string): Promise<void> {
		const config = await loadConfig(this.app, basePath);
		this.styles.setColorsForBase(basePath, config);
		for (const [leaf, state] of this.activeLeaves.entries()) {
			if (state.basePath !== basePath) continue;
			const freshRoot = tagLeaf(leaf, basePath);
			if (!freshRoot) continue;
			if (freshRoot !== state.rootEl) {
				// DOM was refreshed — reconnect MutationObserver to new element
				state.observer.disconnect();
				state.rootEl = freshRoot;
				state.observer = this.createPillObserver(freshRoot, basePath);
			}
			this.refreshView(state.rootEl, basePath);
		}
	}

	// Apply the current shape to open views without touching disk (live slider feedback)
	applyShape(): void {
		this.styles.setShape(this.settings);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		this.styles.setShape(this.settings);
	}

	// Called when the auto-color toggle flips: drop generated rules, re-collect
	// from every active view (collection is a no-op while the toggle is off)
	applyAutoColorToggle(): void {
		if (!this.settings.autoColor) {
			this.styles.clearAllAutoColors();
			return;
		}
		for (const state of this.activeLeaves.values()) {
			this.refreshView(state.rootEl, state.basePath);
		}
		for (const leaf of this.embedLeaves.keys()) this.refreshEmbedLeaf(leaf);
		// Properties pills re-collect too — without this they stay uncolored
		// after an off→on flip until some unrelated DOM mutation fires
		if (this.settings.propertiesColor) this.processPropertyPills();
	}

	// Stamp pills, register their values for auto colors when enabled, then paint
	private refreshView(rootEl: HTMLElement, basePath: string): void {
		const values = processBaseView(rootEl);
		if (this.settings.autoColor) {
			this.styles.addAutoValuesForBase(basePath, values);
		}
		this.styles.paintView(rootEl, basePath);
	}

	// ── Note Properties coloring ─────────────────────────────────────────

	applyPropertiesToggle(): void {
		if (this.settings.propertiesColor) {
			this.startPropertiesColoring();
		} else {
			this.stopPropertiesColoring();
		}
		this.styles.setShape(this.settings); // shape scope includes/excludes properties
	}

	private startPropertiesColoring(): void {
		if (this.propsObserver) return;
		this.propsObserver = new MutationObserver((mutations) => {
			if (mutationsAddPills(mutations)) this.processPropertyPills();
		});
		this.propsObserver.observe(document.body, { childList: true, subtree: true });
		this.processPropertyPills();
		this.reloadPropertyConfigs();
	}

	private stopPropertiesColoring(): void {
		if (!this.propsObserver) return;
		this.propsObserver.disconnect();
		this.propsObserver = null;
		document.body
			.querySelectorAll<HTMLElement>('.metadata-property .multi-select-pill[data-blc-value]')
			.forEach(el => {
				this.styles.unpaintPill(el);
				el.removeAttribute('data-blc-value');
			});
		this.styles.clearPropertyColors();
	}

	// Stamp pills in every visible Properties panel. Column matching rides the
	// panel's own data-property-key attribute, so only the value is stamped.
	private processPropertyPills(): void {
		const values: string[] = [];
		document.body
			.querySelectorAll<HTMLElement>('.metadata-property .multi-select-pill')
			.forEach(pill => {
				const contentEl = pill.querySelector('.multi-select-pill-content');
				const rawText = (contentEl?.textContent ?? pill.textContent ?? '').trim();
				if (!rawText) return;
				const sanitized = sanitizeValue(rawText);
				if (!sanitized) return;
				pill.setAttribute('data-blc-value', sanitized);
				values.push(sanitized);
			});
		if (this.settings.autoColor && values.length) {
			this.styles.addPropertyAutoValues(values);
		}
		this.styles.paintProperties();
	}

	private async reloadPropertyConfigs(): Promise<void> {
		if (!this.settings.propertiesColor) return;
		const colorsFiles = this.app.vault.getFiles().filter(f => f.path.endsWith('.colors.json'));
		const configs = await Promise.all(
			colorsFiles.map(f => loadConfig(this.app, basePathFromColorsPath(f.path)))
		);
		this.styles.setPropertyColors(configs);
	}

	onunload() {
		if (this.layoutDebounce !== null) {
			window.clearTimeout(this.layoutDebounce);
			this.layoutDebounce = null;
		}
		for (const timer of this.colorsModifyDebounce.values()) window.clearTimeout(timer);
		this.colorsModifyDebounce.clear();

		for (const leaf of [...this.activeLeaves.keys()]) this.deactivateLeaf(leaf);
		for (const leaf of [...this.embedLeaves.keys()]) this.deactivateEmbedLeaf(leaf);
		this.embedBasePaths.clear();
		this.stopPropertiesColoring();
		this.styles.destroy();
	}
}
