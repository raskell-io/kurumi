/**
 * Callouts in the editor: a quote whose first line starts with `[!type]`
 * ($lib/callouts) is drawn as Read mode draws it, a tinted box with an icon
 * and a title, while the text stays an ordinary quote. Only decorations:
 * the document, and so the Markdown, is exactly what it was.
 *
 * - The marker is hidden; the cursor never rests inside it.
 * - The rest of the first line is the title (bold, in the callout's colour);
 *   without one, the type's name shows in its place until you type one.
 * - The icon is a button: it changes the type, or makes it a plain quote.
 * - Backspace at the start of the title turns it into a plain quote (the
 *   marker goes, the text stays); a second Backspace lifts it out.
 */

import { $prose } from '@milkdown/kit/utils';
import { Plugin, PluginKey, TextSelection, Selection, type EditorState, type Transaction } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view';
import type { Node as PMNode } from '@milkdown/kit/prose/model';
import { mount, unmount, type Component } from 'svelte';
import { Info, StickyNote, Lightbulb, CircleCheck, TriangleAlert, OctagonAlert, Quote } from 'lucide-svelte';
import { CALLOUT_LABELS, CALLOUT_TYPES, parseCalloutMarker, type CalloutType } from '$lib/callouts';
import { openPopupMenu } from './popupMenu';

const key = new PluginKey<DecorationSet>('kurumi-callout');

const ICONS: Record<CalloutType, Component<{ size?: number }>> = {
	info: Info as unknown as Component<{ size?: number }>,
	note: StickyNote as unknown as Component<{ size?: number }>,
	tip: Lightbulb as unknown as Component<{ size?: number }>,
	success: CircleCheck as unknown as Component<{ size?: number }>,
	warning: TriangleAlert as unknown as Component<{ size?: number }>,
	danger: OctagonAlert as unknown as Component<{ size?: number }>,
	quote: Quote as unknown as Component<{ size?: number }>
};

export interface Callout {
	/** The quote. */
	pos: number;
	type: CalloutType;
	/** `[!type]` and the spaces after it. */
	markerFrom: number;
	markerTo: number;
	/** The marker without the spaces after it. */
	bareTo: number;
	/** Where the title ends: the first line break, or the paragraph's end. */
	titleEnd: number;
	/** That line break, if the body follows on the same paragraph. */
	breakPos: number | null;
}

function calloutOf(node: PMNode, pos: number): Callout | null {
	if (node.type.name !== 'blockquote') return null;
	const first = node.firstChild;
	if (!first || first.type.name !== 'paragraph') return null;
	const lead = first.firstChild;
	if (!lead?.isText) return null;
	const marker = parseCalloutMarker(lead.text ?? '');
	if (!marker) return null;
	const start = pos + 2; // inside the quote, inside its paragraph
	let breakPos: number | null = null;
	first.forEach((child, offset) => {
		if (breakPos === null && child.type.name === 'hardbreak') breakPos = start + offset;
	});
	return {
		pos,
		type: marker.type,
		markerFrom: start,
		markerTo: start + marker.length,
		bareTo: start + marker.bare,
		titleEnd: breakPos ?? start + first.content.size,
		breakPos
	};
}

export function findCallouts(doc: PMNode): Callout[] {
	const found: Callout[] = [];
	doc.descendants((node, pos) => {
		if (node.isTextblock) return false;
		const callout = calloutOf(node, pos);
		if (callout) found.push(callout);
		return true;
	});
	return found;
}

/** The callout whose first line holds `pos`. */
function calloutAt(state: EditorState, pos: number): Callout | null {
	const $pos = state.doc.resolve(pos);
	for (let depth = $pos.depth; depth > 0; depth--) {
		const node = $pos.node(depth);
		if (node.type.name === 'blockquote') {
			const callout = calloutOf(node, $pos.before(depth));
			return callout && pos >= callout.markerFrom && pos <= callout.titleEnd ? callout : null;
		}
	}
	return null;
}

/** Make the callout at `pos` (the quote) another type, or a plain quote (`null`). */
export function setCalloutType(view: EditorView, quotePos: number, type: CalloutType | null) {
	const node = view.state.doc.nodeAt(quotePos);
	const callout = node && calloutOf(node, quotePos);
	if (!callout) return;
	const tr = type
		? view.state.tr.insertText(`[!${type}]`, callout.markerFrom, callout.bareTo)
		: view.state.tr.delete(callout.markerFrom, callout.markerTo);
	const at = type ? Math.min(tr.mapping.map(callout.markerTo), tr.doc.content.size) : callout.markerFrom;
	tr.setSelection(TextSelection.near(tr.doc.resolve(at)));
	view.dispatch(tr);
	view.focus();
}

