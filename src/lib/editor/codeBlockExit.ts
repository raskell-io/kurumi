/**
 * Code block exit plugin for Milkdown.
 *
 * When the cursor is at the end of a code block and the last line is
 * empty, pressing Enter exits the code block and creates a new
 * paragraph below instead of adding another line inside the block.
 *
 * This matches the behavior of Notion, Obsidian, and most modern
 * editors.
 */

import { Plugin, PluginKey, Selection, TextSelection } from '@milkdown/kit/prose/state';
import { $prose } from '@milkdown/kit/utils';
import type { EditorView } from '@milkdown/kit/prose/view';

const codeBlockExitKey = new PluginKey('code-block-exit');

function handleEnter(view: EditorView): boolean {
	const { state } = view;
	const { selection } = state;
	const { $from } = selection;

	// Check if we're inside a code_block node
	const parentNode = $from.parent;
	if (parentNode.type.name !== 'code_block') return false;

	// Check if cursor is at the very end of the code block
	const isAtEnd = $from.parentOffset === parentNode.content.size;
	if (!isAtEnd) return false;

	// Check if the last line is empty (the text ends with \n or is empty)
	const text = parentNode.textContent;
	const lastLine = text.split('\n').pop() ?? '';
	if (lastLine.trim() !== '') return false;

	// Exit the code block: delete the trailing empty line and create
	// a new paragraph after the code block.
	const codeBlockPos = $from.before($from.depth);
	const codeBlockEnd = $from.after($from.depth);

	// Remove the trailing newline from the code block
	const tr = state.tr.delete($from.pos - lastLine.length - 1, $from.pos);

	// Insert a new paragraph after the code block
	const paragraphType = state.schema.nodes.paragraph;
	if (paragraphType) {
		// Recalculate position after the deletion
		const newCodeBlockEnd = codeBlockEnd - lastLine.length - 1;
		tr.insert(newCodeBlockEnd, paragraphType.create());
		// Move cursor into the new paragraph
		tr.setSelection(TextSelection.near(tr.doc.resolve(newCodeBlockEnd + 1)));
	}

	view.dispatch(tr);
	return true;
}

export const codeBlockExitPlugin = $prose(() => {
	return new Plugin({
		key: codeBlockExitKey,
		props: {
			handleKeyDown(view, event) {
				if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
					return handleEnter(view);
				}
				return false;
			}
		}
	});
});
