/**
 * Image processing utilities.
 *
 * Converts uploaded images to AVIF (or WebP fallback) for storage
 * efficiency, stores them in the blob store, and provides URL
 * resolution for rendering.
 *
 * The conversion pipeline:
 *   1. Load image data into an HTMLImageElement
 *   2. Draw onto a Canvas at the original resolution (capped at 2048px)
 *   3. Export as AVIF via canvas.toBlob('image/avif', quality)
 *   4. If AVIF isn't supported (older Safari), fall back to WebP
 *   5. Store the converted blob via the blob store
 *   6. Return a blob ref + markdown image syntax
 */

import { storeBlob, getBlob } from '$lib/db/blob-store';

const MAX_DIMENSION = 2048;
const AVIF_QUALITY = 0.75;
const WEBP_QUALITY = 0.80;

// Cache of blob ref → object URL so we don't create a new one per render.
const urlCache = new Map<string, string>();

/**
 * Check if the browser supports AVIF encoding via Canvas.
 */
let avifSupported: boolean | null = null;

async function isAvifSupported(): Promise<boolean> {
	if (avifSupported !== null) return avifSupported;
	try {
		const canvas = document.createElement('canvas');
		canvas.width = 1;
		canvas.height = 1;
		const blob = await new Promise<Blob | null>((resolve) =>
			canvas.toBlob(resolve, 'image/avif', 0.5)
		);
		avifSupported = blob !== null && blob.type === 'image/avif';
	} catch {
		avifSupported = false;
	}
	return avifSupported;
}

/**
 * Load an image File/Blob into an HTMLImageElement.
 */
function loadImage(source: Blob): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const img = new Image();
		const url = URL.createObjectURL(source);
		img.onload = () => {
			URL.revokeObjectURL(url);
			resolve(img);
		};
		img.onerror = () => {
			URL.revokeObjectURL(url);
			reject(new Error('Failed to load image'));
		};
		img.src = url;
	});
}

/**
 * Convert an image to AVIF (or WebP fallback) via Canvas.
 * Returns the converted Blob and its MIME type.
 */
async function convertImage(
	source: Blob
): Promise<{ blob: Blob; mimeType: string }> {
	const img = await loadImage(source);

	// Scale down if larger than MAX_DIMENSION, preserving aspect ratio.
	let { width, height } = img;
	if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
		const ratio = Math.min(MAX_DIMENSION / width, MAX_DIMENSION / height);
		width = Math.round(width * ratio);
		height = Math.round(height * ratio);
	}

	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('Canvas 2D context unavailable');
	ctx.drawImage(img, 0, 0, width, height);

	// Try AVIF first
	if (await isAvifSupported()) {
		const blob = await new Promise<Blob | null>((resolve) =>
			canvas.toBlob(resolve, 'image/avif', AVIF_QUALITY)
		);
		if (blob && blob.type === 'image/avif') {
			return { blob, mimeType: 'image/avif' };
		}
	}

	// Fallback to WebP
	const blob = await new Promise<Blob | null>((resolve) =>
		canvas.toBlob(resolve, 'image/webp', WEBP_QUALITY)
	);
	if (blob) {
		return { blob, mimeType: blob.type || 'image/webp' };
	}

	// Last resort: PNG
	const pngBlob = await new Promise<Blob | null>((resolve) =>
		canvas.toBlob(resolve, 'image/png')
	);
	if (!pngBlob) throw new Error('Image conversion failed');
	return { blob: pngBlob, mimeType: 'image/png' };
}

/**
 * Process an image file: convert to AVIF/WebP, store in blob store,
 * return the blob ref and a ready-to-insert markdown image string.
 */
export async function processAndStoreImage(
	file: File | Blob,
	altText?: string
): Promise<{ ref: string; markdown: string; mimeType: string; sizeBytes: number }> {
	const { blob, mimeType } = await convertImage(file);
	const ref = await storeBlob(blob, mimeType);
	const alt = altText || 'image';
	const markdown = `![${alt}](${ref})`;
	return { ref, markdown, mimeType, sizeBytes: blob.size };
}

/**
 * Resolve a blob ref to an object URL for rendering. Caches URLs
 * so repeated calls (e.g. from re-renders) don't leak memory.
 *
 * Returns null if the blob isn't found in the store.
 */
export async function resolveBlobUrl(ref: string): Promise<string | null> {
	if (urlCache.has(ref)) return urlCache.get(ref)!;

	const stored = await getBlob(ref);
	if (!stored) return null;

	const url = URL.createObjectURL(stored.blob);
	urlCache.set(ref, url);
	return url;
}

/**
 * Revoke all cached object URLs. Call when navigating away or
 * when memory pressure is high.
 */
export function revokeAllBlobUrls(): void {
	for (const url of urlCache.values()) {
		URL.revokeObjectURL(url);
	}
	urlCache.clear();
}

/**
 * Check if a string looks like a blob image reference.
 */
export function isBlobRef(src: string): boolean {
	return src.startsWith('blob:');
}
