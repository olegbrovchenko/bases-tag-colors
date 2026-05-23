import { Plugin, TAbstractFile, TFile, WorkspaceLeaf } from 'obsidian';
import { getBasePath, tagLeaf, untagLeaf } from './src/base-view';
import { basePathFromColorsPath, loadConfig } from './src/config-io';
import { StyleManager } from './src/style-manager';
import { processBaseView } from './src/pill-processor';
import {
	cmdOpenColorConfig,
	cmdSeedFromCurrentBase,
	cmdReloadColorConfig,
	cmdMigrateFromOldPlugin,
} from './src/commands';
import { BasesTagColorsSettingTab } from './src/settings-tab';

interface LeafState {
	basePath: string;
	rootEl: HTMLElement;
	observer: MutationObserver;
}

export default class BasesTagColorsPlugin extends Plugin {
	private styles!: StyleManager;
	private activeLeaves: Map<WorkspaceLeaf, LeafState> = new Map();
	private layoutDebounce: number | null = null;
	private colorsModifyDebounce: Map<string, number> = new Map();

	async onload() {
		this.styles = new StyleManager();

		// B1/B2 + D3/D4: activate leaf when it becomes active
		this.registerEvent(
			this.app.workspace.on('active-leaf-change', (leaf) => {
				if (!leaf) return;
				if (leaf.view?.getViewType() === 'bases') {
					this.activateLeaf(leaf);
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
		this.app.workspace.onLayoutReady(() => this.syncLeaves());
	}

	// D3: load config, inject CSS, stamp pills, wire observer
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
		this.styles.setRulesForBase(basePath, config);
		processBaseView(rootEl);

		// D4: MutationObserver for virtualised rows
		const observer = new MutationObserver((mutations) => {
			const hasPills = mutations.some(m =>
				m.type === 'childList' &&
				Array.from(m.addedNodes).some(node => {
					if (node.nodeType !== Node.ELEMENT_NODE) return false;
					const el = node as HTMLElement;
					return el.classList.contains('multi-select-pill') ||
						el.querySelector?.('.multi-select-pill') !== null;
				})
			);
			if (hasPills) processBaseView(rootEl);
		});
		observer.observe(rootEl, { childList: true, subtree: true });

		this.activeLeaves.set(leaf, { basePath, rootEl, observer });
	}

	private deactivateLeaf(leaf: WorkspaceLeaf): void {
		const state = this.activeLeaves.get(leaf);
		if (!state) return;
		state.observer.disconnect();

		// Remove data-blc-* attrs from all pills in this view
		state.rootEl
			.querySelectorAll<HTMLElement>('[data-blc-value], [data-blc-col]')
			.forEach(el => {
				el.removeAttribute('data-blc-value');
				el.removeAttribute('data-blc-col');
			});

		untagLeaf(leaf);
		this.activeLeaves.delete(leaf);

		// Clear CSS rules if no other leaf is showing the same base
		const stillOpen = [...this.activeLeaves.values()].some(s => s.basePath === state.basePath);
		if (!stillOpen) this.styles.clearRulesForBase(state.basePath);
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
	}

	// D3: re-apply styles + re-process pills for all leaves showing basePath.
	// Re-queries rootEl on every call — guards against DOM refresh (e.g. after Settings close).
	async applyToBase(basePath: string): Promise<void> {
		const config = await loadConfig(this.app, basePath);
		this.styles.setRulesForBase(basePath, config);
		for (const [leaf, state] of this.activeLeaves.entries()) {
			if (state.basePath !== basePath) continue;
			const freshRoot = tagLeaf(leaf, basePath);
			if (!freshRoot) continue;
			if (freshRoot !== state.rootEl) {
				// DOM was refreshed — reconnect MutationObserver to new element
				state.observer.disconnect();
				state.rootEl = freshRoot;
				const obs = new MutationObserver((mutations) => {
					const hasPills = mutations.some(m =>
						m.type === 'childList' &&
						Array.from(m.addedNodes).some(node => {
							if (node.nodeType !== Node.ELEMENT_NODE) return false;
							const el = node as HTMLElement;
							return el.classList.contains('multi-select-pill') ||
								el.querySelector?.('.multi-select-pill') !== null;
						})
					);
					if (hasPills) processBaseView(freshRoot);
				});
				obs.observe(freshRoot, { childList: true, subtree: true });
				state.observer = obs;
			}
			processBaseView(state.rootEl);
		}
	}

	onunload() {
		if (this.layoutDebounce !== null) {
			window.clearTimeout(this.layoutDebounce);
			this.layoutDebounce = null;
		}
		for (const timer of this.colorsModifyDebounce.values()) window.clearTimeout(timer);
		this.colorsModifyDebounce.clear();

		for (const leaf of [...this.activeLeaves.keys()]) this.deactivateLeaf(leaf);
		this.styles.destroy();
	}
}
