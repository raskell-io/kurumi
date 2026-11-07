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
	parseMetadata,
	type GitMetadata
} from '$lib/git/convert';
import { vaultDirNames } from '$lib/utils/markdown-export';
import { refToId, importBlobPayloads, type BlobPayload } from './blobs';
import agentGuide from './agent-guide.md?raw';
import { CLAUDE_DIR, CLAUDE_FILE, claudeInstructions } from './claude-instructions';
import { hashText, resetFolderState, saveBaseText, type FolderState } from './folder-state';
import { readMetadataRecords, recordFingerprints } from './metadata-import';
import type { MemoryObject, Folder, Vault, Person, Event, ActionItem } from '$lib/db/types';
import { reviveFolderHandle } from '$lib/desktop/folder-handle';

const IDB_KEY = 'kurumi-local-fs-handle';
const FILENAME = 'kurumi-sync.bin';
const METADATA_DIR = '.kurumi';
const METADATA_FILE = 'metadata.json';
// How to add things by editing the folder, for coding agents working in it.
const AGENT_GUIDE_FILE = 'AGENTS.md';
const BLOBS_DIR = 'blobs';
const RESCUED_DIR = 'rescued';
// Where files go instead of being deleted. The sync never deletes a file: it
// copies it here first, and leaves it where it is if that fails.
const ARCHIVE_DIR = 'archive';
// All-vaults layout index: which subfolder each vault was last written to,
// so a renamed (or removed) vault's old folder can be cleaned up.
const VAULTS_INDEX_FILE = 'vaults.json';
const ALL_VAULTS_KEY = 'kurumi-local-fs-all-vaults';
// Synchronous mirror of "is a folder configured?". The handle itself lives in
// IndexedDB (async), but sync gating (isSyncConfigured / shouldSync) needs a
// synchronous answer, so we shadow handle presence in localStorage.
const CONFIGURED_KEY = 'kurumi-local-fs-configured';

/** The stored folder handle (the desktop app's comes back as plain data). */
async function storedHandle(): Promise<FileSystemDirectoryHandle | undefined> {
	return reviveFolderHandle(await get(IDB_KEY)) as FileSystemDirectoryHandle | undefined;
}

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
		await resetFolderState();
		setConfiguredFlag(true);
		return true;
	} catch {
		return false; // User cancelled
	}
}

export async function clearLocalFSHandle(): Promise<void> {
	await del(IDB_KEY);
	await resetFolderState();
	setConfiguredFlag(false);
}

/**
 * The chosen folder, without asking for anything. Browsers only reveal its
 * name, never its path. `granted` is false when the browser wants permission
 * again (after a restart, usually), which takes a click, e.g. on Sync now.
 */
export interface LocalFSFolderInfo {
	name: string;
	granted: boolean;
	/** Top-level entries, directories with a trailing slash (when granted). */
	entries: string[];
	/** When Kurumi's metadata in this folder last changed (when granted). */
	lastWrittenAt: number | null;
}

export async function getLocalFSFolder(): Promise<LocalFSFolderInfo | null> {
	try {
		const handle = await storedHandle();
		if (!handle) return null;
		const permission = await (handle as FileSystemDirectoryHandle & {
			queryPermission: (opts: object) => Promise<string>;
		}).queryPermission({ mode: 'readwrite' });
		const info: LocalFSFolderInfo = {
			name: handle.name,
			granted: permission === 'granted',
			entries: [],
			lastWrittenAt: null
		};
		if (!info.granted) return info;
		const entries = (handle as FileSystemDirectoryHandle & {
			values: () => AsyncIterableIterator<FileSystemHandle>;
		}).values();
		for await (const entry of entries) {
			info.entries.push(entry.kind === 'directory' ? `${entry.name}/` : entry.name);
		}
		info.entries.sort();
		try {
			const metaDir = await handle.getDirectoryHandle(METADATA_DIR);
			for (const name of [METADATA_FILE, VAULTS_INDEX_FILE]) {
				const file = await metaDir.getFileHandle(name).then((h) => h.getFile()).catch(() => null);
				if (file) info.lastWrittenAt = Math.max(info.lastWrittenAt ?? 0, file.lastModified);
			}
		} catch {
			// Nothing written here yet.
		}
		return info;
	} catch {
		return null;
	}
}

