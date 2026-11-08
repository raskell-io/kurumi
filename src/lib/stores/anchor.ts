/**
 * Following a link to a heading or block ([[Note#Heading]], [[Note#^id]]):
 * the link sets where to go, the note page scrolls there once its content
 * is on screen, and the target flashes briefly.
 */

import { headingKey } from '$lib/wikilinks';

export interface NoteAnchor {
	heading?: string | null;
	block?: string | null;
}

let pending: { noteId: string; anchor: NoteAnchor } | null = null;

export function setPendingAnchor(noteId: string, anchor: NoteAnchor): void {
	pending = anchor.heading || anchor.block ? { noteId, anchor } : null;
}

/** The anchor waiting for this note, once (null if none). */
export function takePendingAnchor(noteId: string): NoteAnchor | null {
	if (pending?.noteId !== noteId) return null;
	const { anchor } = pending;
	pending = null;
	return anchor;
}

/** The element an anchor points at inside `root` (rendered editor or reader). */
export function findAnchor(root: ParentNode, anchor: NoteAnchor): HTMLElement | null {
	if (anchor.block) {
		const marker = root.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(anchor.block)}"]`);
		return marker?.closest<HTMLElement>('li, p, h1, h2, h3, h4, h5, h6, blockquote, td') ?? marker ?? null;
	}
	if (anchor.heading) {
		const key = headingKey(anchor.heading);
		return [...root.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')].find((h) => headingKey(h.textContent ?? '') === key) ?? null;
	}
	return null;
}

/**
 * Highlight the target briefly. An overlay, not a class: the editor redraws
 * its own elements and would drop one.
 */
function flash(target: HTMLElement) {
	const rect = target.getBoundingClientRect();
	const overlay = document.createElement('div');
	overlay.className = 'anchor-flash';
	overlay.setAttribute('aria-hidden', 'true');
	Object.assign(overlay.style, {
		position: 'fixed',
		top: `${rect.top - 4}px`,
		left: `${rect.left - 6}px`,
		width: `${rect.width + 12}px`,
		height: `${rect.height + 8}px`,
		pointerEvents: 'none',
		zIndex: '50'
	});
	document.body.appendChild(overlay);
	setTimeout(() => overlay.remove(), 1800);
}

/**
 * Scroll to the anchor in whatever `root()` returns, waiting up to `ms` for
 * it to render. True if found.
 */
export async function scrollToAnchor(root: () => ParentNode | null, anchor: NoteAnchor, ms = 4000): Promise<boolean> {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		const container = root();
		const target = container ? findAnchor(container, anchor) : null;
		if (target) {
			target.scrollIntoView({ block: 'center' });
			flash(target);
			return true;
		}
		await new Promise((r) => setTimeout(r, 100));
	}
	return false;
}
