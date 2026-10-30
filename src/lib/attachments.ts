/**
 * File attachments: any file that isn't an image or a recording is kept
 * in the blob store and linked from the note as `[report.pdf](blob:<id>)`.
 * The link renders as a chip (app.css) and opens the file: in a new tab
 * when the browser can show it, otherwise as a download. Sync picks the
 * file up like any other `blob:` ref.
 */

import { getBlob, storeBlob } from '$lib/db/blob-store';

/** A stored blob ref (`blob:<id>`), not a runtime object URL (`blob:http…`). */
export function isAttachmentRef(href: string | null | undefined): href is string {
	return !!href && /^blob:[0-9A-Za-z]+$/.test(href);
}

const escapeLinkText = (text: string) => text.replace(/([[\]\\])/g, '\\$1');

export async function storeAttachment(file: File): Promise<{ ref: string; name: string; markdown: string }> {
	const name = file.name || 'file';
	const ref = await storeBlob(file, file.type || 'application/octet-stream');
	return { ref, name, markdown: `[${escapeLinkText(name)}](${ref})` };
}

// Types a browser tab can display; anything else is downloaded.
const VIEWABLE = /\.(pdf|png|jpe?g|gif|webp|avif|svg|txt|md|json|mp3|m4a|wav|ogg|mp4|mov|webm)$/i;

/**
 * Open an attachment. Must be called from the click itself: the tab is
 * opened synchronously (popup blockers allow that) and pointed at the file
 * once it's read from IndexedDB.
 */
export function openAttachment(ref: string, name: string): void {
	const viewable = VIEWABLE.test(name);
	const tab = viewable ? window.open('', '_blank') : null;
	void getBlob(ref).then((stored) => {
		if (!stored) {
			tab?.close();
			alertMissing(name);
			return;
		}
		const url = URL.createObjectURL(stored.blob);
		if (tab) tab.location.href = url;
		else {
			const a = Object.assign(document.createElement('a'), { href: url, download: name });
			document.body.append(a);
			a.click();
			a.remove();
		}
		// Give the tab or download time to read it.
		setTimeout(() => URL.revokeObjectURL(url), 60_000);
	});
}

// Not on this device yet (another device attached it and sync hasn't
// brought the bytes over). A console note, not a dialog: dialogs block.
function alertMissing(name: string): void {
	console.warn(`[attachments] "${name}" isn't on this device yet; sync to fetch it.`);
}

/** Click handler for rendered markdown: opens attachment links. Returns true when handled. */
export function handleAttachmentClick(event: MouseEvent): boolean {
	const link = (event.target as HTMLElement | null)?.closest?.('a');
	const href = link?.getAttribute('href');
	if (!link || !isAttachmentRef(href)) return false;
	event.preventDefault();
	event.stopPropagation();
	openAttachment(href, link.textContent?.trim() || 'file');
	return true;
}
