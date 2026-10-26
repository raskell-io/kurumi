/**
 * Local filesystem sync via the File System Access API.
 *
 * The user picks a folder once (via showDirectoryPicker). The app
 * reads/writes `kurumi-sync.bin` inside that folder. The folder can
 * be inside Dropbox, iCloud Drive, OneDrive, Syncthing, or any
 * other cloud-synced folder — Kurumi doesn't care, it just writes
 * a file.
 *
 * The directory handle is persisted in IndexedDB via idb-keyval so
 * the user doesn't have to re-pick on every app load. The browser
 * may prompt for permission on the first access after a restart.
 *
 * Chrome/Edge only (File System Access API).
 */

import { get, set, del } from 'idb-keyval';
import {
	notesToMarkdownFiles,
	createMetadata,
	serializeMetadata,
	parseMetadata
} from '$lib/git/convert';
import { vaultDirNames } from '$lib/utils/markdown-export';
import { refToId, importBlobPayloads, type BlobPayload } from './blobs';
import type { MemoryObject, Folder, Vault, Person, Event, ActionItem } from '$lib/db/types';

const IDB_KEY = 'kurumi-local-fs-handle';
const FILENAME = 'kurumi-sync.bin';
const METADATA_DIR = '.kurumi';
const METADATA_FILE = 'metadata.json';
const BLOBS_DIR = 'blobs';
// All-vaults layout index: which subfolder each vault was last written to,
// so a renamed (or removed) vault's old folder can be cleaned up.
const VAULTS_INDEX_FILE = 'vaults.json';
const ALL_VAULTS_KEY = 'kurumi-local-fs-all-vaults';
// Synchronous mirror of "is a folder configured?". The handle itself lives in
// IndexedDB (async), but sync gating (isSyncConfigured / shouldSync) needs a
// synchronous answer, so we shadow handle presence in localStorage.
const CONFIGURED_KEY = 'kurumi-local-fs-configured';

function setConfiguredFlag(configured: boolean): void {
	if (typeof localStorage === 'undefined') return;
	if (configured) localStorage.setItem(CONFIGURED_KEY, '1');
	else localStorage.removeItem(CONFIGURED_KEY);
}

/**
 * Mirror layout. Off (default): the current vault's notes at the folder
 * root. On: every vault in its own subfolder (`work/`, `personal/`, …),
 * each self-contained with its own `.kurumi/` metadata and blobs — the
 * layout to use when the folder is a git checkout managed by the local
 * agent (see agent/README.md).
 */
export function isLocalFSAllVaults(): boolean {
	return typeof localStorage !== 'undefined' && localStorage.getItem(ALL_VAULTS_KEY) === '1';
}

export function setLocalFSAllVaults(enabled: boolean): void {
	if (typeof localStorage === 'undefined') return;
	if (enabled) localStorage.setItem(ALL_VAULTS_KEY, '1');
	else localStorage.removeItem(ALL_VAULTS_KEY);
}

