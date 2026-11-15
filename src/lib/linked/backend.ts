/**
 * The linked folder that is open: its notes and folders as `MemoryObject`s
 * and `Folder`s, held in memory only. `$lib/db` routes its note readers and
 * writers here when the current vault is linked; nothing here is ever put
 * into the Automerge document, IndexedDB or a sync upload.
 *
 * Only one linked vault is open at a time (scanned by the desktop app's
 * `linked_open`). While it is open a long poll (`linked_changes`) brings in
 * what changes in the folder; `linkedRevision` changes whenever the notes do.
 *
 * Writing (only when the vault's settings allow it): `saveLinkedNote` puts
 * a note's new text into its file, the frontmatter kept byte for byte, and
 * only if the file is still what Kurumi last read (`linked_write` checks the
 * hash). If it isn't, the two are merged by lines, or the save waits for the
 * user (`linkedSaveIssues`). A file is never written when nothing changed.
 *
 * Must not import `$lib/db/store` (the store imports this) or anything of
 * the folder sync (`sync/local-fs`, the agent guide): a linked folder keeps
 * its own conventions.
 */

import { writable, type Readable } from 'svelte/store';
import { createMemoryObject, type Folder, type MemoryObject, type Vault } from '$lib/db/types';
import { invoke } from '$lib/desktop/invoke';
import { buildLinkIndex, type LinkResolver } from './links';
import { joinNote, readFrontmatterFields, scalarFieldValue, setScalarField, splitFrontmatter } from './frontmatter';
import { getLinkedVault, setActiveLinkedVaultId } from './config';
import { READ_ONLY_NOTE } from './capabilities';
import { mergeText } from '$lib/sync/text-merge';
import { showNotice } from '$lib/stores/notice';
import type { LinkedChange, LinkedChanges, LinkedNoteInfo, LinkedSaveIssue, LinkedVaultConfig, NoteFile, OpenedFolder } from './types';

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

