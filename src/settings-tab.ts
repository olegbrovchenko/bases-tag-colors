import { App, Notice, PluginSettingTab } from 'obsidian';
import type BasesLocalColorsPlugin from '../main';
import { listBasesInVault, loadConfig, saveConfig, sanitizeValue, seedConfigFromView, parseBaseColumns } from './config-io';
import { ColorConfig } from './types';
import { getBasePath } from './base-view';

export class BasesLocalColorsSettingTab extends PluginSettingTab {
	private plugin: BasesLocalColorsPlugin;
	private selectedBase: string = '';
	private config: ColorConfig = { version: 1, columns: {} };
	private searchQuery: string = '';
	private debounceTimer: number | null = null;

	constructor(app: App, plugin: BasesLocalColorsPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	hide(): void {
		if (this.debounceTimer !== null) {
			window.clearTimeout(this.debounceTimer);
			this.debounceTimer = null;
		}
	}

	async display(): Promise<void> {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.addClass('blc-settings');

		// ── 1. Hero ──
		const hero = containerEl.createDiv({ cls: 'blc-hero' });
		hero.createEl('p', { text: 'BASES LOCAL COLORS', cls: 'blc-hero-eyebrow' });
		hero.createEl('h1', { text: 'Bring life to your tags.', cls: 'blc-hero-title' });
		hero.createEl('p', { text: 'v1.1 By Oleg Brovchenko', cls: 'blc-hero-meta' });

		// ── 2. Functional UI: base selector + import ──
		const headerEl = containerEl.createDiv({ cls: 'blc-header' });
		const selectorWrapper = headerEl.createDiv({ cls: 'blc-selector-wrapper' });
		selectorWrapper.createEl('label', { text: 'Base:', cls: 'blc-label' });
		const select = selectorWrapper.createEl('select', { cls: 'blc-base-select' });
		const importBtn = headerEl.createEl('button', { text: 'Import from active base', cls: 'blc-import-btn mod-cta' });

		// Search
		const searchInput = containerEl.createEl('input', {
			type: 'text',
			placeholder: 'Search values…',
			cls: 'blc-search',
		});

		// Colors list
		containerEl.createEl('div', { text: 'Colors', cls: 'blc-section-label' });
		const listEl = containerEl.createDiv({ cls: 'blc-list' });

		// Add row
		containerEl.createEl('div', { text: 'Add value', cls: 'blc-section-label' });
		const addRowEl = containerEl.createDiv({ cls: 'blc-add-row' });
		this.buildAddRow(addRowEl, listEl);

		// Populate base selector
		const bases = await listBasesInVault(this.app);

		if (bases.length === 0) {
			select.createEl('option', { text: 'No .base files found', value: '' });
			importBtn.disabled = true;
			return;
		}

		const activeLeaf = this.app.workspace.activeLeaf;
		const activeBase = activeLeaf ? getBasePath(activeLeaf) : null;

		for (const b of bases) {
			const opt = select.createEl('option', { text: b, value: b });
			if (b === activeBase) opt.selected = true;
		}

		this.selectedBase = (activeBase && bases.includes(activeBase)) ? activeBase : bases[0];
		select.value = this.selectedBase;

		this.config = await loadConfig(this.app, this.selectedBase);
		this.renderValueList(listEl);

		select.addEventListener('change', async () => {
			this.selectedBase = select.value;
			this.config = await loadConfig(this.app, this.selectedBase);
			this.searchQuery = '';
			searchInput.value = '';
			this.renderValueList(listEl);
		});

		searchInput.addEventListener('input', () => {
			this.searchQuery = searchInput.value.toLowerCase();
			this.filterRows(listEl);
		});

		importBtn.addEventListener('click', async () => {
			const leaf = this.app.workspace.activeLeaf;
			if (!leaf || leaf.view?.getViewType() !== 'bases') {
				importBtn.title = 'No bases view open';
				return;
			}
			const activeBase = getBasePath(leaf);
			if (activeBase !== this.selectedBase) {
				importBtn.title = `Active base doesn't match — open "${this.selectedBase}" first`;
				new Notice(`Import aborted: active view is a different base. Click the "${this.selectedBase}" tab first.`);
				return;
			}
			const view = leaf.view as { containerEl?: HTMLElement };
			const containerEl2 = view.containerEl;
			if (!containerEl2) return;
			const rootEl = (containerEl2.querySelector('.bases-view') as HTMLElement | null) ?? containerEl2;
			const seeded = seedConfigFromView(rootEl);
			const allowedCols = await parseBaseColumns(this.app, this.selectedBase);

			for (const [col, vals] of Object.entries(seeded.columns)) {
				if (allowedCols && col !== '*' && !allowedCols.has(col)) continue;
				if (!this.config.columns[col]) this.config.columns[col] = {};
				for (const [rawVal, color] of Object.entries(vals)) {
					if (!this.config.columns[col][rawVal]) {
						this.config.columns[col][rawVal] = color;
					}
				}
			}

			await this.saveAndApply();
			this.renderValueList(listEl);
		});

		this.updateImportBtnState(importBtn);

		// ── 3. About section (below the tool) ──
		containerEl.createEl('hr', { cls: 'blc-landing-divider' });

		// What it does
		const featuresSection = containerEl.createDiv({ cls: 'blc-features' });
		featuresSection.createEl('p', { text: 'WHAT IT DOES', cls: 'blc-section-eyebrow' });
		const grid = featuresSection.createDiv({ cls: 'blc-features-grid' });
		([
			{ title: 'Auto base detection', body: 'Automatically detects your active base.' },
			{ title: 'Visual settings UI', body: 'Color picker, hex input, search bar.' },
			{ title: 'Live in 100ms', body: 'Edit the color, real time update.' },
			{ title: 'Per-base palettes', body: 'Each .base file gets a sibling .colors.json.' },
		] as Array<{title: string; body: string}>).forEach(f => {
			const item = grid.createDiv({ cls: 'blc-feature-item' });
			item.createEl('h3', { text: f.title, cls: 'blc-feature-title' });
			item.createEl('p', { text: f.body, cls: 'blc-feature-body' });
		});

		// Problem
		const problemSection = containerEl.createDiv({ cls: 'blc-text-section' });
		problemSection.createEl('p', { text: 'THE PROBLEM', cls: 'blc-section-eyebrow' });
		problemSection.createEl('p', { text: 'Obsidian Bases have zero native pill colors. It makes reading extremely hard, especially annoying if you are coming from Notion and you are used to having colors on your tags.', cls: 'blc-text-body' });

		// Preview — Mac window chrome
		const previewSection = containerEl.createDiv({ cls: 'blc-text-section' });
		previewSection.createEl('p', { text: 'PREVIEW', cls: 'blc-section-eyebrow' });
		const windowFrame = previewSection.createDiv({ cls: 'blc-window-frame' });
		const windowChrome = windowFrame.createDiv({ cls: 'blc-window-chrome' });
		const dotsWrap = windowChrome.createDiv({ cls: 'blc-window-dots' });
		dotsWrap.createDiv({ cls: 'blc-dot blc-dot-red' });
		dotsWrap.createDiv({ cls: 'blc-dot blc-dot-yellow' });
		dotsWrap.createDiv({ cls: 'blc-dot blc-dot-green' });
		windowChrome.createEl('span', { text: 'YouTube Ideas.base', cls: 'blc-window-title' });
		const img = windowFrame.createEl('img', { cls: 'blc-preview-img', attr: { alt: 'Bases Local Colors in action' } });
		const pluginDir = (this.plugin.manifest as { dir?: string }).dir ?? '.obsidian/plugins/bases-local-colors';
		img.src = this.app.vault.adapter.getResourcePath(`${pluginDir}/preview.png`);

		// Sign-off — last element
		containerEl.createEl('p', { text: 'Enjoy! — Oleg Brovchenko', cls: 'blc-signoff' });
	}

	private updateImportBtnState(btn: HTMLButtonElement): void {
		const leaf = this.app.workspace.activeLeaf;
		const isBasesView = leaf?.view?.getViewType() === 'bases';
		btn.disabled = !isBasesView;
		btn.title = isBasesView ? 'Import all visible pill values from the active base' : 'No bases view open';
	}

	private renderValueList(listEl: HTMLElement): void {
		listEl.empty();

		// Flatten all entries: [col, rawValue, color]
		const entries: Array<{ col: string; rawValue: string; color: string }> = [];
		for (const [col, vals] of Object.entries(this.config.columns)) {
			for (const [rawValue, color] of Object.entries(vals)) {
				entries.push({ col, rawValue, color });
			}
		}

		// Deduplicate: if a rawValue exists under both '*' and a specific column,
		// suppress the '*' entry — the specific column is more informative and wins in CSS.
		const valuesWithSpecificCol = new Set(
			entries.filter(e => e.col !== '*').map(e => e.rawValue)
		);
		const deduped = entries.filter(e => !(e.col === '*' && valuesWithSpecificCol.has(e.rawValue)));

		// Sort: '*' first, then alphabetical by col then value
		deduped.sort((a, b) => {
			if (a.col === '*' && b.col !== '*') return -1;
			if (a.col !== '*' && b.col === '*') return 1;
			if (a.col !== b.col) return a.col.localeCompare(b.col);
			return a.rawValue.localeCompare(b.rawValue);
		});

		if (deduped.length === 0) {
			listEl.createEl('p', { text: 'No colors configured. Import from active base or add manually below.', cls: 'blc-empty' });
			return;
		}

		for (const entry of deduped) {
			this.buildRow(listEl, entry.col, entry.rawValue, entry.color);
		}

		this.filterRows(listEl);
	}

	private buildRow(listEl: HTMLElement, col: string, rawValue: string, color: string): void {
		const row = listEl.createDiv({ cls: 'blc-row' });
		row.dataset.col = col;
		row.dataset.value = rawValue.toLowerCase();

		// Pill preview — mirrors real Bases pill appearance
		const pillPreview = row.createEl('span', { text: rawValue, cls: 'blc-pill-preview' });
		pillPreview.style.backgroundColor = color;

		// Column badge
		row.createEl('span', { text: col === '*' ? 'any column' : col, cls: 'blc-col-badge' });

		// Spacer
		row.createDiv({ cls: 'blc-spacer' });

		// Color picker
		const picker = row.createEl('input', { cls: 'blc-color-picker' }) as HTMLInputElement;
		picker.type = 'color';
		picker.value = color;

		// Hex input
		const hexInput = row.createEl('input', { cls: 'blc-hex-input' }) as HTMLInputElement;
		hexInput.type = 'text';
		hexInput.maxLength = 7;
		hexInput.value = color;
		hexInput.placeholder = '#rrggbb';

		// Remove button
		const removeBtn = row.createEl('button', { text: '×', cls: 'blc-remove-btn' });

		// Sync: picker → hex + pill
		picker.addEventListener('input', () => {
			hexInput.value = picker.value;
			pillPreview.style.backgroundColor = picker.value;
			this.setColor(col, rawValue, picker.value);
			this.debouncedSaveApply();
		});

		// Sync: hex → picker + pill
		hexInput.addEventListener('blur', () => {
			const val = hexInput.value.trim();
			if (/^#[0-9a-fA-F]{6}$/.test(val)) {
				picker.value = val;
				pillPreview.style.backgroundColor = val;
				this.setColor(col, rawValue, val);
				this.saveAndApply();
			} else {
				hexInput.value = picker.value; // revert bad input
			}
		});

		// --- Remove ---
		removeBtn.addEventListener('click', async () => {
			this.deleteColor(col, rawValue);
			await this.saveAndApply();
			row.remove();
		});
	}

	private buildAddRow(addRowEl: HTMLElement, listEl: HTMLElement): void {

		const nameInput = addRowEl.createEl('input', { cls: 'blc-add-name' }) as HTMLInputElement;
		nameInput.type = 'text';
		nameInput.placeholder = 'Value name';

		const picker = addRowEl.createEl('input', { cls: 'blc-color-picker' }) as HTMLInputElement;
		picker.type = 'color';
		picker.value = '#78b7b8';

		const hexInput = addRowEl.createEl('input', { cls: 'blc-hex-input' }) as HTMLInputElement;
		hexInput.type = 'text';
		hexInput.maxLength = 7;
		hexInput.value = '#78b7b8';
		hexInput.placeholder = '#rrggbb';

		picker.addEventListener('input', () => { hexInput.value = picker.value; });
		hexInput.addEventListener('blur', () => {
			if (/^#[0-9a-fA-F]{6}$/.test(hexInput.value.trim())) {
				picker.value = hexInput.value.trim();
			} else {
				hexInput.value = picker.value;
			}
		});

		const addBtn = addRowEl.createEl('button', { text: '+ Add', cls: 'blc-add-btn' });
		addBtn.addEventListener('click', async () => {
			const name = nameInput.value.trim();
			if (!name) return;
			const color = picker.value;
			if (!this.config.columns['*']) this.config.columns['*'] = {};
			this.config.columns['*'][name] = color;
			await this.saveAndApply();
			this.buildRow(listEl, '*', name, color);
			this.filterRows(listEl);
			nameInput.value = '';
			picker.value = '#78b7b8';
			hexInput.value = '#78b7b8';
		});
	}

	private filterRows(listEl: HTMLElement): void {
		const q = this.searchQuery;
		listEl.querySelectorAll<HTMLElement>('.blc-row').forEach(row => {
			const valueText = row.dataset.value ?? '';
			const colText = row.dataset.col ?? '';
			const matches = !q || valueText.includes(q) || colText.includes(q);
			row.style.display = matches ? '' : 'none';
		});
	}

	private setColor(col: string, rawValue: string, color: string): void {
		if (!this.config.columns[col]) this.config.columns[col] = {};
		this.config.columns[col][rawValue] = color;
	}

	private deleteColor(col: string, rawValue: string): void {
		if (!this.config.columns[col]) return;
		delete this.config.columns[col][rawValue];
		if (Object.keys(this.config.columns[col]).length === 0) {
			delete this.config.columns[col];
		}
	}

	private debouncedSaveApply(): void {
		if (this.debounceTimer !== null) window.clearTimeout(this.debounceTimer);
		this.debounceTimer = window.setTimeout(() => {
			this.debounceTimer = null;
			this.saveAndApply();
		}, 150);
	}

	private async saveAndApply(): Promise<void> {
		if (!this.selectedBase) return;
		await saveConfig(this.app, this.selectedBase, this.config);
		await this.plugin.applyToBase(this.selectedBase);
	}
}