export function isLocalFSSupported(): boolean {
	return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

export function isLocalFSConfiguredSync(): boolean {
	return typeof localStorage !== 'undefined' && localStorage.getItem(CONFIGURED_KEY) === '1';
}

export async function hasLocalFSHandle(): Promise<boolean> {
	try {
		const handle = await get(IDB_KEY);
		const present = handle != null;
		// Reconcile the synchronous flag with the source of truth on read,
		// so the two can't drift (e.g. handle cleared by the browser).
		setConfiguredFlag(present);
		return present;
	} catch {
		return false;
	}
}

export async function pickLocalFSDirectory(): Promise<boolean> {
	if (!isLocalFSSupported()) return false;
	try {
		const handle = await (window as unknown as {
			showDirectoryPicker: (opts?: object) => Promise<FileSystemDirectoryHandle>;
		}).showDirectoryPicker({ mode: 'readwrite' });
		await set(IDB_KEY, handle);
		setConfiguredFlag(true);
		return true;
	} catch {
		return false; // User cancelled
	}
}

export async function clearLocalFSHandle(): Promise<void> {
	await del(IDB_KEY);
	setConfiguredFlag(false);
}

async function getHandle(): Promise<FileSystemDirectoryHandle | null> {
	try {
		const handle = (await get(IDB_KEY)) as FileSystemDirectoryHandle | undefined;
		if (!handle) return null;
		// Verify we still have permission
		const perm = await (handle as FileSystemDirectoryHandle & {
			queryPermission: (opts: object) => Promise<string>;
			requestPermission: (opts: object) => Promise<string>;
		}).queryPermission({ mode: 'readwrite' });
		if (perm === 'granted') return handle;
		const req = await (handle as FileSystemDirectoryHandle & {
			requestPermission: (opts: object) => Promise<string>;
		}).requestPermission({ mode: 'readwrite' });
		return req === 'granted' ? handle : null;
	} catch {
		return null;
	}
}

export async function localFSPull(): Promise<Uint8Array | null> {
	const dir = await getHandle();
	if (!dir) throw new Error('Local folder not configured');
	try {
		const fileHandle = await dir.getFileHandle(FILENAME);
		const file = await fileHandle.getFile();
		return new Uint8Array(await file.arrayBuffer());
	} catch (err) {
		if (err instanceof DOMException && err.name === 'NotFoundError') {
			return null; // File doesn't exist yet
		}
		throw err;
	}
}

// Documents the local agent couldn't merge itself (two copies of the
// database with no shared history, which a plain CRDT merge would resolve
// by dropping one side). The agent parks the remote copy as
// `kurumi-sync.incoming-<n>.bin`; the app merges it with its own recovery
// logic and then deletes it.
const INCOMING_PATTERN = /^kurumi-sync\.incoming-[\w.-]+\.bin$/;

export async function localFSReadIncoming(): Promise<{ name: string; data: Uint8Array }[]> {
	const dir = await getHandle();
	if (!dir) return [];
	const out: { name: string; data: Uint8Array }[] = [];
	const entries = (dir as FileSystemDirectoryHandle & {
		values: () => AsyncIterableIterator<FileSystemHandle>;
	}).values();
	for await (const handle of entries) {
		if (handle.kind !== 'file' || !INCOMING_PATTERN.test(handle.name)) continue;
		const file = await (handle as FileSystemFileHandle).getFile();
		out.push({ name: handle.name, data: new Uint8Array(await file.arrayBuffer()) });
	}
	return out;
}

export async function localFSRemoveIncoming(name: string): Promise<void> {
	const dir = await getHandle();
	if (dir) await removeFileByPath(dir, name);
}

export async function localFSPush(data: Uint8Array): Promise<void> {
	const dir = await getHandle();
	if (!dir) throw new Error('Local folder not configured');
	await writeFile(dir, FILENAME, data.buffer as ArrayBuffer);
}

/** Copy a (possibly offset/shared-buffer) view into a fresh ArrayBuffer. */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	const ab = new ArrayBuffer(bytes.byteLength);
	new Uint8Array(ab).set(bytes);
	return ab;
}

async function writeFile(
	dir: FileSystemDirectoryHandle,
	name: string,
	contents: string | ArrayBuffer
): Promise<void> {
	const fileHandle = await dir.getFileHandle(name, { create: true });
	const writable = await (fileHandle as FileSystemFileHandle & {
		createWritable: () => Promise<FileSystemWritableFileStream>;
	}).createWritable();
	await writable.write(contents);
	await writable.close();
}

// Walk/create a nested subdirectory path relative to `root`.
async function getOrCreateDir(
	root: FileSystemDirectoryHandle,
	parts: string[]
): Promise<FileSystemDirectoryHandle> {
	let current = root;
	for (const part of parts) {
		current = await current.getDirectoryHandle(part, { create: true });
	}
	return current;
}

// Remove a file at a relative path without creating any directories. Best
// effort: missing dirs/files are ignored (the goal is pruning stale notes).
async function removeFileByPath(root: FileSystemDirectoryHandle, path: string): Promise<void> {
	const parts = path.split('/').filter(Boolean);
	const filename = parts.pop();
	if (!filename) return;
	try {
		let current = root;
		for (const part of parts) {
			current = await current.getDirectoryHandle(part);
		}
		await current.removeEntry(filename);
	} catch {
		// Already gone or directory missing — nothing to prune.
	}
}

// Every directory prefix implied by a set of file paths (e.g. "a/b/note.md"
// yields "a" and "a/b"). Used to figure out which folders Kurumi managed.
function dirPrefixes(paths: Iterable<string>): Set<string> {
	const dirs = new Set<string>();
	for (const p of paths) {
		const parts = p.split('/').filter(Boolean);
		parts.pop(); // drop the filename
		let cur = '';
		for (const part of parts) {
			cur = cur ? `${cur}/${part}` : part;
			dirs.add(cur);
		}
	}
	return dirs;
}

