import { sanitizeValue } from './config-io';

// Walks all .multi-select-pill elements inside viewRoot, stamps data-blc-value + data-blc-col.
// Idempotent: safe to call multiple times on the same DOM.
export function processBaseView(viewRoot: HTMLElement): void {
	viewRoot.querySelectorAll<HTMLElement>('.multi-select-pill').forEach(pill => {
		const contentEl = pill.querySelector('.multi-select-pill-content');
		const rawText = (contentEl?.textContent ?? pill.textContent ?? '').trim();
		if (!rawText) return;

		const sanitized = sanitizeValue(rawText);
		if (!sanitized) return;

		pill.setAttribute('data-blc-value', sanitized);

		const tdEl = pill.closest('[data-property]') as HTMLElement | null;
		const col = tdEl?.getAttribute('data-property');
		if (col) {
			pill.setAttribute('data-blc-col', col);
		}
	});
}
