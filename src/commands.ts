import { App, Notice } from 'obsidian';
import { getBasePath } from './base-view';
import { colorsPathFromBasePath, loadConfig, saveConfig, seedConfigFromView } from './config-io';
import { DEFAULT_COLOR_CONFIG } from './types';

// Opens the *.colors.json sibling, creating a skeleton if it doesn't exist.
export async function cmdOpenColorConfig(app: App): Promise<void> {
	const leaf = app.workspace.activeLeaf;
	if (!leaf || leaf.view?.getViewType() !== 'bases') {
		new Notice('Bases Tag Colors: open a .base file first');
		return;
	}
	const basePath = getBasePath(leaf);
	if (!basePath) {
		new Notice('Bases Tag Colors: could not resolve base file path');
		return;
	}
	const colorsPath = colorsPathFromBasePath(basePath);
	const exists = await app.vault.adapter.exists(colorsPath);
	if (!exists) {
		await app.vault.adapter.write(
			colorsPath,
			JSON.stringify(DEFAULT_COLOR_CONFIG, null, 2)
		);
	}
	await app.workspace.openLinkText(colorsPath, '', false);
}

// Seeds *.colors.json with placeholder colors for all currently visible pills.
export async function cmdSeedFromCurrentBase(app: App): Promise<void> {
	const leaf = app.workspace.activeLeaf;
	if (!leaf || leaf.view?.getViewType() !== 'bases') {
		new Notice('Bases Tag Colors: open a .base file first');
		return;
	}
	const basePath = getBasePath(leaf);
	if (!basePath) {
		new Notice('Bases Tag Colors: could not resolve base file path');
		return;
	}

	const view = leaf.view as { containerEl?: HTMLElement };
	const containerEl = view.containerEl;
	if (!containerEl) return;
	const rootEl =
		(containerEl.querySelector('.bases-view') as HTMLElement | null) ?? containerEl;

	const seeded = seedConfigFromView(rootEl);
	const totalEntries = Object.values(seeded.columns).reduce(
		(sum, vals) => sum + Object.keys(vals).length,
		0
	);

	await saveConfig(app, basePath, seeded);
	const colorsPath = colorsPathFromBasePath(basePath);
	new Notice(`Bases Tag Colors: wrote ${totalEntries} entries to ${colorsPath}`);
}

// Reloads the *.colors.json and re-applies colors for the active base.
export async function cmdReloadColorConfig(
	app: App,
	applyToBase: (basePath: string) => Promise<void>
): Promise<void> {
	const leaf = app.workspace.activeLeaf;
	if (!leaf || leaf.view?.getViewType() !== 'bases') {
		new Notice('Bases Tag Colors: open a .base file first');
		return;
	}
	const basePath = getBasePath(leaf);
	if (!basePath) {
		new Notice('Bases Tag Colors: could not resolve base file path');
		return;
	}
	await applyToBase(basePath);
	new Notice('Bases Tag Colors: config reloaded');
}

// Reads old plugin's data.json, migrates colors for currently-visible pills.
export async function cmdMigrateFromOldPlugin(
	app: App,
	applyToBase: (basePath: string) => Promise<void>
): Promise<void> {
	const leaf = app.workspace.activeLeaf;
	if (!leaf || leaf.view?.getViewType() !== 'bases') {
		new Notice('Bases Tag Colors: open a .base file first');
		return;
	}
	const basePath = getBasePath(leaf);
	if (!basePath) {
		new Notice('Bases Tag Colors: could not resolve base file path');
		return;
	}

	const oldDataPath = '.obsidian/plugins/colored-bases-properties/data.json';
	const oldExists = await app.vault.adapter.exists(oldDataPath);
	if (!oldExists) {
		new Notice('Bases Tag Colors: colored-bases-properties not found — nothing to migrate');
		return;
	}

	let oldPillColors: Record<string, string> = {};
	try {
		const raw = await app.vault.adapter.read(oldDataPath);
		const parsed = JSON.parse(raw) as { pillColors?: Record<string, string> };
		oldPillColors = parsed.pillColors ?? {};
	} catch {
		new Notice('Bases Tag Colors: failed to read old plugin data');
		return;
	}

	const view = leaf.view as { containerEl?: HTMLElement };
	const containerEl = view.containerEl;
	if (!containerEl) return;
	const rootEl =
		(containerEl.querySelector('.bases-view') as HTMLElement | null) ?? containerEl;

	// Collect all (rawText) values visible in this base
	const visibleValues = new Set<string>();
	rootEl.querySelectorAll('.multi-select-pill').forEach(pill => {
		const contentEl = pill.querySelector('.multi-select-pill-content');
		const rawText = (contentEl?.textContent ?? pill.textContent ?? '').trim();
		if (rawText) visibleValues.add(rawText);
	});

	// Build a new config using old colors where available
	const existing = await loadConfig(app, basePath);
	let migrated = 0;
	let total = 0;

	for (const rawText of visibleValues) {
		total++;
		if (oldPillColors[rawText]) {
			// Place under '*' (global within this base) to mirror old plugin's global behavior
			if (!existing.columns['*']) existing.columns['*'] = {};
			existing.columns['*'][rawText] = oldPillColors[rawText];
			migrated++;
		}
	}

	await saveConfig(app, basePath, existing);
	await applyToBase(basePath);

	const colorsPath = colorsPathFromBasePath(basePath);
	new Notice(`Bases Tag Colors: migrated ${migrated} of ${total} values to ${colorsPath}`);
}
