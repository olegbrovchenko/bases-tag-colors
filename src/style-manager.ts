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
			// --pill-padding-x is zeroed on purpose: core feeds it into the
			// content's margin-inline-start AND the remove button's
			// margin-inline-end, so leaving it set doubles the horizontal cost
			// on top of our own padding. With it at 0 our padding is the single
			// source of pill width; gap owns the text-to-X distance.
			this.shapeRule =
				`[data-bases-tag-colors-id] .multi-select-pill { ` +
				`--pill-padding-x: 0px; --pill-padding-y: ${py}px; --pill-radius: ${br}px; ` +
				`padding: ${py}px ${px}px !important; border-radius: ${br}px !important; ` +
				`gap: 3px !important; align-items: center !important; }\n` +
				// No optical trim: centering the caps-only band shoves descender
				// glyphs (open, manager) into the bottom edge. Stock font-box
				// centering is the correct compromise for mixed-case tag values.
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
		if (this.shapeRule) all.push(this.shapeRule);
		for (const rules of this.rulesByBase.values()) all.push(...rules);
		this.styleEl.textContent = all.join('\n');
	}

	destroy(): void {
		this.clearAll();
		this.styleEl.remove();
	}
}