/** The folder of `dir` and of every directory above it, if not there yet. */
function addFolders(config: LinkedVaultConfig, data: LinkedVaultData, dir: string, modified: number): void {
	const parts = dir.split('/').filter(Boolean);
	for (let depth = 1; depth <= parts.length; depth++) {
		const id = linkedFolderId(config.id, parts.slice(0, depth).join('/'));
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
}

const byRel = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** A scan as notes and folders. Pure. */
export function buildLinkedVault(config: LinkedVaultConfig, opened: OpenedFolder): LinkedVaultData {
	const data: LinkedVaultData = { notes: new Map(), folders: new Map(), info: new Map(), skipped: opened.skipped };
	for (const dir of [...opened.dirs].sort()) addFolders(config, data, dir, config.created);
	for (const file of [...opened.notes].sort((a, b) => byRel(a.rel, b.rel))) {
		const { note, info } = buildLinkedNote(config, file);
		if (file.rel.includes('/')) addFolders(config, data, file.rel.slice(0, file.rel.lastIndexOf('/')), file.mtime);
		data.notes.set(note.id, note);
		data.info.set(note.id, info);
	}
	return data;
}

/**
 * Bring changes from the folder into `data` (in place): changed and new
 * notes, and notes that are gone. Notes stay in path order. A directory
 * that lost its last note stays until the next scan. Returns the ids of
 * the notes that changed and of those removed.
 */
export function applyLinkedChanges(config: LinkedVaultConfig, data: LinkedVaultData, changes: LinkedChange[]): { changed: string[]; removed: string[] } {
	const changed: string[] = [];
	const removed: string[] = [];
	let added = false;
	for (const change of changes) {
		if (change.type === 'remove') {
			const id = linkedNoteId(config.id, change.rel);
			if (data.notes.delete(id)) removed.push(id);
			data.info.delete(id);
			continue;
		}
		const { note, info } = buildLinkedNote(config, change.note);
		added ||= !data.notes.has(note.id);
		if (change.note.rel.includes('/')) addFolders(config, data, change.note.rel.slice(0, change.note.rel.lastIndexOf('/')), change.note.mtime);
		data.notes.set(note.id, note);
		data.info.set(note.id, info);
		changed.push(note.id);
	}
	if (added) {
		// The first of two notes with one key wins, by path: keep that order.
		const sorted = [...data.notes.entries()].sort((a, b) => byRel(data.info.get(a[0])!.relPath, data.info.get(b[0])!.relPath));
		data.notes.clear();
		for (const [id, note] of sorted) data.notes.set(id, note);
	}
	return { changed, removed };
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
	/** Where the next `linked_changes` continues. */
	cursor: number;
}

let mounted: Mounted | null = null;
// Each open (and close) starts a new one; a poll of an older one stops.
let generation = 0;

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

export type LinkedWatch = 'events' | 'polling' | 'stopped';
const watch = writable<LinkedWatch | null>(null);
/**
 * How changes in the open folder reach Kurumi: 'events' (at once), 'polling'
 * (the folder is looked at now and then: network shares), or 'stopped'
 * (watching failed; Rescan reads the folder again). Null when none is open.
 */
export const linkedWatch: Readable<LinkedWatch | null> = { subscribe: watch.subscribe };

function setMounted(next: Mounted | null): void {
	mounted = next;
	mountedId.set(next?.config.id ?? null);
	revision.update((n) => n + 1);
}

/** After a change to the open vault's notes. */
function changed(): void {
	if (mounted) mounted.links = null;
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
	if (previous && previous !== config.id) {
		void invoke('linked_close', { vault: previous }).catch(() => {});
		forgetSaves();
	}
	problem.set(null);
	setActiveLinkedVaultId(config.id);
	const gen = ++generation;
	watch.set(opened.watch ?? 'events');
	setMounted({ config, data: buildLinkedVault(config, opened), links: null, cursor: opened.cursor });
	void poll(gen);
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
	generation++;
	void invoke('linked_close', { vault: mounted.config.id }).catch(() => {});
	forgetSaves();
	watch.set(null);
	setMounted(null);
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Wait for changes in the folder and apply them, for as long as this open
 * of the vault is the current one. The app answers when something changed,
 * or after about 25 s with nothing.
 */
async function poll(gen: number): Promise<void> {
	while (mounted && gen === generation) {
		const asked = Date.now();
		let result: LinkedChanges;
		try {
			result = (await invoke('linked_changes', { vault: mounted.config.id, cursor: mounted.cursor })) as LinkedChanges;
		} catch {
			// Closed or opened again meanwhile: that poll is over. Anything
			// else: stop asking; Rescan in the vault's settings reads again.
			if (mounted && gen === generation) watch.set('stopped');
			return;
		}
		if (!mounted || gen !== generation) return;
		if (result.rescan) {
			// Too much changed to list. Open again; that starts its own poll.
			await rescanLinkedVault().catch(() => watch.set('stopped'));
			return;
		}
		mounted.cursor = result.cursor;
		if (result.changes.length) {
			for (const change of result.changes) {
				// Kept in case an edit of it is still to be saved (see `deleted`).
				const id = change.type === 'remove' ? linkedNoteId(mounted.config.id, change.rel) : '';
				const info = id ? mounted.data.info.get(id) : undefined;
				if (info) gone.set(id, { rel: info.relPath, raw: info.rawFrontmatter });
			}
			applyLinkedChanges(mounted.config, mounted.data, result.changes);
			changed();
		} else if (Date.now() - asked < 200) {
			// An answer at once with nothing in it: don't spin.
			await pause(250);
		}
	}
}

// ---- Saving ------------------------------------------------------------

/** What to save of a linked note. */
export interface LinkedSave {
	title?: string;
	/** The whole body, exactly as it should be in the file. */
	bodyMarkdown?: string;
	/**
	 * The body this edit started from, when that may not be the note's
	 * current one (an editor that was open while the file changed). A
	 * change made in the file since is then merged in rather than lost.
	 */
	basedOn?: string;
}

const queued = new Map<string, LinkedSave>();
const busy = new Set<string>();
// Notes removed in the folder, for "save as a new file": path and frontmatter.
const gone = new Map<string, { rel: string; raw: string }>();

const issues = writable<Map<string, LinkedSaveIssue>>(new Map());
/** Saves that wait for the user, by note id. While a note has one, nothing of it is written. */
export const linkedSaveIssues: Readable<Map<string, LinkedSaveIssue>> = { subscribe: issues.subscribe };

let issueMap = new Map<string, LinkedSaveIssue>();
issues.subscribe((value) => (issueMap = value));

function setIssue(id: string, issue: LinkedSaveIssue | null): void {
	const next = new Map(issueMap);
	if (issue) next.set(id, issue);
	else next.delete(id);
	issues.set(next);
}

function forgetSaves(): void {
	queued.clear();
	busy.clear();
	gone.clear();
	issues.set(new Map());
}

const errorName = (err: unknown) => (err instanceof DOMException ? err.name : '');
const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));
const pad = (n: number) => String(n).padStart(2, '0');
const today = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Whether the open vault's notes may be written. */
export const linkedWritable = (): boolean => !!mounted && !mounted.config.readOnly;

/**
 * Whether a linked note's title can be changed: only where it comes from a
 * frontmatter field that is one plain line (files are not renamed).
 */
export function linkedTitleEditable(id: string): boolean {
	const info = mounted?.data.info.get(id);
	const field = mounted?.config.titleField;
	return !!info && !!field && linkedWritable() && scalarFieldValue(info.rawFrontmatter, field) === mounted!.data.notes.get(id)?.title;
}

