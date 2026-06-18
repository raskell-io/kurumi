/**
 * Binary blob storage for media (audio, video, files).
 *
 * Blobs live in their own IndexedDB object store, separate from the Automerge
 * document. Putting binary data in the CRDT would bloat sync payloads and
 * defeat the conflict-free semantics for blobs that don't need merging.
 *
 * Each blob is stored alongside its mime type so playback elements know how
 * to decode it.
 */

import { createStore, set, get, del, keys } from 'idb-keyval';
import { generateId } from './types';

const blobStore = createStore('kurumi-blobs', 'blobs');

interface StoredBlob {
	blob: Blob;
	mimeType: string;
	size: number;
	createdAt: number;
}

/**
 * Persist a blob and return a ref string that can be stored on a MemoryObject
 * (e.g. memory.rawAudioRef = "blob:abc123").
 */
export async function storeBlob(blob: Blob, mimeType: string): Promise<string> {
	const id = generateId(16);
	const ref = `blob:${id}`;
	const stored: StoredBlob = {
		blob,
		mimeType,
		size: blob.size,
		createdAt: Date.now()
	};
	await set(ref, stored, blobStore);
	return ref;
}

/**
 * Retrieve a stored blob by ref. Returns null if the ref isn't found.
 */
export async function getBlob(
	ref: string
): Promise<{ blob: Blob; mimeType: string } | null> {
	const stored = await get<StoredBlob>(ref, blobStore);
	if (!stored) return null;
	return { blob: stored.blob, mimeType: stored.mimeType };
}

/**
 * Delete a stored blob. Safe to call with a missing ref.
 */
export async function deleteBlob(ref: string): Promise<void> {
	await del(ref, blobStore);
}

/**
 * Check whether a blob already exists locally for the given ref.
 */
export async function hasBlob(ref: string): Promise<boolean> {
	const stored = await get<StoredBlob>(ref, blobStore);
	return stored != null;
}

/**
 * Store a blob under a caller-supplied ref instead of a freshly generated
 * one. Used by sync to import a blob another device created while keeping
 * the original `blob:<id>` ref so the markdown that references it resolves.
 */
export async function putBlobWithRef(
	ref: string,
	blob: Blob,
	mimeType: string
): Promise<void> {
	const stored: StoredBlob = {
		blob,
		mimeType,
		size: blob.size,
		createdAt: Date.now()
	};
	await set(ref, stored, blobStore);
}

/**
 * Read a blob's raw bytes + mime type by ref. Returns null if not found.
 * Convenience for sync, which needs a `Uint8Array` to upload/write.
 */
export async function getBlobBytes(
	ref: string
): Promise<{ bytes: Uint8Array; mimeType: string } | null> {
	const stored = await get<StoredBlob>(ref, blobStore);
	if (!stored) return null;
	const bytes = new Uint8Array(await stored.blob.arrayBuffer());
	return { bytes, mimeType: stored.mimeType };
}

/**
 * List every blob ref currently stored locally.
 */
export async function listBlobRefs(): Promise<string[]> {
	const allKeys = await keys(blobStore);
	return allKeys.map((k) => String(k));
}
