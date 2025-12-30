import * as Automerge from '@automerge/automerge';
import { get, set } from 'idb-keyval';
import { writable, derived, type Readable } from 'svelte/store';
import { createEmptyDocument, createNote, createFolder, type KurumiDocument, type Note, type Folder } from './types';

const STORAGE_KEY = 'kurumi-doc';

// The Automerge document
let doc: Automerge.Doc<KurumiDocument>;

// Svelte store for reactive updates
const docStore = writable<Automerge.Doc<KurumiDocument> | null>(null);

// Derived store for notes array (sorted by modified date)
export const notes: Readable<Note[]> = derived(docStore, ($doc) => {
	if (!$doc) return [];
	return Object.values($doc.notes).sort((a, b) => b.modified - a.modified);
});

// Derived store for notes count
export const notesCount: Readable<number> = derived(notes, ($notes) => $notes.length);

// Derived store for folders (sorted by name)
export const folders: Readable<Folder[]> = derived(docStore, ($doc) => {
	if (!$doc || !$doc.folders) return [];
	return Object.values($doc.folders).sort((a, b) => a.name.localeCompare(b.name));
});

// Initialize the database
export async function initDB(): Promise<void> {
	try {
		const savedData = await get<Uint8Array>(STORAGE_KEY);

		if (savedData) {
			doc = Automerge.load<KurumiDocument>(savedData);
			// Migrate: add folders object if missing
			if (!doc.folders) {
				doc = Automerge.change(doc, (d) => {
					d.folders = {};
				});
			}
			// Migrate: add folderId to existing notes if missing
			const needsMigration = Object.values(doc.notes).some((note) => note.folderId === undefined);
			if (needsMigration) {
				doc = Automerge.change(doc, (d) => {
					for (const note of Object.values(d.notes)) {
						if (note.folderId === undefined) {
							note.folderId = null;
						}
					}
				});
				await saveDoc();
			}
		} else {
			doc = Automerge.from<KurumiDocument>(createEmptyDocument());
			await saveDoc();
		}

		docStore.set(doc);
	} catch (error) {
		console.error('Failed to initialize database:', error);
		// Start fresh if there's a corruption
		doc = Automerge.from<KurumiDocument>(createEmptyDocument());
		docStore.set(doc);
		await saveDoc();
	}
}

// Save document to IndexedDB
async function saveDoc(): Promise<void> {
	const binary = Automerge.save(doc);
	await set(STORAGE_KEY, binary);
}

// Update document with a change function
function updateDoc(changeFn: (doc: KurumiDocument) => void): void {
	if (!doc) {
		console.error('Database not initialized');
		return;
	}
	doc = Automerge.change(doc, changeFn);
	docStore.set(doc);
	saveDoc(); // Fire and forget, we have local state
}

// CRUD Operations

export function addNote(title?: string, content?: string, folderId?: string | null): Note {
	if (!doc) {
		console.error('Cannot add note: database not initialized');
		// Initialize synchronously as fallback
		doc = Automerge.from<KurumiDocument>(createEmptyDocument());
		docStore.set(doc);
	}
	const note = createNote(title, content, folderId ?? null);
	updateDoc((d) => {
		d.notes[note.id] = note;
	});
	return note;
}

export function getNote(id: string): Note | undefined {
	return doc?.notes[id];
}

export function updateNote(id: string, updates: Partial<Omit<Note, 'id' | 'created'>>): void {
	updateDoc((d) => {
		const note = d.notes[id];
		if (note) {
			if (updates.title !== undefined) note.title = updates.title;
			if (updates.content !== undefined) note.content = updates.content;
			if (updates.tags !== undefined) {
				// Clear and repopulate tags array for Automerge
				while (note.tags.length > 0) note.tags.pop();
				updates.tags.forEach((tag) => note.tags.push(tag));
			}
			note.modified = Date.now();
		}
	});
}

export function deleteNote(id: string): void {
	updateDoc((d) => {
		delete d.notes[id];
	});
}

// Folder CRUD Operations

export function addFolder(name: string, parentId?: string | null): Folder {
	if (!doc) {
		console.error('Cannot add folder: database not initialized');
		doc = Automerge.from<KurumiDocument>(createEmptyDocument());
		docStore.set(doc);
	}
	const folder = createFolder(name, parentId ?? null);
	updateDoc((d) => {
		d.folders[folder.id] = folder;
	});
	return folder;
}

export function getFolder(id: string): Folder | undefined {
	return doc?.folders?.[id];
}

export function updateFolder(id: string, updates: Partial<Omit<Folder, 'id' | 'created'>>): void {
	updateDoc((d) => {
		const folder = d.folders[id];
		if (folder) {
			if (updates.name !== undefined) folder.name = updates.name;
			if (updates.parentId !== undefined) folder.parentId = updates.parentId;
			folder.modified = Date.now();
		}
	});
}

