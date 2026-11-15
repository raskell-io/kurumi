/**
 * The read model of the linked folder that is open: its notes and folders as
 * `MemoryObject`s and `Folder`s, held in memory only. `$lib/db` routes its
 * note readers here when the current vault is linked; nothing here is ever
 * put into the Automerge document, IndexedDB or a sync upload, and nothing
 * here writes to the folder.
 *
 * Only one linked vault is open at a time (scanned by the desktop app's
 * `linked_open`). `linkedRevision` changes whenever its contents do.
 *
 * Must not import `$lib/db/store` (the store imports this) or anything of
 * the folder sync (`sync/local-fs`, the agent guide): a linked folder keeps
 * its own conventions.
 */

import { writable, type Readable } from 'svelte/store';
import { createMemoryObject, type Folder, type MemoryObject, type Vault } from '$lib/db/types';
import { invoke } from '$lib/desktop/invoke';
import { buildLinkIndex, type LinkResolver } from './links';
import { readFrontmatterFields, splitFrontmatter } from './frontmatter';
import { getLinkedVault, setActiveLinkedVaultId } from './config';
import type { LinkedNoteInfo, LinkedVaultConfig, NoteFile, OpenedFolder } from './types';

// ---- Ids ---------------------------------------------------------------

const NOTE_PREFIX = 'lf.';
const FOLDER_PREFIX = 'lfd.';

export const isLinkedNoteId = (id: string | null | undefined): boolean => !!id && id.startsWith(NOTE_PREFIX);
export const isLinkedFolderId = (id: string | null | undefined): boolean => !!id && id.startsWith(FOLDER_PREFIX);
/** A note or folder of a linked vault. */
export const isLinkedId = (id: string | null | undefined): boolean => isLinkedNoteId(id) || isLinkedFolderId(id);

function base64url(text: string): string {
	let binary = '';
	for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64url(encoded: string): string {
	const binary = atob(encoded.replace(/-/g, '+').replace(/_/g, '/'));
	return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
}

/** `lf.<vault>.<path>`: stable across restarts, and never a document id. */
export const linkedNoteId = (vaultId: string, rel: string): string => `${NOTE_PREFIX}${vaultId}.${base64url(rel)}`;
export const linkedFolderId = (vaultId: string, dir: string): string => `${FOLDER_PREFIX}${vaultId}.${base64url(dir)}`;

/** The vault and path in a linked note or folder id; null for any other id. */
export function parseLinkedId(id: string): { vaultId: string; rel: string } | null {
	const prefix = isLinkedFolderId(id) ? FOLDER_PREFIX : isLinkedNoteId(id) ? NOTE_PREFIX : null;
	if (!prefix) return null;
	const rest = id.slice(prefix.length);
	const dot = rest.lastIndexOf('.');
	if (dot <= 0) return null;
	try {
		return { vaultId: rest.slice(0, dot), rel: fromBase64url(rest.slice(dot + 1)) };
	} catch {
		return null;
	}
}

// ---- Building notes ------------------------------------------------------

export interface LinkedVaultData {
	/** By id, in path order (the first of two notes with one key wins). */
	notes: Map<string, MemoryObject>;
	folders: Map<string, Folder>;
	info: Map<string, LinkedNoteInfo>;
	skipped: number;
}

const stem = (rel: string) => rel.slice(rel.lastIndexOf('/') + 1).replace(/\.(md|markdown)$/i, '');
const one = (value: string | string[] | undefined): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null);

