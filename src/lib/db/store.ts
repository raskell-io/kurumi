import * as Automerge from '@automerge/automerge';
import { get, set } from 'idb-keyval';
import { writable, derived, type Readable } from 'svelte/store';
import { deleteBlob } from './blob-store';
import { inferenceRouter } from '$lib/inference';
import {
	createEmptyDocument,
	createMemoryObject,
	createFolder,
	createVault,
	createDefaultVault,
	createPerson,
	createEvent,
	createTemplate,
	generateId,
	DEFAULT_VAULT_ID,
	type KurumiDocument,
	type MemoryObject,
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

// Derived store for memory objects (sorted by updatedAt desc) - filtered by current vault, excludes deleted
export const memoryObjects: Readable<MemoryObject[]> = derived(
	[docStore, currentVaultId],
	([$doc, $vaultId]) => {
		if (!$doc) return [];
		return Object.values($doc.memoryObjects)
			.filter((m) => m.vaultId === $vaultId && !m.deletedAt)
			.sort((a, b) => b.updatedAt - a.updatedAt);
	}
);

// Derived store for memory objects count
export const memoryObjectsCount: Readable<number> = derived(
	memoryObjects,
	($memoryObjects) => $memoryObjects.length
);

// Derived store for folders (sorted by name) - filtered by current vault, excludes deleted
export const folders: Readable<Folder[]> = derived(
	[docStore, currentVaultId],
	([$doc, $vaultId]) => {
		if (!$doc || !$doc.folders) return [];
		return Object.values($doc.folders)
			.filter((folder) => folder.vaultId === $vaultId && !folder.deletedAt)
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

// All memory objects across all vaults (for cross-vault operations), excludes deleted
export const allMemoryObjects: Readable<MemoryObject[]> = derived(docStore, ($doc) => {
	if (!$doc) return [];
	return Object.values($doc.memoryObjects)
		.filter((m) => !m.deletedAt)
		.sort((a, b) => b.updatedAt - a.updatedAt);
});

// Trash: deleted memory objects in current vault (sorted by deletedAt, newest first)
export const trashedMemoryObjects: Readable<MemoryObject[]> = derived(
	[docStore, currentVaultId],
	([$doc, $vaultId]) => {
		if (!$doc) return [];
		return Object.values($doc.memoryObjects)
			.filter((m) => m.vaultId === $vaultId && m.deletedAt !== null)
			.sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0));
	}
);

// Trash: deleted folders in current vault (sorted by deletedAt, newest first)
export const trashedFolders: Readable<Folder[]> = derived(
	[docStore, currentVaultId],
	([$doc, $vaultId]) => {
		if (!$doc || !$doc.folders) return [];
		return Object.values($doc.folders)
			.filter((folder) => folder.vaultId === $vaultId && folder.deletedAt !== null)
			.sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0));
	}
);

// Count of items in trash
export const trashCount: Readable<number> = derived(
	[trashedMemoryObjects, trashedFolders],
	([$memories, $folders]) => $memories.length + $folders.length
);

