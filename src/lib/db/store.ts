import * as Automerge from '@automerge/automerge';
import { get, set } from 'idb-keyval';
import { writable, derived, type Readable } from 'svelte/store';
import {
	createEmptyDocument,
	createNote,
	createFolder,
	createVault,
	createDefaultVault,
	DEFAULT_VAULT_ID,
	type KurumiDocument,
	type Note,
	type Folder,
	type Vault
} from './types';

const STORAGE_KEY = 'kurumi-doc';

// The Automerge document
let doc: Automerge.Doc<KurumiDocument>;

// Internal store for current vault ID (for derived stores to use)
const currentVaultIdStore = writable<string>(DEFAULT_VAULT_ID);

// Svelte store for reactive updates
const docStore = writable<Automerge.Doc<KurumiDocument> | null>(null);

// Derived store for all vaults
export const vaults: Readable<Vault[]> = derived(docStore, ($doc) => {
	if (!$doc || !$doc.vaults) return [];
	return Object.values($doc.vaults).sort((a, b) => a.created - b.created);
});

// Export current vault ID as readable store
export const currentVaultId: Readable<string> = derived(
	[docStore, currentVaultIdStore],
	([$doc, $vaultId]) => {
		return $doc?.currentVaultId || $vaultId || DEFAULT_VAULT_ID;
	}
);

// Current vault object
export const currentVault: Readable<Vault | undefined> = derived(
	[docStore, currentVaultId],
	([$doc, $vaultId]) => {
		if (!$doc?.vaults) return undefined;
		return $doc.vaults[$vaultId];
	}
);

// Derived store for notes array (sorted by modified date) - filtered by current vault
export const notes: Readable<Note[]> = derived(
	[docStore, currentVaultId],
	([$doc, $vaultId]) => {
		if (!$doc) return [];
		return Object.values($doc.notes)
			.filter((note) => note.vaultId === $vaultId)
			.sort((a, b) => b.modified - a.modified);
	}
);

// Derived store for notes count
export const notesCount: Readable<number> = derived(notes, ($notes) => $notes.length);

// Derived store for folders (sorted by name) - filtered by current vault
export const folders: Readable<Folder[]> = derived(
	[docStore, currentVaultId],
	([$doc, $vaultId]) => {
		if (!$doc || !$doc.folders) return [];
		return Object.values($doc.folders)
			.filter((folder) => folder.vaultId === $vaultId)
			.sort((a, b) => a.name.localeCompare(b.name));
	}
);

