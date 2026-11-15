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
	/** Frontmatter field to stamp on save (not used while vaults are read-only). */
	updatedField: string | null;
	updatedFormat: 'date' | 'datetime';
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
