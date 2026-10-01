import { sanitizeValue } from './config-io';
import { PILL_SELECTOR, pillText } from './selectors';

// Walks all value elements (table pills + card values) inside viewRoot, stamps data-blc-value + data-blc-col.
// Idempotent: safe to call multiple times on the same DOM.
// Returns the sanitized values it stamped, for auto-color registration.
export function processBaseView(viewRoot: HTMLElement): string[] {
	const values: string[] = [];
	viewRoot.querySelectorAll<HTMLElement>(PILL_SELECTOR).forEach(pill => {
		const rawText = pillText(pill);
		if (!rawText) return;

		const sanitized = sanitizeValue(rawText);
		if (!sanitized) return;

		pill.setAttribute('data-blc-value', sanitized);
		values.push(sanitized);

		const tdEl = pill.closest('[data-property]') as HTMLElement | null;
		const col = tdEl?.getAttribute('data-property');
		if (col) {
			pill.setAttribute('data-blc-col', col);
		}
	});
	return values;
}
