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

const IDB_KEY = 'kurumi-local-fs-handle';
const FILENAME = 'kurumi-sync.bin';

export function isLocalFSSupported(): boolean {
	return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

export async function hasLocalFSHandle(): Promise<boolean> {
	try {
		const handle = await get(IDB_KEY);
		return handle != null;
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
		return true;
	} catch {
		return false; // User cancelled
	}
}

export async function clearLocalFSHandle(): Promise<void> {
	await del(IDB_KEY);
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
	const fileHandle = await dir.getFileHandle(FILENAME, { create: true });
	const writable = await (fileHandle as FileSystemFileHandle & {
		createWritable: () => Promise<FileSystemWritableFileStream>;
	}).createWritable();
	await writable.write(data.buffer as ArrayBuffer);
	await writable.close();
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
