/**
 * Linked folder vaults (desktop app): a folder of Markdown notes that Kurumi
 * reads where it lies. The folder is the only copy: its notes are never in
 * the Automerge document, in IndexedDB or in a sync upload. See
 * `backend.ts` for the read model and desktop/src-tauri/src/linked.rs for
 * the commands behind it.
 */

export type VaultKind = 'kurumi' | 'linked';

/** One linked folder, remembered on this device only (`config.ts`). */
export interface LinkedVaultConfig {
	/** 'lv-' + 8 random characters. */
	id: string;
	name: string;
	icon?: string;
	/** As returned by the folder dialog (`folder_pick`). */
	path: string;
	/** What a [[link]] addresses a note by. */
	linkKey: 'frontmatter' | 'title' | 'filename';
	/** The frontmatter field holding the key, when `linkKey` is 'frontmatter'. */
	linkKeyField: string;
	/** Tried in order when the key misses. */
	linkFallback: ('title' | 'filename')[];
	/** Frontmatter field for the title; null or absent in a file = first H1, else the filename. */
	titleField: string | null;
	/** Frontmatter field shown as the note's summary. */
	summaryField: string | null;
	/** Frontmatter fields turned into tags: `type: project` becomes `type/project`. */
	tagFields: string[];
	/** gitignore-style patterns left out of the vault. */
	ignore: string[];
	respectGitignore: boolean;
	readOnly: boolean;
	/** Frontmatter field set to today (or now) when a note's text is saved. */
	updatedField: string | null;
	updatedFormat: 'date' | 'datetime';
	/** Where new notes go, relative to the folder ('' = its top). */
	newNoteDir: string;
	/** Filename of a new note, without `.md`: `{title}`, `{date}` and `{id}` are filled in. */
	newNoteFilename: string;
	/** What a new note starts with (its frontmatter), with the same placeholders. Empty = nothing. */
	newNoteTemplate: string;
	created: number;
}

/** What a vault can do; the UI hides or disables the rest. */
export interface VaultCapabilities {
	kind: VaultKind;
	editNotes: boolean;
	createNotes: boolean;
	/** To-dos, projects, decisions, questions, meetings, people, events: kept in Kurumi vaults. */
	records: boolean;
	sync: boolean;
	/** Digest, weekly review, living notes, workflows. */
	generated: boolean;
}

/** A note file as `linked_open` / `linked_read` return it. */
export interface NoteFile {
	/** Path below the folder, `/`-separated. */
	rel: string;
	/** Exactly as on disk: a BOM is a leading U+FEFF, CRLF is kept. */
	content: string;
	/** Lowercase hex SHA-256 of the file. */
	hash: string;
	/** Milliseconds. */
	mtime: number;
	size: number;
}

/** What `linked_open` returns. */
export interface OpenedFolder {
	cursor: number;
	notes: NoteFile[];
	dirs: string[];
	/** Files left out for being too large or unreadable. */
	skipped: number;
	/** How changes are noticed: file system events, or (network shares) looking again now and then. */
	watch?: 'events' | 'polling';
}

/** One change in the folder, as `linked_changes` reports it. A rename is a remove and an upsert. */
export type LinkedChange = { type: 'upsert'; note: NoteFile } | { type: 'remove'; rel: string };

/** What `linked_changes` returns. `rescan` means: open the vault again, this cursor is spent. */
export interface LinkedChanges {
	cursor: number;
	changes: LinkedChange[];
	rescan: boolean;
}

/** A save that is waiting for the user: nothing is written until it is resolved. */
export interface LinkedSaveIssue {
	/** 'conflict': the file changed where the edit did. 'deleted': the file is gone. 'error': the write failed. */
	kind: 'conflict' | 'deleted' | 'error';
	message: string;
	/** What Kurumi would write. */
	mine: { title?: string; body: string };
	/** The body in the file now (conflict). */
	theirs?: string;
}

/** What the backend keeps about a linked note besides its MemoryObject. */
export interface LinkedNoteInfo {
	relPath: string;
	/** Everything before the body, byte for byte (BOM, delimiters, newlines). */
	rawFrontmatter: string;
	/** Parsed for display and conventions only; never written back. */
	frontmatter: Record<string, string | string[]>;
	/** Hash of the file as last read. */
	baseHash: string;
	mtime: number;
	/** What [[links]] address this note by, if it has a key. */
	linkKeyValue: string | null;
}
