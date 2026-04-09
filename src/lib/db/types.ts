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
// MemoryObject is the unified storage shape: text notes, voice memos, meetings,
// tasks, references, and uploaded files all live here, distinguished by `type`.
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

/**
 * Lightweight action item shape used inside MeetingExtras. The full
 * ActionItem entity (with status, confidence, links to Person entities)
 * comes later when there's a real action management UI; for now we just
 * capture the text and any obvious metadata an LLM extracts.
 */
export interface MeetingActionItemDraft {
	text: string;
	assignee: string | null;
	dueDate: string | null;
}

/**
 * Structured output produced by the meeting summarization pipeline.
 * Stored on MemoryObject.meetingExtras when type === 'meeting'.
 */
export interface MeetingExtras {
	captureMode: CaptureMode;
	startedAt: number;
	endedAt: number | null;
	actionItems: MeetingActionItemDraft[];
	unresolvedQuestions: string[];
	followUpSuggestions: string[];
}

export interface MemoryObject {
	id: string;
	type: MemoryType;
	space: MemorySpace;
	parentBucket: string | null; // e.g. "Inbox", "Projects", "Meetings" (spec §6.2 navigation buckets)
	folderId: string | null; // existing nested-folder navigation; deviation from spec to keep folder UX
	title: string;
	rawText: string; // raw captured input; '' for empty
	bodyMarkdown: string; // primary editable markdown body; '' for empty
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
	processingError: string | null;
	confidenceScores: Record<string, number>;
	embeddingRef: string | null;
	meetingExtras: MeetingExtras | null;
	// User-defined properties for database views. Keys match
	// PropertyDefinition.key values from the parent folder's
	// DatabaseView. Values are typed per the definition.
	customProps: Record<string, unknown>;
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

export type Recurrence = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface ActionItem {
	id: string;
	// null for manually-created items that aren't sourced from a memory
	memoryObjectId: string | null;
	text: string;
	assignee: string | null; // entity id or freeform
	dueDate: string | null; // ISO date
	status: ActionItemStatus;
	confidence: number; // 0..1
	// Recurrence configuration. 'none' means a one-shot item; any other
	// value means the item rolls over to its next occurrence when
	// completed or when its dueDate passes.
	recurrence: Recurrence;
	vaultId: string;
	createdAt: number;
	updatedAt: number;
	[key: string]: unknown; // Automerge compatibility
}

/**
 * Draft proposal — Phase 9 controlled action layer companion to
 * ReminderProposal. Extracted from memories when the LLM spots an
 * obvious follow-up email or calendar invite. Deliberately NOT sent
 * to anything — the user copies the draft into their real mail/
 * calendar client. Aliasing outgoing side-effects behind OAuth would
 * require a much larger scope.
 */
export type DraftStatus = 'pending' | 'used' | 'rejected';
export type DraftKind = 'email' | 'calendar-event';

export interface DraftProposal {
	id: string;
	memoryObjectId: string;
	kind: DraftKind;
	// Who / what is it directed at
	target: string | null; // recipient name, attendee list, etc.
	// For email: subject; for calendar-event: event title
	subject: string;
	// Main body (markdown ok for email, calendar description for events)
	body: string;
	// For calendar-event: suggested ISO date (YYYY-MM-DD) or datetime
	suggestedDate: string | null;
	suggestedTime: string | null; // HH:MM local, optional
	confidence: number;
	status: DraftStatus;
	vaultId: string;
	createdAt: number;
	decidedAt: number | null;
	[key: string]: unknown; // Automerge compatibility
}

/**
 * Reminder proposal — Phase 9 controlled action layer. Produced by
 * `proposeReminders` during memory processing. Lives as a user-review
 * queue: approving turns a proposal into a real ActionItem with a
 * dueDate; rejecting leaves an audit record.
 *
 * Proposals are kept forever even after decision so there's a
 * transparent log of what the assistant suggested and what the user
 * accepted.
 */
export type ReminderStatus = 'pending' | 'approved' | 'rejected' | 'snoozed';

// ---------------------------------------------------------------------------
// Database views — Notion-style structured views over a folder's memories.
// A DatabaseView defines how a folder is rendered as a table/board/calendar.
// Each column maps to either a built-in MemoryObject field or a custom
// property key. Custom properties live in `MemoryObject.customProps`.
// ---------------------------------------------------------------------------

export type PropertyType = 'text' | 'number' | 'date' | 'select' | 'multiSelect' | 'checkbox' | 'url' | 'person';

export interface PropertyDefinition {
	key: string; // unique within the view, used as the key in customProps
	label: string;
	type: PropertyType;
	options?: string[]; // for select / multiSelect: allowed values
}

export type DatabaseViewType = 'table' | 'board' | 'calendar' | 'gallery';

export interface DatabaseColumn {
	// Either a built-in field name (title, type, createdAt, updatedAt,
	// tags, participants, topics, projects, processingState) OR a
	// custom property key prefixed with 'prop:' (e.g. 'prop:priority').
	field: string;
	width?: number; // pixels, optional
	visible: boolean;
}

export interface DatabaseView {
	id: string;
	name: string;
	folderId: string; // the folder whose memories this view renders
	viewType: DatabaseViewType;
	columns: DatabaseColumn[];
	properties: PropertyDefinition[]; // custom property schema
	sortField: string | null;
	sortDirection: 'asc' | 'desc';
	groupField: string | null; // for board view
	filterQuery: string; // search filter operators string, optional
	vaultId: string;
	createdAt: number;
	updatedAt: number;
	[key: string]: unknown; // Automerge compatibility
}

export interface ReminderProposal {
	id: string;
	memoryObjectId: string; // source memory that triggered the proposal
	text: string; // e.g. "Follow up with Alice about Q4 deck"
	suggestedDate: string; // ISO YYYY-MM-DD, resolved against memory.capturedAt
	reason: string | null; // short quote or rationale for user context
	confidence: number; // 0..1
	// Optional recurrence hint. If set, approving this proposal creates
	// an ActionItem with the matching recurrence so it rolls forward
	// automatically. Defaults to 'none' for legacy proposals.
	recurrence: Recurrence;
	status: ReminderStatus;
	vaultId: string;
	createdAt: number;
	decidedAt: number | null; // when the user approved/rejected
	// ActionItem id created on approval, for round-tripping and to
	// prevent duplicate promotions on retry.
	actionItemId: string | null;
	[key: string]: unknown; // Automerge compatibility
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
	memoryObjects: Record<string, MemoryObject>;
	folders: Record<string, Folder>;
	vaults: Record<string, Vault>;
	people: Record<string, Person>;
	events: Record<string, Event>;
	templates: Record<string, Template>;
	actionItems: Record<string, ActionItem>;
	reminderProposals: Record<string, ReminderProposal>;
	draftProposals: Record<string, DraftProposal>;
	databaseViews: Record<string, DatabaseView>;
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
		memoryObjects: {},
		folders: {},
		vaults: { [DEFAULT_VAULT_ID]: defaultVault },
		people: {},
		events: {},
		templates: {},
		actionItems: {},
		reminderProposals: {},
		draftProposals: {},
		databaseViews: {},
		currentVaultId: DEFAULT_VAULT_ID,
		version: 14
	};
}