async function getHandle(): Promise<FileSystemDirectoryHandle | null> {
	try {
		const handle = await storedHandle();
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

/**
 * One sync's view of the folder. `expected` holds what each file contained
 * when the sync read it (keys lowercased); a file that differs by the time
 * we'd overwrite it changed in between, so it's left alone for the next sync
 * (`skipped`) instead of losing that change.
 */
export interface WriteSession {
	expected: Map<string, string>;
	state: FolderState;
	skipped: boolean;
	/** Files that couldn't be written (too long a path, a name Windows reserves, a lock). */
	failed: string[];
	/** Lowercased paths whose outside changes the sync has taken in. */
	consumed: Set<string>;
	/** Copies saved under `.kurumi/rescued/` this run. */
	rescued: string[];
}

// The last line of defence. About to replace or remove a file that was changed
// from outside, and nothing took that change in: keep a copy. The importers
// should have handled it; if one ever doesn't, this makes that recoverable.
async function rescueIfUnread(key: string, text: string, session: WriteSession): Promise<void> {
	const lowered = key.toLowerCase();
	const base = session.state.files[lowered];
	if (base === undefined || hashText(text) === base || session.consumed.has(lowered)) return;
	const root = await getHandle();
	if (!root) return;
	const dir = await getOrCreateDir(root, [METADATA_DIR, RESCUED_DIR]);
	const name = `${Date.now()}-${key.replace(/[\\/]/g, '__')}`;
	await writeFile(dir, name, text);
	session.rescued.push(`${METADATA_DIR}/${RESCUED_DIR}/${name}`);
}

async function readIfExists(dir: FileSystemDirectoryHandle, name: string): Promise<string | null> {
	try {
		return await (await (await dir.getFileHandle(name)).getFile()).text();
	} catch {
		return null;
	}
}

// Write a file only if that changes it and doesn't overwrite something the
// sync hasn't read. Leaving unchanged files alone also keeps their dates, so
// watchers, cloud clients and git aren't woken up for nothing.
async function writeGuarded(
	dir: FileSystemDirectoryHandle,
	name: string,
	key: string,
	content: string,
	session: WriteSession
): Promise<boolean> {
	const lowered = key.toLowerCase();
	const hash = hashText(content);
	const disk = await readIfExists(dir, name);
	if (disk !== null) {
		const diskHash = hashText(disk);
		if (diskHash !== hash && session.expected.get(lowered) !== diskHash) {
			session.skipped = true;
			return false;
		}
		if (diskHash === hash) {
			if (session.state.files[lowered] !== hash) await saveBaseText(lowered, content);
			session.state.files[lowered] = hash;
			return true;
		}
		await rescueIfUnread(key, disk, session);
	}
	await writeFile(dir, name, content);
	await saveBaseText(lowered, content);
	session.expected.set(lowered, hash);
	session.state.files[lowered] = hash;
	return true;
}

// A convenience, so it never gets in the way of syncing.
async function writeClaudeInstructions(root: FileSystemDirectoryHandle): Promise<void> {
	try {
		const dir = await getOrCreateDir(root, [CLAUDE_DIR]);
		const content = claudeInstructions(await readIfExists(dir, CLAUDE_FILE));
		if (content !== null) await writeFile(dir, CLAUDE_FILE, content);
	} catch (err) {
		console.warn(`Couldn't write ${CLAUDE_DIR}/${CLAUDE_FILE}:`, err);
	}
}

async function writeIfChanged(dir: FileSystemDirectoryHandle, name: string, content: string): Promise<void> {
	if ((await readIfExists(dir, name)) !== content) await writeFile(dir, name, content);
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

async function getExistingDir(
	root: FileSystemDirectoryHandle,
	parts: string[]
): Promise<FileSystemDirectoryHandle> {
	let current = root;
	for (const part of parts) current = await current.getDirectoryHandle(part);
	return current;
}

// Move a file out of the way, which is the only way the sync ever removes one:
// into `.kurumi/archive/`, named by content (so a note that keeps moving back
// and forth is stored once), and only once that copy is safely written.
async function archiveFile(dir: FileSystemDirectoryHandle, filename: string, label: string): Promise<void> {
	const handle = await dir.getFileHandle(filename);
	const file = await handle.getFile();
	const bytes = await file.arrayBuffer();
	const textual = /\.(md|markdown|json)$/i.test(filename);
	const tag = textual ? hashText(new TextDecoder().decode(bytes)) : `${file.size}`;
	const root = await getHandle();
	if (!root) throw new Error('Local folder not available');
	const archive = await getOrCreateDir(root, [METADATA_DIR, ARCHIVE_DIR]);
	const name = `${tag}-${label.replace(/[\\/]/g, '__')}`;
	const present = await archive.getFileHandle(name).then(() => true, () => false);
	if (!present) await writeFile(archive, name, bytes);
	await dir.removeEntry(filename);
}

// Archive a file at a relative path without creating any directories. Best
// effort: a file that's already gone is fine, and one that can't be archived
// stays where it is.
async function removeFileByPath(root: FileSystemDirectoryHandle, path: string, prefix = ''): Promise<void> {
	const parts = path.split('/').filter(Boolean);
	const filename = parts.pop();
	if (!filename) return;
	try {
		let current = root;
		for (const part of parts) {
			current = await current.getDirectoryHandle(part);
		}
		await archiveFile(current, filename, prefix + path);
	} catch (err) {
		if (!(err instanceof DOMException && err.name === 'NotFoundError')) {
			console.warn(`Left ${prefix + path} in place, couldn't archive it:`, err);
		}
	}
}

// Archive everything in a directory (a removed vault's `.kurumi`), then remove
// the directory if all of it made it.
async function archiveTree(parent: FileSystemDirectoryHandle, name: string, prefix: string): Promise<void> {
	const dir = await parent.getDirectoryHandle(name);
	const entries = (dir as FileSystemDirectoryHandle & {
		values: () => AsyncIterableIterator<FileSystemHandle>;
	}).values();
	const handles: FileSystemHandle[] = [];
	for await (const handle of entries) handles.push(handle);
	for (const handle of handles) {
		if (handle.kind === 'directory') await archiveTree(dir, handle.name, `${prefix}${name}/`);
		else await archiveFile(dir, handle.name, `${prefix}${name}/${handle.name}`);
	}
	await parent.removeEntry(name);
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
 * localFSReadMarkdown / importLocalFSEdits); so are new files and records
 * added to `metadata.json` (see agent-guide.md). Renames and deletes stay
 * app-driven.
 */
export async function localFSPushMarkdown(
	memories: MemoryObject[],
	folders: Folder[],
	vault: Vault,
	people: Person[],
	events: Event[],
	actionItems: ActionItem[],
	blobs: BlobPayload[],
	work: GitMetadata['work'],
	session: WriteSession
): Promise<void> {
	const dir = await getHandle();
	if (!dir) throw new Error('Local folder not configured');
	// Switching back from the all-vaults layout: clear its vault folders.
	await pruneAllVaultsLayout(dir, new Set(), session);
	await writeClaudeInstructions(dir);
	await writeVaultMarkdown(dir, { memories, folders, vault, people, events, actionItems, blobs, work }, session, '');
}

export interface VaultMirror {
	vault: Vault;
	memories: MemoryObject[];
	folders: Folder[];
	people: Person[];
	events: Event[];
	actionItems: ActionItem[];
	blobs: BlobPayload[];
	work?: GitMetadata['work'];
}

/**
 * All-vaults layout: write each vault into its own subfolder, in the same
 * format `localFSPushMarkdown` uses at the root. Cleans up the root-level
 * single-vault mirror if one exists, and the folders of vaults that were
 * renamed or deleted since the last sync.
 */
export async function localFSPushAllVaults(mirrors: VaultMirror[], session: WriteSession): Promise<void> {
	const dir = await getHandle();
	if (!dir) throw new Error('Local folder not configured');

	// Switching from the single-vault layout: remove the root-level notes
	// and their index (blobs stay; they're harmless and may be shared).
	const rootPaths = await readManagedPaths(dir);
	if (rootPaths.length > 0) {
		await pruneManagedFiles(dir, rootPaths, new Set(), session);
		try {
			await archiveFile(await dir.getDirectoryHandle(METADATA_DIR), METADATA_FILE, `${METADATA_DIR}/${METADATA_FILE}`);
		} catch {
			// Already gone.
		}
	}

	const dirNames = vaultDirNames(mirrors.map((m) => m.vault));
	const index: Record<string, string> = {};
	for (const mirror of mirrors) {
		const name = dirNames.get(mirror.vault.id)!;
		index[mirror.vault.id] = name;
		await writeVaultMarkdown(await getOrCreateDir(dir, [name]), mirror, session, `${name}/`);
	}
	await pruneAllVaultsLayout(dir, new Set(Object.values(index)), session);

	const metaDir = await getOrCreateDir(dir, [METADATA_DIR]);
	await writeIfChanged(metaDir, VAULTS_INDEX_FILE, JSON.stringify({ version: 1, vaults: index }, null, 2) + '\n');
	await writeIfChanged(metaDir, AGENT_GUIDE_FILE, agentGuide);
	await writeClaudeInstructions(dir);
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
	keep: Set<string>,
	session: WriteSession
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
		await pruneManagedFiles(vaultDir, await readManagedPaths(vaultDir), new Set(), session, `${name}/`);
		try {
			await archiveTree(vaultDir, METADATA_DIR, `${name}/`);
		} catch {
			// No metadata dir.
		}
		await removeEmptyDirByPath(dir, name);
	}
	if (keep.size === 0 && Object.keys(index).length > 0) {
		try {
			await archiveFile(await dir.getDirectoryHandle(METADATA_DIR), VAULTS_INDEX_FILE, `${METADATA_DIR}/${VAULTS_INDEX_FILE}`);
		} catch {
			// Already gone.
		}
	}
}

// Delete previously written note files that aren't in `keep`, then any
// directories that pruning left empty. With a session, a file that changed
// since the sync read it stays (see WriteSession).
async function pruneManagedFiles(
	dir: FileSystemDirectoryHandle,
	previousPaths: string[],
	keep: Set<string>,
	session?: WriteSession,
	prefix = ''
): Promise<void> {
	for (const path of previousPaths) {
		if (keep.has(path)) continue;
		if (session) {
			const parts = path.split('/').filter(Boolean);
			const name = parts.pop()!;
			const key = (prefix + path).toLowerCase();
			let text: string | null = null;
			try {
				text = await readIfExists(parts.length ? await getExistingDir(dir, parts) : dir, name);
			} catch {
				// Directory gone: nothing to protect.
			}
			if (text !== null && session.expected.get(key) !== hashText(text)) {
				session.skipped = true;
				continue;
			}
			if (text !== null) await rescueIfUnread(prefix + path, text, session);
			delete session.state.files[key];
		}
		await removeFileByPath(dir, path, prefix);
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
	{ memories, folders, vault, people, events, actionItems, blobs, work }: VaultMirror,
	session: WriteSession,
	prefix: string
): Promise<void> {
	// First, so an agent finds it whatever happens to the rest.
	const metaDir = await getOrCreateDir(dir, [METADATA_DIR]);
	await writeIfChanged(metaDir, AGENT_GUIDE_FILE, agentGuide);

	const files = notesToMarkdownFiles(memories, folders);
	const newPaths = new Set(files.map((f) => f.path));
	const previousPaths = await readManagedPaths(dir);

	for (const file of files) {
		const parts = file.path.split('/').filter(Boolean);
		const filename = parts.pop();
		if (!filename) continue;
		// One file that can't be written mustn't cost all the others, or the
		// metadata below, which comes last.
		try {
			const targetDir = parts.length ? await getOrCreateDir(dir, parts) : dir;
			await writeGuarded(targetDir, filename, prefix + file.path, file.content, session);
		} catch (err) {
			console.warn(`Couldn't write ${prefix + file.path}:`, err);
			session.failed.push(prefix + file.path);
		}
	}

	// Write referenced blob bytes under .kurumi/blobs/<id> and record mimes.
	const blobMeta: Record<string, { mimeType: string }> = {};
	if (blobs.length > 0) {
		const blobDir = await getOrCreateDir(dir, [METADATA_DIR, BLOBS_DIR]);
		for (const blob of blobs) {
			// Immutable: a blob that's there is the right one.
			const present = await blobDir.getFileHandle(refToId(blob.ref)).then(() => true, () => false);
			try {
				if (!present) await writeFile(blobDir, refToId(blob.ref), toArrayBuffer(blob.bytes));
			} catch (err) {
				console.warn(`Couldn't write blob ${blob.ref}:`, err);
				session.failed.push(`${prefix}${METADATA_DIR}/${BLOBS_DIR}/${refToId(blob.ref)}`);
			}
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
		blobMeta,
		work
	);
	const metadataKey = `${prefix}${METADATA_DIR}/${METADATA_FILE}`;
	if (await writeGuarded(metaDir, METADATA_FILE, metadataKey, serializeMetadata(metadata), session)) {
		session.state.records[vault.id] = recordFingerprints(readMetadataRecords(metadata, vault.id));
	}

	// Prune notes we previously wrote that no longer exist (rename/delete).
	await pruneManagedFiles(dir, previousPaths, newPaths, session, prefix);
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

const MARKDOWN_FILE = /\.(md|markdown)$/i;

export interface DiskTree {
	files: DiskMarkdownFile[];
	emptyDirs: string[]; // directories with nothing (visible) in them
}

// Recursively read every markdown file and directory in the picked folder.
// Hidden entries (`.kurumi`, `.git`, `.obsidian`, `.DS_Store`, …) are
// skipped. Returns raw contents + the OS file mtime so the caller can
// decide which side is newer.
export async function localFSReadTree(): Promise<DiskTree> {
	const dir = await getHandle();
	if (!dir) throw new Error('Local folder not configured');
	const tree: DiskTree = { files: [], emptyDirs: [] };
	await walkTree(dir, '', tree);
	return tree;
}

export async function localFSReadMarkdown(): Promise<DiskMarkdownFile[]> {
	return (await localFSReadTree()).files;
}

async function walkTree(dir: FileSystemDirectoryHandle, prefix: string, tree: DiskTree): Promise<void> {
	const entries = (dir as FileSystemDirectoryHandle & {
		values: () => AsyncIterableIterator<FileSystemHandle>;
	}).values();
	let empty = true;
	for await (const handle of entries) {
		if (handle.name.startsWith('.')) continue;
		empty = false;
		const childPath = prefix ? `${prefix}/${handle.name}` : handle.name;
		if (handle.kind === 'directory') {
			await walkTree(handle as FileSystemDirectoryHandle, childPath, tree);
		} else if (handle.kind === 'file' && MARKDOWN_FILE.test(handle.name)) {
			const file = await (handle as FileSystemFileHandle).getFile();
			tree.files.push({ path: childPath, content: await file.text(), lastModified: file.lastModified });
		}
	}
	if (empty && prefix) tree.emptyDirs.push(prefix);
}

/**
 * Paths of the notes Kurumi wrote on the last sync, mapped to their note
 * ids (from the `.kurumi/metadata.json` of the root or of each vault
 * folder), relative to the folder root.
 */
export async function localFSManagedPaths(): Promise<Map<string, string>> {
	const root = await getHandle();
	const out = new Map<string, string>();
	if (!root) return out;
	const add = async (dir: FileSystemDirectoryHandle, prefix: string) => {
		try {
			const metaDir = await dir.getDirectoryHandle(METADATA_DIR);
			const handle = await metaDir.getFileHandle(METADATA_FILE);
			const parsed = parseMetadata(await (await handle.getFile()).text());
			for (const [path, id] of Object.entries(parsed?.noteIds ?? {})) out.set(prefix + path, id);
		} catch {
			// No metadata here yet.
		}
	};
	await add(root, '');
	for (const name of new Set(Object.values(await readVaultsIndex(root)))) {
		try {
			await add(await root.getDirectoryHandle(name), `${name}/`);
		} catch {
			// Vault folder missing.
		}
	}
	return out;
}

export interface MetadataFile {
	/** Path relative to the folder root. */
	path: string;
	text: string;
	/** Null when it isn't valid JSON (yet). */
	metadata: GitMetadata | null;
}

/** Every `.kurumi/metadata.json` in the folder (the root's and each vault folder's). */
export async function localFSReadMetadata(): Promise<MetadataFile[]> {
	const root = await getHandle();
	if (!root) return [];
	const dirs: [FileSystemDirectoryHandle, string][] = [[root, '']];
	for (const name of new Set(Object.values(await readVaultsIndex(root)))) {
		try {
			dirs.push([await root.getDirectoryHandle(name), `${name}/`]);
		} catch {
			// Vault folder missing.
		}
	}
	const out: MetadataFile[] = [];
	for (const [dir, prefix] of dirs) {
		try {
			const metaDir = await dir.getDirectoryHandle(METADATA_DIR);
			const text = await (await (await metaDir.getFileHandle(METADATA_FILE)).getFile()).text();
			out.push({ path: `${prefix}${METADATA_DIR}/${METADATA_FILE}`, text, metadata: parseMetadata(text) });
		} catch {
			// No metadata here yet.
		}
	}
	return out;
}

/**
 * A fingerprint of the folder from names, sizes and dates only, cheap enough
 * to compare every few seconds. Covers notes, Kurumi's metadata and blobs and
 * the database; skips other hidden entries (`.git`, …) and `node_modules`.
 */
export async function localFSSignature(): Promise<string | null> {
	const root = await getGrantedHandle();
	if (!root) return null;
	const parts: string[] = [];
	const walk = async (dir: FileSystemDirectoryHandle, prefix: string): Promise<void> => {
		const entries = (dir as FileSystemDirectoryHandle & {
			values: () => AsyncIterableIterator<FileSystemHandle>;
		}).values();
		for await (const handle of entries) {
			if (handle.name === 'node_modules') continue;
			if (handle.name.startsWith('.') && handle.name !== METADATA_DIR) continue;
			const path = `${prefix}${handle.name}`;
			// Only Kurumi writes those, and they can get long.
			if (path === `${METADATA_DIR}/${ARCHIVE_DIR}` || path === `${METADATA_DIR}/${RESCUED_DIR}`) continue;
			if (handle.kind === 'directory') await walk(handle as FileSystemDirectoryHandle, `${path}/`);
			else if (handle.name !== AGENT_GUIDE_FILE) {
				const file = await (handle as FileSystemFileHandle).getFile();
				parts.push(`${path}:${file.size}:${file.lastModified}`);
			}
		}
	};
	await walk(root, '');
	return hashText(parts.sort().join('\n'));
}

// The handle, without ever asking for permission (no click to ask from).
async function getGrantedHandle(): Promise<FileSystemDirectoryHandle | null> {
	const info = await getLocalFSFolder();
	return info?.granted ? ((await storedHandle()) as FileSystemDirectoryHandle) : null;
}

/** The all-vaults index: vault id → folder name. */
export async function localFSVaultFolders(): Promise<Record<string, string>> {
	const root = await getHandle();
	return root ? readVaultsIndex(root) : {};
}

/**
 * Remove files that were imported and have since been written under
 * their canonical path, then any directories that left empty (deepest
 * first; non-empty ones, e.g. holding attachments, are kept).
 */
export async function localFSRemoveImported(paths: string[]): Promise<void> {
	const root = await getHandle();
	if (!root || paths.length === 0) return;
	for (const path of paths) await removeFileByPath(root, path);
	const dirs = [...dirPrefixes(paths)].sort((a, b) => b.split('/').length - a.split('/').length);
	for (const dir of dirs) await removeEmptyDirByPath(root, dir);
}

/**
 * Whether a file exists at exactly `path` (relative to the folder root),
 * comparing names case-sensitively against the directory listings. On a
 * case-insensitive disk (macOS, Windows) "Notes/A.md" and "notes/a.md"
 * are one file whose listed name is whichever was created first, so this
 * is what tells two paths apart as really different files.
 */
export async function localFSExactFileExists(path: string): Promise<boolean> {
	const root = await getHandle();
	if (!root) return false;
	const parts = path.split('/').filter(Boolean);
	let dir: FileSystemDirectoryHandle = root;
	for (let i = 0; i < parts.length; i++) {
		const wantDir = i < parts.length - 1;
		let next: FileSystemHandle | null = null;
		const entries = (dir as FileSystemDirectoryHandle & {
			values: () => AsyncIterableIterator<FileSystemHandle>;
		}).values();
		for await (const handle of entries) {
			if (handle.name === parts[i] && handle.kind === (wantDir ? 'directory' : 'file')) {
				next = handle;
				break;
			}
		}
		if (!next) return false;
		if (wantDir) dir = next as FileSystemDirectoryHandle;
	}
	return true;
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
