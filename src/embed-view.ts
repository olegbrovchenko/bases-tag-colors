import { App } from 'obsidian';

// An embedded base (`![[Something.base]]`) renders inside a markdown leaf as
// `div.internal-embed.bases-embed` (reading view) or `span.internal-embed.bases-embed`
// (live preview), each holding its own `.bases-view`. The `src` attribute carries
// the link text exactly as written in the note, so it must be resolved against
// the embedding note's path.
const EMBED_SELECTOR = '.internal-embed.bases-embed';

export function containsBasesEmbed(el: HTMLElement): boolean {
	return !!(el.matches?.(EMBED_SELECTOR) || el.querySelector?.(EMBED_SELECTOR));
}

// Tag every embedded base view inside containerEl with data-bases-tag-colors-id.
// Returns basePath → tagged root elements (a note open in both editing and
// reading mode holds one embed element per mode; several embeds of the same
// base collapse onto one key).
export function tagEmbeds(
	app: App,
	containerEl: HTMLElement,
	sourcePath: string
): Map<string, HTMLElement[]> {
	const roots = new Map<string, HTMLElement[]>();
	containerEl.querySelectorAll<HTMLElement>(EMBED_SELECTOR).forEach(embedEl => {
		const src = embedEl.getAttribute('src');
		if (!src) return;
		// `src` may carry a `#ViewName` subpath selecting a specific base view
		const linkpath = src.split('#')[0];
		const file = app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath);
		if (!file) return;
		const rootEl = (embedEl.querySelector('.bases-view') as HTMLElement | null) ?? embedEl;
		rootEl.setAttribute('data-bases-tag-colors-id', file.path);
		const list = roots.get(file.path);
		if (list) {
			list.push(rootEl);
		} else {
			roots.set(file.path, [rootEl]);
		}
	});
	return roots;
}