// Remove a directory only if it's empty (non-recursive removeEntry rejects on
// a non-empty dir). This protects any files the user dropped into the folder
// themselves — we only reclaim folders Kurumi emptied by pruning its notes.
// Returns true if the directory was removed.
async function removeEmptyDirByPath(
	root: FileSystemDirectoryHandle,
	path: string
): Promise<boolean> {
	const parts = path.split('/').filter(Boolean);
	const name = parts.pop();
	if (!name) return false;
	try {
		let current = root;
		for (const part of parts) {
			current = await current.getDirectoryHandle(part);
		}
		await current.removeEntry(name); // non-recursive: throws if not empty
		return true;
	} catch {
		// Missing, or still has content (incl. user-added files) — leave it.
		return false;
	}
}

// Paths Kurumi wrote on the previous sync (from .kurumi/metadata.json).
// Used to delete notes that were since renamed or removed.
async function readManagedPaths(dir: FileSystemDirectoryHandle): Promise<string[]> {
	try {
		const metaDir = await dir.getDirectoryHandle(METADATA_DIR);
		const fileHandle = await metaDir.getFileHandle(METADATA_FILE);
		const text = await (await fileHandle.getFile()).text();
		const parsed = parseMetadata(text);
		return parsed ? Object.keys(parsed.noteIds) : [];
	} catch {
		return [];
	}
}

/**
 * Write the current vault as a human-readable tree of markdown files —
 * one `.md` per note, nested to mirror the folder tree, plus a
 * `.kurumi/metadata.json` index. Uses the same on-disk format as git sync.
 *
 * The binary `kurumi-sync.bin` remains the source of truth for cross-device
 * merge. Text edits to these `.md` files are read back on the next sync (see
 * localFSReadMarkdown / importLocalFSEdits); structural changes (create,
 * rename, delete) stay app-driven.
 */
export async function localFSPushMarkdown(
	memories: MemoryObject[],
	folders: Folder[],
	vault: Vault,
	people: Person[],
	events: Event[],
	actionItems: ActionItem[],
	blobs: BlobPayload[] = []
): Promise<void> {
	const dir = await getHandle();
	if (!dir) throw new Error('Local folder not configured');
	// Switching back from the all-vaults layout: clear its vault folders.
	await pruneAllVaultsLayout(dir, new Set());
	await writeVaultMarkdown(dir, { memories, folders, vault, people, events, actionItems, blobs });
}

export interface VaultMirror {
	vault: Vault;
	memories: MemoryObject[];
	folders: Folder[];
	people: Person[];
	events: Event[];
	actionItems: ActionItem[];
	blobs: BlobPayload[];
}

/**
 * All-vaults layout: write each vault into its own subfolder, in the same
 * format `localFSPushMarkdown` uses at the root. Cleans up the root-level
 * single-vault mirror if one exists, and the folders of vaults that were
 * renamed or deleted since the last sync.
 */
export async function localFSPushAllVaults(mirrors: VaultMirror[]): Promise<void> {
	const dir = await getHandle();
	if (!dir) throw new Error('Local folder not configured');

	// Switching from the single-vault layout: remove the root-level notes
	// and their index (blobs stay; they're harmless and may be shared).
	const rootPaths = await readManagedPaths(dir);
	if (rootPaths.length > 0) {
		await pruneManagedFiles(dir, rootPaths, new Set());
		try {
			const metaDir = await dir.getDirectoryHandle(METADATA_DIR);
			await metaDir.removeEntry(METADATA_FILE);
		} catch {
			// Already gone.
		}
	}

	const dirNames = vaultDirNames(mirrors.map((m) => m.vault));
	const index: Record<string, string> = {};
	for (const mirror of mirrors) {
		const name = dirNames.get(mirror.vault.id)!;
		index[mirror.vault.id] = name;
		await writeVaultMarkdown(await getOrCreateDir(dir, [name]), mirror);
	}
	await pruneAllVaultsLayout(dir, new Set(Object.values(index)));

	const metaDir = await getOrCreateDir(dir, [METADATA_DIR]);
	await writeFile(
		metaDir,
		VAULTS_INDEX_FILE,
		JSON.stringify({ version: 1, vaults: index }, null, 2) + '\n'
	);
}

async function readVaultsIndex(dir: FileSystemDirectoryHandle): Promise<Record<string, string>> {
	try {
		const metaDir = await dir.getDirectoryHandle(METADATA_DIR);
		const handle = await metaDir.getFileHandle(VAULTS_INDEX_FILE);
		const parsed = JSON.parse(await (await handle.getFile()).text());
		return parsed && typeof parsed.vaults === 'object' ? parsed.vaults : {};
	} catch {
		return {};
	}
}