/** The first `# Heading` outside fenced code. */
function firstHeading(body: string): string | null {
	let fence: string | null = null;
	for (const line of body.split(/\r?\n/)) {
		const marker = line.trimStart().match(/^(`{3,}|~{3,})/)?.[1];
		if (fence) {
			if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = null;
			continue;
		}
		if (marker) {
			fence = marker;
			continue;
		}
		const heading = /^#\s+(.+?)\s*#*\s*$/.exec(line);
		if (heading) return heading[1].trim() || null;
	}
	return null;
}

const tagPart = (text: string) => text.trim().toLowerCase().replace(/^#/, '').replace(/\s+/g, '-');

/** One file as a note. Pure: the same file gives the same note. */
export function buildLinkedNote(config: LinkedVaultConfig, file: NoteFile): { note: MemoryObject; info: LinkedNoteInfo } {
	const { raw, body } = splitFrontmatter(file.content);
	const frontmatter = readFrontmatterFields(raw);
	const name = stem(file.rel);
	const title = (config.titleField ? one(frontmatter[config.titleField]) : null) ?? firstHeading(body) ?? name;
	const tags = new Set<string>();
	for (const field of config.tagFields) {
		const value = frontmatter[field];
		for (const v of Array.isArray(value) ? value : value ? [value] : []) if (tagPart(v)) tags.add(`${tagPart(field)}/${tagPart(v)}`);
	}
	const listed = frontmatter.tags;
	for (const v of Array.isArray(listed) ? listed : typeof listed === 'string' ? listed.split(/[,\s]+/) : []) if (tagPart(v)) tags.add(tagPart(v));
	const dir = file.rel.includes('/') ? file.rel.slice(0, file.rel.lastIndexOf('/')) : '';
	const linkKeyValue =
		config.linkKey === 'frontmatter' ? one(frontmatter[config.linkKeyField]) : config.linkKey === 'filename' ? name : title;
	const note: MemoryObject = {
		...createMemoryObject({ title, bodyMarkdown: body, folderId: dir ? linkedFolderId(config.id, dir) : null, vaultId: config.id }),
		id: linkedNoteId(config.id, file.rel),
		summaryShort: config.summaryField ? one(frontmatter[config.summaryField]) : null,
		tags: [...tags],
		createdAt: file.mtime,
		updatedAt: file.mtime,
		capturedAt: file.mtime
	};
	return { note, info: { relPath: file.rel, rawFrontmatter: raw, frontmatter, baseHash: file.hash, mtime: file.mtime, linkKeyValue } };
}

/** A scan as notes and folders. Pure. */
export function buildLinkedVault(config: LinkedVaultConfig, opened: OpenedFolder): LinkedVaultData {
	const data: LinkedVaultData = { notes: new Map(), folders: new Map(), info: new Map(), skipped: opened.skipped };
	const addDir = (dir: string, modified: number) => {
		// The directory and every one above it.
		const parts = dir.split('/').filter(Boolean);
		for (let depth = 1; depth <= parts.length; depth++) {
			const path = parts.slice(0, depth).join('/');
			const id = linkedFolderId(config.id, path);
			if (data.folders.has(id)) continue;
			data.folders.set(id, {
				id,
				name: parts[depth - 1],
				parentId: depth > 1 ? linkedFolderId(config.id, parts.slice(0, depth - 1).join('/')) : null,
				vaultId: config.id,
				created: config.created,
				modified,
				deletedAt: null
			});
		}
	};
	for (const dir of [...opened.dirs].sort()) addDir(dir, config.created);
	for (const file of [...opened.notes].sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))) {
		const { note, info } = buildLinkedNote(config, file);
		if (file.rel.includes('/')) addDir(file.rel.slice(0, file.rel.lastIndexOf('/')), file.mtime);
		data.notes.set(note.id, note);
		data.info.set(note.id, info);
	}
	return data;
}

/** The link resolver of a linked vault: by key, then the configured fallbacks. */
export function buildLinkedResolver(config: LinkedVaultConfig, data: LinkedVaultData): LinkResolver<MemoryObject> {
	const filename = (note: MemoryObject) => stem(data.info.get(note.id)?.relPath ?? '') || null;
	const title = (note: MemoryObject) => note.title;
	return buildLinkIndex([...data.notes.values()], {
		linkKeyOf: (note) => data.info.get(note.id)?.linkKeyValue,
		fallbacks: config.linkFallback.map((fallback) => (fallback === 'filename' ? filename : title))
	});
}

/** A linked folder as the vault list shows it. Display only: never stored. */
export function linkedVaultAsVault(config: LinkedVaultConfig): Vault {
	return { id: config.id, name: config.name, ...(config.icon ? { icon: config.icon } : {}), created: config.created, modified: config.created, kind: 'linked' };
}

// ---- The open vault ------------------------------------------------------

interface Mounted {
	config: LinkedVaultConfig;
	data: LinkedVaultData;
	links: LinkResolver<MemoryObject> | null;
}

let mounted: Mounted | null = null;

const revision = writable(0);
/** Changes whenever the open linked vault's contents (or which one is open) change. */
export const linkedRevision: Readable<number> = { subscribe: revision.subscribe };

const mountedId = writable<string | null>(null);
/** The id of the linked vault that is open and current, or null. */
export const linkedVaultId: Readable<string | null> = { subscribe: mountedId.subscribe };

export interface LinkedProblem {
	vaultId: string;
	/** 'missing': the folder isn't there (moved, disk unplugged). */
	kind: 'missing' | 'error';
	message: string;
}
const problem = writable<LinkedProblem | null>(null);
/** Why the linked vault that should be current isn't open, if so. */
export const linkedProblem: Readable<LinkedProblem | null> = { subscribe: problem.subscribe };

function setMounted(next: Mounted | null): void {
	mounted = next;
	mountedId.set(next?.config.id ?? null);
	revision.update((n) => n + 1);
}

/**
 * Scan the folder and make it the current vault of this device. Scanning
 * the vault that is already open reads it again (Rescan). Throws what the
 * app's command fails with (a DOMException: `NotFoundError` when the folder
 * is gone), leaving the previous state as it was except that `linkedProblem`
 * says why.
 */
export async function openLinkedVault(config: LinkedVaultConfig): Promise<void> {
	let opened: OpenedFolder;
	try {
		opened = (await invoke('linked_open', {
			vault: config.id,
			root: config.path,
			ignore: config.ignore,
			respectGitignore: config.respectGitignore,
			readOnly: config.readOnly
		})) as OpenedFolder;
	} catch (err) {
		const name = err instanceof DOMException ? err.name : '';
		problem.set({ vaultId: config.id, kind: name === 'NotFoundError' ? 'missing' : 'error', message: err instanceof Error ? err.message : String(err) });
		throw err;
	}
	const previous = mounted?.config.id;
	if (previous && previous !== config.id) void invoke('linked_close', { vault: previous }).catch(() => {});
	problem.set(null);
	setActiveLinkedVaultId(config.id);
	setMounted({ config, data: buildLinkedVault(config, opened), links: null });
}

/** Read the open vault's folder again. */
export async function rescanLinkedVault(): Promise<void> {
	if (!mounted) return;
	// Settings may have changed since it was opened.
	await openLinkedVault(getLinkedVault(mounted.config.id) ?? mounted.config);
}

/** Leave the linked vault: the document's own current vault is current again. */
export function closeLinkedVault(): void {
	setActiveLinkedVaultId(null);
	problem.set(null);
	if (!mounted) return;
	void invoke('linked_close', { vault: mounted.config.id }).catch(() => {});
	setMounted(null);
}

// ---- Readers (for $lib/db) ------------------------------------------------

export const getOpenLinkedVaultId = (): string | null => mounted?.config.id ?? null;
export const getOpenLinkedVaultConfig = (): LinkedVaultConfig | null => mounted?.config ?? null;

/** The open vault's notes, in path order. */
export const linkedNotes = (): MemoryObject[] => (mounted ? [...mounted.data.notes.values()] : []);
export const linkedNote = (id: string): MemoryObject | undefined => mounted?.data.notes.get(id);
export const linkedFolders = (): Folder[] => (mounted ? [...mounted.data.folders.values()] : []);
export const linkedFolder = (id: string): Folder | undefined => mounted?.data.folders.get(id);
/** Path, frontmatter and key of a linked note. */
export const linkedNoteInfo = (id: string): LinkedNoteInfo | undefined => mounted?.data.info.get(id);

/** The open vault's link resolver (key mode), or null when none is open. */
export function linkedLinks(): LinkResolver<MemoryObject> | null {
	if (!mounted) return null;
	mounted.links ??= buildLinkedResolver(mounted.config, mounted.data);
	return mounted.links;
}

/** Counts for the vault's settings. */
export function linkedStats(): { notes: number; folders: number; skipped: number; duplicates: { key: string; ids: string[] }[] } | null {
	if (!mounted) return null;
	return { notes: mounted.data.notes.size, folders: mounted.data.folders.size, skipped: mounted.data.skipped, duplicates: linkedLinks()?.duplicates() ?? [] };
}
