/**
 * `==highlight==` (Obsidian's syntax, which Read mode draws as <mark>) is
 * drawn highlighted in the editor too. The `==` show only while the cursor
 * is at the highlight, faintly; the text of the note is untouched.
 * Mod+Shift+H wraps the selection in `==` (or unwraps a highlight).
 */

import { $prose } from '@milkdown/kit/utils';
import { Plugin, PluginKey, TextSelection, type EditorState } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view';
import type { Node as PMNode } from '@milkdown/kit/prose/model';

const key = new PluginKey<DecorationSet>('kurumi-highlight');

/** Read mode's rule (MarkdownRenderer): `==` … `==` with no `==` inside. */
const HIGHLIGHT = /==((?:[^=\n￼]|=[^=\n￼])+?)==/g;

export interface HighlightRange {
	from: number;
	to: number;
}

/** The highlights in a textblock starting at `start` (inside it). Code is skipped. */
function highlightsIn(block: PMNode, start: number): HighlightRange[] {
	// One character per position: text as is, any other inline node as U+FFFC.
	let text = '';
	const code: boolean[] = [];
	block.forEach((child) => {
		const value = child.isText ? child.text! : '￼';
		const isCode = child.marks.some((m) => m.type.name === 'inlineCode' || m.type.name === 'code');
		text += value;
		for (let i = 0; i < value.length; i++) code.push(isCode);
	});
	const found: HighlightRange[] = [];
	for (const match of text.matchAll(HIGHLIGHT)) {
		const from = match.index!;
		const to = from + match[0].length;
		if (code.slice(from, to).some(Boolean)) continue;
		found.push({ from: start + from, to: start + to });
	}
	return found;
}

export function findHighlights(doc: PMNode): HighlightRange[] {
	const found: HighlightRange[] = [];
	doc.descendants((node, pos) => {
		if (!node.isTextblock) return true;
		if (node.type.name !== 'code_block' && node.type.name !== 'toggle_summary') found.push(...highlightsIn(node, pos + 1));
		return false;
	});
	return found;
}

function decorate(state: EditorState): DecorationSet {
	const { from, to } = state.selection;
	const decorations: Decoration[] = [];
	for (const range of findHighlights(state.doc)) {
		const editing = from <= range.to && to >= range.from;
		const marker = editing ? 'md-marker' : 'md-marker-hidden';
		decorations.push(
			Decoration.inline(range.from + 2, range.to - 2, { class: 'kurumi-highlight' }),
			Decoration.inline(range.from, range.from + 2, { class: marker }),
			Decoration.inline(range.to - 2, range.to, { class: marker })
		);
	}
	return DecorationSet.create(state.doc, decorations);
}

/** Wrap the selection in `==`, or take them away from the highlight it is in. */
export function toggleHighlight(view: EditorView): boolean {
	const { state } = view;
	const { from, to, $from } = state.selection;
	if (!$from.parent.isTextblock || $from.parent.type.name === 'code_block') return false;
	const around = findHighlights(state.doc).find((r) => r.from <= from && r.to >= to);
	if (around) {
		const tr = state.tr.delete(around.to - 2, around.to).delete(around.from, around.from + 2);
		tr.setSelection(TextSelection.create(tr.doc, Math.max(around.from, from - 2), Math.max(around.from, to - 2)));
		view.dispatch(tr);
		return true;
	}
	if (from === to || !state.doc.resolve(to).sameParent($from)) return false;
	const tr = state.tr.insertText('==', to).insertText('==', from);
	tr.setSelection(TextSelection.create(tr.doc, from + 2, to + 2));
	view.dispatch(tr);
	return true;
}

export const highlightTextPlugin = $prose(
	() =>
		new Plugin<DecorationSet>({
			key,
			state: {
				init: (_, state) => decorate(state),
				apply: (tr, old, _old, state) => (tr.docChanged || tr.selectionSet ? decorate(state) : old)
			},
			props: {
				decorations(state) {
					return key.getState(state);
				},
				handleKeyDown(view, event) {
					if (!(event.metaKey || event.ctrlKey) || !event.shiftKey || event.altKey || event.key.toLowerCase() !== 'h') return false;
					if (!toggleHighlight(view)) return false;
					event.preventDefault();
					return true;
				}
			}
		})
);