// Remove vault folders recorded in the all-vaults index that aren't in
// `keep`: the notes Kurumi wrote there, the folder's `.kurumi/`, and then
// the folder itself if nothing else is left in it. With an empty `keep`
// this tears the whole layout down, index included.
async function pruneAllVaultsLayout(
	dir: FileSystemDirectoryHandle,
	keep: Set<string>
): Promise<void> {
	const index = await readVaultsIndex(dir);
	for (const name of new Set(Object.values(index))) {
		if (keep.has(name)) continue;
		let vaultDir: FileSystemDirectoryHandle;
		try {
			vaultDir = await dir.getDirectoryHandle(name);
		} catch {
			continue;
		}
		await pruneManagedFiles(vaultDir, await readManagedPaths(vaultDir), new Set());
		try {
			await vaultDir.removeEntry(METADATA_DIR, { recursive: true });
		} catch {
			// No metadata dir.
		}
		await removeEmptyDirByPath(dir, name);
	}
	if (keep.size === 0 && Object.keys(index).length > 0) {
		try {
			const metaDir = await dir.getDirectoryHandle(METADATA_DIR);
			await metaDir.removeEntry(VAULTS_INDEX_FILE);
		} catch {
			// Already gone.
		}
	}
}

// Delete previously written note files that aren't in `keep`, then any
// directories that pruning left empty.
async function pruneManagedFiles(
	dir: FileSystemDirectoryHandle,
	previousPaths: string[],
	keep: Set<string>
): Promise<void> {
	for (const path of previousPaths) {
		if (!keep.has(path)) await removeFileByPath(dir, path);
	}

	// Reclaim folders that Kurumi managed but no longer uses (e.g. a deleted
	// folder). Removing the stale .md files above leaves the directories
	// behind, so delete the now-unused ones — deepest first so a parent can
	// be removed once its children are gone. Empty-only removal protects any
	// files the user placed in the folder directly.
	const previousDirs = dirPrefixes(previousPaths);
	const currentDirs = dirPrefixes(keep);
	const staleDirs = [...previousDirs]
		.filter((d) => !currentDirs.has(d))
		.sort((a, b) => b.split('/').length - a.split('/').length);
	for (const dirPath of staleDirs) {
		await removeEmptyDirByPath(dir, dirPath);
	}
}

// Write one vault's notes, blobs and `.kurumi/metadata.json` into `dir`,
// pruning notes that a previous write put there but that no longer exist.
async function writeVaultMarkdown(
	dir: FileSystemDirectoryHandle,
	{ memories, folders, vault, people, events, actionItems, blobs }: VaultMirror
): Promise<void> {
	const files = notesToMarkdownFiles(memories, folders);
	const newPaths = new Set(files.map((f) => f.path));
	const previousPaths = await readManagedPaths(dir);

	for (const file of files) {
		const parts = file.path.split('/').filter(Boolean);
		const filename = parts.pop();
		if (!filename) continue;
		const targetDir = parts.length ? await getOrCreateDir(dir, parts) : dir;
		await writeFile(targetDir, filename, file.content);
	}

	// Write referenced blob bytes under .kurumi/blobs/<id> and record mimes.
	const blobMeta: Record<string, { mimeType: string }> = {};
	if (blobs.length > 0) {
		const blobDir = await getOrCreateDir(dir, [METADATA_DIR, BLOBS_DIR]);
		for (const blob of blobs) {
			await writeFile(blobDir, refToId(blob.ref), toArrayBuffer(blob.bytes));
			blobMeta[blob.ref] = { mimeType: blob.mimeType };
		}
	}

	const metadata = createMetadata(
		vault,
		folders,
		memories,
		people,
		events,
		actionItems,
		blobMeta
	);
	const metaDir = await getOrCreateDir(dir, [METADATA_DIR]);
	await writeFile(metaDir, METADATA_FILE, serializeMetadata(metadata));

	// Prune notes we previously wrote that no longer exist (rename/delete).
	await pruneManagedFiles(dir, previousPaths, newPaths);
}

/**
 * Read blob bytes written under `.kurumi/blobs/` back into the local store,
 * using mime types from `.kurumi/metadata.json`. Imports only blobs missing
 * locally. No-op if the folder has no blobs dir yet.
 */
