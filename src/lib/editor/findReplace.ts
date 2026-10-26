/**
 * Find & replace inside the editor. The plugin holds the query and the
 * current match, decorates every match, and exposes commands the find
 * bar (FindBar.svelte) calls. Matches are found per textblock, so they
 * can span bold/italic boundaries but not paragraphs.
 */

import { $prose } from '@milkdown/kit/utils';
import { Plugin, PluginKey, TextSelection, type EditorState } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view';

export interface FindState {
	query: string;
	caseSensitive: boolean;
	matches: { from: number; to: number }[];
	current: number; // index into matches, -1 when none
}

const findKey = new PluginKey<FindState>('find-replace');
const EMPTY: FindState = { query: '', caseSensitive: false, matches: [], current: -1 };

export function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function findMatches(state: EditorState, query: string, caseSensitive: boolean) {
	const matches: { from: number; to: number }[] = [];
	if (!query) return matches;
	const re = new RegExp(escapeRegExp(query), caseSensitive ? 'g' : 'gi');
	state.doc.descendants((node, pos) => {
		if (!node.isTextblock) return true;
		// One char per inline position (leaf nodes become U+FFFC), so string
		// offsets map 1:1 onto document positions inside the block.
		const text = node.textBetween(0, node.content.size, undefined, '￼');
		for (const m of text.matchAll(re)) {
			const from = pos + 1 + m.index!;
			matches.push({ from, to: from + m[0].length });
		}
		return false;
	});
	return matches;
}

function recompute(state: EditorState, prev: FindState, query: string, caseSensitive: boolean): FindState {
	const matches = findMatches(state, query, caseSensitive);
	if (!matches.length) return { query, caseSensitive, matches, current: -1 };
	// Keep the current match near where it was (or the cursor).
	const anchor = prev.matches[prev.current]?.from ?? state.selection.from;
	const current = Math.max(0, matches.findIndex((m) => m.to >= anchor));
	return { query, caseSensitive, matches, current };
}

export const findReplacePlugin = $prose(
	() =>
		new Plugin<FindState>({
			key: findKey,
			state: {
				init: () => EMPTY,
				apply(tr, prev, _old, state) {
					const meta = tr.getMeta(findKey) as Partial<FindState> | undefined;
					if (meta) {
						if (meta.current !== undefined && meta.query === undefined) {
							return { ...prev, current: meta.current };
						}
						return recompute(state, prev, meta.query ?? prev.query, meta.caseSensitive ?? prev.caseSensitive);
					}
					if (tr.docChanged && prev.query) return recompute(state, prev, prev.query, prev.caseSensitive);
					return prev;
				}
			},
			props: {
				decorations(state) {
					const find = findKey.getState(state);
					if (!find?.matches.length) return null;
					return DecorationSet.create(
						state.doc,
						find.matches.map((m, i) =>
							Decoration.inline(m.from, m.to, {
								class: i === find.current ? 'find-match find-current' : 'find-match'
							})
						)
					);
				}
			}
		})
);

export function getFindState(view: EditorView): FindState {
	return findKey.getState(view.state) ?? EMPTY;
}

export function setFindQuery(view: EditorView, query: string, caseSensitive: boolean): void {
	view.dispatch(view.state.tr.setMeta(findKey, { query, caseSensitive }));
	revealCurrent(view);
}

export function clearFind(view: EditorView): void {
	view.dispatch(view.state.tr.setMeta(findKey, { query: '' }));
}

// Scroll the current match into view without moving focus out of the bar.
function revealCurrent(view: EditorView): void {
	const { matches, current } = getFindState(view);
	const match = matches[current];
	if (!match) return;
	const dom = view.domAtPos(match.from);
	const el = (dom.node.nodeType === 1 ? dom.node : dom.node.parentElement) as HTMLElement | null;
	el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

export function stepMatch(view: EditorView, delta: 1 | -1): void {
	const { matches, current } = getFindState(view);
	if (!matches.length) return;
	const next = (current + delta + matches.length) % matches.length;
	view.dispatch(view.state.tr.setMeta(findKey, { current: next }));
	revealCurrent(view);
}

export function replaceCurrent(view: EditorView, replacement: string): void {
	const { matches, current } = getFindState(view);
	const match = matches[current];
	if (!match) return;
	const tr = view.state.tr;
	if (replacement) tr.insertText(replacement, match.from, match.to);
	else tr.delete(match.from, match.to);
	view.dispatch(tr);
	revealCurrent(view);
}

export function replaceAll(view: EditorView, replacement: string): number {
	const { matches } = getFindState(view);
	if (!matches.length) return 0;
	const tr = view.state.tr;
	// Back to front so earlier positions stay valid.
	for (const m of [...matches].reverse()) {
		if (replacement) tr.insertText(replacement, m.from, m.to);
		else tr.delete(m.from, m.to);
	}
	view.dispatch(tr);
	return matches.length;
}

/** Put the cursor on the current match and focus the editor (Enter / Escape). */
export function focusCurrentMatch(view: EditorView): void {
	const { matches, current } = getFindState(view);
	const match = matches[current];
	if (match) view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, match.from, match.to)));
	view.focus();
}
