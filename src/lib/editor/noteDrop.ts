/**
 * A note dragged from the sidebar onto the text becomes a [[link]] to it,
 * with a space on either side where there is a word. The sidebar's drag
 * carries the row's link too, which the editor used to drop as a link to
 * the note's address glued to the word it landed on. A folder dropped on
 * the text adds nothing.
 */

import { $prose } from '@milkdown/kit/utils';
import { Plugin, PluginKey, TextSelection } from '@milkdown/kit/prose/state';
import { getMemoryObject } from '$lib/db';

function draggedRow(event: DragEvent): { type: 'note' | 'folder'; id: string } | null {
	try {
		const item = JSON.parse(event.dataTransfer?.getData('text/plain') ?? '');
		return (item?.type === 'note' || item?.type === 'folder') && typeof item.id === 'string' ? item : null;
	} catch {
		return null;
	}
}

export const noteDropPlugin = $prose(
	() =>
		new Plugin({
			key: new PluginKey('note-drop'),
			props: {
				handleDrop(view, event) {
					const row = draggedRow(event as DragEvent);
					if (!row) return false;
					event.preventDefault();
					const title = row.type === 'note' ? getMemoryObject(row.id)?.title?.trim() : null;
					const at = view.posAtCoords({ left: (event as DragEvent).clientX, top: (event as DragEvent).clientY });
					if (!title || !at || !view.editable) return true;
					const $pos = view.state.doc.resolve(at.pos);
					if (!$pos.parent.isTextblock || $pos.parent.type.spec.code) return true;
					const before = $pos.parent.textBetween(0, $pos.parentOffset, undefined, '￼').slice(-1);
					const after = $pos.parent.textBetween($pos.parentOffset, $pos.parent.content.size, undefined, '￼').charAt(0);
					const text = `${before && !/\s/.test(before) ? ' ' : ''}[[${title}]]${after && !/[\s.,;:!?)]/.test(after) ? ' ' : ''}`;
					const tr = view.state.tr.insertText(text, at.pos);
					tr.setSelection(TextSelection.create(tr.doc, at.pos + text.length));
					view.dispatch(tr);
					view.focus();
					return true;
				}
			}
		})
);
