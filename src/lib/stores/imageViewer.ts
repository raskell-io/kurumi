/**
 * Full-screen image viewer (ImageViewer.svelte, mounted in the layout).
 * Opened by clicking an image in the editor or in read mode; `images`
 * lets ← / → step through the other images of the same note.
 */

import { writable } from 'svelte/store';

export interface ViewerImage {
	src: string; // displayable URL (blob: refs already resolved)
	alt: string;
}

export const imageViewer = writable<{ images: ViewerImage[]; index: number } | null>(null);

export function openImageViewer(images: ViewerImage[], index = 0): void {
	if (images.length === 0) return;
	imageViewer.set({ images, index: Math.min(Math.max(index, 0), images.length - 1) });
}

export function closeImageViewer(): void {
	imageViewer.set(null);
}

/** Collect the viewable images inside `container` and open the one clicked. */
export function openImageFromContainer(container: Element, clicked: HTMLImageElement): void {
	const imgs = [...container.querySelectorAll<HTMLImageElement>('img')].filter(isViewable);
	const index = Math.max(0, imgs.indexOf(clicked));
	openImageViewer(
		imgs.map((img) => ({ src: img.currentSrc || img.src, alt: img.alt })),
		index
	);
}

/**
 * Real content images: not ProseMirror's spacer, not the audio player
 * stand-ins, and with a displayable src (an internal `blob:<id>` ref that
 * hasn't been resolved to an object URL yet can't be shown).
 */
export function isViewable(img: HTMLImageElement): boolean {
	if (img.classList.contains('ProseMirror-separator')) return false;
	if (img.alt.startsWith('audio:')) return false;
	const src = img.getAttribute('src') ?? '';
	return src !== '' && !/^blob:(?!https?:)/.test(src);
}
