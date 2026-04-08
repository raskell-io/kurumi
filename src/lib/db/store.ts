import * as Automerge from '@automerge/automerge';
import { get, set } from 'idb-keyval';
import { writable, derived, type Readable } from 'svelte/store';
import { deleteBlob, getBlob } from './blob-store';
import { deleteEmbedding, embedMemory } from '$lib/embeddings';
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
	type Template,
	type ActionItem,
	type ActionItemStatus,
	type MeetingActionItemDraft,
	type ReminderProposal,
	type ReminderStatus,
	type DraftProposal,
	type DraftStatus,
	type DraftKind
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

// Derived store for action items in the current vault. Sorted so that
// non-terminal statuses come first (open > in_progress > done/cancelled),
// then by due date ascending (nulls last), then by createdAt descending.
export const actionItems: Readable<ActionItem[]> = derived(
	[docStore, currentVaultId],
	([$doc, $vaultId]) => {
		if (!$doc || !$doc.actionItems) return [];
		const statusOrder: Record<ActionItemStatus, number> = {
			open: 0,
			in_progress: 1,
			done: 2,
			cancelled: 3
		};
		return Object.values($doc.actionItems)
			.filter((item) => item.vaultId === $vaultId)
			.sort((a, b) => {
				const s = statusOrder[a.status] - statusOrder[b.status];
				if (s !== 0) return s;
				// Due date asc, nulls last
				if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
				if (a.dueDate) return -1;
				if (b.dueDate) return 1;
				return b.createdAt - a.createdAt;
			});
	}
);

// Derived store for reminder proposals in the current vault. Pending
// first, then sorted by suggestedDate asc. Decided proposals (approved/
// rejected) stay visible as an audit trail but after pending ones.
export const reminderProposals: Readable<ReminderProposal[]> = derived(
	[docStore, currentVaultId],
	([$doc, $vaultId]) => {
		if (!$doc || !$doc.reminderProposals) return [];
		const statusOrder: Record<ReminderStatus, number> = {
			pending: 0,
			snoozed: 1,
			approved: 2,
			rejected: 3
		};
		return Object.values($doc.reminderProposals)
			.filter((p) => p.vaultId === $vaultId)
			.sort((a, b) => {
				const s = statusOrder[a.status] - statusOrder[b.status];
				if (s !== 0) return s;
				if (a.suggestedDate && b.suggestedDate)
					return a.suggestedDate.localeCompare(b.suggestedDate);
				return b.createdAt - a.createdAt;
			});
	}
);

