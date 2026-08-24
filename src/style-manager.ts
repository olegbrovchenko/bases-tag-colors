import { ColorConfig, PluginSettings } from './types';
import { sanitizeValue, generateColorFromText } from './config-io';

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

// A hand-edited colors.json can hold anything; only real color literals may
// reach a pill's CSS variables.
const COLOR_RE = /^(#[0-9a-fA-F]{3}|#[0-9a-fA-F]{6}|rgba?\(\s*[\d.,%\s/]+\))$/;

// sanitized value → color
type ValueColors = Map<string, string>;
// column name ('*' = any column) → value colors
type ColumnColors = Map<string, ValueColors>;

function parseColumns(config: ColorConfig): ColumnColors {
	const columns: ColumnColors = new Map();
	if (typeof config.columns !== 'object' || config.columns === null) return columns;
	for (const [col, colorMap] of Object.entries(config.columns)) {
		if (typeof colorMap !== 'object' || colorMap === null) continue;
		for (const [rawValue, color] of Object.entries(colorMap)) {
			if (typeof color !== 'string' || !COLOR_RE.test(color)) continue;
			const sanitized = sanitizeValue(rawValue);
			if (!sanitized) continue;
			let values = columns.get(col);
			if (!values) {
				values = new Map();
				columns.set(col, values);
			}
			values.set(sanitized, color);
		}
	}
	return columns;
}

// Paints pills directly: each colored pill gets .blc-colored plus per-element
// --blc-bg/--blc-fg variables (setCssProps); the matching rules live in
// styles.css. No stylesheet is ever generated or injected.
export class StyleManager {
	private configByBase: Map<string, ColumnColors> = new Map();
	// basePath → (sanitized value → generated color); a configured color always
	// wins over these — precedence is explicit in resolveBaseColor
	private autoColorsByBase: Map<string, ValueColors> = new Map();
	// Note Properties panel: configured colors (merged across all bases) + auto colors
	private propertyConfig: ColumnColors = new Map();
	private propertyAutoColors: ValueColors = new Map();

	setColorsForBase(basePath: string, config: ColorConfig): void {
		this.configByBase.set(basePath, parseColumns(config));
		this.repaintBase(basePath);
	}

	// Global pill shape (padding / border-radius), applied to ALL pills inside
	// tagged bases views — and the note Properties panel when that coloring is
	// on — so rows stay uniform whether or not a pill is colored. The rules live
	// in styles.css, gated on body classes; only the three size variables are
	// set here. They zero Obsidian's --pill-padding-x on purpose: core feeds it
	// into the content's margin-inline-start AND the remove button's
	// margin-inline-end, so leaving it set doubles the horizontal cost on top
	// of our own padding.
	setShape(shape: PluginSettings): void {
		const body = document.body;
		body.toggleClass('blc-shape', shape.customShape);
		body.toggleClass('blc-shape-props', shape.customShape && shape.propertiesColor);
		if (shape.customShape) {
			body.setCssProps({
				'--blc-px': `${Math.round(shape.paddingX)}px`,
				'--blc-py': `${Math.round(shape.paddingY)}px`,
				'--blc-br': `${Math.round(shape.borderRadius)}px`,
			});
		} else {
			body.setCssProps({ '--blc-px': '', '--blc-py': '', '--blc-br': '' });
		}
	}

	clearColorsForBase(basePath: string): void {
		this.configByBase.delete(basePath);
		this.autoColorsByBase.delete(basePath);
		this.repaintBase(basePath);
	}

	// Register newly-seen pill values for a base; generates a stable hash color
	// for each. On new values, repaints EVERY view of the base — a second pane
	// showing the same base must pick them up now, not on its next mutation.
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
		if (changed) this.repaintBase(basePath);
	}

	clearAllAutoColors(): void {
		this.autoColorsByBase.clear();
		this.propertyAutoColors.clear();
		this.repaintAll();
	}

	// Colors for the note Properties panel, merged from every base's config.
	// Column-specific entries match the property key; '*' entries match any.
	// Later bases overwrite earlier on collisions.
	setPropertyColors(configs: ColorConfig[]): void {
		const merged: ColumnColors = new Map();
		for (const config of configs) {
			for (const [col, values] of parseColumns(config).entries()) {
				let target = merged.get(col);
				if (!target) {
					target = new Map();
					merged.set(col, target);
				}
				for (const [value, color] of values.entries()) target.set(value, color);
			}
		}
		this.propertyConfig = merged;
		this.paintProperties();
	}

	// Painting is the caller's job (processPropertyPills always paints after)
	addPropertyAutoValues(sanitizedValues: string[]): void {
		for (const v of sanitizedValues) {
			if (!this.propertyAutoColors.has(v)) {
				this.propertyAutoColors.set(v, generateColorFromText(v));
			}
		}
	}

	clearPropertyColors(): void {
		this.propertyConfig = new Map();
		this.propertyAutoColors.clear();
		this.paintProperties();
	}

	// ── Painting ─────────────────────────────────────────────────────────

	paintView(rootEl: HTMLElement, basePath: string): void {
		rootEl.querySelectorAll<HTMLElement>('.multi-select-pill[data-blc-value]').forEach(pill => {
			const value = pill.getAttribute('data-blc-value');
			if (!value) return;
			const col = pill.getAttribute('data-blc-col');
			this.applyPaint(pill, this.resolveBaseColor(basePath, col, value));
		});
	}

	// Column matching rides the panel's own data-property-key attribute
	paintProperties(): void {
		document.body
			.querySelectorAll<HTMLElement>('.metadata-property .multi-select-pill[data-blc-value]')
			.forEach(pill => {
				const value = pill.getAttribute('data-blc-value');
				if (!value) return;
				const key = pill.closest('.metadata-property')?.getAttribute('data-property-key') ?? null;
				this.applyPaint(pill, this.resolvePropertyColor(key, value));
			});
	}

	unpaintPill(pill: HTMLElement): void {
		pill.removeClass('blc-colored');
		pill.setCssProps({ '--blc-bg': '', '--blc-fg': '' });
	}

	// Precedence: configured column-specific > configured '*' > auto
	private resolveBaseColor(basePath: string, col: string | null, value: string): string | null {
		const config = this.configByBase.get(basePath);
		if (config) {
			const specific = col ? config.get(col)?.get(value) : undefined;
			if (specific) return specific;
			const any = config.get('*')?.get(value);
			if (any) return any;
		}
		return this.autoColorsByBase.get(basePath)?.get(value) ?? null;
	}

	private resolvePropertyColor(key: string | null, value: string): string | null {
		const specific = key ? this.propertyConfig.get(key)?.get(value) : undefined;
		if (specific) return specific;
		const any = this.propertyConfig.get('*')?.get(value);
		if (any) return any;
		return this.propertyAutoColors.get(value) ?? null;
	}

	private applyPaint(pill: HTMLElement, color: string | null): void {
		if (color) {
			pill.addClass('blc-colored');
			pill.setCssProps({ '--blc-bg': color, '--blc-fg': textColorFor(color) });
		} else if (pill.hasClass('blc-colored')) {
			this.unpaintPill(pill);
		}
	}

	private baseRoots(): HTMLElement[] {
		return Array.from(document.querySelectorAll<HTMLElement>('[data-bases-tag-colors-id]'));
	}

	private repaintBase(basePath: string): void {
		for (const root of this.baseRoots()) {
			if (root.getAttribute('data-bases-tag-colors-id') === basePath) {
				this.paintView(root, basePath);
			}
		}
	}

	private repaintAll(): void {
		for (const root of this.baseRoots()) {
			const basePath = root.getAttribute('data-bases-tag-colors-id');
			if (basePath) this.paintView(root, basePath);
		}
		this.paintProperties();
	}

	destroy(): void {
		this.configByBase.clear();
		this.autoColorsByBase.clear();
		this.propertyConfig = new Map();
		this.propertyAutoColors.clear();
		document.querySelectorAll<HTMLElement>('.blc-colored').forEach(pill => this.unpaintPill(pill));
		document.body.removeClass('blc-shape', 'blc-shape-props');
		document.body.setCssProps({ '--blc-px': '', '--blc-py': '', '--blc-br': '' });
	}
}