function iconWidget(callout: Callout) {
	return Decoration.widget(
		callout.markerFrom,
		(view: EditorView, getPos: () => number | undefined) => {
			const button = document.createElement('button');
			button.type = 'button';
			button.className = 'callout-icon';
			button.contentEditable = 'false';
			button.setAttribute('aria-haspopup', 'menu');
			button.setAttribute('aria-expanded', 'false');
			button.setAttribute('aria-label', `${CALLOUT_LABELS[callout.type]} callout: change type`);
			button.title = 'Change the callout’s type';
			const icon = mount(ICONS[callout.type], { target: button, props: { size: 16 } });
			(button as HTMLElement & { _unmount?: () => void })._unmount = () => void unmount(icon);
			button.addEventListener('mousedown', (event) => event.preventDefault());
			button.addEventListener('click', (event) => {
				event.preventDefault();
				if (!view.editable) return;
				const pos = getPos();
				if (pos === undefined) return;
				const quotePos = pos - 2;
				openPopupMenu(
					button,
					'Callout type',
					[
						...CALLOUT_TYPES.map((type) => ({
							label: CALLOUT_LABELS[type],
							checked: type === callout.type,
							run: () => setCalloutType(view, quotePos, type)
						})),
						'sep',
						{ label: 'Plain quote', run: () => setCalloutType(view, quotePos, null) }
					],
					(refocus) => {
						if (refocus) view.focus();
					}
				);
			});
			return button;
		},
		{
			side: -1,
			key: `callout-icon:${callout.type}`,
			ignoreSelection: true,
			stopEvent: () => true,
			destroy: (dom) => (dom as HTMLElement & { _unmount?: () => void })._unmount?.()
		}
	);
}

function decorate(doc: PMNode): DecorationSet {
	const decorations: Decoration[] = [];
	for (const callout of findCallouts(doc)) {
		const node = doc.nodeAt(callout.pos)!;
		decorations.push(
			Decoration.node(callout.pos, callout.pos + node.nodeSize, {
				class: `kurumi-callout callout-${callout.type}`,
				'data-callout': callout.type
			}),
			iconWidget(callout),
			Decoration.inline(callout.markerFrom, callout.markerTo, { class: 'callout-marker' })
		);
		if (callout.titleEnd > callout.markerTo) {
			decorations.push(Decoration.inline(callout.markerTo, callout.titleEnd, { class: 'callout-title' }));
		} else {
			const label = CALLOUT_LABELS[callout.type];
			decorations.push(
				Decoration.widget(
					callout.markerTo,
					() => {
						const span = document.createElement('span');
						span.className = 'callout-title callout-title-placeholder';
						span.textContent = label;
						return span;
					},
					{ side: 1, key: `callout-placeholder:${label}`, ignoreSelection: true }
				)
			);
		}
		if (callout.breakPos !== null) {
			decorations.push(Decoration.inline(callout.breakPos, callout.breakPos + 1, { class: 'callout-title-break' }));
		}
	}
	return DecorationSet.create(doc, decorations);
}

/** A cursor inside the hidden marker moves to just after it. */
function keepOutOfMarker(state: EditorState): Transaction | null {
	const { selection } = state;
	if (!selection.empty) return null;
	const callout = calloutAt(state, selection.from);
	if (!callout || selection.from >= callout.markerTo) return null;
	return state.tr.setSelection(TextSelection.create(state.doc, callout.markerTo));
}

export const calloutPlugin = $prose(
	() =>
		new Plugin<DecorationSet>({
			key,
			state: {
				init: (_, state) => decorate(state.doc),
				apply: (tr, old) => (tr.docChanged ? decorate(tr.doc) : old)
			},
			appendTransaction(_trs, _old, state) {
				return keepOutOfMarker(state);
			},
			props: {
				decorations(state) {
					return key.getState(state);
				},
				handleKeyDown(view, event) {
					const { state } = view;
					const { selection } = state;
					if (!selection.empty || event.altKey || event.metaKey || event.ctrlKey) return false;
					const callout = calloutAt(state, selection.from);
					if (!callout || selection.from !== callout.markerTo) return false;
					if (event.key === 'Backspace') {
						// The start of the title: the callout becomes a plain quote.
						event.preventDefault();
						setCalloutType(view, callout.pos, null);
						return true;
					}
					if (event.key === 'ArrowLeft') {
						// Over the hidden marker, to the end of what comes before.
						event.preventDefault();
						const before = Selection.findFrom(state.doc.resolve(callout.pos), -1, true);
						if (before) view.dispatch(state.tr.setSelection(before).scrollIntoView());
						return true;
					}
					return false;
				},
				handleTextInput(view, from, to, text) {
					// `[!info]` directly followed by a title wants a space between.
					const callout = calloutAt(view.state, from);
					if (!callout || from !== callout.markerTo || callout.markerTo !== callout.bareTo || /^\s/.test(text)) return false;
					view.dispatch(view.state.tr.insertText(` ${text}`, from, to));
					return true;
				}
			}
		})
);

/**
 * After the slash menu inserted `> [!type]\n> Write here`: select the body's
 * placeholder, so typing replaces it (and not the hidden marker).
 */
export function selectCalloutBody(view: EditorView) {
	const { state } = view;
	const callout = calloutAt(state, state.selection.from);
	if (!callout || callout.breakPos === null) return;
	const paragraph = state.doc.resolve(callout.markerFrom).parent;
	const end = callout.markerFrom + paragraph.content.size;
	view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, callout.breakPos + 1, end)));
}
