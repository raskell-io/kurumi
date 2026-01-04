import * as Automerge from '@automerge/automerge';
import { get, set } from 'idb-keyval';
import { writable, derived, type Readable } from 'svelte/store';
import {
	createEmptyDocument,
	createNote,
	createFolder,
	createVault,
	createDefaultVault,
	createPerson,
	createEvent,
	createTemplate,
	generateId,
	DEFAULT_VAULT_ID,
	type KurumiDocument,
	type Note,
	type Folder,
	type Vault,
	type Person,
	type Event,
	type Template
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

// Derived store for people (sorted by name) - filtered by current vault
export const people: Readable<Person[]> = derived(
	[docStore, currentVaultId],
	([$doc, $vaultId]) => {
		if (!$doc || !$doc.people) return [];
		return Object.values($doc.people)
			.filter((person) => person.vaultId === $vaultId)
			.sort((a, b) => a.name.localeCompare(b.name));
	}
);

// Derived store for events (sorted by date) - filtered by current vault
export const events: Readable<Event[]> = derived(
	[docStore, currentVaultId],
	([$doc, $vaultId]) => {
		if (!$doc || !$doc.events) return [];
		return Object.values($doc.events)
			.filter((event) => event.vaultId === $vaultId)
			.sort((a, b) => a.date.localeCompare(b.date));
	}
);

// Derived store for templates (sorted by name) - filtered by current vault
export const templates: Readable<Template[]> = derived(
	[docStore, currentVaultId],
	([$doc, $vaultId]) => {
		if (!$doc || !$doc.templates) return [];
		return Object.values($doc.templates)
			.filter((template) => template.vaultId === $vaultId)
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

			// Migrate: add people and events collections (version 2 -> version 3)
			if (!doc.people || !doc.events) {
				doc = Automerge.change(doc, (d) => {
					if (!d.people) d.people = {};
					if (!d.events) d.events = {};
					d.version = 3;
				});
				await saveDoc();
			}

			// Migrate: add templates collection with starter templates (version 3 -> version 4)
			if (!doc.templates) {
				const now = Date.now();
				const vaultId = doc.currentVaultId || DEFAULT_VAULT_ID;
				doc = Automerge.change(doc, (d) => {
					d.templates = {};

					// Add default starter templates
					const meetingNotesId = generateId();
					d.templates[meetingNotesId] = {
						id: meetingNotesId,
						name: 'Meeting Notes',
						description: 'Template for meeting notes with agenda and action items',
						content: `# Meeting: {title}

**Date:** {date}
**Attendees:**

## Agenda
-

## Notes

## Action Items
- [ ] `,
						vaultId,
						created: now,
						modified: now
					};

					const dailyJournalId = generateId();
					d.templates[dailyJournalId] = {
						id: dailyJournalId,
						name: 'Daily Journal',
						description: 'Daily reflection and planning template',
						content: `# {weekday}, {date}

## How I'm feeling

## Today's priorities
- [ ]

## Notes

## Gratitude
`,
						vaultId,
						created: now,
						modified: now
					};

					const projectBriefId = generateId();
					d.templates[projectBriefId] = {
						id: projectBriefId,
						name: 'Project Brief',
						description: 'Template for project planning and documentation',
						content: `# {title}

## Overview

## Goals

## Timeline

## Resources

## Notes
`,
						vaultId,
						created: now,
						modified: now
					};

					d.version = 4;
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

// ============ People CRUD Operations ============

export function addPerson(
	name: string,
	fields?: Partial<Omit<Person, 'id' | 'name' | 'vaultId' | 'created' | 'modified'>>
): Person {
	if (!doc) {
		console.error('Cannot add person: database not initialized');
		doc = Automerge.from<KurumiDocument>(createEmptyDocument());
		docStore.set(doc);
	}
	const vaultId = getCurrentVaultId();
	const person = createPerson(name, vaultId, fields);
	updateDoc((d) => {
		if (!d.people) d.people = {};
		d.people[person.id] = person;
	});
	return person;
}

export function getPerson(id: string): Person | undefined {
	return doc?.people?.[id];
}

export function getPersonByName(name: string): Person | undefined {
	if (!doc?.people) return undefined;
	const vaultId = getCurrentVaultId();
	return Object.values(doc.people).find((p) => p.name === name && p.vaultId === vaultId);
}

export function updatePerson(
	id: string,
	updates: Partial<Omit<Person, 'id' | 'created' | 'vaultId'>>
): void {
	updateDoc((d) => {
		const person = d.people?.[id];
		if (person) {
			if (updates.name !== undefined) person.name = updates.name;
			if (updates.email !== undefined) person.email = updates.email;
			if (updates.phone !== undefined) person.phone = updates.phone;
			if (updates.company !== undefined) person.company = updates.company;
			if (updates.title !== undefined) person.title = updates.title;
			if (updates.customFields !== undefined) person.customFields = updates.customFields;
			person.modified = Date.now();
		}
	});
}

export function deletePerson(id: string): void {
	updateDoc((d) => {
		if (d.people) {
			delete d.people[id];
		}
	});
}

// ============ Events CRUD Operations ============

export function addEvent(
	date: string,
	fields?: Partial<Omit<Event, 'id' | 'date' | 'vaultId' | 'created' | 'modified'>>
): Event {
	if (!doc) {
		console.error('Cannot add event: database not initialized');
		doc = Automerge.from<KurumiDocument>(createEmptyDocument());
		docStore.set(doc);
	}
	const vaultId = getCurrentVaultId();
	const event = createEvent(date, vaultId, fields);
	updateDoc((d) => {
		if (!d.events) d.events = {};
		d.events[event.id] = event;
	});
	return event;
}

export function getEvent(id: string): Event | undefined {
	return doc?.events?.[id];
}

export function getEventByDate(date: string): Event | undefined {
	if (!doc?.events) return undefined;
	const vaultId = getCurrentVaultId();
	return Object.values(doc.events).find((e) => e.date === date && e.vaultId === vaultId);
}

export function getEventsByDate(date: string): Event[] {
	if (!doc?.events) return [];
	const vaultId = getCurrentVaultId();
	return Object.values(doc.events).filter((e) => e.date === date && e.vaultId === vaultId);
}

export function updateEvent(
	id: string,
	updates: Partial<Omit<Event, 'id' | 'created' | 'vaultId'>>
): void {
	updateDoc((d) => {
		const event = d.events?.[id];
		if (event) {
			if (updates.date !== undefined) event.date = updates.date;
			if (updates.title !== undefined) event.title = updates.title;
			if (updates.time !== undefined) event.time = updates.time;
			if (updates.duration !== undefined) event.duration = updates.duration;
			if (updates.location !== undefined) event.location = updates.location;
			if (updates.attendees !== undefined) event.attendees = updates.attendees;
			if (updates.customFields !== undefined) event.customFields = updates.customFields;
			event.modified = Date.now();
		}
	});
}

export function deleteEvent(id: string): void {
	updateDoc((d) => {
		if (d.events) {
			delete d.events[id];
		}
	});
}

// ============ Template CRUD Operations ============

export function addTemplate(name: string, content: string, description?: string): Template {
	if (!doc) {
		console.error('Cannot add template: database not initialized');
		doc = Automerge.from<KurumiDocument>(createEmptyDocument());
		docStore.set(doc);
	}
	const vaultId = getCurrentVaultId();
	const template = createTemplate(name, content, vaultId, description);
	updateDoc((d) => {
		if (!d.templates) d.templates = {};
		d.templates[template.id] = template;
	});
	return template;
}

export function getTemplate(id: string): Template | undefined {
	return doc?.templates?.[id];
}

export function getTemplateByName(name: string): Template | undefined {
	if (!doc?.templates) return undefined;
	const vaultId = getCurrentVaultId();
	return Object.values(doc.templates).find((t) => t.name === name && t.vaultId === vaultId);
}

export function updateTemplate(
	id: string,
	updates: Partial<Omit<Template, 'id' | 'created' | 'vaultId'>>
): void {
	updateDoc((d) => {
		const template = d.templates?.[id];
		if (template) {
			if (updates.name !== undefined) template.name = updates.name;
			if (updates.content !== undefined) template.content = updates.content;
			if (updates.description !== undefined) template.description = updates.description;
			template.modified = Date.now();
		}
	});
}

export function deleteTemplate(id: string): void {
	updateDoc((d) => {
		if (d.templates) {
			delete d.templates[id];
		}
	});
}

// Get current vault name (for template variables)
export function getCurrentVaultName(): string {
	if (!doc?.vaults) return 'Default';
	const vaultId = getCurrentVaultId();
	return doc.vaults[vaultId]?.name || 'Default';
}

// Apply template variables to content
export function applyTemplateVariables(
	content: string,
	overrides?: Record<string, string>
): string {
	const now = new Date();
	const variables: Record<string, string> = {
		date: now.toISOString().split('T')[0],
		datetime: now.toISOString(),
		time: now.toTimeString().slice(0, 5),
		year: now.getFullYear().toString(),
		month: now.toLocaleDateString('en-US', { month: 'long' }),
		weekday: now.toLocaleDateString('en-US', { weekday: 'long' }),
		vault: getCurrentVaultName(),
		...overrides
	};

	return content.replace(/\{(\w+)\}/g, (match, key) => variables[key] ?? match);
}

// Check if template content contains a specific variable
export function templateHasVariable(content: string, variable: string): boolean {
	return content.includes(`{${variable}}`);
}

// ============ Sync Operations ============

// Get the raw Automerge document for sync
export function getDocBinary(): Uint8Array {
	return Automerge.save(doc);
}

// Check if local document is essentially empty (no user content)
function isDocEmpty(d: Automerge.Doc<KurumiDocument>): boolean {
	const noteCount = Object.keys(d.notes || {}).length;
	const folderCount = Object.keys(d.folders || {}).length;
	return noteCount === 0 && folderCount === 0;
}

// Deep copy an object to break Automerge references
function deepCopy<T>(obj: T): T {
	return JSON.parse(JSON.stringify(obj));
}

// Helper to pick the most recent version of an item
function pickNewest<T extends { modified: number }>(local: T | undefined, remote: T | undefined): T | undefined {
	if (!local) return remote;
	if (!remote) return local;
	return local.modified >= remote.modified ? local : remote;
}

// Manually merge all data from both documents, preferring newest versions
function manualMerge(
	baseDoc: Automerge.Doc<KurumiDocument>,
	localDoc: Automerge.Doc<KurumiDocument>,
	remoteDoc: Automerge.Doc<KurumiDocument>
): Automerge.Doc<KurumiDocument> {
	// Extract plain objects from Automerge docs to avoid reference issues
	const localData = deepCopy({
		vaults: localDoc.vaults || {},
		folders: localDoc.folders || {},
		notes: localDoc.notes || {},
		people: localDoc.people || {},
		events: localDoc.events || {}
	});
	const remoteData = deepCopy({
		vaults: remoteDoc.vaults || {},
		folders: remoteDoc.folders || {},
		notes: remoteDoc.notes || {},
		people: remoteDoc.people || {},
		events: remoteDoc.events || {}
	});

	return Automerge.change(baseDoc, (d) => {
		// Merge vaults
		const allVaultIds = new Set([
			...Object.keys(localData.vaults),
			...Object.keys(remoteData.vaults)
		]);
		for (const id of allVaultIds) {
			const newest = pickNewest(localData.vaults[id], remoteData.vaults[id]);
			if (newest && !d.vaults[id]) {
				d.vaults[id] = newest;
			}
		}

		// Merge folders
		const allFolderIds = new Set([
			...Object.keys(localData.folders),
			...Object.keys(remoteData.folders)
		]);
		for (const id of allFolderIds) {
			const newest = pickNewest(localData.folders[id], remoteData.folders[id]);
			if (newest) {
				d.folders[id] = newest;
			}
		}

		// Merge notes - always keep all, use newest content for conflicts
		const allNoteIds = new Set([
			...Object.keys(localData.notes),
			...Object.keys(remoteData.notes)
		]);
		for (const id of allNoteIds) {
			const newest = pickNewest(localData.notes[id], remoteData.notes[id]);
			if (newest) {
				d.notes[id] = newest;
			}
		}

		// Merge people
		const allPeopleIds = new Set([
			...Object.keys(localData.people),
			...Object.keys(remoteData.people)
		]);
		for (const id of allPeopleIds) {
			const newest = pickNewest(localData.people[id], remoteData.people[id]);
			if (newest && !d.people[id]) {
				d.people[id] = newest;
			}
		}

		// Merge events
		const allEventIds = new Set([
			...Object.keys(localData.events),
			...Object.keys(remoteData.events)
		]);
		for (const id of allEventIds) {
			const newest = pickNewest(localData.events[id], remoteData.events[id]);
			if (newest && !d.events[id]) {
				d.events[id] = newest;
			}
		}
	});
}

// Merge with a remote document (for sync)
// Strategy: Always combine all data, use CRDT merge when possible, fall back to manual merge
export async function mergeDoc(remoteBinary: Uint8Array): Promise<void> {
	// Validate binary data
	if (!remoteBinary || remoteBinary.length === 0) {
		console.warn('Received empty remote document, skipping merge');
		return;
	}

	if (remoteBinary.length < 8) {
		console.warn('Remote document too small to be valid, skipping merge');
		return;
	}

	let remoteDoc: Automerge.Doc<KurumiDocument>;

	try {
		remoteDoc = Automerge.load<KurumiDocument>(remoteBinary);
	} catch (loadError) {
		console.error('Failed to load remote document:', loadError);
		console.warn('Remote document corrupted - local data preserved, will push on next sync');
		return;
	}

	if (!remoteDoc || typeof remoteDoc !== 'object') {
		console.warn('Remote document has invalid structure, skipping merge');
		return;
	}

	// If local is empty but remote has content, adopt remote
	if (isDocEmpty(doc) && !isDocEmpty(remoteDoc)) {
		console.log('Local empty, adopting remote document');
		doc = Automerge.clone(remoteDoc);
		currentVaultIdStore.set(doc.currentVaultId || DEFAULT_VAULT_ID);
		docStore.set(doc);
		await saveDoc();
		return;
	}

	// If remote is empty but local has content, keep local (will push)
	if (!isDocEmpty(doc) && isDocEmpty(remoteDoc)) {
		console.log('Remote empty, keeping local document');
		return;
	}

	// Try standard Automerge CRDT merge first
	let mergedDoc: Automerge.Doc<KurumiDocument> | null = null;
	try {
		mergedDoc = Automerge.merge(doc, remoteDoc);
	} catch (mergeError) {
		console.warn('Automerge CRDT merge failed, falling back to manual merge:', mergeError);
	}

	// If CRDT merge worked, check for data loss and recover if needed
	if (mergedDoc) {
		const localNoteCount = Object.keys(doc.notes || {}).length;
		const remoteNoteCount = Object.keys(remoteDoc.notes || {}).length;
		const mergedNoteCount = Object.keys(mergedDoc.notes || {}).length;
		const expectedMinNotes = Math.max(localNoteCount, remoteNoteCount);

		// If merge lost notes, do manual recovery
		if (mergedNoteCount < expectedMinNotes) {
			console.log(`CRDT merge lost data (${mergedNoteCount} < ${expectedMinNotes}), recovering...`);
			doc = manualMerge(mergedDoc, doc, remoteDoc);
		} else {
			doc = mergedDoc;
		}
	} else {
		// CRDT merge failed completely, do full manual merge
		console.log('Performing full manual merge of local and remote data');
		doc = manualMerge(doc, doc, remoteDoc);
	}

	// Update the vault ID store
	currentVaultIdStore.set(doc.currentVaultId || DEFAULT_VAULT_ID);

	docStore.set(doc);
	await saveDoc();
}

// Export all notes as JSON (for backup) - legacy format
export function exportNotesJSON(): string {
	if (!doc) return '[]';
	return JSON.stringify(Object.values(doc.notes), null, 2);
}

// Full export including vaults, folders, notes, people, and events
export interface KurumiExport {
	version: number;
	exportedAt: string;
	vaults: Vault[];
	folders: Folder[];
	notes: Note[];
	people: Person[];
	events: Event[];
}

export function exportFullJSON(): string {
	if (!doc) return JSON.stringify({ version: 3, exportedAt: new Date().toISOString(), vaults: [], folders: [], notes: [], people: [], events: [] });
	const exportData: KurumiExport = {
		version: doc.version || 3,
		exportedAt: new Date().toISOString(),
		vaults: Object.values(doc.vaults || {}),
		folders: Object.values(doc.folders || {}),
		notes: Object.values(doc.notes || {}),
		people: Object.values(doc.people || {}),
		events: Object.values(doc.events || {})
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
// Handles both escaped \[\[...\]\] and unescaped [[...]] formats (Milkdown escapes brackets)
export function extractWikilinks(content: string): string[] {
	const links: string[] = [];

	// Match unescaped [[...]]
	const unescapedRegex = /\[\[([^\]]+)\]\]/g;
	let match;
	while ((match = unescapedRegex.exec(content)) !== null) {
		links.push(match[1]);
	}

	// Match escaped \[\[...]] (Milkdown format - escapes opening brackets)
	const escapedRegex = /\\\[\\\[([^\]]+)\]\]/g;
	while ((match = escapedRegex.exec(content)) !== null) {
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

// Extract URLs from content
export function extractUrls(content: string): string[] {
	// Match http:// and https:// URLs, stopping at whitespace, quotes, or markdown syntax
	const regex = /https?:\/\/[^\s\])"'<>]+/g;
	const urls = new Set<string>();
	let match;
	while ((match = regex.exec(content)) !== null) {
		// Clean up trailing punctuation that's likely not part of the URL
		let url = match[0].replace(/[.,;:!?)]+$/, '');
		urls.add(url);
	}
	return Array.from(urls);
}

// Get domain from URL for display
export function getUrlDomain(url: string): string {
	try {
		const parsed = new URL(url);
		return parsed.hostname.replace(/^www\./, '');
	} catch {
		return url;
	}
}

// Get all unique URLs across notes in current vault
export function getAllLinks(): { url: string; domain: string; count: number }[] {
	if (!doc) return [];
	const vaultId = getCurrentVaultId();
	const urlCounts = new Map<string, number>();

	for (const note of Object.values(doc.notes)) {
		if (note.vaultId !== vaultId) continue;
		const urls = extractUrls(note.content);
		for (const url of urls) {
			urlCounts.set(url, (urlCounts.get(url) || 0) + 1);
		}
	}

	return Array.from(urlCounts.entries())
		.map(([url, count]) => ({ url, domain: getUrlDomain(url), count }))
		.sort((a, b) => b.count - a.count);
}

// Get notes containing a specific URL in current vault
export function getNotesByLink(url: string): Note[] {
	if (!doc) return [];
	const vaultId = getCurrentVaultId();

	return Object.values(doc.notes).filter((note) => {
		if (note.vaultId !== vaultId) return false;
		const urls = extractUrls(note.content);
		return urls.includes(url);
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

// ============ Reference Types ============

export interface PersonWithMetadata {
	name: string;
	count: number;
	person: Person | null; // The Person object if exists
	mentioningNotes: Note[];
}

export interface DateWithEvents {
	date: string;
	events: Event[]; // Event objects for this date
	mentioningNotes: Note[];
}

/**
 * Get all people with their metadata from Person objects
 */
export function getAllPeopleWithMetadata(): PersonWithMetadata[] {
	if (!doc) return [];
	const vaultId = getCurrentVaultId();
	const peopleMap = new Map<string, PersonWithMetadata>();

	// First pass: collect all mentions from notes
	for (const note of Object.values(doc.notes)) {
		if (note.vaultId !== vaultId) continue;
		const peopleNames = extractPeople(note.content);

		for (const name of peopleNames) {
			if (!peopleMap.has(name)) {
				peopleMap.set(name, {
					name,
					count: 0,
					person: null,
					mentioningNotes: []
				});
			}
			const personData = peopleMap.get(name)!;
			personData.count++;
			personData.mentioningNotes.push(note);
		}
	}

	// Second pass: link Person objects
	if (doc.people) {
		for (const personObj of Object.values(doc.people)) {
			if (personObj.vaultId !== vaultId) continue;

			if (peopleMap.has(personObj.name)) {
				peopleMap.get(personObj.name)!.person = personObj;
			} else {
				// Person exists but has no mentions
				peopleMap.set(personObj.name, {
					name: personObj.name,
					count: 0,
					person: personObj,
					mentioningNotes: []
				});
			}
		}
	}

	return Array.from(peopleMap.values()).sort((a, b) => b.count - a.count);
}

/**
 * Get all dates with their events
 */
export function getAllDatesWithEvents(): DateWithEvents[] {
	if (!doc) return [];
	const vaultId = getCurrentVaultId();
	const datesMap = new Map<string, DateWithEvents>();

	// First pass: collect all date mentions from notes
	for (const note of Object.values(doc.notes)) {
		if (note.vaultId !== vaultId) continue;
		const dates = extractDates(note.content);

		for (const date of dates) {
			if (!datesMap.has(date)) {
				datesMap.set(date, {
					date,
					events: [],
					mentioningNotes: []
				});
			}
			const dateInfo = datesMap.get(date)!;
			dateInfo.mentioningNotes.push(note);
		}
	}

	// Second pass: link Event objects
	if (doc.events) {
		for (const event of Object.values(doc.events)) {
			if (event.vaultId !== vaultId) continue;

			if (datesMap.has(event.date)) {
				datesMap.get(event.date)!.events.push(event);
			} else {
				// Event exists but date has no mentions
				datesMap.set(event.date, {
					date: event.date,
					events: [event],
					mentioningNotes: []
				});
			}
		}
	}

	return Array.from(datesMap.values()).sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Group dates by relative time periods for agenda view
 */
export function groupDatesByPeriod(dates: DateWithEvents[]): {
	overdue: DateWithEvents[];
	today: DateWithEvents[];
	tomorrow: DateWithEvents[];
	thisWeek: DateWithEvents[];
	nextWeek: DateWithEvents[];
	thisMonth: DateWithEvents[];
	later: DateWithEvents[];
} {
	const today = new Date();
	today.setHours(0, 0, 0, 0);

	const tomorrow = new Date(today);
	tomorrow.setDate(tomorrow.getDate() + 1);

	const endOfWeek = new Date(today);
	endOfWeek.setDate(endOfWeek.getDate() + (7 - endOfWeek.getDay()));

	const endOfNextWeek = new Date(endOfWeek);
	endOfNextWeek.setDate(endOfNextWeek.getDate() + 7);

	const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);

	const groups = {
		overdue: [] as DateWithEvents[],
		today: [] as DateWithEvents[],
		tomorrow: [] as DateWithEvents[],
		thisWeek: [] as DateWithEvents[],
		nextWeek: [] as DateWithEvents[],
		thisMonth: [] as DateWithEvents[],
		later: [] as DateWithEvents[]
	};

	for (const dateInfo of dates) {
		const date = new Date(dateInfo.date + 'T00:00:00');

		if (date < today) {
			groups.overdue.push(dateInfo);
		} else if (date.getTime() === today.getTime()) {
			groups.today.push(dateInfo);
		} else if (date.getTime() === tomorrow.getTime()) {
			groups.tomorrow.push(dateInfo);
		} else if (date <= endOfWeek) {
			groups.thisWeek.push(dateInfo);
		} else if (date <= endOfNextWeek) {
			groups.nextWeek.push(dateInfo);
		} else if (date <= endOfMonth) {
			groups.thisMonth.push(dateInfo);
		} else {
			groups.later.push(dateInfo);
		}
	}

	// Sort each group chronologically
	for (const group of Object.values(groups)) {
		group.sort((a, b) => a.date.localeCompare(b.date));
	}

	// Except overdue: reverse (most recent first)
	groups.overdue.reverse();

	return groups;
}
