/**
 * Toggle headings: a caret beside each heading folds its section (everything
 * up to the next heading of the same or a higher level), like Notion's toggle
 * headings and Obsidian's folding. Folds are a view setting, not content:
 * kept per device and note in localStorage, so the markdown stays plain.
 */

import { $prose } from '@milkdown/kit/utils';
import { Plugin, PluginKey, type EditorState, TextSelection } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view';
import { headingKey } from '$lib/wikilinks';

const key = new PluginKey<Set<string>>('heading-fold');
const storeKey = (noteId: string) => `kurumi-folds:${noteId}`;

function noteIdOf(view: EditorView): string | null {
	return view.dom.closest<HTMLElement>('[data-note-id]')?.dataset.noteId ?? null;
}

function loadFolds(noteId: string | null): Set<string> {
	if (!noteId) return new Set();
	try {
		return new Set(JSON.parse(localStorage.getItem(storeKey(noteId)) ?? '[]'));
	} catch {
		return new Set();
	}
}

function saveFolds(noteId: string | null, folds: Set<string>) {
	if (!noteId) return;
	try {
		if (folds.size) localStorage.setItem(storeKey(noteId), JSON.stringify([...folds]));
		else localStorage.removeItem(storeKey(noteId));
	} catch {
		/* private mode */
	}
}

function decorations(state: EditorState, folds: Set<string>): DecorationSet {
	const decos: Decoration[] = [];
	let hideBelow: number | null = null; // level of the folded heading we're inside
	state.doc.forEach((node, pos) => {
		const level = node.type.name === 'heading' ? (node.attrs.level as number) : null;
		if (level !== null && hideBelow !== null && level <= hideBelow) hideBelow = null;
		if (hideBelow !== null) {
			decos.push(Decoration.node(pos, pos + node.nodeSize, { class: 'fold-hidden' }));
			return;
		}
		if (level !== null) {
			// The caret is the heading's ::before (CSS), in the left margin: a
			// widget inside the heading would get in the way of the cursor.
			const k = headingKey(node.textContent);
			const folded = !!k && folds.has(k);
			if (k) {
				decos.push(
					Decoration.node(pos, pos + node.nodeSize, {
						class: folded ? 'foldable is-folded-heading' : 'foldable',
						'data-fold-key': k
					})
				);
			}
			if (folded) hideBelow = level;
		}
	});
	return DecorationSet.create(state.doc, decos);
}

export const headingFoldPlugin = $prose(
	() =>
		new Plugin<Set<string>>({
			key,
			state: {
				init: () => new Set(),
				apply: (tr, folds) => (tr.getMeta(key) as Set<string> | undefined) ?? folds
			},
			props: {
				decorations(state) {
					return decorations(state, key.getState(state) ?? new Set());
				},
				handleDOMEvents: {
					mousedown(view, event) {
						// A click in the margin left of a heading: its caret.
						const btn = (event.target as HTMLElement).closest<HTMLElement>('.foldable');
						if (!btn || event.clientX >= btn.getBoundingClientRect().left) return false;
						event.preventDefault();
						const k = btn.dataset.foldKey ?? '';
						const folds = new Set(key.getState(view.state));
						if (folds.has(k)) folds.delete(k);
						else folds.add(k);
						saveFolds(noteIdOf(view), folds);
						let tr = view.state.tr.setMeta(key, folds);
						// Don't leave the cursor inside what was just hidden.
						const { from } = view.state.selection;
						const $pos = view.state.doc.resolve(from);
						if ($pos.depth > 0) {
							const at = view.posAtDOM(btn, 0);
							const heading = view.state.doc.resolve(Math.min(at, view.state.doc.content.size));
							if (folds.has(k) && from > heading.pos) tr = tr.setSelection(TextSelection.near(view.state.doc.resolve(heading.end())));
						}
						view.dispatch(tr);
						return true;
					}
				}
			},
			view(view) {
				// Folds saved for this note, once the editor is in the page.
				queueMicrotask(() => {
					const folds = loadFolds(noteIdOf(view));
					if (folds.size) view.dispatch(view.state.tr.setMeta(key, folds));
				});
				return {};
			}
		})
);