// All notes across all vaults (for cross-vault operations)
export const allNotes: Readable<Note[]> = derived(docStore, ($doc) => {
	if (!$doc) return [];
	return Object.values($doc.notes).sort((a, b) => b.modified - a.modified);
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
			const needsFolderIdMigration = Object.values(doc.notes).some(
				(note) => note.folderId === undefined
			);
			if (needsFolderIdMigration) {
				doc = Automerge.change(doc, (d) => {
					for (const note of Object.values(d.notes)) {
						if (note.folderId === undefined) {
							note.folderId = null;
						}
					}
				});
			}

			// Migrate: add vaults if missing (version 1 -> version 2)
			if (!doc.vaults) {
				doc = Automerge.change(doc, (d) => {
					// Create vaults collection with default vault
					d.vaults = {};
					const defaultVault = createDefaultVault();
					d.vaults[DEFAULT_VAULT_ID] = defaultVault;

					// Set current vault
					d.currentVaultId = DEFAULT_VAULT_ID;

					// Migrate all existing notes to default vault
					for (const note of Object.values(d.notes)) {
						if (note.vaultId === undefined) {
							(note as Note).vaultId = DEFAULT_VAULT_ID;
						}
					}

					// Migrate all existing folders to default vault
					for (const folder of Object.values(d.folders)) {
						if (folder.vaultId === undefined) {
							(folder as Folder).vaultId = DEFAULT_VAULT_ID;
						}
					}

					// Update version
					d.version = 2;
				});
				await saveDoc();
			}

			// Update internal vault ID store
			currentVaultIdStore.set(doc.currentVaultId || DEFAULT_VAULT_ID);
		} else {
			doc = Automerge.from<KurumiDocument>(createEmptyDocument());
			currentVaultIdStore.set(DEFAULT_VAULT_ID);
			await saveDoc();
		}

		docStore.set(doc);
	} catch (error) {
		console.error('Failed to initialize database:', error);
		// Start fresh if there's a corruption
		doc = Automerge.from<KurumiDocument>(createEmptyDocument());
		currentVaultIdStore.set(DEFAULT_VAULT_ID);
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

// Get current vault ID synchronously
function getCurrentVaultId(): string {
	return doc?.currentVaultId || DEFAULT_VAULT_ID;
}

// ============ Vault Operations ============

export function setCurrentVault(vaultId: string): void {
	if (!doc?.vaults?.[vaultId]) {
		console.error('Vault not found:', vaultId);
		return;
	}
	updateDoc((d) => {
		d.currentVaultId = vaultId;
	});
	currentVaultIdStore.set(vaultId);
}

export function addVault(name: string, icon?: string): Vault {
	if (!doc) {
		doc = Automerge.from<KurumiDocument>(createEmptyDocument());
		docStore.set(doc);
	}
	const vault = createVault(name, icon);
	updateDoc((d) => {
		d.vaults[vault.id] = vault;
	});
	return vault;
}

export function getVault(id: string): Vault | undefined {
	return doc?.vaults?.[id];
}

export function updateVault(id: string, updates: Partial<Omit<Vault, 'id' | 'created'>>): void {
	updateDoc((d) => {
		const vault = d.vaults[id];
		if (vault) {
			if (updates.name !== undefined) vault.name = updates.name;
			if (updates.icon !== undefined) vault.icon = updates.icon;
			vault.modified = Date.now();
		}
	});
}

export function deleteVault(id: string): { success: boolean; error?: string } {
	if (!doc?.vaults) return { success: false, error: 'Database not initialized' };

	const vaultList = Object.values(doc.vaults);
	if (vaultList.length <= 1) {
		return { success: false, error: 'Cannot delete the last vault' };
	}

	const notesInVault = Object.values(doc.notes).filter((n) => n.vaultId === id);
	const foldersInVault = Object.values(doc.folders).filter((f) => f.vaultId === id);

	if (notesInVault.length > 0 || foldersInVault.length > 0) {
		return { success: false, error: 'Vault contains notes or folders. Move or delete them first.' };
	}

	const wasCurrentVault = doc.currentVaultId === id;

	updateDoc((d) => {
		delete d.vaults[id];
		// Switch to another vault if deleting current
		if (wasCurrentVault) {
			d.currentVaultId = Object.keys(d.vaults)[0];
		}
	});

	if (wasCurrentVault) {
		currentVaultIdStore.set(doc.currentVaultId);
	}

	return { success: true };
}

// Move note to a different vault
export function moveNoteToVault(noteId: string, targetVaultId: string): void {
	if (!doc?.vaults?.[targetVaultId]) {
		console.error('Target vault not found:', targetVaultId);
		return;
	}
	updateDoc((d) => {
		const note = d.notes[noteId];
		if (note) {
			note.vaultId = targetVaultId;
			note.folderId = null; // Reset folder since folders don't cross vaults
			note.modified = Date.now();
		}
	});
}

// Move folder to a different vault (including all nested content)
export function moveFolderToVault(folderId: string, targetVaultId: string): void {
	if (!doc?.vaults?.[targetVaultId]) {
		console.error('Target vault not found:', targetVaultId);
		return;
	}

	updateDoc((d) => {
		const folder = d.folders[folderId];
		if (!folder) return;

		// Collect all subfolder IDs recursively
		const folderIds = new Set<string>([folderId]);
		function collectSubfolders(parentId: string) {
			for (const f of Object.values(d.folders)) {
				if (f.parentId === parentId && !folderIds.has(f.id)) {
					folderIds.add(f.id);
					collectSubfolders(f.id);
				}
			}
		}
		collectSubfolders(folderId);

		// Move all collected folders
		for (const id of folderIds) {
			const f = d.folders[id];
			if (f) {
				f.vaultId = targetVaultId;
				f.modified = Date.now();
			}
		}

		// Move root folder to root level in new vault
		folder.parentId = null;

		// Move all notes in these folders
		for (const note of Object.values(d.notes)) {
			if (note.folderId && folderIds.has(note.folderId)) {
				note.vaultId = targetVaultId;
				note.modified = Date.now();
			}
		}
	});
}

// ============ Note CRUD Operations ============

export function addNote(title?: string, content?: string, folderId?: string | null): Note {
	if (!doc) {
		console.error('Cannot add note: database not initialized');
		doc = Automerge.from<KurumiDocument>(createEmptyDocument());
		docStore.set(doc);
	}
	const vaultId = getCurrentVaultId();
	const note = createNote(title, content, folderId ?? null, vaultId);
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

// ============ Folder CRUD Operations ============

export function addFolder(name: string, parentId?: string | null): Folder {
	if (!doc) {
		console.error('Cannot add folder: database not initialized');
		doc = Automerge.from<KurumiDocument>(createEmptyDocument());
		docStore.set(doc);
	}
	const vaultId = getCurrentVaultId();
	const folder = createFolder(name, parentId ?? null, vaultId);
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
	const vaultId = getCurrentVaultId();
	return Object.values(doc.notes)
		.filter((note) => note.folderId === folderId && note.vaultId === vaultId)
		.sort((a, b) => b.modified - a.modified);
}

export function getSubfolders(parentId: string | null): Folder[] {
	if (!doc?.folders) return [];
	const vaultId = getCurrentVaultId();
	return Object.values(doc.folders)
		.filter((folder) => folder.parentId === parentId && folder.vaultId === vaultId)
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

// ============ Sync Operations ============

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

// Export all notes as JSON (for backup) - legacy format
export function exportNotesJSON(): string {
	if (!doc) return '[]';
	return JSON.stringify(Object.values(doc.notes), null, 2);
}

// Full export including vaults, folders, and notes
export interface KurumiExport {
	version: number;
	exportedAt: string;
	vaults: Vault[];
	folders: Folder[];
	notes: Note[];
}

export function exportFullJSON(): string {
	if (!doc) return JSON.stringify({ version: 2, exportedAt: new Date().toISOString(), vaults: [], folders: [], notes: [] });
	const exportData: KurumiExport = {
		version: doc.version || 2,
		exportedAt: new Date().toISOString(),
		vaults: Object.values(doc.vaults || {}),
		folders: Object.values(doc.folders || {}),
		notes: Object.values(doc.notes || {})
	};
	return JSON.stringify(exportData, null, 2);
}

// Import types
export interface VaultConflict {
	importedVault: Vault;
	existingVault: Vault;
}

export interface ImportAnalysis {
	hasConflicts: boolean;
	vaultConflicts: VaultConflict[];
	newVaults: Vault[];
	totalFolders: number;
	totalNotes: number;
}

export function analyzeImport(jsonString: string): ImportAnalysis | { error: string } {
	if (!doc) return { error: 'Database not initialized' };

	try {
		const data = JSON.parse(jsonString);

		// Handle both old format (array of notes) and new format (full export)
		let vaults: Vault[] = [];
		let folders: Folder[] = [];
		let notes: Note[] = [];

		if (Array.isArray(data)) {
			// Old format: array of notes, put them in current vault
			notes = data;
		} else if (data.vaults && data.notes) {
			// New format
			vaults = data.vaults || [];
			folders = data.folders || [];
			notes = data.notes || [];
		} else {
			return { error: 'Invalid import format' };
		}

		// Check for vault conflicts
		const vaultConflicts: VaultConflict[] = [];
		const newVaults: Vault[] = [];

		for (const importedVault of vaults) {
			const existingVault = doc.vaults?.[importedVault.id];
			if (existingVault) {
				vaultConflicts.push({ importedVault, existingVault });
			} else {
				newVaults.push(importedVault);
			}
		}

		return {
			hasConflicts: vaultConflicts.length > 0,
			vaultConflicts,
			newVaults,
			totalFolders: folders.length,
			totalNotes: notes.length
		};
	} catch {
		return { error: 'Invalid JSON format' };
	}
}

export type ConflictResolution = 'overwrite' | 'duplicate' | 'skip';

export interface ImportOptions {
	conflictResolution: ConflictResolution;
}

export async function importJSON(jsonString: string, options: ImportOptions): Promise<{ success: boolean; error?: string; imported?: { vaults: number; folders: number; notes: number } }> {
	if (!doc) return { success: false, error: 'Database not initialized' };

	try {
		const data = JSON.parse(jsonString);

		// Handle both old format (array of notes) and new format (full export)
		let vaults: Vault[] = [];
		let folders: Folder[] = [];
		let notes: Note[] = [];

		if (Array.isArray(data)) {
			// Old format: array of notes, put them in current vault
			notes = data.map(n => ({ ...n, vaultId: n.vaultId || doc!.currentVaultId }));
		} else if (data.vaults && data.notes) {
			// New format
			vaults = data.vaults || [];
			folders = data.folders || [];
			notes = data.notes || [];
		} else {
			return { success: false, error: 'Invalid import format' };
		}

		// Track ID mappings for duplicated vaults
		const vaultIdMap = new Map<string, string>();
		let importedVaults = 0;
		let importedFolders = 0;
		let importedNotes = 0;

		doc = Automerge.change(doc, (d) => {
			// Import vaults
			for (const vault of vaults) {
				const existingVault = d.vaults?.[vault.id];

				if (existingVault) {
					if (options.conflictResolution === 'overwrite') {
						d.vaults[vault.id] = vault;
						importedVaults++;
					} else if (options.conflictResolution === 'duplicate') {
						const newId = generateId();
						vaultIdMap.set(vault.id, newId);
						d.vaults[newId] = { ...vault, id: newId, name: `${vault.name} (imported)` };
						importedVaults++;
					}
					// 'skip' does nothing
				} else {
					d.vaults[vault.id] = vault;
					importedVaults++;
				}
			}

			// Import folders (with remapped vault IDs if duplicated)
			for (const folder of folders) {
				const targetVaultId = vaultIdMap.get(folder.vaultId) || folder.vaultId;

				// Check if folder already exists
				if (d.folders[folder.id]) {
					if (options.conflictResolution === 'overwrite') {
						d.folders[folder.id] = { ...folder, vaultId: targetVaultId };
						importedFolders++;
					} else if (options.conflictResolution === 'duplicate') {
						const newId = generateId();
						d.folders[newId] = { ...folder, id: newId, vaultId: targetVaultId };
						importedFolders++;
					}
				} else {
					d.folders[folder.id] = { ...folder, vaultId: targetVaultId };
					importedFolders++;
				}
			}

			// Import notes (with remapped vault IDs if duplicated)
			for (const note of notes) {
				const targetVaultId = vaultIdMap.get(note.vaultId) || note.vaultId || d.currentVaultId;

				// Check if note already exists
				if (d.notes[note.id]) {
					if (options.conflictResolution === 'overwrite') {
						d.notes[note.id] = { ...note, vaultId: targetVaultId };
						importedNotes++;
					} else if (options.conflictResolution === 'duplicate') {
						const newId = generateId();
						d.notes[newId] = { ...note, id: newId, vaultId: targetVaultId };
						importedNotes++;
					}
				} else {
					d.notes[note.id] = { ...note, vaultId: targetVaultId };
					importedNotes++;
				}
			}
		});

		docStore.set(doc);
		await saveDoc();

		return {
			success: true,
			imported: {
				vaults: importedVaults,
				folders: importedFolders,
				notes: importedNotes
			}
		};
	} catch (e) {
		return { success: false, error: `Import failed: ${e instanceof Error ? e.message : 'Unknown error'}` };
	}
}

// ============ Content Extraction ============

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

// Get all unique tags across notes in current vault
export function getAllTags(): { tag: string; count: number }[] {
	if (!doc) return [];
	const vaultId = getCurrentVaultId();
	const tagCounts = new Map<string, number>();

	for (const note of Object.values(doc.notes)) {
		if (note.vaultId !== vaultId) continue;
		const tags = extractTags(note.content);
		for (const tag of tags) {
			tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
		}
	}

	return Array.from(tagCounts.entries())
		.map(([tag, count]) => ({ tag, count }))
		.sort((a, b) => b.count - a.count);
}

// Get notes with a specific tag in current vault
export function getNotesByTag(tag: string): Note[] {
	if (!doc) return [];
	const vaultId = getCurrentVaultId();
	const lowerTag = tag.toLowerCase();

	return Object.values(doc.notes).filter((note) => {
		if (note.vaultId !== vaultId) return false;
		const tags = extractTags(note.content);
		return tags.includes(lowerTag);
	});
}

// Extract people mentions from content (@Full Name)
export function extractPeople(content: string): string[] {
	const regex = /@([A-Z][a-zA-Z]+(?: [A-Z][a-zA-Z]+)*)/g;
	const people = new Set<string>();
	let match;
	while ((match = regex.exec(content)) !== null) {
		people.add(match[1]);
	}
	return Array.from(people);
}

// Get all unique people across notes in current vault
export function getAllPeople(): { name: string; count: number }[] {
	if (!doc) return [];
	const vaultId = getCurrentVaultId();
	const peopleCounts = new Map<string, number>();

	for (const note of Object.values(doc.notes)) {
		if (note.vaultId !== vaultId) continue;
		const people = extractPeople(note.content);
		for (const person of people) {
			peopleCounts.set(person, (peopleCounts.get(person) || 0) + 1);
		}
	}

	return Array.from(peopleCounts.entries())
		.map(([name, count]) => ({ name, count }))
		.sort((a, b) => b.count - a.count);
}

// Get notes mentioning a specific person in current vault
export function getNotesByPerson(name: string): Note[] {
	if (!doc) return [];
	const vaultId = getCurrentVaultId();

	return Object.values(doc.notes).filter((note) => {
		if (note.vaultId !== vaultId) return false;
		const people = extractPeople(note.content);
		return people.some((p) => p.toLowerCase() === name.toLowerCase());
	});
}

// Extract dates from content (//YYYY-MM-DD)
export function extractDates(content: string): string[] {
	const regex = /\/\/(\d{4}-\d{2}-\d{2})/g;
	const dates = new Set<string>();
	let match;
	while ((match = regex.exec(content)) !== null) {
		dates.add(match[1]);
	}
	return Array.from(dates);
}

// Get all unique dates across notes in current vault
export function getAllDates(): { date: string; count: number }[] {
	if (!doc) return [];
	const vaultId = getCurrentVaultId();
	const dateCounts = new Map<string, number>();

	for (const note of Object.values(doc.notes)) {
		if (note.vaultId !== vaultId) continue;
		const dates = extractDates(note.content);
		for (const date of dates) {
			dateCounts.set(date, (dateCounts.get(date) || 0) + 1);
		}
	}

	return Array.from(dateCounts.entries())
		.map(([date, count]) => ({ date, count }))
		.sort((a, b) => b.date.localeCompare(a.date)); // Sort by date descending
}

// Get notes with a specific date in current vault
export function getNotesByDate(date: string): Note[] {
	if (!doc) return [];
	const vaultId = getCurrentVaultId();

	return Object.values(doc.notes).filter((note) => {
		if (note.vaultId !== vaultId) return false;
		const dates = extractDates(note.content);
		return dates.includes(date);
	});
}

// Find notes that link to a given note (in current vault)
export function findBacklinks(noteId: string): Note[] {
	if (!doc) return [];
	const targetNote = doc.notes[noteId];
	if (!targetNote) return [];

	const vaultId = targetNote.vaultId;
	const targetTitle = targetNote.title.toLowerCase();

	return Object.values(doc.notes).filter((note) => {
		if (note.id === noteId) return false;
		if (note.vaultId !== vaultId) return false;
		const links = extractWikilinks(note.content);
		return links.some((link) => link.toLowerCase() === targetTitle);
	});
}

// Find a note by its title in current vault (case-insensitive)
export function findNoteByTitle(title: string): Note | undefined {
	if (!doc) return undefined;
	const vaultId = getCurrentVaultId();
	const lowerTitle = title.toLowerCase();
	return Object.values(doc.notes).find(
		(note) => note.vaultId === vaultId && note.title.toLowerCase() === lowerTitle
	);
}
