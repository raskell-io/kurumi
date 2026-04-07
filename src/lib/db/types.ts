export const DEFAULT_VAULT_ID = 'default-vault';

// Compact ID generator - 12 chars of base62 (~71 bits of entropy)
const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

export function generateId(length: number = 12): string {
	const bytes = new Uint8Array(length);
	crypto.getRandomValues(bytes);
	let id = '';
	for (let i = 0; i < length; i++) {
		id += BASE62[bytes[i] % 62];
	}
	return id;
}

export interface Vault {
	id: string;
	name: string;
	icon?: string;
	created: number;
	modified: number;
}

export interface Note {
	id: string;
	title: string;
	content: string;
	tags: string[];
	folderId: string | null; // null = root level
	vaultId: string;
	created: number;
	modified: number;
	deletedAt: number | null; // null = not deleted, timestamp = when moved to trash
}

export interface Folder {
	id: string;
	name: string;
	parentId: string | null; // null = root level
	vaultId: string;
	created: number;
	modified: number;
	deletedAt: number | null; // null = not deleted, timestamp = when moved to trash
}

// Reference objects - first-class entities for people and events
export interface Person {
	id: string;
	name: string; // The @Name reference
	email?: string;
	phone?: string;
	company?: string;
	title?: string;
	customFields?: Record<string, string>;
	vaultId: string;
	created: number;
	modified: number;
}

export interface Event {
	id: string;
	date: string; // The //YYYY-MM-DD reference
	title?: string;
	time?: string;
	duration?: string;
	location?: string;
	attendees?: string[];
	customFields?: Record<string, string>;
	vaultId: string;
	created: number;
	modified: number;
}

export interface Template {
	id: string;
	name: string;
	content: string; // Markdown with {variable} placeholders
	description?: string;
	vaultId: string;
	created: number;
	modified: number;
	[key: string]: unknown; // Automerge compatibility
}

// ---------------------------------------------------------------------------
// Memory model (roadmap §7) — durable knowledge objects beyond simple notes.
// These types are the frozen contract for storage, sync, processing, and the
// inference router. They are additive: existing Note/Folder remain untouched.
// ---------------------------------------------------------------------------

export type MemoryType =
	| 'note'
	| 'voice-memo'
	| 'meeting'
	| 'task'
	| 'reference'
	| 'file';

export type MemorySpace = 'personal' | 'work' | 'shared' | 'archive';

export type ProcessingState =
	| 'pending'
	| 'transcribing'
	| 'summarizing'
	| 'extracting'
	| 'ready'
	| 'failed';

export type CaptureMode =
	| 'voice-memo'
	| 'in-person-meeting'
	| 'remote-meeting-basic'
	| 'remote-meeting-enhanced'
	| 'upload';

export type EntityType =
	| 'project'
	| 'person'
	| 'topic'
	| 'place'
	| 'organization'
	| 'source';

export type RelationType =
	| 'relates_to'
	| 'mentions'
	| 'belongs_to_space'
	| 'produced'
	| 'follows'
	| 'blocks'
	| 'depends_on'
	| 'aliases'
	| 'supersedes'
	| 'derived_from';

export type ActionItemStatus = 'open' | 'in_progress' | 'done' | 'cancelled';

export interface TranscriptSegment {
	start: number; // seconds
	end: number;
	speaker?: string;
	text: string;
}

export interface ControlledLabel {
	class: 'type' | 'domain' | 'entity' | 'workflow';
	value: string;
}

export interface MemoryObject {
	id: string;
	type: MemoryType;
	space: MemorySpace;
	parentBucket: string | null; // e.g. "Inbox", "Projects", "Meetings"
	title: string;
	rawText: string | null;
	bodyMarkdown: string | null;
	rawAudioRef: string | null;
	rawMediaRef: string | null;
	transcript: string | null;
	transcriptSegments: TranscriptSegment[];
	summaryShort: string | null;
	summaryLong: string | null;
	createdAt: number;
	updatedAt: number;
	capturedAt: number;
	sourceDevice: string | null;
	sourceContext: string | null;
	language: string | null;
	tags: string[];
	controlledLabels: ControlledLabel[];
	participants: string[]; // entity ids
	entities: string[]; // entity ids
	projects: string[]; // entity ids
	topics: string[]; // entity ids
	dates: string[]; // ISO dates referenced
	actionItems: string[]; // ActionItem ids
	decisions: string[];
	relatedMemoryIds: string[];
	visibilityScope: MemorySpace;
	processingState: ProcessingState;
	confidenceScores: Record<string, number>;
	embeddingRef: string | null;
	vaultId: string;
	deletedAt: number | null;
}

