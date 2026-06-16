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
import type { MemoryObject, Folder, Vault, Person, Event, ActionItem } from '$lib/db/types';

const IDB_KEY = 'kurumi-local-fs-handle';
const FILENAME = 'kurumi-sync.bin';
const METADATA_DIR = '.kurumi';
const METADATA_FILE = 'metadata.json';
// Synchronous mirror of "is a folder configured?". The handle itself lives in
// IndexedDB (async), but sync gating (isSyncConfigured / shouldSync) needs a
// synchronous answer, so we shadow handle presence in localStorage.
const CONFIGURED_KEY = 'kurumi-local-fs-configured';

function setConfiguredFlag(configured: boolean): void {
	if (typeof localStorage === 'undefined') return;
	if (configured) localStorage.setItem(CONFIGURED_KEY, '1');
	else localStorage.removeItem(CONFIGURED_KEY);
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

export async function localFSPush(data: Uint8Array): Promise<void> {
	const dir = await getHandle();
	if (!dir) throw new Error('Local folder not configured');
	await writeFile(dir, FILENAME, data.buffer as ArrayBuffer);
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
	actionItems: ActionItem[]
): Promise<void> {
	const dir = await getHandle();
	if (!dir) throw new Error('Local folder not configured');

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

	const metadata = createMetadata(vault, folders, memories, people, events, actionItems);
	const metaDir = await getOrCreateDir(dir, [METADATA_DIR]);
	await writeFile(metaDir, METADATA_FILE, serializeMetadata(metadata));

	// Prune notes we previously wrote that no longer exist (rename/delete).
	for (const path of previousPaths) {
		if (!newPaths.has(path)) await removeFileByPath(dir, path);
	}
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