// Derived store for draft proposals (email / calendar-event).
export const draftProposals: Readable<DraftProposal[]> = derived(
	[docStore, currentVaultId],
	([$doc, $vaultId]) => {
		if (!$doc || !$doc.draftProposals) return [];
		const statusOrder: Record<DraftStatus, number> = {
			pending: 0,
			used: 1,
			rejected: 2
		};
		return Object.values($doc.draftProposals)
			.filter((p) => p.vaultId === $vaultId)
			.sort((a, b) => {
				const s = statusOrder[a.status] - statusOrder[b.status];
				if (s !== 0) return s;
				return b.createdAt - a.createdAt;
			});
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
								processingError: null,
								confidenceScores: {},
								embeddingRef: null,
								meetingExtras: null,
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

			// Migrate: add processingError field to existing memory objects
			// (version 6 -> version 7). Defaults to null.
			if ((doc.version ?? 0) < 7) {
				doc = Automerge.change(doc, (d) => {
					for (const memory of Object.values(d.memoryObjects)) {
						if ((memory as { processingError?: unknown }).processingError === undefined) {
							(memory as { processingError: string | null }).processingError = null;
						}
					}
					d.version = 7;
				});
				await saveDoc();
			}

			// Migrate: add meetingExtras field for the meeting capture path
			// (version 7 -> version 8). Defaults to null for non-meetings.
			if ((doc.version ?? 0) < 8) {
				doc = Automerge.change(doc, (d) => {
					for (const memory of Object.values(d.memoryObjects)) {
						if ((memory as { meetingExtras?: unknown }).meetingExtras === undefined) {
							(memory as { meetingExtras: null }).meetingExtras = null;
						}
					}
					d.version = 8;
				});
				await saveDoc();
			}

			// Migrate: add top-level actionItems collection (v8 -> v9) so
			// extracted drafts can be promoted to persistent entities with
			// status tracking.
			if ((doc.version ?? 0) < 9) {
				doc = Automerge.change(doc, (d) => {
					if (!d.actionItems) d.actionItems = {};
					d.version = 9;
				});
				await saveDoc();
			}

			// Migrate: add reminderProposals collection (v9 -> v10) for the
			// Phase 9 controlled action layer. Proposals are persisted
			// forever as an audit trail.
			if ((doc.version ?? 0) < 10) {
				doc = Automerge.change(doc, (d) => {
					if (!d.reminderProposals) d.reminderProposals = {};
					d.version = 10;
				});
				await saveDoc();
			}

			// Migrate: add draftProposals collection (v10 -> v11). Same
			// audit-log semantics as reminderProposals.
			if ((doc.version ?? 0) < 11) {
				doc = Automerge.change(doc, (d) => {
					if (!d.draftProposals) d.draftProposals = {};
					d.version = 11;
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

// Fire-and-forget deletion of any blob refs and the cached embedding for
// a memory. Used when permanently deleting memories so blobs and vectors
// don't leak in IndexedDB.
function deleteBlobsForMemory(memory: MemoryObject): void {
	if (memory.rawAudioRef) {
		void deleteBlob(memory.rawAudioRef);
	}
	if (memory.rawMediaRef) {
		void deleteBlob(memory.rawMediaRef);
	}
	void deleteEmbedding(memory.id);
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
 * Create a meeting memory from a recording or upload. Same shape as a voice
 * memo but with type='meeting' and meetingExtras populated with capture
 * metadata so the post-transcribe pipeline knows to run summarizeMeeting().
 */
export function addMeetingMemo(options: {
	title: string;
	rawAudioRef: string;
	captureMode: import('./types').CaptureMode;
	folderId?: string | null;
	startedAt?: number;
	endedAt?: number | null;
}): MemoryObject {
	if (!doc) {
		console.error('Cannot add meeting: database not initialized');
		doc = Automerge.from<KurumiDocument>(createEmptyDocument());
		docStore.set(doc);
	}
	const vaultId = getCurrentVaultId();
	const memory = createMemoryObject({
		type: 'meeting',
		title: options.title,
		folderId: options.folderId ?? null,
		vaultId
	});
	memory.rawAudioRef = options.rawAudioRef;
	memory.processingState = 'pending';
	memory.meetingExtras = {
		captureMode: options.captureMode,
		startedAt: options.startedAt ?? Date.now(),
		endedAt: options.endedAt ?? null,
		actionItems: [],
		unresolvedQuestions: [],
		followUpSuggestions: []
	};
	updateDoc((d) => {
		d.memoryObjects[memory.id] = memory;
	});
	return memory;
}

/**
 * Run the post-capture pipeline on a voice memo's audio:
 *   1. Transcribe via the first registered provider that supports it.
 *   2. If transcription succeeds, run summarize() and generateTitle() in
 *      parallel through the inference router. The local text provider runs
 *      first when enabled, with the remote provider as a fallback.
 *
 * processingState reflects the current phase: pending → transcribing →
 * summarizing → ready (or failed with processingError set).
 *
 * Each step degrades gracefully: if no transcribe provider is configured,
 * the memory is marked ready and no summary runs. If transcription succeeds
 * but no text provider can summarize, the transcript still lands and the
 * summary is just skipped.
 */
/**
 * Re-run the post-capture pipeline on an existing memory by id. Looks up
 * the audio blob from the blob store and feeds it back into
 * transcribeMemoryAudio. Used for the "Transcribe" / "Retry" button on the
 * memory page so users can recover memos that got stuck (model wasn't
 * downloaded, network failed, app was on an older code version, etc.).
 */
export async function retryMemoryProcessing(memoryId: string): Promise<void> {
	const memory = doc?.memoryObjects[memoryId];
	if (!memory || !memory.rawAudioRef) {
		return;
	}
	const stored = await getBlob(memory.rawAudioRef);
	if (!stored) {
		updateMemoryObject(memoryId, {
			processingState: 'failed',
			processingError: 'Audio blob not found in local storage'
		});
		return;
	}
	await transcribeMemoryAudio(memoryId, stored.blob, stored.mimeType);
}

export async function transcribeMemoryAudio(
	memoryId: string,
	audio: Blob,
	mimeType: string
): Promise<void> {
	const transcribeProvider = inferenceRouter.findProvider((cap) => cap.supportsTranscribe);
	if (!transcribeProvider) {
		updateMemoryObject(memoryId, { processingState: 'ready', processingError: null });
		return;
	}

	updateMemoryObject(memoryId, { processingState: 'transcribing', processingError: null });

	let transcriptText = '';
	try {
		const result = await transcribeProvider.transcribe({ audio, mimeType });
		if (!result.ok || !result.value) {
			updateMemoryObject(memoryId, {
				processingState: 'failed',
				processingError: result.error ?? 'Transcription failed'
			});
			return;
		}

		transcriptText = result.value.text;
		updateDoc((d) => {
			const memory = d.memoryObjects[memoryId];
			if (!memory) return;
			memory.transcript = result.value!.text;
			memory.processingState = 'summarizing';
			memory.processingError = null;
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
			processingError: err instanceof Error ? err.message : 'Transcription error'
		});
		return;
	}

	// --- Summarization + title pass --------------------------------------
	if (transcriptText.length === 0) {
		updateMemoryObject(memoryId, { processingState: 'ready' });
		return;
	}

	const memoryType = doc?.memoryObjects[memoryId]?.type;

	// Entity extraction runs in parallel with summarization for both meeting
	// and voice-memo paths. The pipeline degrades gracefully if no provider
	// supports it (returns null → we just skip the storage step).
	const entitiesPromise = runFirstSuccessful((p) =>
		p.extractEntities({ text: transcriptText })
	);

	// Reminder proposal extraction also runs in parallel. Anchored to
	// the memory's capturedAt so "tomorrow" resolves relative to when
	// the memo was taken, not when we happen to process it.
	const anchorDate = (() => {
		const captured = doc?.memoryObjects[memoryId]?.capturedAt ?? Date.now();
		return new Date(captured).toISOString().split('T')[0];
	})();
	const remindersPromise = runFirstSuccessful((p) =>
		p.proposeReminders({ text: transcriptText, anchorDate })
	);
	const draftsPromise = runFirstSuccessful((p) =>
		p.proposeDrafts({ text: transcriptText, anchorDate })
	);

	if (memoryType === 'meeting') {
		// Meetings get a structured summary with action items, decisions, etc.
		const [meetingSummary, entities, reminders, drafts] = await Promise.all([
			runFirstSuccessful((p) => p.summarizeMeeting({ transcript: transcriptText })),
			entitiesPromise,
			remindersPromise,
			draftsPromise
		]);

		updateDoc((d) => {
			const memory = d.memoryObjects[memoryId];
			if (!memory) return;
			if (meetingSummary) {
				if (meetingSummary.summaryShort) memory.summaryShort = meetingSummary.summaryShort;
				if (meetingSummary.summaryLong) memory.summaryLong = meetingSummary.summaryLong;

				// Replace decisions and topics arrays (Automerge needs in-place mutation)
				memory.decisions.splice(0, memory.decisions.length);
				for (const d2 of meetingSummary.decisions) memory.decisions.push(d2);

				memory.topics.splice(0, memory.topics.length);
				for (const t of meetingSummary.keyTopics) memory.topics.push(t);

				// Stuff the meeting-specific bits into meetingExtras
				const existing = memory.meetingExtras;
				memory.meetingExtras = {
					captureMode: existing?.captureMode ?? 'in-person-meeting',
					startedAt: existing?.startedAt ?? memory.capturedAt,
					endedAt: existing?.endedAt ?? null,
					actionItems: meetingSummary.actionItems.map((a) => ({
						text: a.text,
						assignee: a.assignee,
						dueDate: a.dueDate
					})),
					unresolvedQuestions: [...meetingSummary.unresolvedQuestions],
					followUpSuggestions: [...meetingSummary.followUpSuggestions]
				};

				// Auto-title if user hasn't set one
				if (meetingSummary.title) {
					const looksAutoTitled =
						memory.title.startsWith('Meeting —') ||
						memory.title.startsWith('Voice memo —') ||
						memory.title === 'Untitled';
					if (looksAutoTitled) {
						memory.title = meetingSummary.title;
					}
				}
			}

			// Merge extracted entities into the memory's participant/project/topic
			// arrays. The summarizeMeeting result already populated participants
			// for meetings, so we union with anything extractEntities found that
			// isn't already there.
			applyExtractedEntities(memory, entities, meetingSummary?.participants ?? []);

			memory.processingState = 'ready';
			memory.processingError = null;
			memory.updatedAt = Date.now();
		});
		// Promote meeting action item drafts into persistent ActionItem
		// entities so they surface on the /actions dashboard. Safe to call
		// repeatedly (dedupes by text).
		promoteDraftActionItems(memoryId);
		// Stash any extracted reminders / drafts as pending proposals.
		if (reminders) stashReminderProposals(memoryId, reminders);
		if (drafts) stashDraftProposals(memoryId, drafts);
		// Refresh the embedding so semantic search picks up the new transcript
		// + summary immediately rather than waiting for the next ask.
		void embedMemory(memoryId);
		return;
	}

	// Voice memo / default path: simple summary + title + entities
	const [summary, title, entities, reminders, drafts] = await Promise.all([
		runFirstSuccessful((p) => p.summarize({ text: transcriptText, style: 'short' })),
		runFirstSuccessful((p) => p.generateTitle({ text: transcriptText })),
		entitiesPromise,
		remindersPromise,
		draftsPromise
	]);

	updateDoc((d) => {
		const memory = d.memoryObjects[memoryId];
		if (!memory) return;
		if (summary && summary.length > 0) {
			memory.summaryShort = summary;
		}
		if (title && title.length > 0) {
			// Only auto-rename if the title still looks auto-generated.
			// This is a deliberately loose check — if the user has typed a
			// real title, we don't want to clobber it.
			const looksAutoTitled =
				memory.title.startsWith('Voice memo —') || memory.title === 'Untitled';
			if (looksAutoTitled) {
				memory.title = title;
			}
		}

		applyExtractedEntities(memory, entities, []);

		memory.processingState = 'ready';
		memory.processingError = null;
		memory.updatedAt = Date.now();
	});
	if (reminders) stashReminderProposals(memoryId, reminders);
	if (drafts) stashDraftProposals(memoryId, drafts);
	// Refresh the embedding so semantic search picks up the new transcript
	// + summary immediately rather than waiting for the next ask.
	void embedMemory(memoryId);
}

/**
 * Manually run reminder + draft extraction against a memory. Works for
 * any memory type — the audio pipeline runs it automatically after
 * transcription, but notes need an explicit trigger. Uses the memory's
 * transcript (if present) otherwise its bodyMarkdown, and anchors
 * relative dates to capturedAt.
 *
 * Returns an object with the count of NEW reminders and NEW drafts
 * created (dedupe drops repeats). Both fields are -1 if no provider
 * supports the task or the memory has no processable text.
 */
export async function extractRemindersFromMemory(
	memoryId: string
): Promise<{ reminders: number; drafts: number }> {
	if (!doc) return { reminders: -1, drafts: -1 };
	const memory = doc.memoryObjects[memoryId];
	if (!memory) return { reminders: -1, drafts: -1 };

	const text = (memory.transcript?.trim() || memory.bodyMarkdown?.trim()) ?? '';
	if (!text) return { reminders: -1, drafts: -1 };

	const anchorDate = new Date(memory.capturedAt ?? Date.now())
		.toISOString()
		.split('T')[0];

	const [reminders, drafts] = await Promise.all([
		runFirstSuccessful((p) => p.proposeReminders({ text, anchorDate })),
		runFirstSuccessful((p) => p.proposeDrafts({ text, anchorDate }))
	]);

	let remindersAdded = -1;
	if (reminders) {
		const before = Object.values(doc.reminderProposals ?? {}).filter(
			(p) => p.memoryObjectId === memoryId
		).length;
		stashReminderProposals(memoryId, reminders);
		const after = Object.values(doc.reminderProposals ?? {}).filter(
			(p) => p.memoryObjectId === memoryId
		).length;
		remindersAdded = after - before;
	}

	let draftsAdded = -1;
	if (drafts) {
		const before = Object.values(doc.draftProposals ?? {}).filter(
			(p) => p.memoryObjectId === memoryId
		).length;
		stashDraftProposals(memoryId, drafts);
		const after = Object.values(doc.draftProposals ?? {}).filter(
			(p) => p.memoryObjectId === memoryId
		).length;
		draftsAdded = after - before;
	}

	return { reminders: remindersAdded, drafts: draftsAdded };
}

/**
 * Persist extracted reminders as pending proposals. Dedupes against
 * existing proposals for the same memory by exact text + suggestedDate
 * pair so re-running the pipeline doesn't create duplicates.
 */
function stashReminderProposals(
	memoryId: string,
	reminders: Array<{
		text: string;
		suggestedDate: string;
		reason: string | null;
		confidence: number;
	}>
): void {
	if (!doc || reminders.length === 0) return;
	const existing = new Set<string>();
	for (const p of Object.values(doc.reminderProposals ?? {})) {
		if (p.memoryObjectId === memoryId) {
			existing.add(`${p.text}|${p.suggestedDate}`);
		}
	}
	for (const r of reminders) {
		const key = `${r.text}|${r.suggestedDate}`;
		if (existing.has(key)) continue;
		addReminderProposal({
			memoryObjectId: memoryId,
			text: r.text,
			suggestedDate: r.suggestedDate,
			reason: r.reason,
			confidence: r.confidence
		});
		existing.add(key);
	}
}

/**
 * Merge extractEntities() results into the memory's participants/projects/
 * topics arrays. Dedupes case-insensitively against existing values.
 * `seedParticipants` is an optional list (e.g. from summarizeMeeting) that's
 * unioned in alongside the LLM's entity extraction.
 */
function applyExtractedEntities(
	memory: MemoryObject,
	entities: Array<{ type: string; canonicalName: string }> | null,
	seedParticipants: string[]
): void {
	const personNames = new Set<string>();
	const projectNames = new Set<string>();
	const topicNames = new Set<string>();
	const orgNames = new Set<string>();

	for (const seed of seedParticipants) {
		if (seed) personNames.add(seed.trim());
	}

	if (entities) {
		for (const entity of entities) {
			const name = entity.canonicalName.trim();
			if (!name) continue;
			switch (entity.type) {
				case 'person':
					personNames.add(name);
					break;
				case 'project':
					projectNames.add(name);
					break;
				case 'topic':
					topicNames.add(name);
					break;
				case 'organization':
					orgNames.add(name);
					break;
			}
		}
	}

	mergeIntoArray(memory.participants, [...personNames]);
	mergeIntoArray(memory.projects, [...projectNames]);
	mergeIntoArray(memory.topics, [...topicNames]);
	// Organizations don't have a dedicated field on MemoryObject; surface them
	// as topics for now so they're at least findable. Can be split out later.
	mergeIntoArray(memory.topics, [...orgNames]);
}

/**
 * Push items into an existing Automerge array, deduplicating against the
 * existing entries case-insensitively. Mutates `target` in place.
 */
function mergeIntoArray(target: string[], incoming: string[]): void {
	const existing = new Set(target.map((v) => v.toLowerCase()));
	for (const item of incoming) {
		if (!existing.has(item.toLowerCase())) {
			target.push(item);
			existing.add(item.toLowerCase());
		}
	}
}

/**
 * Walk every registered provider in priority order and return the first
 * successful result. Returns null if no provider produces a value (e.g. no
 * provider supports the task or every one errors). Generic over the result
 * value type so callers can use it for both string-typed and structured
 * results (meeting summaries, etc.).
 */
async function runFirstSuccessful<T>(
	call: (provider: import('$lib/inference').InferenceProvider) => Promise<{
		ok: boolean;
		value?: T;
		error?: string;
	}>
): Promise<T | null> {
	for (const provider of inferenceRouter.allProviders()) {
		try {
			const result = await call(provider);
			if (result.ok && result.value !== undefined) {
				return result.value;
			}
		} catch {
			// Try next provider
		}
	}
	return null;
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
		if (updates.processingError !== undefined) memory.processingError = updates.processingError;
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

/**
 * Restore a deleted person exactly as it was, preserving id. Used by
 * undo.
 */
export function restorePerson(person: Person): void {
	updateDoc((d) => {
		if (!d.people) d.people = {};
		d.people[person.id] = deepCopy(person);
	});
}

/**
 * Merge two people entries. The source is deleted after moving its
 * metadata into the target and rewriting every reference across
 * memories and action items:
 *
 * 1. Markdown bodies: @Source → @Target (whole-word match on the name)
 * 2. memory.participants: replace Source with Target, dedupe
 * 3. actionItem.assignee: replace Source with Target
 * 4. Target person gets any email/phone/company/title/customFields
 *    from the source that the target was missing
 *
 * The rewrite keeps IDs, so backlinks / search results / embeddings
 * stay valid.
 */
export function mergePeople(sourceId: string, targetId: string): void {
	if (sourceId === targetId) return;
	updateDoc((d) => {
		const source = d.people?.[sourceId];
		const target = d.people?.[targetId];
		if (!source || !target) return;

		// Fill in missing fields on the target from the source
		if (!target.email && source.email) target.email = source.email;
		if (!target.phone && source.phone) target.phone = source.phone;
		if (!target.company && source.company) target.company = source.company;
		if (!target.title && source.title) target.title = source.title;
		if (source.customFields) {
			target.customFields = { ...(target.customFields ?? {}), ...source.customFields };
		}
		target.modified = Date.now();

		// Rewrite markdown bodies: @Source → @Target. Escape regex
		// metacharacters in the source name and require a word boundary
		// so "Alice" doesn't match inside "Alice Smith".
		const sourceEsc = source.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		const atRegex = new RegExp(`@${sourceEsc}(?![A-Za-z])`, 'g');
		for (const memory of Object.values(d.memoryObjects)) {
			if (memory.vaultId !== target.vaultId) continue;

			if (atRegex.test(memory.bodyMarkdown)) {
				memory.bodyMarkdown = memory.bodyMarkdown.replace(atRegex, `@${target.name}`);
				memory.updatedAt = Date.now();
			}
			atRegex.lastIndex = 0;

			// Replace source name inside participants array, dedupe
			const participants = memory.participants ?? [];
			let changed = false;
			const next: string[] = [];
			const seen = new Set<string>();
			for (const p of participants) {
				const replacement = p.toLowerCase() === source.name.toLowerCase() ? target.name : p;
				if (replacement !== p) changed = true;
				const key = replacement.toLowerCase();
				if (seen.has(key)) {
					changed = true;
					continue;
				}
				seen.add(key);
				next.push(replacement);
			}
			if (changed) {
				memory.participants.splice(0, memory.participants.length);
				for (const p of next) memory.participants.push(p);
				memory.updatedAt = Date.now();
			}
		}

		// Rewrite action item assignees (freeform name match)
		if (d.actionItems) {
			for (const item of Object.values(d.actionItems)) {
				if (item.assignee && item.assignee.toLowerCase() === source.name.toLowerCase()) {
					item.assignee = target.name;
					item.updatedAt = Date.now();
				}
			}
		}

		// Finally drop the source Person
		delete d.people![sourceId];
	});
}

/**
 * Propose pairs of people that look like duplicates. Uses a cheap
 * heuristic:
 *
 * - case-insensitive exact name match (guaranteed dupe)
 * - one name is a prefix of the other (e.g. "Alice" vs "Alice Smith")
 * - normalized (letters only, lowercased) strings are equal
 *
 * Returns pairs sorted with the lower-count candidate as the source
 * (so merges default to moving fewer refs). Fuzzy matching (Levenshtein,
 * phonetic) is intentionally out of scope for the first pass.
 */
export function proposePersonMerges(): Array<{ source: Person; target: Person }> {
	if (!doc?.people) return [];
	const vaultId = getCurrentVaultId();
	const list = Object.values(doc.people).filter((p) => p.vaultId === vaultId);
	const proposals: Array<{ source: Person; target: Person; score: number }> = [];

	const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');

	for (let i = 0; i < list.length; i++) {
		for (let j = i + 1; j < list.length; j++) {
			const a = list[i];
			const b = list[j];
			const aLower = a.name.toLowerCase();
			const bLower = b.name.toLowerCase();

			if (aLower === bLower) {
				proposals.push({ source: b, target: a, score: 3 });
				continue;
			}

			if (
				aLower !== bLower &&
				(aLower.startsWith(bLower + ' ') || bLower.startsWith(aLower + ' '))
			) {
				// Prefer the longer name as target.
				if (a.name.length >= b.name.length) {
					proposals.push({ source: b, target: a, score: 2 });
				} else {
					proposals.push({ source: a, target: b, score: 2 });
				}
				continue;
			}

			if (norm(a.name) === norm(b.name)) {
				proposals.push({ source: b, target: a, score: 1 });
			}
		}
	}

	return proposals
		.sort((a, b) => b.score - a.score)
		.map(({ source, target }) => ({ source, target }));
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

/**
 * Format a date for the daily note title. Uses a single consistent format
 * (`YYYY-MM-DD`) so lookups are deterministic across vaults.
 */
export function dailyNoteTitle(isoDate: string): string {
	return `Daily • ${isoDate}`;
}

/**
 * Find an existing daily note for a given ISO date (YYYY-MM-DD), or create
 * one from the "Daily Journal" template if none exists yet. Returns the
 * memory. Date variables in the template are resolved relative to the
 * requested date, not "today", so past dates generate correct weekday
 * names.
 */
export function getOrCreateDailyNote(isoDate: string): MemoryObject {
	const vaultId = getCurrentVaultId();
	const expectedTitle = dailyNoteTitle(isoDate);

	// Look up by title within current vault (excludes soft-deleted).
	if (doc?.memoryObjects) {
		for (const m of Object.values(doc.memoryObjects)) {
			if (
				m.vaultId === vaultId &&
				!m.deletedAt &&
				m.title === expectedTitle
			) {
				return m;
			}
		}
	}

	const template = getTemplateByName('Daily Journal');
	const body = template
		? applyTemplateVariables(template.content, { date: isoDate })
		: `# ${isoDate}\n\n`;

	return addMemoryObject(expectedTitle, body, null);
}

/**
 * Today's date in ISO (YYYY-MM-DD) format, local timezone. Kept here so
 * callers share one definition and the "Today" button always matches the
 * daily note route.
 */
export function todayIso(): string {
	const now = new Date();
	const y = now.getFullYear();
	const m = String(now.getMonth() + 1).padStart(2, '0');
	const d = String(now.getDate()).padStart(2, '0');
	return `${y}-${m}-${d}`;
}

export function updateTemplate(
	id: string,
	updates: { name?: string; content?: string; description?: string }
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

// ============ ActionItem CRUD ============

export function addActionItem(options: {
	memoryObjectId?: string | null;
	text: string;
	assignee?: string | null;
	dueDate?: string | null;
	status?: ActionItemStatus;
	confidence?: number;
}): ActionItem {
	const now = Date.now();
	const item: ActionItem = {
		id: generateId(),
		memoryObjectId: options.memoryObjectId ?? null,
		text: options.text,
		assignee: options.assignee ?? null,
		dueDate: options.dueDate ?? null,
		status: options.status ?? 'open',
		confidence: options.confidence ?? 1,
		vaultId: getCurrentVaultId(),
		createdAt: now,
		updatedAt: now
	};
	updateDoc((d) => {
		if (!d.actionItems) d.actionItems = {};
		d.actionItems[item.id] = item;
		// Also record the id on the source memory for fast lookup.
		if (options.memoryObjectId) {
			const memory = d.memoryObjects[options.memoryObjectId];
			if (memory && !memory.actionItems.includes(item.id)) {
				memory.actionItems.push(item.id);
			}
		}
	});
	return item;
}

export function updateActionItemStatus(id: string, status: ActionItemStatus): void {
	updateDoc((d) => {
		const item = d.actionItems?.[id];
		if (item) {
			item.status = status;
			item.updatedAt = Date.now();
		}
	});
}

export function updateActionItem(
	id: string,
	updates: { text?: string; assignee?: string | null; dueDate?: string | null }
): void {
	updateDoc((d) => {
		const item = d.actionItems?.[id];
		if (!item) return;
		if (updates.text !== undefined) item.text = updates.text;
		if (updates.assignee !== undefined) item.assignee = updates.assignee;
		if (updates.dueDate !== undefined) item.dueDate = updates.dueDate;
		item.updatedAt = Date.now();
	});
}

export function deleteActionItem(id: string): void {
	updateDoc((d) => {
		const item = d.actionItems?.[id];
		if (!item) return;
		if (item.memoryObjectId) {
			const memory = d.memoryObjects[item.memoryObjectId];
			if (memory) {
				memory.actionItems = memory.actionItems.filter((x) => x !== id);
			}
		}
		delete d.actionItems![id];
	});
}

/**
 * Restore an action item exactly as it was, preserving its id. Used
 * by the undo stack — a plain addActionItem would generate a new id
 * and break any existing references (e.g. the source memory's
 * actionItems array).
 */
export function restoreActionItem(item: ActionItem): void {
	updateDoc((d) => {
		if (!d.actionItems) d.actionItems = {};
		d.actionItems[item.id] = deepCopy(item);
		if (item.memoryObjectId) {
			const memory = d.memoryObjects[item.memoryObjectId];
			if (memory && !memory.actionItems.includes(item.id)) {
				memory.actionItems.push(item.id);
			}
		}
	});
}

// ============ ReminderProposal CRUD ============

export function addReminderProposal(options: {
	memoryObjectId: string;
	text: string;
	suggestedDate: string;
	reason?: string | null;
	confidence?: number;
}): ReminderProposal {
	const now = Date.now();
	const proposal: ReminderProposal = {
		id: generateId(),
		memoryObjectId: options.memoryObjectId,
		text: options.text,
		suggestedDate: options.suggestedDate,
		reason: options.reason ?? null,
		confidence: options.confidence ?? 0.8,
		status: 'pending',
		vaultId: getCurrentVaultId(),
		createdAt: now,
		decidedAt: null,
		actionItemId: null
	};
	updateDoc((d) => {
		if (!d.reminderProposals) d.reminderProposals = {};
		d.reminderProposals[proposal.id] = proposal;
	});
	return proposal;
}

/**
 * Approve a pending proposal: creates an ActionItem linked to the
 * source memory (status 'open', due date = suggestedDate) and stamps
 * the proposal with the new action item id so re-approval is
 * idempotent.
 */
export function approveReminderProposal(id: string): void {
	if (!doc) return;
	const proposal = doc.reminderProposals?.[id];
	if (!proposal || proposal.status === 'approved') return;

	const actionItem = addActionItem({
		memoryObjectId: proposal.memoryObjectId,
		text: proposal.text,
		dueDate: proposal.suggestedDate,
		confidence: proposal.confidence
	});

	updateDoc((d) => {
		const p = d.reminderProposals?.[id];
		if (!p) return;
		p.status = 'approved';
		p.decidedAt = Date.now();
		p.actionItemId = actionItem.id;
	});
}

export function rejectReminderProposal(id: string): void {
	updateDoc((d) => {
		const p = d.reminderProposals?.[id];
		if (!p) return;
		p.status = 'rejected';
		p.decidedAt = Date.now();
	});
}

export function snoozeReminderProposal(id: string, newDate: string): void {
	updateDoc((d) => {
		const p = d.reminderProposals?.[id];
		if (!p) return;
		p.suggestedDate = newDate;
		p.status = 'snoozed';
		p.decidedAt = Date.now();
	});
}

/**
 * Revert a previously decided proposal back to pending. Useful if the
 * user changes their mind, or if the approval created an ActionItem
 * they then deleted and want to re-create.
 */
export function reopenReminderProposal(id: string): void {
	updateDoc((d) => {
		const p = d.reminderProposals?.[id];
		if (!p) return;
		p.status = 'pending';
		p.decidedAt = null;
		p.actionItemId = null;
	});
}

export function deleteReminderProposal(id: string): void {
	updateDoc((d) => {
		if (d.reminderProposals) delete d.reminderProposals[id];
	});
}

/**
 * Restore a reminder proposal exactly as it was, preserving id and
 * any linked actionItemId. Used by undo.
 */
export function restoreReminderProposal(proposal: ReminderProposal): void {
	updateDoc((d) => {
		if (!d.reminderProposals) d.reminderProposals = {};
		d.reminderProposals[proposal.id] = deepCopy(proposal);
	});
}

// ============ DraftProposal CRUD ============

export function addDraftProposal(options: {
	memoryObjectId: string;
	kind: DraftKind;
	target?: string | null;
	subject: string;
	body: string;
	suggestedDate?: string | null;
	suggestedTime?: string | null;
	confidence?: number;
}): DraftProposal {
	const now = Date.now();
	const draft: DraftProposal = {
		id: generateId(),
		memoryObjectId: options.memoryObjectId,
		kind: options.kind,
		target: options.target ?? null,
		subject: options.subject,
		body: options.body,
		suggestedDate: options.suggestedDate ?? null,
		suggestedTime: options.suggestedTime ?? null,
		confidence: options.confidence ?? 0.7,
		status: 'pending',
		vaultId: getCurrentVaultId(),
		createdAt: now,
		decidedAt: null
	};
	updateDoc((d) => {
		if (!d.draftProposals) d.draftProposals = {};
		d.draftProposals[draft.id] = draft;
	});
	return draft;
}

export function markDraftUsed(id: string): void {
	updateDoc((d) => {
		const draft = d.draftProposals?.[id];
		if (!draft) return;
		draft.status = 'used';
		draft.decidedAt = Date.now();
	});
}

export function rejectDraftProposal(id: string): void {
	updateDoc((d) => {
		const draft = d.draftProposals?.[id];
		if (!draft) return;
		draft.status = 'rejected';
		draft.decidedAt = Date.now();
	});
}

export function deleteDraftProposal(id: string): void {
	updateDoc((d) => {
		if (d.draftProposals) delete d.draftProposals[id];
	});
}

/**
 * Restore a draft proposal exactly as it was, preserving id. Used by
 * undo.
 */
export function restoreDraftProposal(draft: DraftProposal): void {
	updateDoc((d) => {
		if (!d.draftProposals) d.draftProposals = {};
		d.draftProposals[draft.id] = deepCopy(draft);
	});
}

/**
 * Stash extracted drafts as pending proposals, dedupe by
 * memoryId + kind + subject so retries don't create duplicates.
 */
function stashDraftProposals(
	memoryId: string,
	drafts: Array<{
		kind: DraftKind;
		target: string | null;
		subject: string;
		body: string;
		suggestedDate: string | null;
		suggestedTime: string | null;
		confidence: number;
	}>
): void {
	if (!doc || drafts.length === 0) return;
	const existing = new Set<string>();
	for (const p of Object.values(doc.draftProposals ?? {})) {
		if (p.memoryObjectId === memoryId) {
			existing.add(`${p.kind}|${p.subject}`);
		}
	}
	for (const d2 of drafts) {
		const key = `${d2.kind}|${d2.subject}`;
		if (existing.has(key)) continue;
		addDraftProposal({
			memoryObjectId: memoryId,
			kind: d2.kind,
			target: d2.target,
			subject: d2.subject,
			body: d2.body,
			suggestedDate: d2.suggestedDate,
			suggestedTime: d2.suggestedTime,
			confidence: d2.confidence
		});
		existing.add(key);
	}
}

/**
 * Promote the draft action items sitting on a meeting's meetingExtras
 * into top-level ActionItem entities. Called after meeting summarization
 * completes. Safe to call repeatedly — drafts already promoted (matched
 * by text) are skipped.
 */
export function promoteDraftActionItems(memoryId: string): void {
	if (!doc) return;
	const memory = doc.memoryObjects[memoryId];
	if (!memory || !memory.meetingExtras) return;
	const existingIds = new Set(memory.actionItems);
	const existingTexts = new Set(
		memory.actionItems
			.map((id) => doc!.actionItems?.[id]?.text)
			.filter((t): t is string => typeof t === 'string')
	);
	const drafts = memory.meetingExtras.actionItems as MeetingActionItemDraft[];
	for (const draft of drafts) {
		if (existingTexts.has(draft.text)) continue;
		const item = addActionItem({
			memoryObjectId: memoryId,
			text: draft.text,
			assignee: draft.assignee,
			dueDate: draft.dueDate
		});
		existingIds.add(item.id);
	}
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
	const now = overrides?.date ? new Date(overrides.date + 'T00:00:00') : new Date();
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
		events: localDoc.events || {},
		actionItems: localDoc.actionItems || {},
		reminderProposals: localDoc.reminderProposals || {},
		draftProposals: localDoc.draftProposals || {}
	});
	const remoteData = deepCopy({
		vaults: remoteDoc.vaults || {},
		folders: remoteDoc.folders || {},
		memoryObjects: remoteDoc.memoryObjects || {},
		people: remoteDoc.people || {},
		events: remoteDoc.events || {},
		actionItems: remoteDoc.actionItems || {},
		reminderProposals: remoteDoc.reminderProposals || {},
		draftProposals: remoteDoc.draftProposals || {}
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

		// Merge action items
		if (!d.actionItems) d.actionItems = {};
		const allActionIds = new Set([
			...Object.keys(localData.actionItems),
			...Object.keys(remoteData.actionItems)
		]);
		for (const id of allActionIds) {
			const newest = pickNewestBy(
				localData.actionItems[id],
				remoteData.actionItems[id],
				byUpdatedAt
			);
			if (newest) {
				d.actionItems[id] = newest;
			}
		}

		// Merge reminder proposals. These don't have updatedAt; use a
		// preference for decided > pending (so an approval on one device
		// wins over a still-pending copy on another), then fall back to
		// createdAt.
		if (!d.reminderProposals) d.reminderProposals = {};
		const allProposalIds = new Set([
			...Object.keys(localData.reminderProposals),
			...Object.keys(remoteData.reminderProposals)
		]);
		for (const id of allProposalIds) {
			const local = localData.reminderProposals[id];
			const remote = remoteData.reminderProposals[id];
			if (!local && remote) {
				d.reminderProposals[id] = remote;
			} else if (local && !remote) {
				d.reminderProposals[id] = local;
			} else if (local && remote) {
				// Prefer the side that's been decided (has a non-null decidedAt).
				const localDecided = local.decidedAt != null;
				const remoteDecided = remote.decidedAt != null;
				if (localDecided && !remoteDecided) {
					d.reminderProposals[id] = local;
				} else if (remoteDecided && !localDecided) {
					d.reminderProposals[id] = remote;
				} else if (localDecided && remoteDecided) {
					d.reminderProposals[id] =
						(local.decidedAt ?? 0) >= (remote.decidedAt ?? 0) ? local : remote;
				} else {
					d.reminderProposals[id] =
						local.createdAt >= remote.createdAt ? local : remote;
				}
			}
		}

		// Merge draft proposals — same decided-wins strategy
		if (!d.draftProposals) d.draftProposals = {};
		const allDraftIds = new Set([
			...Object.keys(localData.draftProposals),
			...Object.keys(remoteData.draftProposals)
		]);
		for (const id of allDraftIds) {
			const local = localData.draftProposals[id];
			const remote = remoteData.draftProposals[id];
			if (!local && remote) {
				d.draftProposals[id] = remote;
			} else if (local && !remote) {
				d.draftProposals[id] = local;
			} else if (local && remote) {
				const localDecided = local.decidedAt != null;
				const remoteDecided = remote.decidedAt != null;
				if (localDecided && !remoteDecided) d.draftProposals[id] = local;
				else if (remoteDecided && !localDecided) d.draftProposals[id] = remote;
				else if (localDecided && remoteDecided) {
					d.draftProposals[id] =
						(local.decidedAt ?? 0) >= (remote.decidedAt ?? 0) ? local : remote;
				} else {
					d.draftProposals[id] =
						local.createdAt >= remote.createdAt ? local : remote;
				}
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
			version: 11,
			exportedAt: new Date().toISOString(),
			vaults: [],
			folders: [],
			memoryObjects: [],
			people: [],
			events: []
		});
	const exportData: KurumiExport = {
		version: doc.version || 7,
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
		processingError: null,
		confidenceScores: {},
		embeddingRef: null,
		meetingExtras: null,
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

/**
 * Rename every occurrence of #oldTag in memory bodies (and in the
 * memory.tags arrays) to #newTag across the current vault. Bumps
 * updatedAt so the next sync picks up the change. Returns how many
 * memories were touched.
 *
 * Both inputs are normalized to lowercase; the regex requires a
 * word-boundary-style lookahead so "#projects" doesn't become
 * "#projectsnew" when renaming "projects" → "projectsnew".
 */
export function renameTag(oldTag: string, newTag: string): number {
	if (!doc) return 0;
	const vaultId = getCurrentVaultId();
	const from = oldTag.toLowerCase();
	const to = newTag.toLowerCase();
	if (from === to || !from || !to) return 0;

	// Require word-boundary after the tag so #proj doesn't match inside
	// #projects. Tags allow letters/digits/underscore/hyphen.
	const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const regex = new RegExp(`(^|\\s)#${escaped}(?![a-zA-Z0-9_-])`, 'g');

	let touched = 0;
	updateDoc((d) => {
		for (const memory of Object.values(d.memoryObjects)) {
			if (memory.vaultId !== vaultId) continue;
			if (!regex.test(memory.bodyMarkdown)) {
				regex.lastIndex = 0;
				continue;
			}
			regex.lastIndex = 0;
			memory.bodyMarkdown = memory.bodyMarkdown.replace(regex, `$1#${to}`);

			// Also rewrite the legacy tags array if the old tag is listed
			// (stored lowercase by convention).
			const tagIndex = memory.tags.findIndex((t) => t.toLowerCase() === from);
			if (tagIndex >= 0) {
				memory.tags[tagIndex] = to;
			}

			memory.updatedAt = Date.now();
			touched++;
		}
	});
	return touched;
}

/**
 * Merge one tag into another. Identical to renameTag today — kept as
 * a separate entry point so future work (e.g. keeping the source as
 * an alias) has an obvious hook.
 */
export function mergeTags(sourceTag: string, targetTag: string): number {
	return renameTag(sourceTag, targetTag);
}

/**
 * Propose tag-merge candidates using the same heuristic as
 * proposePersonMerges: exact dupes, prefix matches, letters-only
 * normalized matches. Returns pairs with the lower-count tag as the
 * merge source.
 */
export function proposeTagMerges(): Array<{ source: string; target: string; score: number }> {
	const tags = getAllTags();
	const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
	const proposals: Array<{ source: string; target: string; score: number }> = [];

	for (let i = 0; i < tags.length; i++) {
		for (let j = i + 1; j < tags.length; j++) {
			const a = tags[i];
			const b = tags[j];

			if (a.tag === b.tag) continue; // getAllTags already dedupes; defensive

			// Normalized match — covers "side_project" vs "side-project", etc.
			if (norm(a.tag) === norm(b.tag)) {
				const source = a.count <= b.count ? a : b;
				const target = a.count <= b.count ? b : a;
				proposals.push({ source: source.tag, target: target.tag, score: 3 });
				continue;
			}

			// Prefix match — "proj" vs "project"
			if (
				(a.tag.length > 3 || b.tag.length > 3) &&
				(a.tag.startsWith(b.tag) || b.tag.startsWith(a.tag))
			) {
				// Prefer the longer tag as target (more specific)
				const source = a.tag.length < b.tag.length ? a : b;
				const target = a.tag.length < b.tag.length ? b : a;
				proposals.push({ source: source.tag, target: target.tag, score: 1 });
			}
		}
	}

	return proposals.sort((a, b) => b.score - a.score);
}

/**
 * Return tags that appear in exactly one memory. These are candidates
 * for cleanup — often accidental single-use labels.
 */
export function getLowValueTags(): Array<{ tag: string; count: number }> {
	return getAllTags().filter((t) => t.count <= 1);
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

// Get all unique people across memories in current vault. Combines two
// sources: @-mentions in markdown bodies (via extractPeople regex) AND
// LLM-extracted entities stored in memory.participants. Counts are summed
// case-insensitively.
export function getAllPeople(): { name: string; count: number }[] {
	if (!doc) return [];
	const vaultId = getCurrentVaultId();
	const peopleCounts = new Map<string, { name: string; count: number }>();

	const bump = (rawName: string) => {
		const key = rawName.toLowerCase();
		const existing = peopleCounts.get(key);
		if (existing) {
			existing.count++;
		} else {
			peopleCounts.set(key, { name: rawName, count: 1 });
		}
	};

	for (const memory of Object.values(doc.memoryObjects)) {
		if (memory.vaultId !== vaultId) continue;
		// @-mentions in markdown
		for (const person of extractPeople(memory.bodyMarkdown)) {
			bump(person);
		}
		// LLM-extracted participants from transcripts
		for (const person of memory.participants ?? []) {
			bump(person);
		}
	}

	return Array.from(peopleCounts.values()).sort((a, b) => b.count - a.count);
}

// Get memories mentioning a specific person in current vault. Matches both
// @-mentions in bodyMarkdown and entities in memory.participants.
export function getMemoryObjectsByPerson(name: string): MemoryObject[] {
	if (!doc) return [];
	const vaultId = getCurrentVaultId();
	const target = name.toLowerCase();

	return Object.values(doc.memoryObjects).filter((memory) => {
		if (memory.vaultId !== vaultId) return false;
		const fromMarkdown = extractPeople(memory.bodyMarkdown).some(
			(p) => p.toLowerCase() === target
		);
		if (fromMarkdown) return true;
		return (memory.participants ?? []).some((p) => p.toLowerCase() === target);
	});
}

// Get all unique extracted topics across memories in current vault.
export function getAllExtractedTopics(): { name: string; count: number }[] {
	if (!doc) return [];
	const vaultId = getCurrentVaultId();
	const counts = new Map<string, { name: string; count: number }>();

	for (const memory of Object.values(doc.memoryObjects)) {
		if (memory.vaultId !== vaultId) continue;
		for (const topic of memory.topics ?? []) {
			const key = topic.toLowerCase();
			const existing = counts.get(key);
			if (existing) {
				existing.count++;
			} else {
				counts.set(key, { name: topic, count: 1 });
			}
		}
	}

	return Array.from(counts.values()).sort((a, b) => b.count - a.count);
}

export function getMemoryObjectsByTopic(topic: string): MemoryObject[] {
	if (!doc) return [];
	const vaultId = getCurrentVaultId();
	const target = topic.toLowerCase();

	return Object.values(doc.memoryObjects).filter((memory) => {
		if (memory.vaultId !== vaultId) return false;
		return (memory.topics ?? []).some((t) => t.toLowerCase() === target);
	});
}

/**
 * Rename every occurrence of `oldTopic` in memory.topics arrays across
 * the current vault. Case-insensitive source match. If the target
 * already exists on a memory that also has the source, the source is
 * removed (dedupe). Returns memories touched.
 */
export function renameTopic(oldTopic: string, newTopic: string): number {
	return renameStringInArrays('topics', oldTopic, newTopic);
}

export function mergeTopics(sourceTopic: string, targetTopic: string): number {
	return renameTopic(sourceTopic, targetTopic);
}

/**
 * Generic rename-across-memory-arrays helper used by topic/project/
 * (and in principle any other bare-string array on MemoryObject).
 * Mutates the array in place via Automerge, dedupes against the
 * target, and bumps updatedAt for touched memories.
 */
function renameStringInArrays(
	field: 'topics' | 'projects',
	from: string,
	to: string
): number {
	if (!doc) return 0;
	const vaultId = getCurrentVaultId();
	const fromLower = from.toLowerCase().trim();
	const toTrimmed = to.trim();
	const toLower = toTrimmed.toLowerCase();
	if (!fromLower || !toLower || fromLower === toLower) return 0;

	let touched = 0;
	updateDoc((d) => {
		for (const memory of Object.values(d.memoryObjects)) {
			if (memory.vaultId !== vaultId) continue;
			const arr = memory[field];
			if (!Array.isArray(arr)) continue;
			const fromIndex = arr.findIndex((v) => v.toLowerCase() === fromLower);
			if (fromIndex < 0) continue;

			const hasTarget = arr.some((v) => v.toLowerCase() === toLower);
			if (hasTarget) {
				// Target already present → just remove the source entry.
				arr.splice(fromIndex, 1);
			} else {
				arr[fromIndex] = toTrimmed;
			}

			memory.updatedAt = Date.now();
			touched++;
		}
	});
	return touched;
}

/**
 * Propose topic merges using the same heuristic as
 * proposeTagMerges / proposePersonMerges.
 */
export function proposeTopicMerges(): Array<{
	source: string;
	target: string;
	score: number;
}> {
	return proposeStringMerges(getAllExtractedTopics());
}

export function proposeProjectMerges(): Array<{
	source: string;
	target: string;
	score: number;
}> {
	return proposeStringMerges(getAllExtractedProjects());
}

function proposeStringMerges(
	entries: { name: string; count: number }[]
): Array<{ source: string; target: string; score: number }> {
	const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
	const proposals: Array<{ source: string; target: string; score: number }> = [];

	for (let i = 0; i < entries.length; i++) {
		for (let j = i + 1; j < entries.length; j++) {
			const a = entries[i];
			const b = entries[j];
			const aLower = a.name.toLowerCase();
			const bLower = b.name.toLowerCase();

			if (aLower === bLower) continue;

			if (norm(a.name) === norm(b.name)) {
				const source = a.count <= b.count ? a : b;
				const target = a.count <= b.count ? b : a;
				proposals.push({ source: source.name, target: target.name, score: 3 });
				continue;
			}

			if (
				(a.name.length > 3 || b.name.length > 3) &&
				(aLower.startsWith(bLower + ' ') || bLower.startsWith(aLower + ' '))
			) {
				const source = a.name.length < b.name.length ? a : b;
				const target = a.name.length < b.name.length ? b : a;
				proposals.push({ source: source.name, target: target.name, score: 1 });
			}
		}
	}

	return proposals.sort((a, b) => b.score - a.score);
}

// Get all unique extracted projects across memories in current vault.
export function getAllExtractedProjects(): { name: string; count: number }[] {
	if (!doc) return [];
	const vaultId = getCurrentVaultId();
	const counts = new Map<string, { name: string; count: number }>();

	for (const memory of Object.values(doc.memoryObjects)) {
		if (memory.vaultId !== vaultId) continue;
		for (const project of memory.projects ?? []) {
			const key = project.toLowerCase();
			const existing = counts.get(key);
			if (existing) {
				existing.count++;
			} else {
				counts.set(key, { name: project, count: 1 });
			}
		}
	}

	return Array.from(counts.values()).sort((a, b) => b.count - a.count);
}

export function getMemoryObjectsByProject(project: string): MemoryObject[] {
	if (!doc) return [];
	const vaultId = getCurrentVaultId();
	const target = project.toLowerCase();

	return Object.values(doc.memoryObjects).filter((memory) => {
		if (memory.vaultId !== vaultId) return false;
		return (memory.projects ?? []).some((p) => p.toLowerCase() === target);
	});
}

export function renameProject(oldProject: string, newProject: string): number {
	return renameStringInArrays('projects', oldProject, newProject);
}

export function mergeProjects(sourceProject: string, targetProject: string): number {
	return renameProject(sourceProject, targetProject);
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
 * Get all people with their metadata from Person objects. Combines:
 *   1. @-mentions in memory.bodyMarkdown (typed notes)
 *   2. LLM-extracted entities in memory.participants (voice memos / meetings)
 *   3. Person records in doc.people
 *
 * Names are deduped case-insensitively but the display form preserves the
 * casing of whichever source named the person first.
 */
export function getAllPeopleWithMetadata(): PersonWithMetadata[] {
	if (!doc) return [];
	const vaultId = getCurrentVaultId();
	// Key by lowercased name so "alice" and "Alice" don't double-count.
	const peopleMap = new Map<string, PersonWithMetadata>();

	const addMention = (rawName: string, memory: MemoryObject) => {
		const key = rawName.toLowerCase();
		let entry = peopleMap.get(key);
		if (!entry) {
			entry = {
				name: rawName,
				count: 0,
				person: null,
				mentioningMemories: []
			};
			peopleMap.set(key, entry);
		}
		entry.count++;
		// Avoid double-counting the same memory (markdown + extracted both
		// referencing the same person should only show one mentioning memory).
		if (!entry.mentioningMemories.some((m) => m.id === memory.id)) {
			entry.mentioningMemories.push(memory);
		}
	};

	// First pass: collect mentions from both regex and extracted entities
	for (const memory of Object.values(doc.memoryObjects)) {
		if (memory.vaultId !== vaultId) continue;
		for (const name of extractPeople(memory.bodyMarkdown)) {
			addMention(name, memory);
		}
		for (const name of memory.participants ?? []) {
			addMention(name, memory);
		}
	}

	// Second pass: link Person objects (vault contacts)
	if (doc.people) {
		for (const personObj of Object.values(doc.people)) {
			if (personObj.vaultId !== vaultId) continue;
			const key = personObj.name.toLowerCase();
			const existing = peopleMap.get(key);
			if (existing) {
				existing.person = personObj;
			} else {
				peopleMap.set(key, {
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
