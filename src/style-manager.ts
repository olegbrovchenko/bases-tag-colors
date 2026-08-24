import { ColorConfig, PluginSettings } from './types';
import { sanitizeValue, generateColorFromText } from './config-io';

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

// Only " and \ need escaping inside a quoted CSS attribute string.
// CSS.escape() is for unquoted selectors and would wrongly escape "/" and "." in paths.
function escapeAttr(value: string): string {
	return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export class StyleManager {
	private styleEl: HTMLStyleElement;
	private rulesByBase: Map<string, string[]> = new Map();
	// basePath → (sanitized value → generated color); rebuilt into rules BEFORE
	// the configured rules so a configured color always wins at equal specificity
	private autoColorsByBase: Map<string, Map<string, string>> = new Map();
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
		const escapedPath = escapeAttr(basePath);

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
					const escapedCol = escapeAttr(col);
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
	setShape(shape: PluginSettings): void {
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
		this.autoColorsByBase.delete(basePath);
		this.rebuild();
	}

	// Register newly-seen pill values for a base; generates a stable hash color
	// for each. No-ops (no rebuild) when nothing new appeared.
	addAutoValuesForBase(basePath: string, sanitizedValues: string[]): void {
		let colors = this.autoColorsByBase.get(basePath);
		if (!colors) {
			colors = new Map();
			this.autoColorsByBase.set(basePath, colors);
		}
		let changed = false;
		for (const v of sanitizedValues) {
			if (!colors.has(v)) {
				colors.set(v, generateColorFromText(v));
				changed = true;
			}
		}
		if (changed) this.rebuild();
	}

	clearAllAutoColors(): void {
		this.autoColorsByBase.clear();
		this.rebuild();
	}

	clearAll(): void {
		this.rulesByBase.clear();
		this.styleEl.textContent = '';
	}

	private rebuild(): void {
		const all: string[] = [];
		if (this.shapeRule) all.push(this.shapeRule);
		// Auto rules first: configured rules follow and win ties by source order
		// (sanitized values are \w-only, safe in a quoted attribute selector)
		for (const [basePath, colors] of this.autoColorsByBase.entries()) {
			const escapedPath = escapeAttr(basePath);
			for (const [value, color] of colors.entries()) {
				all.push(
					`[data-bases-tag-colors-id="${escapedPath}"] .multi-select-pill[data-blc-value="${value}"] { background-color: ${color} !important; color: ${textColorFor(color)}; }`
				);
			}
		}
		for (const rules of this.rulesByBase.values()) all.push(...rules);
		this.styleEl.textContent = all.join('\n');
	}

	destroy(): void {
		this.clearAll();
		this.styleEl.remove();
	}
}
