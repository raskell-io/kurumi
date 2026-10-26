/**
 * Task list auto-conversion plugin for Milkdown.
 *
 * Watches for `[ ] `, `[x] `, or `[] ` typed at the start of a line
 * and turns the line into a GFM task item (rendered with a checkbox,
 * saved as `- [ ] `).
 *
 * Without this, the user must type the full `- [ ] ` syntax which
 * doesn't match the Notion/Obsidian muscle memory of just typing
 * `[]` to create a checkbox.
 */

import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import { $prose } from '@milkdown/kit/utils';
import type { EditorView } from '@milkdown/kit/prose/view';
import { turnInto } from './blocks';

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
	let checked: boolean | null = null;
	if (textBefore === '[ ]' || textBefore === '[]') checked = false;
	else if (textBefore === '[x]' || textBefore === '[X]') checked = true;
	if (checked === null) return false;

	// Only at the very start of a plain line: drop the typed "[ ]" and turn
	// the line into a real task item (the same node `- [ ] ` loads as).
	const blockStart = from - $pos.parentOffset;
	view.dispatch(state.tr.delete(blockStart, to));
	turnInto(view, 'task');
	if (checked) {
		const { $from } = view.state.selection;
		for (let d = $from.depth; d > 0; d--) {
			const node = $from.node(d);
			if (node.type.name === 'list_item') {
				view.dispatch(view.state.tr.setNodeMarkup($from.before(d), undefined, { ...node.attrs, checked: true }));
				break;
			}
		}
	}
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
