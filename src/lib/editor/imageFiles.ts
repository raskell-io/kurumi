/**
 * Pasting or dropping image files. Runs before every other paste/drop
 * handler and claims the event: copying an image from a browser or most
 * apps puts both the file and an HTML <img> on the clipboard, and letting
 * both through inserted the picture twice.
 */

import { $prose } from '@milkdown/kit/utils';
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';

export type ImageFileHandler = (files: File[], pos: number | null) => void;

function imageFiles(list: FileList | DataTransferItemList | undefined | null): File[] {
	if (!list) return [];
	const files: File[] = [];
	for (const entry of Array.from(list as ArrayLike<File | DataTransferItem>)) {
		const file = entry instanceof File ? entry : entry.kind === 'file' ? entry.getAsFile() : null;
		if (file && file.type.startsWith('image/')) files.push(file);
	}
	return files;
}

/** `onFiles` receives the images and, for drops, the document position to insert at. */
export function imageFilePlugin(onFiles: ImageFileHandler) {
	return $prose(
		() =>
			new Plugin({
				key: new PluginKey('image-files'),
				props: {
					handlePaste(_view, event) {
						const files = imageFiles(event.clipboardData?.items);
						if (files.length === 0) return false;
						event.preventDefault();
						onFiles(files, null);
						return true;
					},
					handleDrop(view, event) {
						const files = imageFiles((event as DragEvent).dataTransfer?.files);
						if (files.length === 0) return false;
						event.preventDefault();
						const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
						onFiles(files, at?.pos ?? null);
						return true;
					}
				}
			})
	);
}
