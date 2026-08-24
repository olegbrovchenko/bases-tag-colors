import { ColorConfig, PillShapeSettings } from './types';
import { sanitizeValue } from './config-io';

const STYLE_ID = 'bases-tag-colors-style';

export class StyleManager {
	private styleEl: HTMLStyleElement;
	private rulesByBase: Map<string, string[]> = new Map();
	private shapeRule: string = '';

	constructor() {
		this.styleEl = this.getOrCreate();
	}

	private getOrCreate(): HTMLStyleElement {
		let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
		if (!el || !el.isConnected) {
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
				if (!color || !/^#[0-9a-fA-F]{3}$|^#[0-9a-fA-F]{6}$|^rgba?\(/.test(color)) continue;
				const sanitized = sanitizeValue(rawValue);
				if (!sanitized) continue;

				if (col === '*') {
					rules.push(
						`[data-bases-tag-colors-id="${escapedPath}"] .multi-select-pill[data-blc-value="${sanitized}"] { background-color: ${color} !important; color: white; }`
					);
				} else {
					const escapedCol = col.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
					rules.push(
						`[data-bases-tag-colors-id="${escapedPath}"] .multi-select-pill[data-blc-col="${escapedCol}"][data-blc-value="${sanitized}"] { background-color: ${color} !important; color: white; }`
					);
				}
			}
		}

		this.rulesByBase.set(basePath, rules);
		this.rebuild();
	}

	// Global pill shape (padding / border-radius), applied to ALL pills inside
	// tagged bases views so rows stay uniform whether or not a pill is colored.
	// Sets Obsidian's --pill-* variables AND the properties directly, so it wins
	// against both var-based and hardcoded theme styles.
	setShape(shape: PillShapeSettings): void {
		if (!shape.customShape) {
			this.shapeRule = '';
		} else {
			const px = Math.round(shape.paddingX);
			const py = Math.round(shape.paddingY);
			const br = Math.round(shape.borderRadius);
			this.shapeRule =
				`[data-bases-tag-colors-id] .multi-select-pill { ` +
				`--pill-padding-x: ${px}px; --pill-padding-y: ${py}px; --pill-radius: ${br}px; ` +
				`padding: ${py}px ${px}px !important; border-radius: ${br}px !important; ` +
				`align-items: center !important; }\n` +
				// line-height:1 kills the descender-reserve gap that makes caps-only
				// values look pushed toward the top of the pill
				`[data-bases-tag-colors-id] .multi-select-pill .multi-select-pill-content { ` +
				`line-height: 1 !important; }`;
		}
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
