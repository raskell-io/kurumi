/**
 * File attachments: any file that isn't an image or a recording is kept
 * in the blob store and linked from the note as `[report.pdf](blob:<id>)`.
 * The link renders as a chip (app.css) and opens the file: in a new tab
 * when the browser can show it, otherwise as a download. Sync picks the
 * file up like any other `blob:` ref.
 */

import { getBlob, storeBlob } from '$lib/db/blob-store';
import { showNotice } from '$lib/stores/notice';
import { openPdf } from '$lib/stores/pdfViewer';

/**
 * A stored blob ref (`blob:<id>`), not a runtime object URL (`blob:http…`).
 * A link to a page of a PDF adds `#page=3`.
 */
export function isAttachmentRef(href: string | null | undefined): href is string {
	return !!href && /^blob:[0-9A-Za-z]+(#page=\d+)?$/.test(href);
}

/** `blob:<id>#page=3` → the ref and the page. */
export function splitAttachmentHref(href: string): { ref: string; page: number } {
	const [ref, fragment] = href.split('#');
	return { ref, page: Number(/page=(\d+)/.exec(fragment ?? '')?.[1] ?? 1) || 1 };
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
			tellMissing(name);
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

// Not on this device yet: another device attached it and sync hasn't
// brought the file over.
function tellMissing(name: string): void {
	showNotice(`"${name}" isn't on this device yet. Sync to fetch it.`);
}

/** Click handler for rendered markdown: opens attachment links. Returns true when handled. */
export function handleAttachmentClick(event: MouseEvent): boolean {
	const link = (event.target as HTMLElement | null)?.closest?.('a');
	const href = link?.getAttribute('href');
	if (!link || !isAttachmentRef(href)) return false;
	event.preventDefault();
	event.stopPropagation();
	const { ref, page } = splitAttachmentHref(href);
	const name = link.textContent?.trim() || 'file';
	// PDFs open in Kurumi's viewer (highlights; it can open them in a tab too).
	if ((/\.pdf\b/i.test(name) || href.includes('#page=')) && !event.shiftKey && !event.metaKey && !event.ctrlKey) {
		const noteId = /#\/memory\/([^/?#]+)/.exec(location.hash)?.[1] ?? null;
		openPdf(ref, name.replace(/,\s*p\.\s*\d+$/, ''), page, noteId);
		return true;
	}
	openAttachment(ref, name);
	return true;
}
