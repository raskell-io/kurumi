/**
 * `![[Title]]` on a line of its own renders the target note below it
 * (Obsidian-style embed). The rendered note is a read-only widget that
 * follows edits to the embedded note; its source line shows only while
 * the cursor is in it, like a diagram's source. The card's title row (not
 * its buttons) puts the cursor there, and so do the arrow keys and
 * Backspace next to it: the line can't be skipped or merged unseen.
 */

import { $prose } from '@milkdown/kit/utils';
import { Plugin, PluginKey, TextSelection, type EditorState } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view';
import type { Node as PMNode } from '@milkdown/kit/prose/model';
import { mount, unmount } from 'svelte';
import NoteEmbed from '$lib/components/NoteEmbed.svelte';

const embedKey = new PluginKey<DecorationSet>('note-embed');
const EMBED_LINE = /^!\[\[([^\]]+)\]\]$/;

const embedTitle = (node: PMNode) =>
	node.isTextblock && node.type.name !== 'code_block' ? node.textContent.trim().match(EMBED_LINE)?.[1]?.trim() ?? null : null;

function findEmbeds(state: EditorState): DecorationSet {
	const { doc, selection } = state;
	const decorations: Decoration[] = [];
	const seen = new Map<string, number>();
	doc.descendants((node, pos) => {
		if (!node.isTextblock) return true;
		const title = embedTitle(node);
		if (title) {
			const n = (seen.get(title.toLowerCase()) ?? 0) + 1;
			seen.set(title.toLowerCase(), n);
			const end = pos + node.nodeSize;
			const editing = selection.from >= pos && selection.to <= end;
			decorations.push(Decoration.node(pos, end, { class: editing ? 'note-embed-source is-editing' : 'note-embed-source' }));
			decorations.push(
				Decoration.widget(
					end,
					(view: EditorView, getPos: () => number | undefined) => {
						const el = document.createElement('div');
						el.className = 'note-embed-widget';
						const component = mount(NoteEmbed, { target: el, props: { title } });
						(el as HTMLElement & { _unmount?: () => void })._unmount = () => unmount(component);
						// The title row, outside its buttons: edit the line it comes from.
						el.addEventListener('mousedown', (event) => {
							const target = event.target as HTMLElement;
							if (!target.closest('.note-embed-bar') || target.closest('button, a, textarea')) return;
							const at = getPos();
							if (at === undefined || !view.editable) return;
							event.preventDefault();
							view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at - 1)));
							view.focus();
						});
						return el;
					},
					{
						// Same title (nth occurrence) → reuse the widget across
						// edits instead of remounting it.
						key: `embed:${title.toLowerCase()}:${n}`,
						side: 1,
						ignoreSelection: true,
						stopEvent: () => true,
						destroy: (el) => (el as HTMLElement & { _unmount?: () => void })._unmount?.()
					}
				)
			);
		}
		return false;
	});
	return DecorationSet.create(doc, decorations);
}

/** The embed line just before (dir -1) or after (1) the cursor's textblock, if the cursor is at that edge. */
function embedBeside(view: EditorView, dir: -1 | 1): number | null {
	const { $from, empty } = view.state.selection;
	if (!empty || !$from.parent.isTextblock || embedTitle($from.parent)) return null;
	const edge = dir < 0 ? $from.before() : $from.after();
	const $edge = view.state.doc.resolve(edge);
	const neighbour = dir < 0 ? $edge.nodeBefore : $edge.nodeAfter;
	if (!neighbour || !embedTitle(neighbour)) return null;
	// Inside it: its end coming from below, its start coming from above.
	return dir < 0 ? edge - 1 : edge + 1;
}

export const noteEmbedPlugin = $prose(
	() =>
		new Plugin<DecorationSet>({
			key: embedKey,
			state: {
				init: (_, state) => findEmbeds(state),
				apply: (tr, old, _old, state) => (tr.docChanged || tr.selectionSet ? findEmbeds(state) : old)
			},
			props: {
				decorations(state) {
					return embedKey.getState(state);
				},
				handleKeyDown(view, event) {
					if (event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return false;
					const { $from } = view.state.selection;
					let dir: -1 | 1 | 0 = 0;
					if (event.key === 'ArrowUp' && view.endOfTextblock('up')) dir = -1;
					else if ((event.key === 'ArrowLeft' || event.key === 'Backspace') && $from.parentOffset === 0) dir = -1;
					else if (event.key === 'ArrowDown' && view.endOfTextblock('down')) dir = 1;
					else if (event.key === 'ArrowRight' && $from.parentOffset === $from.parent.content.size) dir = 1;
					if (!dir) return false;
					const target = embedBeside(view, dir);
					if (target === null) return false;
					event.preventDefault();
					view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, target)).scrollIntoView());
					return true;
				}
			}
		})
);