export async function localFSImportBlobs(): Promise<void> {
	const root = await getHandle();
	if (!root) return;
	const dirs = [root];
	for (const name of new Set(Object.values(await readVaultsIndex(root)))) {
		try {
			dirs.push(await root.getDirectoryHandle(name));
		} catch {
			// Vault folder not written yet.
		}
	}
	for (const dir of dirs) await importBlobsFrom(dir);
}

async function importBlobsFrom(dir: FileSystemDirectoryHandle): Promise<void> {
	let metaDir: FileSystemDirectoryHandle;
	let blobDir: FileSystemDirectoryHandle;
	try {
		metaDir = await dir.getDirectoryHandle(METADATA_DIR);
		blobDir = await metaDir.getDirectoryHandle(BLOBS_DIR);
	} catch {
		return; // No blobs synced into this folder.
	}

	// Mime lookup from metadata.json.
	let mimeByRef: Record<string, { mimeType: string }> = {};
	try {
		const metaHandle = await metaDir.getFileHandle(METADATA_FILE);
		const parsed = parseMetadata(await (await metaHandle.getFile()).text());
		mimeByRef = parsed?.blobs ?? {};
	} catch {
		// Missing/unparseable metadata — fall back to octet-stream below.
	}

	const payloads: BlobPayload[] = [];
	const entries = (blobDir as FileSystemDirectoryHandle & {
		values: () => AsyncIterableIterator<FileSystemHandle>;
	}).values();
	for await (const handle of entries) {
		if (handle.kind !== 'file') continue;
		const ref = `blob:${handle.name}`;
		const file = await (handle as FileSystemFileHandle).getFile();
		payloads.push({
			ref,
			bytes: new Uint8Array(await file.arrayBuffer()),
			mimeType: mimeByRef[ref]?.mimeType || 'application/octet-stream'
		});
	}
	await importBlobPayloads(payloads);
}

export interface DiskMarkdownFile {
	path: string;
	content: string;
	lastModified: number;
}

// Recursively read every `.md` file in the picked folder (skipping the
// `.kurumi` metadata dir). Returns raw contents + the OS file mtime so the
// caller can decide which side is newer.
export async function localFSReadMarkdown(): Promise<DiskMarkdownFile[]> {
	const dir = await getHandle();
	if (!dir) throw new Error('Local folder not configured');
	const out: DiskMarkdownFile[] = [];
	await walkMarkdown(dir, '', out);
	return out;
}

async function walkMarkdown(
	dir: FileSystemDirectoryHandle,
	prefix: string,
	out: DiskMarkdownFile[]
): Promise<void> {
	const entries = (dir as FileSystemDirectoryHandle & {
		values: () => AsyncIterableIterator<FileSystemHandle>;
	}).values();
	for await (const handle of entries) {
		const childPath = prefix ? `${prefix}/${handle.name}` : handle.name;
		if (handle.kind === 'directory') {
			if (handle.name === METADATA_DIR) continue;
			await walkMarkdown(handle as FileSystemDirectoryHandle, childPath, out);
		} else if (handle.kind === 'file' && handle.name.endsWith('.md')) {
			const file = await (handle as FileSystemFileHandle).getFile();
			out.push({ path: childPath, content: await file.text(), lastModified: file.lastModified });
		}
	}
}

const PROBE_FILENAME = '.kurumi-write-test';

export async function localFSTest(): Promise<{ success: boolean; error?: string; folder?: string }> {
	let dir: FileSystemDirectoryHandle | null = null;
	try {
		dir = await getHandle();
		if (!dir) return { success: false, error: 'No folder selected' };
		// Verify write access by creating and reading back a probe file —
		// listing only proves read access, but the user wants to know Kurumi
		// can actually write content here before syncing.
		const fileHandle = await dir.getFileHandle(PROBE_FILENAME, { create: true });
		const writable = await (fileHandle as FileSystemFileHandle & {
			createWritable: () => Promise<FileSystemWritableFileStream>;
		}).createWritable();
		await writable.write(new TextEncoder().encode('ok').buffer as ArrayBuffer);
		await writable.close();
		const readBack = await (await fileHandle.getFile()).text();
		if (readBack !== 'ok') {
			return { success: false, error: 'Wrote a test file but read back unexpected content' };
		}
		return { success: true, folder: dir.name };
	} catch (err) {
		return {
			success: false,
			error: err instanceof Error ? err.message : 'Access denied'
		};
	} finally {
		// Clean up the probe file regardless of outcome.
		if (dir) {
			try {
				await dir.removeEntry(PROBE_FILENAME);
			} catch {
				// Probe may not have been created; nothing to clean up.
			}
		}
	}
}