export function deleteFolder(id: string, deleteContents: boolean = false): void {
	updateDoc((d) => {
		if (deleteContents) {
			// Delete all notes in this folder
			for (const note of Object.values(d.notes)) {
				if (note.folderId === id) {
					delete d.notes[note.id];
				}
			}
			// Recursively delete subfolders
			for (const folder of Object.values(d.folders)) {
				if (folder.parentId === id) {
					// Move subfolder's notes to root before deleting
					for (const note of Object.values(d.notes)) {
						if (note.folderId === folder.id) {
							delete d.notes[note.id];
						}
					}
					delete d.folders[folder.id];
				}
			}
		} else {
			// Move notes to root level
			for (const note of Object.values(d.notes)) {
				if (note.folderId === id) {
					note.folderId = null;
				}
			}
			// Move subfolders to root level
			for (const folder of Object.values(d.folders)) {
				if (folder.parentId === id) {
					folder.parentId = null;
				}
			}
		}
		delete d.folders[id];
	});
}

export function moveNoteToFolder(noteId: string, folderId: string | null): void {
	updateDoc((d) => {
		const note = d.notes[noteId];
		if (note) {
			note.folderId = folderId;
			note.modified = Date.now();
		}
	});
}

export function moveFolderToFolder(folderId: string, parentId: string | null): void {
	// Prevent moving a folder into itself or its descendants
	if (folderId === parentId) return;
	if (parentId && isDescendantFolder(folderId, parentId)) return;

	updateDoc((d) => {
		const folder = d.folders[folderId];
		if (folder) {
			folder.parentId = parentId;
			folder.modified = Date.now();
		}
	});
}

function isDescendantFolder(ancestorId: string, descendantId: string): boolean {
	if (!doc?.folders) return false;
	let current = doc.folders[descendantId];
	while (current?.parentId) {
		if (current.parentId === ancestorId) return true;
		current = doc.folders[current.parentId];
	}
	return false;
}

export function getNotesInFolder(folderId: string | null): Note[] {
	if (!doc) return [];
	return Object.values(doc.notes)
		.filter((note) => note.folderId === folderId)
		.sort((a, b) => b.modified - a.modified);
}

export function getSubfolders(parentId: string | null): Folder[] {
	if (!doc?.folders) return [];
	return Object.values(doc.folders)
		.filter((folder) => folder.parentId === parentId)
		.sort((a, b) => a.name.localeCompare(b.name));
}

export function getFolderPath(folderId: string | null): Folder[] {
	if (!folderId || !doc?.folders) return [];
	const path: Folder[] = [];
	let current: Folder | undefined = doc.folders[folderId];
	while (current) {
		path.unshift(current);
		current = current.parentId ? doc.folders[current.parentId] : undefined;
	}
	return path;
}

// Get the raw Automerge document for sync
export function getDocBinary(): Uint8Array {
	return Automerge.save(doc);
}

// Merge with a remote document (for sync)
export async function mergeDoc(remoteBinary: Uint8Array): Promise<void> {
	const remoteDoc = Automerge.load<KurumiDocument>(remoteBinary);
	doc = Automerge.merge(doc, remoteDoc);
	docStore.set(doc);
	await saveDoc();
}

// Export all notes as JSON (for backup)
export function exportNotesJSON(): string {
	if (!doc) return '[]';
	return JSON.stringify(Object.values(doc.notes), null, 2);
}

// Extract wikilinks from content
export function extractWikilinks(content: string): string[] {
	const regex = /\[\[([^\]]+)\]\]/g;
	const links: string[] = [];
	let match;
	while ((match = regex.exec(content)) !== null) {
		links.push(match[1]);
	}
	return links;
}

// Extract hashtags from content
export function extractTags(content: string): string[] {
	// Match #tag but not inside code blocks or URLs
	const regex = /(?:^|\s)#([a-zA-Z][a-zA-Z0-9_-]*)/g;
	const tags = new Set<string>();
	let match;
	while ((match = regex.exec(content)) !== null) {
		tags.add(match[1].toLowerCase());
	}
	return Array.from(tags);
}

// Get all unique tags across all notes
export function getAllTags(): { tag: string; count: number }[] {
	if (!doc) return [];
	const tagCounts = new Map<string, number>();

	for (const note of Object.values(doc.notes)) {
		const tags = extractTags(note.content);
		for (const tag of tags) {
			tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
		}
	}

	return Array.from(tagCounts.entries())
		.map(([tag, count]) => ({ tag, count }))
		.sort((a, b) => b.count - a.count);
}

// Get notes with a specific tag
export function getNotesByTag(tag: string): Note[] {
	if (!doc) return [];
	const lowerTag = tag.toLowerCase();

	return Object.values(doc.notes).filter((note) => {
		const tags = extractTags(note.content);
		return tags.includes(lowerTag);
	});
}

// Find notes that link to a given note
export function findBacklinks(noteId: string): Note[] {
	if (!doc) return [];
	const targetNote = doc.notes[noteId];
	if (!targetNote) return [];

	const targetTitle = targetNote.title.toLowerCase();

	return Object.values(doc.notes).filter((note) => {
		if (note.id === noteId) return false;
		const links = extractWikilinks(note.content);
		return links.some((link) => link.toLowerCase() === targetTitle);
	});
}
