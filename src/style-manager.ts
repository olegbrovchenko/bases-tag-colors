import { ColorConfig } from './types';
import { sanitizeValue } from './config-io';

const STYLE_ID = 'bases-local-colors-style';

export class StyleManager {
	private styleEl: HTMLStyleElement;
	private rulesByBase: Map<string, string[]> = new Map();

	constructor() {
		this.styleEl = this.getOrCreate();
	}

	private getOrCreate(): HTMLStyleElement {
		let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
		if (!el) {
			el = document.createElement('style');
			el.id = STYLE_ID;
			el.type = 'text/css';
			document.head.appendChild(el);
		}
		return el;
	}

	setRulesForBase(basePath: string, config: ColorConfig): void {
		const rules: string[] = [];
		// Only need to escape " and \ inside a quoted CSS string attribute value.
		// CSS.escape() is for unquoted selectors and would wrongly escape "/" and "." in paths.
		const escapedPath = basePath.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

		for (const [col, colorMap] of Object.entries(config.columns)) {
			for (const [rawValue, color] of Object.entries(colorMap)) {
				if (!color) continue;
				const sanitized = sanitizeValue(rawValue);
				if (!sanitized) continue;

				if (col === '*') {
					rules.push(
						`[data-bases-local-colors-id="${escapedPath}"] .multi-select-pill[data-blc-value="${sanitized}"] { background-color: ${color} !important; color: white; }`
					);
				} else {
					const escapedCol = col.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
					rules.push(
						`[data-bases-local-colors-id="${escapedPath}"] .multi-select-pill[data-blc-col="${escapedCol}"][data-blc-value="${sanitized}"] { background-color: ${color} !important; color: white; }`
					);
				}
			}
		}

		this.rulesByBase.set(basePath, rules);
		this.rebuild();
	}

	clearRulesForBase(basePath: string): void {
		this.rulesByBase.delete(basePath);
		this.rebuild();
	}

	clearAll(): void {
		this.rulesByBase.clear();
		this.styleEl.textContent = '';
	}

	private rebuild(): void {
		const all: string[] = [];
		for (const rules of this.rulesByBase.values()) all.push(...rules);
		this.styleEl.textContent = all.join('\n');
	}

	destroy(): void {
		this.clearAll();
		this.styleEl.remove();
	}
}