/**
 * Save a linked note's text (and title, where that is a frontmatter field)
 * to its file. Returns at once; saves of one note run one after another,
 * the latest text winning. In a read-only vault nothing happens but a notice.
 */
export function saveLinkedNote(id: string, save: LinkedSave): void {
	if (!mounted || !isLinkedNoteId(id)) return;
	if (mounted.config.readOnly) return showNotice(READ_ONLY_NOTE);
	const waiting = issueMap.get(id);
	if (waiting) {
		// Paused until the user decides; keep what they would write up to date.
		setIssue(id, { ...waiting, mine: { title: save.title ?? waiting.mine.title, body: save.bodyMarkdown ?? waiting.mine.body } });
		return;
	}
	const before = queued.get(id);
	queued.set(id, { ...before, ...save, basedOn: before?.basedOn ?? save.basedOn });
	if (!busy.has(id)) void drain(id);
}

async function drain(id: string): Promise<void> {
	busy.add(id);
	try {
		for (let save = queued.get(id); save; save = queued.get(id)) {
			queued.delete(id);
			await writeNote(id, save);
		}
	} finally {
		busy.delete(id);
	}
}

/** One write of one note. Never throws: what goes wrong becomes a save issue. */
async function writeNote(id: string, save: LinkedSave, again = false): Promise<void> {
	const open = mounted;
	if (!open || open.config.readOnly) return;
	const note = open.data.notes.get(id);
	const info = open.data.info.get(id);
	const mine = { title: save.title, body: save.bodyMarkdown ?? note?.bodyMarkdown ?? '' };
	if (!note || !info) {
		if (save.bodyMarkdown !== undefined) setIssue(id, { kind: 'deleted', message: 'This file was deleted outside Kurumi.', mine });
		return;
	}
	const current = note.bodyMarkdown;
	let body = save.bodyMarkdown ?? current;
	let merged = false;
	if (save.basedOn !== undefined && save.basedOn !== current && body !== current) {
		// The file changed since this edit began: both changes, if they
		// don't touch the same lines.
		const both = body === save.basedOn ? current : mergeText(save.basedOn, body, current);
		if (both === null) {
			setIssue(id, { kind: 'conflict', message: 'This note was changed outside Kurumi while you were editing it.', mine, theirs: current });
			return;
		}
		merged = both !== body;
		body = both;
	}
	let raw = info.rawFrontmatter;
	const { titleField, updatedField, updatedFormat } = open.config;
	if (save.title !== undefined && save.title !== note.title && titleField) raw = setScalarField(raw, titleField, save.title);
	if (body !== current && updatedField) raw = setScalarField(raw, updatedField, updatedFormat === 'datetime' ? new Date().toISOString() : today());
	// Nothing to write: a file is never rewritten for nothing.
	if (body === current && raw === info.rawFrontmatter) return;
	const content = joinNote(raw, body);
	let written: { hash: string; mtime: number };
	try {
		written = (await invoke('linked_write', { vault: open.config.id, rel: info.relPath, expectedHash: info.baseHash, content })) as typeof written;
	} catch (err) {
		if (mounted !== open) return;
		const name = errorName(err);
		if (name === 'ConflictError' && !again) {
			// The file changed and the watcher hasn't said so yet: read it,
			// then save again, which merges or asks.
			try {
				const file = (await invoke('linked_read', { vault: open.config.id, rel: info.relPath })) as NoteFile;
				if (mounted !== open) return;
				applyLinkedChanges(open.config, open.data, [{ type: 'upsert', note: file }]);
				changed();
				return writeNote(id, { ...save, bodyMarkdown: body, basedOn: save.basedOn ?? current }, true);
			} catch (readError) {
				if (errorName(readError) === 'NotFoundError') return setIssue(id, { kind: 'deleted', message: 'This file was deleted outside Kurumi.', mine: { ...mine, body } });
			}
		}
		if (name === 'NotFoundError') return setIssue(id, { kind: 'deleted', message: 'This file was deleted outside Kurumi.', mine: { ...mine, body } });
		setIssue(id, {
			kind: name === 'ConflictError' ? 'conflict' : 'error',
			message: name === 'ConflictError' ? 'This note was changed outside Kurumi while you were editing it.' : `Couldn't save: ${errorText(err)}`,
			mine: { ...mine, body },
			...(name === 'ConflictError' ? { theirs: current } : {})
		});
		return;
	}
	if (mounted !== open) return;
	applyLinkedChanges(open.config, open.data, [{ type: 'upsert', note: { rel: info.relPath, content, hash: written.hash, mtime: written.mtime, size: content.length } }]);
	changed();
	if (merged) showNotice('Merged with a change made outside Kurumi.');
}