export function createMemoryObject(
	options: {
		type?: MemoryType;
		title?: string;
		bodyMarkdown?: string;
		folderId?: string | null;
		vaultId?: string;
		space?: MemorySpace;
	} = {}
): MemoryObject {
	const now = Date.now();
	const space = options.space ?? 'personal';
	return {
		id: generateId(),
		type: options.type ?? 'note',
		space,
		parentBucket: null,
		folderId: options.folderId ?? null,
		title: options.title ?? 'Untitled',
		rawText: '',
		bodyMarkdown: options.bodyMarkdown ?? '',
		rawAudioRef: null,
		rawMediaRef: null,
		transcript: null,
		transcriptSegments: [],
		summaryShort: null,
		summaryLong: null,
		createdAt: now,
		updatedAt: now,
		capturedAt: now,
		sourceDevice: null,
		sourceContext: null,
		language: null,
		tags: [],
		controlledLabels: [],
		participants: [],
		entities: [],
		projects: [],
		topics: [],
		dates: [],
		actionItems: [],
		decisions: [],
		relatedMemoryIds: [],
		visibilityScope: space,
		processingState: 'ready',
		processingError: null,
		confidenceScores: {},
		embeddingRef: null,
		meetingExtras: null,
		customProps: {},
		vaultId: options.vaultId ?? DEFAULT_VAULT_ID,
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
