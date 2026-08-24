import { ColorConfig, PillShapeSettings } from './types';
import { sanitizeValue } from './config-io';

const STYLE_ID = 'bases-tag-colors-style';

// White text is unreadable on light backgrounds; pick by perceived luminance (YIQ).
// Unparseable colors keep the historical white.
function textColorFor(color: string): string {
	let r: number, g: number, b: number;
	const hex = color.match(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
	const rgb = color.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/);
	if (hex) {
		let h = hex[1];
		if (h.length === 3) h = h.split('').map(c => c + c).join('');
		r = parseInt(h.slice(0, 2), 16);
		g = parseInt(h.slice(2, 4), 16);
		b = parseInt(h.slice(4, 6), 16);
	} else if (rgb) {
		r = Number(rgb[1]); g = Number(rgb[2]); b = Number(rgb[3]);
	} else {
		return 'white';
	}
	return (r * 299 + g * 587 + b * 114) / 1000 >= 150 ? '#1e1e1e' : 'white';
}

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
			if (typeof colorMap !== 'object' || colorMap === null) continue;
			for (const [rawValue, color] of Object.entries(colorMap)) {
				// Full-match only — a prefix test would let a crafted colors.json
				// inject arbitrary CSS into the shared stylesheet.
				if (typeof color !== 'string' || !/^(#[0-9a-fA-F]{3}|#[0-9a-fA-F]{6}|rgba?\(\s*[\d.,%\s/]+\))$/.test(color)) continue;
				const sanitized = sanitizeValue(rawValue);
				if (!sanitized) continue;
				const fg = textColorFor(color);

				if (col === '*') {
					rules.push(
						`[data-bases-tag-colors-id="${escapedPath}"] .multi-select-pill[data-blc-value="${sanitized}"] { background-color: ${color} !important; color: ${fg}; }`
					);
				} else {
					const escapedCol = col.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
					rules.push(
						`[data-bases-tag-colors-id="${escapedPath}"] .multi-select-pill[data-blc-col="${escapedCol}"][data-blc-value="${sanitized}"] { background-color: ${color} !important; color: ${fg}; }`
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