/** Hold a save for the user instead of writing it (an edit from before a restart whose file changed since). */
export function raiseLinkedConflict(id: string, mine: { title?: string; body: string }): void {
	const note = mounted?.data.notes.get(id);
	if (!note || note.bodyMarkdown === mine.body) return;
	setIssue(id, { kind: 'conflict', message: 'This note was changed outside Kurumi after your last edit.', mine, theirs: note.bodyMarkdown });
}

/**
 * Settle a save that was waiting: 'mine' writes Kurumi's text over the
 * file's (a deleted file is created again), 'theirs' drops it, and a string
 * is the text to write instead (the two combined by the user). For a failed
 * write 'mine' tries again.
 */
export function resolveLinkedIssue(id: string, choice: 'mine' | 'theirs' | { body: string }): void {
	const issue = issueMap.get(id);
	if (!issue || !mounted) return;
	setIssue(id, null);
	if (choice === 'theirs') return changed();
	const body = choice === 'mine' ? issue.mine.body : choice.body;
	if (issue.kind === 'deleted') {
		const file = gone.get(id);
		if (file) void createFile(file.rel, joinNote(file.raw, body), id);
		return;
	}
	saveLinkedNote(id, { title: issue.mine.title, bodyMarkdown: body });
}

// ---- New notes ---------------------------------------------------------

/** `{title}`, `{date}` (YYYY-MM-DD) and `{id}` (the title as a slug) filled in. */
export function renderNoteTemplate(template: string, title: string, date = today()): string {
	const id = title.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'note';
	return template.replace(/\{(title|date|id)\}/g, (_, name: string) => (name === 'title' ? title : name === 'date' ? date : id));
}

/** A name that every file system takes, without the extension. */
function fileName(name: string): string {
	const clean = name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').replace(/\s+/g, ' ').replace(/^[.\s-]+|[.\s]+$/g, '');
	return clean.slice(0, 120) || 'Untitled';
}

/**
 * The file a new note would get, and what it starts with: the vault's
 * directory for new notes (or `dir`), its filename pattern and template.
 * A name that is taken gets a number. Pure, but for reading which exist.
 */
export function newLinkedNoteFile(config: LinkedVaultConfig, taken: (rel: string) => boolean, title: string, body = '', dir?: string): { rel: string; content: string } {
	const folder = (dir ?? config.newNoteDir).replace(/^\/+|\/+$/g, '');
	const name = fileName(renderNoteTemplate(config.newNoteFilename || '{title}', title));
	const at = (n: number) => `${folder ? `${folder}/` : ''}${n > 1 ? `${name} ${n}` : name}.md`;
	let n = 1;
	while (taken(at(n))) n++;
	let head = renderNoteTemplate(config.newNoteTemplate, title);
	if (head && !head.endsWith('\n')) head += '\n';
	return { rel: at(n), content: head + body };
}

async function createFile(rel: string, content: string, id: string): Promise<void> {
	const open = mounted;
	if (!open) return;
	busy.add(id);
	try {
		const made = (await invoke('linked_create', { vault: open.config.id, rel, content })) as { hash: string; mtime: number };
		if (mounted !== open) return;
		applyLinkedChanges(open.config, open.data, [{ type: 'upsert', note: { rel, content, hash: made.hash, mtime: made.mtime, size: content.length } }]);
		changed();
	} catch (err) {
		if (mounted !== open) return;
		// Not there after all: take it out of the list again.
		applyLinkedChanges(open.config, open.data, [{ type: 'remove', rel }]);
		queued.delete(id);
		changed();
		showNotice(errorName(err) === 'InvalidModificationError' ? `A file called ${rel} already exists in the folder.` : `Couldn't create ${rel}: ${errorText(err)}`);
	} finally {
		busy.delete(id);
		// What was typed while the file was being made.
		if (queued.has(id) && mounted === open) void drain(id);
	}
}

/**
 * A new note in the open vault, if it is writable: shown at once, its file
 * created right after (and taken back with a notice if that fails).
 * `folderId` is a directory of the vault; without one the vault's setting
 * decides. Null when notes can't be created here.
 */
export function createLinkedNote(title?: string, body?: string, folderId?: string | null): MemoryObject | null {
	const open = mounted;
	if (!open || open.config.readOnly) return null;
	const dir = isLinkedFolderId(folderId) ? parseLinkedId(folderId!)?.rel : undefined;
	const name = (title ?? '').trim() || 'Untitled';
	const { rel, content } = newLinkedNoteFile(open.config, (r) => open.data.notes.has(linkedNoteId(open.config.id, r)), name, body ?? '', dir);
	const id = linkedNoteId(open.config.id, rel);
	applyLinkedChanges(open.config, open.data, [{ type: 'upsert', note: { rel, content, hash: '', mtime: Date.now(), size: content.length } }]);
	changed();
	void createFile(rel, content, id);
	return open.data.notes.get(id) ?? null;
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
