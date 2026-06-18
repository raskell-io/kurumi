/**
 * Shared blob (image / audio / media) sync helpers.
 *
 * Note bodies reference binary assets by a `blob:<id>` ref (e.g. an inline
 * image `![alt](blob:abc123)` or an `<audio src="blob:...">`), and voice /
 * upload memories carry `rawAudioRef` / `rawMediaRef`. The bytes themselves
 * live in a separate IndexedDB store (see db/blob-store.ts) and are NOT part
 * of the Automerge document, so none of the sync backends moved them before.
 *
 * This module gives every backend a uniform way to round-trip those blobs:
 *
 * - `collectBlobRefs` finds every ref a set of memories depends on.
 * - File-tree backends (git, local FS) write the bytes next to the markdown.
 * - Object-storage backends (R2, S3, WebDAV, Azure) use `syncBlobObjects`,
 *   which keeps a small JSON manifest plus one object per blob.
 *
 * Blobs are content-immutable (the random ref never changes for given bytes),
 * so sync is additive: we upload/import what's missing and never delete. That
 * may leave orphaned remote blobs after a note is deleted, which is harmless.
 */

import {
	hasBlob,
	getBlobBytes,
	putBlobWithRef
} from '$lib/db/blob-store';
import type { MemoryObject } from '$lib/db/types';

/** Matches a persisted `blob:<base62-id>` ref (not a runtime `blob:http…` URL). */
const BLOB_REF_RE = /blob:([0-9A-Za-z]+)/g;

export interface BlobPayload {
	ref: string;
	bytes: Uint8Array;
	mimeType: string;
}

export interface BlobManifestEntry {
	mimeType: string;
	size: number;
}

export interface BlobManifest {
	version: number;
	blobs: Record<string, BlobManifestEntry>;
}

/**
 * Collect every blob ref a set of memories depends on: the `rawAudioRef` /
 * `rawMediaRef` fields plus any `blob:<id>` embedded in the markdown body.
 */
export function collectBlobRefs(memories: MemoryObject[]): Set<string> {
	const refs = new Set<string>();
	for (const memory of memories) {
		if (memory.rawAudioRef) refs.add(memory.rawAudioRef);
		if (memory.rawMediaRef) refs.add(memory.rawMediaRef);
		const body = memory.bodyMarkdown ?? '';
		for (const match of body.matchAll(BLOB_REF_RE)) {
			const id = match[1];
			// Guard against object URLs (`blob:http…`) that shouldn't be in
			// persisted markdown but could slip in.
			if (id === 'http' || id === 'https') continue;
			refs.add(`blob:${id}`);
		}
	}
	return refs;
}

/** Strip the `blob:` prefix to get a filename-safe id. */
export function refToId(ref: string): string {
	return ref.startsWith('blob:') ? ref.slice('blob:'.length) : ref;
}

/**
 * Read the bytes for each ref out of the local blob store, skipping any that
 * aren't present locally (e.g. a ref imported from a peer whose bytes haven't
 * arrived yet).
 */
export async function gatherBlobPayloads(refs: Iterable<string>): Promise<BlobPayload[]> {
	const payloads: BlobPayload[] = [];
	for (const ref of refs) {
		const data = await getBlobBytes(ref);
		if (data) payloads.push({ ref, bytes: data.bytes, mimeType: data.mimeType });
	}
	return payloads;
}

/**
 * Import a set of blob payloads into the local store, keeping their original
 * refs. Skips any blob already present. Returns how many were newly imported.
 */
export async function importBlobPayloads(payloads: BlobPayload[]): Promise<number> {
	let imported = 0;
	for (const p of payloads) {
		if (await hasBlob(p.ref)) continue;
		await putBlobWithRef(p.ref, new Blob([p.bytes as BlobPart], { type: p.mimeType }), p.mimeType);
		imported++;
	}
	return imported;
}

// ---------------------------------------------------------------------------
// Object-storage backends (R2 / S3 / WebDAV / Azure)
// ---------------------------------------------------------------------------

/**
 * Minimal key/value object interface a backend implements so it can sync
 * blobs. Keys are flat strings; `get` resolves to null for a missing object.
 */
export interface ObjectTransport {
	get(key: string): Promise<Uint8Array | null>;
	put(key: string, data: Uint8Array, contentType: string): Promise<void>;
}

/** Manifest object key for a vault, e.g. `kurumi-sync/<vault>.blobs.json`. */
export function blobManifestKey(vaultId: string): string {
	return `kurumi-sync/${vaultId}.blobs.json`;
}

/** Individual blob object key, e.g. `kurumi-sync/<vault>.blob.<id>`. */
export function blobObjectKey(vaultId: string, ref: string): string {
	return `kurumi-sync/${vaultId}.blob.${refToId(ref)}`;
}

function parseManifest(bytes: Uint8Array | null): BlobManifest {
	if (!bytes) return { version: 1, blobs: {} };
	try {
		const parsed = JSON.parse(new TextDecoder().decode(bytes)) as BlobManifest;
		if (parsed && typeof parsed === 'object' && parsed.blobs) return parsed;
	} catch {
		// Corrupt/legacy manifest — start fresh.
	}
	return { version: 1, blobs: {} };
}

/**
 * Round-trip blobs for one vault through a flat object store. Pulls any blob
 * the remote manifest lists but we lack, then uploads any locally-referenced
 * blob the remote manifest doesn't have, and rewrites the manifest if it grew.
 */
export async function syncBlobObjects(
	transport: ObjectTransport,
	vaultId: string,
	memories: MemoryObject[]
): Promise<void> {
	const manifestKey = blobManifestKey(vaultId);
	const remote = parseManifest(await transport.get(manifestKey));
	const merged: Record<string, BlobManifestEntry> = { ...remote.blobs };

	// 1. Pull: import remote blobs we don't have locally.
	for (const [ref, entry] of Object.entries(remote.blobs)) {
		if (await hasBlob(ref)) continue;
		const bytes = await transport.get(blobObjectKey(vaultId, ref));
		if (!bytes) continue;
		await putBlobWithRef(
			ref,
			new Blob([bytes as BlobPart], { type: entry.mimeType }),
			entry.mimeType
		);
	}

	// 2. Push: upload locally-referenced blobs the remote doesn't list yet.
	const localRefs = collectBlobRefs(memories);
	let changed = false;
	for (const ref of localRefs) {
		if (merged[ref]) continue;
		const data = await getBlobBytes(ref);
		if (!data) continue;
		await transport.put(
			blobObjectKey(vaultId, ref),
			data.bytes,
			data.mimeType || 'application/octet-stream'
		);
		merged[ref] = { mimeType: data.mimeType, size: data.bytes.length };
		changed = true;
	}

	// 3. Persist the manifest if it grew.
	if (changed || Object.keys(remote.blobs).length === 0) {
		const json = JSON.stringify({ version: 1, blobs: merged } satisfies BlobManifest);
		await transport.put(manifestKey, new TextEncoder().encode(json), 'application/json');
	}
}