// Initialize the database
export async function initDB(): Promise<void> {
	try {
		const savedData = await get<Uint8Array>(STORAGE_KEY);

		if (savedData) {
			doc = Automerge.load<KurumiDocument>(savedData);

			// Legacy docs (v1-v5) stored memories under `notes`. Treat the field as
			// untyped during these older migrations; v5→v6 below relocates it.
			type LegacyDoc = KurumiDocument & {
				notes?: Record<string, LegacyNote>;
			};
			type LegacyNote = {
				id: string;
				title: string;
				content: string;
				tags: string[];
				folderId?: string | null;
				vaultId?: string;
				created: number;
				modified: number;
				deletedAt?: number | null;
			};

			// Migrate: add folders object if missing
			if (!doc.folders) {
				doc = Automerge.change(doc, (d) => {
					d.folders = {};
				});
			}

			// Migrate: add folderId to existing notes if missing
			const legacy0 = doc as LegacyDoc;
			if (legacy0.notes) {
				const needsFolderIdMigration = Object.values(legacy0.notes).some(
					(note) => note.folderId === undefined
				);
				if (needsFolderIdMigration) {
					doc = Automerge.change(doc, (d) => {
						const dl = d as LegacyDoc;
						if (!dl.notes) return;
						for (const note of Object.values(dl.notes)) {
							if (note.folderId === undefined) {
								note.folderId = null;
							}
						}
					});
				}
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

					const dl = d as LegacyDoc;
					if (dl.notes) {
						for (const note of Object.values(dl.notes)) {
							if (note.vaultId === undefined) {
								note.vaultId = DEFAULT_VAULT_ID;
							}
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

			// Migrate: add deletedAt field to notes and folders (version 4 -> version 5)
			const legacy5 = doc as LegacyDoc;
			const needsDeletedAtMigration =
				(legacy5.notes &&
					Object.values(legacy5.notes).some((note) => note.deletedAt === undefined)) ||
				Object.values(doc.folders).some((folder) => folder.deletedAt === undefined);

			if (needsDeletedAtMigration) {
				doc = Automerge.change(doc, (d) => {
					const dl = d as LegacyDoc;
					if (dl.notes) {
						for (const note of Object.values(dl.notes)) {
							if (note.deletedAt === undefined) {
								note.deletedAt = null;
							}
						}
					}
					for (const folder of Object.values(d.folders)) {
						if (folder.deletedAt === undefined) {
							(folder as Folder).deletedAt = null;
						}
					}
					d.version = 5;
				});
				await saveDoc();
			}

			// Migrate: relocate `notes` -> `memoryObjects` and expand each Note into
			// a full MemoryObject (version 5 -> version 6).
			const legacy6 = doc as LegacyDoc;
			if (!doc.memoryObjects || legacy6.notes) {
				doc = Automerge.change(doc, (d) => {
					const dl = d as LegacyDoc;
					if (!d.memoryObjects) d.memoryObjects = {};
					if (dl.notes) {
						for (const note of Object.values(dl.notes)) {
							if (d.memoryObjects[note.id]) continue;
							d.memoryObjects[note.id] = {
								id: note.id,
								type: 'note',
								space: 'personal',
								parentBucket: null,
								folderId: note.folderId ?? null,
								title: note.title,
								rawText: '',
								bodyMarkdown: note.content ?? '',
								rawAudioRef: null,
								rawMediaRef: null,
								transcript: null,
								transcriptSegments: [],
								summaryShort: null,
								summaryLong: null,
								createdAt: note.created,
								updatedAt: note.modified,
								capturedAt: note.created,
								sourceDevice: null,
								sourceContext: null,
								language: null,
								tags: Array.isArray(note.tags) ? [...note.tags] : [],
								controlledLabels: [],
								participants: [],
								entities: [],
								projects: [],
								topics: [],
								dates: [],
								actionItems: [],
								decisions: [],
								relatedMemoryIds: [],
								visibilityScope: 'personal',
								processingState: 'ready',
								confidenceScores: {},
								embeddingRef: null,
								vaultId: note.vaultId ?? DEFAULT_VAULT_ID,
								deletedAt: note.deletedAt ?? null
							};
						}
						delete dl.notes;
					}
					d.version = 6;
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

		// Auto-cleanup old trash items (>30 days)
		const cleanedUp = cleanupOldTrashInternal();
		if (cleanedUp > 0) {
			console.log(`Auto-cleaned ${cleanedUp} items from trash`);
		}
	} catch (error) {
		console.error('Failed to initialize database:', error);
		// Start fresh if there's a corruption
		doc = Automerge.from<KurumiDocument>(createEmptyDocument());
		currentVaultIdStore.set(DEFAULT_VAULT_ID);
		docStore.set(doc);
		await saveDoc();
	}
}

// Internal cleanup function that returns count without triggering store update during init
function cleanupOldTrashInternal(): number {
	const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
	let deletedCount = 0;

	const memoryIdsToDelete: string[] = [];
	const foldersToDelete: string[] = [];

	// Collect items to delete
	for (const m of Object.values(doc.memoryObjects)) {
		if (m.deletedAt && m.deletedAt < thirtyDaysAgo) {
			memoryIdsToDelete.push(m.id);
			deleteBlobsForMemory(m);
		}
	}
	for (const folder of Object.values(doc.folders)) {
		if (folder.deletedAt && folder.deletedAt < thirtyDaysAgo) {
			foldersToDelete.push(folder.id);
		}
	}

	if (memoryIdsToDelete.length > 0 || foldersToDelete.length > 0) {
		doc = Automerge.change(doc, (d) => {
			for (const id of memoryIdsToDelete) {
				delete d.memoryObjects[id];
				deletedCount++;
			}
			for (const id of foldersToDelete) {
				delete d.folders[id];
				deletedCount++;
			}
		});
		saveDoc();
	}

	return deletedCount;
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

// Fire-and-forget deletion of any blob refs attached to a memory.
// Used when permanently deleting memories so blobs don't leak in IndexedDB.
function deleteBlobsForMemory(memory: MemoryObject): void {
	if (memory.rawAudioRef) {
		void deleteBlob(memory.rawAudioRef);
	}
	if (memory.rawMediaRef) {
		void deleteBlob(memory.rawMediaRef);
	}
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

	const memoriesInVault = Object.values(doc.memoryObjects).filter((m) => m.vaultId === id);
	const foldersInVault = Object.values(doc.folders).filter((f) => f.vaultId === id);

	if (memoriesInVault.length > 0 || foldersInVault.length > 0) {
		return {
			success: false,
			error: 'Vault contains memories or folders. Move or delete them first.'
		};
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

// Move memory object to a different vault
export function moveMemoryObjectToVault(memoryId: string, targetVaultId: string): void {
	if (!doc?.vaults?.[targetVaultId]) {
		console.error('Target vault not found:', targetVaultId);
		return;
	}
	updateDoc((d) => {
		const memory = d.memoryObjects[memoryId];
		if (memory) {
			memory.vaultId = targetVaultId;
			memory.folderId = null; // Reset folder since folders don't cross vaults
			memory.updatedAt = Date.now();
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

		// Move all memory objects in these folders
		for (const memory of Object.values(d.memoryObjects)) {
			if (memory.folderId && folderIds.has(memory.folderId)) {
				memory.vaultId = targetVaultId;
				memory.updatedAt = Date.now();
			}
		}
	});
}

// ============ MemoryObject CRUD Operations ============

export function addMemoryObject(
	title?: string,
	bodyMarkdown?: string,
	folderId?: string | null
): MemoryObject {
	if (!doc) {
		console.error('Cannot add memory: database not initialized');
		doc = Automerge.from<KurumiDocument>(createEmptyDocument());
		docStore.set(doc);
	}
	const vaultId = getCurrentVaultId();
	const memory = createMemoryObject({
		title,
		bodyMarkdown,
		folderId: folderId ?? null,
		vaultId
	});
	updateDoc((d) => {
		d.memoryObjects[memory.id] = memory;
	});
	return memory;
}

export function addVoiceMemo(options: {
	title: string;
	rawAudioRef: string;
	folderId?: string | null;
}): MemoryObject {
	if (!doc) {
		console.error('Cannot add voice memo: database not initialized');
		doc = Automerge.from<KurumiDocument>(createEmptyDocument());
		docStore.set(doc);
	}
	const vaultId = getCurrentVaultId();
	const memory = createMemoryObject({
		type: 'voice-memo',
		title: options.title,
		folderId: options.folderId ?? null,
		vaultId
	});
	memory.rawAudioRef = options.rawAudioRef;
	memory.processingState = 'pending';
	updateDoc((d) => {
		d.memoryObjects[memory.id] = memory;
	});
	return memory;
}

/**
 * Run transcription on a voice memo's audio. Updates processingState as the
 * job progresses and stores the result on memory.transcript on success.
 *
 * If no provider is registered or none supports transcription, the memory is
 * silently marked 'ready' so the user isn't left in a permanent "transcribing"
 * limbo. Errors are stored on memory.summaryShort for visibility (until we
 * add a dedicated error field to the schema).
 */
export async function transcribeMemoryAudio(
	memoryId: string,
	audio: Blob,
	mimeType: string
): Promise<void> {
	const provider = inferenceRouter.findProvider((cap) => cap.supportsTranscribe);
	if (!provider) {
		updateMemoryObject(memoryId, { processingState: 'ready' });
		return;
	}

	updateMemoryObject(memoryId, { processingState: 'transcribing' });

	try {
		const result = await provider.transcribe({ audio, mimeType });
		if (!result.ok || !result.value) {
			updateMemoryObject(memoryId, {
				processingState: 'failed',
				summaryShort: result.error ?? 'Transcription failed'
			});
			return;
		}

		updateDoc((d) => {
			const memory = d.memoryObjects[memoryId];
			if (!memory) return;
			memory.transcript = result.value!.text;
			memory.processingState = 'ready';
			// Replace transcript segments
			memory.transcriptSegments.splice(0, memory.transcriptSegments.length);
			for (const seg of result.value!.segments) {
				memory.transcriptSegments.push(seg);
			}
			if (result.value!.language) {
				memory.language = result.value!.language;
			}
			memory.updatedAt = Date.now();
		});
	} catch (err) {
		updateMemoryObject(memoryId, {
			processingState: 'failed',
			summaryShort: err instanceof Error ? err.message : 'Transcription error'
		});
	}
}

export function getMemoryObject(id: string): MemoryObject | undefined {
	return doc?.memoryObjects[id];
}

export function updateMemoryObject(
	id: string,
	updates: Partial<Omit<MemoryObject, 'id' | 'createdAt'>>
): void {
	updateDoc((d) => {
		const memory = d.memoryObjects[id];
		if (!memory) return;
		if (updates.title !== undefined) memory.title = updates.title;
		if (updates.bodyMarkdown !== undefined) memory.bodyMarkdown = updates.bodyMarkdown;
		if (updates.rawText !== undefined) memory.rawText = updates.rawText;
		if (updates.tags !== undefined) {
			// Clear and repopulate tags array for Automerge
			while (memory.tags.length > 0) memory.tags.pop();
			updates.tags.forEach((tag) => memory.tags.push(tag));
		}
		if (updates.folderId !== undefined) memory.folderId = updates.folderId;
		if (updates.processingState !== undefined) memory.processingState = updates.processingState;
		if (updates.summaryShort !== undefined) memory.summaryShort = updates.summaryShort;
		if (updates.summaryLong !== undefined) memory.summaryLong = updates.summaryLong;
		if (updates.transcript !== undefined) memory.transcript = updates.transcript;
		memory.updatedAt = Date.now();
	});
}

export function deleteMemoryObject(id: string): void {
	updateDoc((d) => {
		const memory = d.memoryObjects[id];
		if (memory) {
			memory.deletedAt = Date.now();
		}
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
	const now = Date.now();
	updateDoc((d) => {
		const folder = d.folders[id];
		if (!folder) return;

		if (deleteContents) {
			// Soft delete all memories in this folder
			for (const memory of Object.values(d.memoryObjects)) {
				if (memory.folderId === id && !memory.deletedAt) {
					memory.deletedAt = now;
				}
			}
			// Recursively soft delete subfolders and their memories
			const collectSubfolderIds = (parentId: string): string[] => {
				const ids: string[] = [];
				for (const f of Object.values(d.folders)) {
					if (f.parentId === parentId && !f.deletedAt) {
						ids.push(f.id);
						ids.push(...collectSubfolderIds(f.id));
					}
				}
				return ids;
			};

			const subfolderIds = collectSubfolderIds(id);
			for (const subfolderId of subfolderIds) {
				// Soft delete memories in subfolder
				for (const memory of Object.values(d.memoryObjects)) {
					if (memory.folderId === subfolderId && !memory.deletedAt) {
						memory.deletedAt = now;
					}
				}
				// Soft delete subfolder
				const subfolder = d.folders[subfolderId];
				if (subfolder) {
					subfolder.deletedAt = now;
				}
			}
		} else {
			// Move memories to root level
			for (const memory of Object.values(d.memoryObjects)) {
				if (memory.folderId === id && !memory.deletedAt) {
					memory.folderId = null;
				}
			}
			// Move subfolders to root level
			for (const f of Object.values(d.folders)) {
				if (f.parentId === id && !f.deletedAt) {
					f.parentId = null;
				}
			}
		}
		// Soft delete the folder itself
		folder.deletedAt = now;
	});
}

// ============ Trash Operations ============

// Restore a memory object from trash
export function restoreMemoryObject(id: string): void {
	updateDoc((d) => {
		const memory = d.memoryObjects[id];
		if (memory && memory.deletedAt) {
			memory.deletedAt = null;
			// If the memory was in a deleted folder, move to root
			if (memory.folderId && d.folders[memory.folderId]?.deletedAt) {
				memory.folderId = null;
			}
		}
	});
}

// Restore a folder from trash (and optionally its contents)
export function restoreFolder(id: string, restoreContents: boolean = true): void {
	updateDoc((d) => {
		const folder = d.folders[id];
		if (!folder || !folder.deletedAt) return;

		// Restore the folder
		folder.deletedAt = null;

		// If parent folder is deleted, move to root
		if (folder.parentId && d.folders[folder.parentId]?.deletedAt) {
			folder.parentId = null;
		}

		if (restoreContents) {
			// Restore all memories that were in this folder
			for (const memory of Object.values(d.memoryObjects)) {
				if (memory.folderId === id && memory.deletedAt) {
					memory.deletedAt = null;
				}
			}

			// Restore subfolders recursively
			const restoreSubfolders = (parentId: string) => {
				for (const f of Object.values(d.folders)) {
					if (f.parentId === parentId && f.deletedAt) {
						f.deletedAt = null;
						// Restore memories in this subfolder
						for (const memory of Object.values(d.memoryObjects)) {
							if (memory.folderId === f.id && memory.deletedAt) {
								memory.deletedAt = null;
							}
						}
						restoreSubfolders(f.id);
					}
				}
			};
			restoreSubfolders(id);
		}
	});
}

// Permanently delete a memory object (cannot be undone)
export function permanentlyDeleteMemoryObject(id: string): void {
	const memory = doc?.memoryObjects[id];
	if (memory) {
		deleteBlobsForMemory(memory);
	}
	updateDoc((d) => {
		delete d.memoryObjects[id];
	});
}

// Permanently delete a folder (cannot be undone)
export function permanentlyDeleteFolder(id: string): void {
	if (!doc) return;

	// Collect every memory that will be removed so we can clean up blobs.
	const folderIdsToDelete = new Set<string>([id]);
	const collectSubfolders = (parentId: string) => {
		for (const f of Object.values(doc.folders)) {
			if (f.parentId === parentId && !folderIdsToDelete.has(f.id)) {
				folderIdsToDelete.add(f.id);
				collectSubfolders(f.id);
			}
		}
	};
	collectSubfolders(id);

	for (const memory of Object.values(doc.memoryObjects)) {
		if (memory.folderId && folderIdsToDelete.has(memory.folderId)) {
			deleteBlobsForMemory(memory);
		}
	}

	updateDoc((d) => {
		// Also permanently delete all memories that were in this folder
		for (const memory of Object.values(d.memoryObjects)) {
			if (memory.folderId === id) {
				delete d.memoryObjects[memory.id];
			}
		}

		// Permanently delete subfolders recursively
		const deleteSubfolders = (parentId: string) => {
			for (const f of Object.values(d.folders)) {
				if (f.parentId === parentId) {
					// Delete memories in subfolder
					for (const memory of Object.values(d.memoryObjects)) {
						if (memory.folderId === f.id) {
							delete d.memoryObjects[memory.id];
						}
					}
					deleteSubfolders(f.id);
					delete d.folders[f.id];
				}
			}
		};
		deleteSubfolders(id);

		delete d.folders[id];
	});
}

// Empty entire trash (permanently delete all trashed items)
export function emptyTrash(): void {
	const vaultId = getCurrentVaultId();
	if (doc) {
		for (const memory of Object.values(doc.memoryObjects)) {
			if (memory.vaultId === vaultId && memory.deletedAt) {
				deleteBlobsForMemory(memory);
			}
		}
	}
	updateDoc((d) => {
		// Delete all trashed memories in current vault
		for (const memory of Object.values(d.memoryObjects)) {
			if (memory.vaultId === vaultId && memory.deletedAt) {
				delete d.memoryObjects[memory.id];
			}
		}

		// Delete all trashed folders in current vault
		for (const folder of Object.values(d.folders)) {
			if (folder.vaultId === vaultId && folder.deletedAt) {
				delete d.folders[folder.id];
			}
		}
	});
}

// Auto-cleanup: permanently delete items that have been in trash for more than 30 days
export function cleanupOldTrash(): number {
	const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
	let deletedCount = 0;

	if (doc) {
		for (const memory of Object.values(doc.memoryObjects)) {
			if (memory.deletedAt && memory.deletedAt < thirtyDaysAgo) {
				deleteBlobsForMemory(memory);
			}
		}
	}

	updateDoc((d) => {
		// Delete old trashed memories
		for (const memory of Object.values(d.memoryObjects)) {
			if (memory.deletedAt && memory.deletedAt < thirtyDaysAgo) {
				delete d.memoryObjects[memory.id];
				deletedCount++;
			}
		}

		// Delete old trashed folders
		for (const folder of Object.values(d.folders)) {
			if (folder.deletedAt && folder.deletedAt < thirtyDaysAgo) {
				delete d.folders[folder.id];
				deletedCount++;
			}
		}
	});

	return deletedCount;
}

export function moveMemoryObjectToFolder(memoryId: string, folderId: string | null): void {
	updateDoc((d) => {
		const memory = d.memoryObjects[memoryId];
		if (memory) {
			memory.folderId = folderId;
			memory.updatedAt = Date.now();
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

export function getMemoryObjectsInFolder(folderId: string | null): MemoryObject[] {
	if (!doc) return [];
	const vaultId = getCurrentVaultId();
	return Object.values(doc.memoryObjects)
		.filter((m) => m.folderId === folderId && m.vaultId === vaultId)
		.sort((a, b) => b.updatedAt - a.updatedAt);
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

// Add default starter templates
export function addStarterTemplates(): void {
	if (!doc) {
		console.error('Cannot add templates: database not initialized');
		return;
	}

	const vaultId = getCurrentVaultId();
	const now = Date.now();

	updateDoc((d) => {
		if (!d.templates) d.templates = {};

		// Meeting Notes
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

		// Daily Journal
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

		// Project Brief
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
	});
}

// ============ Sync Operations ============

// Get the raw Automerge document for sync
export function getDocBinary(): Uint8Array {
	return Automerge.save(doc);
}

// Check if local document is essentially empty (no user content)
function isDocEmpty(d: Automerge.Doc<KurumiDocument>): boolean {
	const memoryCount = Object.keys(d.memoryObjects || {}).length;
	const folderCount = Object.keys(d.folders || {}).length;
	return memoryCount === 0 && folderCount === 0;
}

// Deep copy an object to break Automerge references
function deepCopy<T>(obj: T): T {
	return JSON.parse(JSON.stringify(obj));
}

// Helper to pick the most recent version of an item.
// Folders/Vaults/People/Events still use `modified`; MemoryObjects use `updatedAt`.
function pickNewestBy<T>(
	local: T | undefined,
	remote: T | undefined,
	getTime: (item: T) => number
): T | undefined {
	if (!local) return remote;
	if (!remote) return local;
	return getTime(local) >= getTime(remote) ? local : remote;
}

const byModified = <T extends { modified: number }>(item: T) => item.modified;
const byUpdatedAt = <T extends { updatedAt: number }>(item: T) => item.updatedAt;

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
		memoryObjects: localDoc.memoryObjects || {},
		people: localDoc.people || {},
		events: localDoc.events || {}
	});
	const remoteData = deepCopy({
		vaults: remoteDoc.vaults || {},
		folders: remoteDoc.folders || {},
		memoryObjects: remoteDoc.memoryObjects || {},
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
			const newest = pickNewestBy(localData.vaults[id], remoteData.vaults[id], byModified);
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
			const newest = pickNewestBy(localData.folders[id], remoteData.folders[id], byModified);
			if (newest) {
				d.folders[id] = newest;
			}
		}

		// Merge memory objects - always keep all, use newest version for conflicts
		const allMemoryIds = new Set([
			...Object.keys(localData.memoryObjects),
			...Object.keys(remoteData.memoryObjects)
		]);
		for (const id of allMemoryIds) {
			const newest = pickNewestBy(
				localData.memoryObjects[id],
				remoteData.memoryObjects[id],
				byUpdatedAt
			);
			if (newest) {
				d.memoryObjects[id] = newest;
			}
		}

		// Merge people
		const allPeopleIds = new Set([
			...Object.keys(localData.people),
			...Object.keys(remoteData.people)
		]);
		for (const id of allPeopleIds) {
			const newest = pickNewestBy(localData.people[id], remoteData.people[id], byModified);
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
			const newest = pickNewestBy(localData.events[id], remoteData.events[id], byModified);
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
		const localCount = Object.keys(doc.memoryObjects || {}).length;
		const remoteCount = Object.keys(remoteDoc.memoryObjects || {}).length;
		const mergedCount = Object.keys(mergedDoc.memoryObjects || {}).length;
		const expectedMin = Math.max(localCount, remoteCount);

		// If merge lost memories, do manual recovery
		if (mergedCount < expectedMin) {
			console.log(`CRDT merge lost data (${mergedCount} < ${expectedMin}), recovering...`);
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

// Export all memory objects as JSON (for backup) - legacy format
export function exportMemoryObjectsJSON(): string {
	if (!doc) return '[]';
	return JSON.stringify(Object.values(doc.memoryObjects), null, 2);
}

// Full export including vaults, folders, memory objects, people, and events
export interface KurumiExport {
	version: number;
	exportedAt: string;
	vaults: Vault[];
	folders: Folder[];
	memoryObjects: MemoryObject[];
	people: Person[];
	events: Event[];
}

export function exportFullJSON(): string {
	if (!doc)
		return JSON.stringify({
			version: 6,
			exportedAt: new Date().toISOString(),
			vaults: [],
			folders: [],
			memoryObjects: [],
			people: [],
			events: []
		});
	const exportData: KurumiExport = {
		version: doc.version || 6,
		exportedAt: new Date().toISOString(),
		vaults: Object.values(doc.vaults || {}),
		folders: Object.values(doc.folders || {}),
		memoryObjects: Object.values(doc.memoryObjects || {}),
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
	totalMemoryObjects: number;
}

// Legacy note shape used by old exports/imports (pre-v6).
type LegacyNoteImport = {
	id: string;
	title: string;
	content: string;
	tags?: string[];
	folderId?: string | null;
	vaultId?: string;
	created: number;
	modified: number;
	deletedAt?: number | null;
};

function legacyNoteToMemoryObject(note: LegacyNoteImport, defaultVaultId: string): MemoryObject {
	return {
		id: note.id,
		type: 'note',
		space: 'personal',
		parentBucket: null,
		folderId: note.folderId ?? null,
		title: note.title,
		rawText: '',
		bodyMarkdown: note.content ?? '',
		rawAudioRef: null,
		rawMediaRef: null,
		transcript: null,
		transcriptSegments: [],
		summaryShort: null,
		summaryLong: null,
		createdAt: note.created,
		updatedAt: note.modified,
		capturedAt: note.created,
		sourceDevice: null,
		sourceContext: null,
		language: null,
		tags: Array.isArray(note.tags) ? [...note.tags] : [],
		controlledLabels: [],
		participants: [],
		entities: [],
		projects: [],
		topics: [],
		dates: [],
		actionItems: [],
		decisions: [],
		relatedMemoryIds: [],
		visibilityScope: 'personal',
		processingState: 'ready',
		confidenceScores: {},
		embeddingRef: null,
		vaultId: note.vaultId ?? defaultVaultId,
		deletedAt: note.deletedAt ?? null
	};
}

// Parse an import JSON blob into vaults/folders/memoryObjects regardless of
// whether it's a legacy (notes) or current (memoryObjects) export shape.
function parseImportPayload(
	data: unknown,
	defaultVaultId: string
): { vaults: Vault[]; folders: Folder[]; memoryObjects: MemoryObject[] } | null {
	let vaults: Vault[] = [];
	let folders: Folder[] = [];
	let memories: MemoryObject[] = [];

	if (Array.isArray(data)) {
		// Legacy: bare array of notes
		memories = (data as LegacyNoteImport[]).map((n) => legacyNoteToMemoryObject(n, defaultVaultId));
	} else if (data && typeof data === 'object') {
		const payload = data as {
			vaults?: Vault[];
			folders?: Folder[];
			memoryObjects?: MemoryObject[];
			notes?: LegacyNoteImport[];
		};
		if (payload.memoryObjects) {
			vaults = payload.vaults ?? [];
			folders = payload.folders ?? [];
			memories = payload.memoryObjects;
		} else if (payload.notes) {
			vaults = payload.vaults ?? [];
			folders = payload.folders ?? [];
			memories = payload.notes.map((n) => legacyNoteToMemoryObject(n, defaultVaultId));
		} else {
			return null;
		}
	} else {
		return null;
	}

	return { vaults, folders, memoryObjects: memories };
}

export function analyzeImport(jsonString: string): ImportAnalysis | { error: string } {
	if (!doc) return { error: 'Database not initialized' };

	try {
		const data = JSON.parse(jsonString);
		const parsed = parseImportPayload(data, doc.currentVaultId || DEFAULT_VAULT_ID);
		if (!parsed) return { error: 'Invalid import format' };

		// Check for vault conflicts
		const vaultConflicts: VaultConflict[] = [];
		const newVaults: Vault[] = [];

		for (const importedVault of parsed.vaults) {
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
			totalFolders: parsed.folders.length,
			totalMemoryObjects: parsed.memoryObjects.length
		};
	} catch {
		return { error: 'Invalid JSON format' };
	}
}

export type ConflictResolution = 'overwrite' | 'duplicate' | 'skip';

export interface ImportOptions {
	conflictResolution: ConflictResolution;
}

export async function importJSON(
	jsonString: string,
	options: ImportOptions
): Promise<{
	success: boolean;
	error?: string;
	imported?: { vaults: number; folders: number; memoryObjects: number };
}> {
	if (!doc) return { success: false, error: 'Database not initialized' };

	try {
		const data = JSON.parse(jsonString);
		const parsed = parseImportPayload(data, doc.currentVaultId || DEFAULT_VAULT_ID);
		if (!parsed) return { success: false, error: 'Invalid import format' };

		const { vaults, folders, memoryObjects: memories } = parsed;

		// Track ID mappings for duplicated vaults
		const vaultIdMap = new Map<string, string>();
		let importedVaults = 0;
		let importedFolders = 0;
		let importedMemories = 0;

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

			// Import memory objects (with remapped vault IDs if duplicated)
			for (const memory of memories) {
				const targetVaultId =
					vaultIdMap.get(memory.vaultId) || memory.vaultId || d.currentVaultId;

				// Check if memory already exists
				if (d.memoryObjects[memory.id]) {
					if (options.conflictResolution === 'overwrite') {
						d.memoryObjects[memory.id] = { ...memory, vaultId: targetVaultId };
						importedMemories++;
					} else if (options.conflictResolution === 'duplicate') {
						const newId = generateId();
						d.memoryObjects[newId] = { ...memory, id: newId, vaultId: targetVaultId };
						importedMemories++;
					}
				} else {
					d.memoryObjects[memory.id] = { ...memory, vaultId: targetVaultId };
					importedMemories++;
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
				memoryObjects: importedMemories
			}
		};
	} catch (e) {
		return {
			success: false,
			error: `Import failed: ${e instanceof Error ? e.message : 'Unknown error'}`
		};
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

// Get all unique tags across memories in current vault
export function getAllTags(): { tag: string; count: number }[] {
	if (!doc) return [];
	const vaultId = getCurrentVaultId();
	const tagCounts = new Map<string, number>();

	for (const memory of Object.values(doc.memoryObjects)) {
		if (memory.vaultId !== vaultId) continue;
		const tags = extractTags(memory.bodyMarkdown);
		for (const tag of tags) {
			tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
		}
	}

	return Array.from(tagCounts.entries())
		.map(([tag, count]) => ({ tag, count }))
		.sort((a, b) => b.count - a.count);
}

// Get memories with a specific tag in current vault
export function getMemoryObjectsByTag(tag: string): MemoryObject[] {
	if (!doc) return [];
	const vaultId = getCurrentVaultId();
	const lowerTag = tag.toLowerCase();

	return Object.values(doc.memoryObjects).filter((memory) => {
		if (memory.vaultId !== vaultId) return false;
		const tags = extractTags(memory.bodyMarkdown);
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

// Get all unique people across memories in current vault
export function getAllPeople(): { name: string; count: number }[] {
	if (!doc) return [];
	const vaultId = getCurrentVaultId();
	const peopleCounts = new Map<string, number>();

	for (const memory of Object.values(doc.memoryObjects)) {
		if (memory.vaultId !== vaultId) continue;
		const people = extractPeople(memory.bodyMarkdown);
		for (const person of people) {
			peopleCounts.set(person, (peopleCounts.get(person) || 0) + 1);
		}
	}

	return Array.from(peopleCounts.entries())
		.map(([name, count]) => ({ name, count }))
		.sort((a, b) => b.count - a.count);
}

// Get memories mentioning a specific person in current vault
export function getMemoryObjectsByPerson(name: string): MemoryObject[] {
	if (!doc) return [];
	const vaultId = getCurrentVaultId();

	return Object.values(doc.memoryObjects).filter((memory) => {
		if (memory.vaultId !== vaultId) return false;
		const people = extractPeople(memory.bodyMarkdown);
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

// Get all unique dates across memories in current vault
export function getAllDates(): { date: string; count: number }[] {
	if (!doc) return [];
	const vaultId = getCurrentVaultId();
	const dateCounts = new Map<string, number>();

	for (const memory of Object.values(doc.memoryObjects)) {
		if (memory.vaultId !== vaultId) continue;
		const dates = extractDates(memory.bodyMarkdown);
		for (const date of dates) {
			dateCounts.set(date, (dateCounts.get(date) || 0) + 1);
		}
	}

	return Array.from(dateCounts.entries())
		.map(([date, count]) => ({ date, count }))
		.sort((a, b) => b.date.localeCompare(a.date)); // Sort by date descending
}

// Get memories with a specific date in current vault
export function getMemoryObjectsByDate(date: string): MemoryObject[] {
	if (!doc) return [];
	const vaultId = getCurrentVaultId();

	return Object.values(doc.memoryObjects).filter((memory) => {
		if (memory.vaultId !== vaultId) return false;
		const dates = extractDates(memory.bodyMarkdown);
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

// Get all unique URLs across memories in current vault
export function getAllLinks(): { url: string; domain: string; count: number }[] {
	if (!doc) return [];
	const vaultId = getCurrentVaultId();
	const urlCounts = new Map<string, number>();

	for (const memory of Object.values(doc.memoryObjects)) {
		if (memory.vaultId !== vaultId) continue;
		const urls = extractUrls(memory.bodyMarkdown);
		for (const url of urls) {
			urlCounts.set(url, (urlCounts.get(url) || 0) + 1);
		}
	}

	return Array.from(urlCounts.entries())
		.map(([url, count]) => ({ url, domain: getUrlDomain(url), count }))
		.sort((a, b) => b.count - a.count);
}

// Get memories containing a specific URL in current vault
export function getMemoryObjectsByLink(url: string): MemoryObject[] {
	if (!doc) return [];
	const vaultId = getCurrentVaultId();

	return Object.values(doc.memoryObjects).filter((memory) => {
		if (memory.vaultId !== vaultId) return false;
		const urls = extractUrls(memory.bodyMarkdown);
		return urls.includes(url);
	});
}

// Find memories that link to a given memory (in current vault)
export function findBacklinks(memoryId: string): MemoryObject[] {
	if (!doc) return [];
	const target = doc.memoryObjects[memoryId];
	if (!target) return [];

	const vaultId = target.vaultId;
	const targetTitle = target.title.toLowerCase();

	return Object.values(doc.memoryObjects).filter((memory) => {
		if (memory.id === memoryId) return false;
		if (memory.vaultId !== vaultId) return false;
		const links = extractWikilinks(memory.bodyMarkdown);
		return links.some((link) => link.toLowerCase() === targetTitle);
	});
}

// Find a memory by its title in current vault (case-insensitive)
export function findMemoryObjectByTitle(title: string): MemoryObject | undefined {
	if (!doc) return undefined;
	const vaultId = getCurrentVaultId();
	const lowerTitle = title.toLowerCase();
	return Object.values(doc.memoryObjects).find(
		(memory) => memory.vaultId === vaultId && memory.title.toLowerCase() === lowerTitle
	);
}

// ============ Reference Types ============

export interface PersonWithMetadata {
	name: string;
	count: number;
	person: Person | null; // The Person object if exists
	mentioningMemories: MemoryObject[];
}

export interface DateWithEvents {
	date: string;
	events: Event[]; // Event objects for this date
	mentioningMemories: MemoryObject[];
}

/**
 * Get all people with their metadata from Person objects
 */
export function getAllPeopleWithMetadata(): PersonWithMetadata[] {
	if (!doc) return [];
	const vaultId = getCurrentVaultId();
	const peopleMap = new Map<string, PersonWithMetadata>();

	// First pass: collect all mentions from memories
	for (const memory of Object.values(doc.memoryObjects)) {
		if (memory.vaultId !== vaultId) continue;
		const peopleNames = extractPeople(memory.bodyMarkdown);

		for (const name of peopleNames) {
			if (!peopleMap.has(name)) {
				peopleMap.set(name, {
					name,
					count: 0,
					person: null,
					mentioningMemories: []
				});
			}
			const personData = peopleMap.get(name)!;
			personData.count++;
			personData.mentioningMemories.push(memory);
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
					mentioningMemories: []
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

	// First pass: collect all date mentions from memories
	for (const memory of Object.values(doc.memoryObjects)) {
		if (memory.vaultId !== vaultId) continue;
		const dates = extractDates(memory.bodyMarkdown);

		for (const date of dates) {
			if (!datesMap.has(date)) {
				datesMap.set(date, {
					date,
					events: [],
					mentioningMemories: []
				});
			}
			const dateInfo = datesMap.get(date)!;
			dateInfo.mentioningMemories.push(memory);
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
					mentioningMemories: []
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