export interface MeetingMetadata {
	memoryObjectId: string;
	captureMode: CaptureMode;
	startedAt: number;
	endedAt: number | null;
	platform: string | null;
	diarizationEnabled: boolean;
	consentNoticeShown: boolean;
	transcriptStatus: ProcessingState;
	summaryStatus: ProcessingState;
}

export interface ActionItem {
	id: string;
	memoryObjectId: string;
	text: string;
	assignee: string | null; // entity id or freeform
	dueDate: string | null; // ISO date
	status: ActionItemStatus;
	confidence: number; // 0..1
	createdAt: number;
	updatedAt: number;
}

export interface Entity {
	id: string;
	type: EntityType;
	canonicalName: string;
	aliases: string[];
	description: string | null;
	links: string[];
	relatedEntityIds: string[];
	vaultId: string;
	createdAt: number;
	updatedAt: number;
}

export interface Relation {
	id: string;
	fromObjectId: string;
	relationType: RelationType;
	toObjectId: string;
	confidence: number; // 0..1
	createdBy: 'user' | 'system' | 'inference';
	createdAt: number;
}

export interface KurumiDocument {
	notes: Record<string, Note>;
	folders: Record<string, Folder>;
	vaults: Record<string, Vault>;
	people: Record<string, Person>;
	events: Record<string, Event>;
	templates: Record<string, Template>;
	currentVaultId: string;
	version: number;
	[key: string]: unknown; // Required for Automerge compatibility
}

export function createDefaultVault(): Vault {
	const now = Date.now();
	return {
		id: DEFAULT_VAULT_ID,
		name: 'Default',
		created: now,
		modified: now
	};
}

export function createVault(name: string, icon?: string): Vault {
	const now = Date.now();
	return {
		id: generateId(),
		name,
		icon,
		created: now,
		modified: now
	};
}

export function createEmptyDocument(): KurumiDocument {
	const defaultVault = createDefaultVault();
	return {
		notes: {},
		folders: {},
		vaults: { [DEFAULT_VAULT_ID]: defaultVault },
		people: {},
		events: {},
		templates: {},
		currentVaultId: DEFAULT_VAULT_ID,
		version: 5
	};
}

export function createNote(
	title: string = 'Untitled',
	content: string = '',
	folderId: string | null = null,
	vaultId: string = DEFAULT_VAULT_ID
): Note {
	const now = Date.now();
	return {
		id: generateId(),
		title,
		content,
		tags: [],
		folderId,
		vaultId,
		created: now,
		modified: now,
		deletedAt: null
	};
}

export function createFolder(
	name: string,
	parentId: string | null = null,
	vaultId: string = DEFAULT_VAULT_ID
): Folder {
	const now = Date.now();
	return {
		id: generateId(),
		name,
		parentId,
		vaultId,
		created: now,
		modified: now,
		deletedAt: null
	};
}

export function createPerson(
	name: string,
	vaultId: string = DEFAULT_VAULT_ID,
	fields?: Partial<Omit<Person, 'id' | 'name' | 'vaultId' | 'created' | 'modified'>>
): Person {
	const now = Date.now();
	return {
		id: generateId(),
		name,
		vaultId,
		created: now,
		modified: now,
		...fields
	};
}

export function createEvent(
	date: string,
	vaultId: string = DEFAULT_VAULT_ID,
	fields?: Partial<Omit<Event, 'id' | 'date' | 'vaultId' | 'created' | 'modified'>>
): Event {
	const now = Date.now();
	return {
		id: generateId(),
		date,
		vaultId,
		created: now,
		modified: now,
		...fields
	};
}

export function createTemplate(
	name: string,
	content: string,
	vaultId: string = DEFAULT_VAULT_ID,
	description?: string
): Template {
	const now = Date.now();
	return {
		id: generateId(),
		name,
		content,
		description,
		vaultId,
		created: now,
		modified: now
	};
}
