import { App, TFile } from 'obsidian';
import { ColorConfig, DEFAULT_COLOR_CONFIG } from './types';

export async function listBasesInVault(app: App): Promise<string[]> {
	return app.vault.getFiles()
		.filter((f: TFile) => f.path.endsWith('.base'))
		.map((f: TFile) => f.path)
		.sort();
}

export function colorsPathFromBasePath(basePath: string): string {
	return basePath.replace(/\.base$/, '.colors.json');
}

export function basePathFromColorsPath(colorsPath: string): string {
	return colorsPath.replace(/\.colors\.json$/, '.base');
}

export async function loadConfig(app: App, basePath: string): Promise<ColorConfig> {
	const colorsPath = colorsPathFromBasePath(basePath);
	try {
		const exists = await app.vault.adapter.exists(colorsPath);
		if (!exists) return { ...DEFAULT_COLOR_CONFIG };

		const raw = await app.vault.adapter.read(colorsPath);
		const parsed = JSON.parse(raw) as ColorConfig;

		if (parsed.version !== 1) {
			console.warn(`[BasesLocalColors] Unknown config version ${parsed.version} at ${colorsPath}`);
			return { ...DEFAULT_COLOR_CONFIG };
		}

		console.log(`[BasesLocalColors] Loaded config: ${JSON.stringify(parsed)}`);
		return parsed;
	} catch (e) {
		console.warn(`[BasesLocalColors] Failed to load config at ${colorsPath}:`, e);
		return { ...DEFAULT_COLOR_CONFIG };
	}
}

export async function saveConfig(app: App, basePath: string, config: ColorConfig): Promise<void> {
	const colorsPath = colorsPathFromBasePath(basePath);
	try {
		await app.vault.adapter.write(colorsPath, JSON.stringify(config, null, 2));
	} catch (e) {
		console.error(`[BasesLocalColors] Failed to save config at ${colorsPath}:`, e);
	}
}

export function sanitizeValue(text: string): string {
	return text.replace(/\s+/g, '').replace(/[^\wÀ-ſ-]/g, '');
}

// Same hash algorithm as colored-bases-properties so migration colors match exactly.
export function generateColorFromText(sanitized: string): string {
	let hash = 0;
	for (let i = 0; i < sanitized.length; i++) {
		const c = sanitized.charCodeAt(i);
		hash = (hash << 5) - hash + c;
		hash = hash & hash;
	}
	const r = 80 + Math.abs(hash) % 120;
	const g = 80 + Math.abs(hash >> 8) % 120;
	const b = 80 + Math.abs(hash >> 16) % 120;
	return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

// Walks the rendered view root, collects (column, rawText) pairs, fills placeholder colors.
export function seedConfigFromView(viewRoot: HTMLElement): ColorConfig {
	const config: ColorConfig = { version: 1, columns: {} };

	viewRoot.querySelectorAll('.multi-select-pill').forEach(pill => {
		const contentEl = pill.querySelector('.multi-select-pill-content');
		const rawText = (contentEl?.textContent ?? pill.textContent ?? '').trim();
		if (!rawText) return;

		const tdEl = pill.closest('[data-property]') as HTMLElement | null;
		const col = tdEl?.getAttribute('data-property') ?? '*';

		const sanitized = sanitizeValue(rawText);
		if (!sanitized) return;

		if (!config.columns[col]) config.columns[col] = {};
		if (!config.columns[col][rawText]) {
			config.columns[col][rawText] = generateColorFromText(sanitized);
		}
	});

	return config;
}
