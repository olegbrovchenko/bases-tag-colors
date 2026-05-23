import { App, WorkspaceLeaf, View } from 'obsidian';

// Obsidian's Bases view has a `file` property but the generic View type doesn't declare it.
interface BasesViewLike extends View {
	file?: { path: string };
	containerEl: HTMLElement;
}

export function getBasePath(leaf: WorkspaceLeaf): string | null {
	const view = leaf.view as BasesViewLike;
	if (view?.getViewType() !== 'bases') return null;

	// Fallback chain per plan section 1.2
	return (
		view.file?.path ??
		(leaf.getViewState()?.state?.file as string | undefined) ??
		null
	);
}

export function tagLeaf(leaf: WorkspaceLeaf, basePath: string): HTMLElement | null {
	const view = leaf.view as BasesViewLike;
	const containerEl = view.containerEl;
	if (!containerEl) return null;

	const basesView = containerEl.querySelector('.bases-view') as HTMLElement | null;
	if (!basesView) console.warn('[BasesLocalColors] .bases-view selector not found — Obsidian Bases DOM may have changed');
	const rootEl = basesView ?? containerEl;
	rootEl.setAttribute('data-bases-local-colors-id', basePath);
	return rootEl;
}

export function untagLeaf(leaf: WorkspaceLeaf): void {
	const view = leaf.view as BasesViewLike;
	const containerEl = view?.containerEl;
	if (!containerEl) return;

	containerEl
		.querySelectorAll('[data-bases-local-colors-id]')
		.forEach(el => el.removeAttribute('data-bases-local-colors-id'));
	containerEl.removeAttribute('data-bases-local-colors-id');
}

export function tagAllBasesLeaves(app: App): void {
	for (const leaf of app.workspace.getLeavesOfType('bases')) {
		const basePath = getBasePath(leaf);
		if (basePath) {
			tagLeaf(leaf, basePath);
		} else {
			console.warn('[BasesLocalColors] bases leaf found but path unavailable');
		}
	}
}
