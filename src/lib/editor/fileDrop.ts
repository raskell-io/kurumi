/**
 * Pasting or dropping files. Runs before every other paste/drop handler
 * and claims the event: copying an image from a browser or most apps puts
 * both the file and an HTML <img> on the clipboard, and letting both
 * through inserted the picture twice. The editor decides what each file
 * becomes (image, audio player, attachment link).
 */

import { $prose } from '@milkdown/kit/utils';
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import { handleAttachmentClick, isAttachmentRef } from '$lib/attachments';

export type FileDropHandler = (files: File[], pos: number | null) => void;

function filesOf(list: FileList | DataTransferItemList | undefined | null): File[] {
	if (!list) return [];
	const files: File[] = [];
	for (const entry of Array.from(list as ArrayLike<File | DataTransferItem>)) {
		const file = entry instanceof File ? entry : entry.kind === 'file' ? entry.getAsFile() : null;
		if (file) files.push(file);
	}
	return files;
}

/** `onFiles` receives the files and, for drops, the document position to insert at. */
export function fileDropPlugin(onFiles: FileDropHandler) {
	return $prose(
		() =>
			new Plugin({
				key: new PluginKey('file-drop'),
				props: {
					handlePaste(_view, event) {
						const files = filesOf(event.clipboardData?.items);
						if (files.length === 0) return false;
						event.preventDefault();
						onFiles(files, null);
						return true;
					},
					handleDrop(view, event) {
						const files = filesOf((event as DragEvent).dataTransfer?.files);
						if (files.length === 0) return false;
						event.preventDefault();
						const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
						onFiles(files, at?.pos ?? null);
						return true;
					},
					// Attachment links open the file instead of placing the cursor.
					handleClick(_view, _pos, event) {
						return handleAttachmentClick(event);
					},
					// Typing right before or after an attachment link stays plain
					// text instead of growing the link; inside it edits the name.
					handleTextInput(view, from, to, text) {
						const { state } = view;
						const link = state.schema.marks.link;
						if (!link) return false;
						const marks = state.storedMarks ?? state.doc.resolve(from).marks();
						const attachment = marks.find((m) => m.type === link && isAttachmentRef(m.attrs.href));
						if (!attachment) return false;
						const before = state.doc.resolve(from).nodeBefore;
						const after = state.doc.resolve(to).nodeAfter;
						if (before && after && attachment.isInSet(before.marks) && attachment.isInSet(after.marks)) return false;
						view.dispatch(state.tr.insertText(text, from, to).removeMark(from, from + text.length, link));
						return true;
					}
				}
			})
	);
}
