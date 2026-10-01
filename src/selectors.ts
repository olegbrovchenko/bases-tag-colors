// Every element Bases uses to render a list/tag value, across view types.
// Table view renders `.multi-select-pill`; Cards view renders `.value-list-element`
// inside `.bases-cards-line`; Kanban renders it inside `.bases-kanban-card-line`.
// If a future Bases view uses different markup, add its selector here.
export const PILL_SELECTOR = [
	'.multi-select-pill',
	'.bases-cards-line .value-list-element',
	'.bases-kanban-card-line .value-list-element',
].join(', ');

// Visible text of a value, whichever markup it uses
export function pillText(pill: Element): string {
	const contentEl = pill.querySelector('.multi-select-pill-content');
	return (contentEl?.textContent ?? pill.textContent ?? '').trim();
}

// Stamped pills only, built once: `.multi-select-pill[data-blc-value], ...`
export const STAMPED_SELECTOR = PILL_SELECTOR.split(', ').map(s => `${s}[data-blc-value]`).join(', ');
