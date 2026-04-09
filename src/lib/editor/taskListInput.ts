/**
 * Task list auto-conversion plugin for Milkdown.
 *
 * Watches for `[ ] `, `[x] `, or `[] ` typed at the start of a line
 * and converts the text to `- [ ] ` / `- [x] ` so Milkdown's GFM
 * plugin picks it up and renders a proper task list item with a
 * checkbox.
 *
 * Without this, the user must type the full `- [ ] ` syntax which
 * doesn't match the Notion/Obsidian muscle memory of just typing
 * `[]` to create a checkbox.
 */

import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import { $prose } from '@milkdown/kit/utils';
import type { EditorView } from '@milkdown/kit/prose/view';

const taskListKey = new PluginKey('task-list-auto');

/**
 * Check if the text just typed completes a checkbox pattern at the
 * start of a line. If so, replace it with the GFM task list syntax.
 */
function handleTextInput(view: EditorView, from: number, to: number, text: string): boolean {
	// We only care about the space after the closing bracket
	if (text !== ' ') return false;

	const { state } = view;
	const $pos = state.doc.resolve(from);
	const textBefore = $pos.parent.textBetween(0, $pos.parentOffset, undefined, '\ufffc');

	// Match patterns at the start of the line:
	// "[ ]" → unchecked
	// "[x]" or "[X]" → checked
	// "[]" → unchecked (shorthand)
	let replacement: string | null = null;

	if (textBefore === '[ ]' || textBefore === '[]') {
		replacement = '- [ ] ';
	} else if (textBefore === '[x]' || textBefore === '[X]') {
		replacement = '- [x] ';
	}

	if (!replacement) return false;

	// Only convert if this is at the very start of the paragraph
	// (the matched text IS the entire text content so far).
	const blockStart = from - $pos.parentOffset;
	const replaceFrom = blockStart;
	const replaceTo = to; // includes the space the user just typed

	const tr = state.tr.replaceWith(
		replaceFrom,
		replaceTo,
		state.schema.text(replacement)
	);
	view.dispatch(tr);
	return true;
}

export const taskListInputPlugin = $prose(() => {
	return new Plugin({
		key: taskListKey,
		props: {
			handleTextInput
		}
	});
});
