import { App, PluginSettingTab } from 'obsidian';
import type BasesLocalColorsPlugin from '../main';
import { listBasesInVault, loadConfig, saveConfig, sanitizeValue, seedConfigFromView } from './config-io';
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

	async display(): Promise<void> {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.addClass('blc-settings');

		// --- Header: base selector + import button ---
		const headerEl = containerEl.createDiv({ cls: 'blc-header' });

		const selectorWrapper = headerEl.createDiv({ cls: 'blc-selector-wrapper' });
		selectorWrapper.createEl('label', { text: 'Base:', cls: 'blc-label' });
		const select = selectorWrapper.createEl('select', { cls: 'blc-base-select' });

		const importBtn = headerEl.createEl('button', { text: 'Import from active base', cls: 'blc-import-btn' });

		// --- Search bar ---
		const searchInput = containerEl.createEl('input', {
			type: 'text',
			placeholder: 'Search values…',
			cls: 'blc-search',
		});

		// --- List container ---
		const listEl = containerEl.createDiv({ cls: 'blc-list' });

		// --- Add new value row ---
		const addRowEl = containerEl.createDiv({ cls: 'blc-add-row' });
		this.buildAddRow(addRowEl, listEl);

		// --- Populate base selector ---
		const bases = await listBasesInVault(this.app);

		if (bases.length === 0) {
			select.createEl('option', { text: 'No .base files found', value: '' });
			importBtn.disabled = true;
			return;
		}

		// Detect active base
		const activeLeaf = this.app.workspace.activeLeaf;
		const activeBase = activeLeaf ? getBasePath(activeLeaf) : null;

		for (const b of bases) {
			const opt = select.createEl('option', { text: b, value: b });
			if (b === activeBase) opt.selected = true;
		}

		// Set initial selectedBase
		this.selectedBase = (activeBase && bases.includes(activeBase)) ? activeBase : bases[0];
		select.value = this.selectedBase;

		// Load config for initial base
		this.config = await loadConfig(this.app, this.selectedBase);
		this.renderValueList(listEl);

		// --- Event: base selector change ---
		select.addEventListener('change', async () => {
			this.selectedBase = select.value;
			this.config = await loadConfig(this.app, this.selectedBase);
			this.searchQuery = '';
			searchInput.value = '';
			this.renderValueList(listEl);
		});

		// --- Event: search ---
		searchInput.addEventListener('input', () => {
			this.searchQuery = searchInput.value.toLowerCase();
			this.filterRows(listEl);
		});

		// --- Event: import from active base ---
		importBtn.addEventListener('click', async () => {
			const leaf = this.app.workspace.activeLeaf;
			if (!leaf || leaf.view?.getViewType() !== 'bases') {
				importBtn.title = 'No bases view open';
				return;
			}
			const view = leaf.view as { containerEl?: HTMLElement };
			const containerEl2 = view.containerEl;
			if (!containerEl2) return;
			const rootEl = (containerEl2.querySelector('.bases-view') as HTMLElement | null) ?? containerEl2;
			const seeded = seedConfigFromView(rootEl);

			// Merge: only add values not already present
			for (const [col, vals] of Object.entries(seeded.columns)) {
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

		// Update import button state once on open
		this.updateImportBtnState(importBtn);
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

		// Swatch
		const swatch = row.createDiv({ cls: 'blc-swatch' });
		swatch.style.backgroundColor = color;

		// Column badge
		row.createEl('span', { text: col === '*' ? 'any' : col, cls: 'blc-col-badge' });

		// Value name
		row.createEl('span', { text: rawValue, cls: 'blc-value-name' });

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

		// --- Sync: picker → hex + swatch ---
		picker.addEventListener('input', () => {
			hexInput.value = picker.value;
			swatch.style.backgroundColor = picker.value;
			this.setColor(col, rawValue, picker.value);
			this.debouncedSaveApply();
		});

		// --- Sync: hex → picker + swatch ---
		hexInput.addEventListener('blur', () => {
			const val = hexInput.value.trim();
			if (/^#[0-9a-fA-F]{6}$/.test(val)) {
				picker.value = val;
				swatch.style.backgroundColor = val;
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
		addRowEl.createEl('span', { text: 'Add value:', cls: 'blc-label' });

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
