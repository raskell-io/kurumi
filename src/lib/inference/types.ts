// ---------------------------------------------------------------------------
// Inference layer (roadmap §8) — task-level provider abstraction.
//
// The router (router.ts) selects an InferenceProvider implementation per call
// based on InferencePolicy + RoutingContext. Providers are adapters: remote
// (OpenAI, Anthropic, ...) or local (Ollama, llama.cpp, ...). Callers depend
// only on InferenceProvider, never on a concrete adapter.
// ---------------------------------------------------------------------------

import type {
	ActionItem,
	ControlledLabel,
	Entity,
	MemoryObject,
	TranscriptSegment
} from '../db/types';

// --- Policies ---------------------------------------------------------------

export type InferencePolicy =
	| 'auto'
	| 'private-first'
	| 'best-quality'
	| 'offline-only'
	| 'work-safe';

export type ExecutionTarget = 'local' | 'remote';

export type DataSensitivity = 'public' | 'personal' | 'confidential';

export interface RoutingContext {
	policy: InferencePolicy;
	space?: MemoryObject['space'];
	sensitivity?: DataSensitivity;
	online: boolean;
	contextTokens?: number;
	latencyToleranceMs?: number;
	preferTarget?: ExecutionTarget;
}

export interface RoutingDecision {
	target: ExecutionTarget;
	providerId: string;
	model: string;
	reason: string;
}

// --- Common task option/result shapes ---------------------------------------

export interface TaskOptions {
	signal?: AbortSignal;
	maxTokens?: number;
	temperature?: number;
	language?: string;
}

export interface InferenceResult<T> {
	ok: boolean;
	value?: T;
	error?: string;
	target: ExecutionTarget;
	providerId: string;
	model: string;
	latencyMs: number;
	usage?: { inputTokens?: number; outputTokens?: number };
}

// --- Task-specific payloads -------------------------------------------------

export interface SummarizeInput {
	text: string;
	style?: 'short' | 'long' | 'bullets';
}

export interface MeetingSummary {
	title: string;
	summaryShort: string;
	summaryLong: string;
	participants: string[];
	keyTopics: string[];
	actionItems: Array<Pick<ActionItem, 'text' | 'assignee' | 'dueDate' | 'confidence'>>;
	decisions: string[];
	unresolvedQuestions: string[];
	followUpSuggestions: string[];
}

export interface MeetingSummaryInput {
	transcript: string;
	segments?: TranscriptSegment[];
	knownParticipants?: string[];
}

export interface RewriteTranscriptInput {
	transcript: string;
	segments?: TranscriptSegment[];
}

export interface ExtractedEntity {
	type: Entity['type'];
	canonicalName: string;
	aliases: string[];
	confidence: number;
}

export interface ExtractedActionItem {
	text: string;
	assignee: string | null;
	dueDate: string | null;
	confidence: number;
}

/**
 * Time-anchored nudge extracted from a memory, e.g.
 *   "Follow up with Alice about the Q4 deck"  → suggestedDate=2026-04-22
 *
 * `suggestedDate` is always resolved to an absolute ISO YYYY-MM-DD by
 * the provider. `reason` is an optional short quote from the source
 * that the reviewer can use to decide whether to approve.
 *
 * `recurrence` is an optional hint: if the source text says "every
 * Monday" or "weekly check-in", the provider can populate this so
 * approving the proposal creates a recurring ActionItem instead of a
 * one-shot. 'none' (or missing) means a single occurrence.
 */
export type ExtractedRecurrence = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface ExtractedReminder {
	text: string;
	suggestedDate: string;
	reason: string | null;
	confidence: number;
	recurrence?: ExtractedRecurrence;
}

export interface ProposeRemindersInput {
	text: string;
	/**
	 * Anchor date the model resolves relative dates against (ISO
	 * YYYY-MM-DD). Usually the memory's capturedAt in the user's local
	 * timezone. Required so "tomorrow" in a week-old voice memo
	 * produces the right absolute date.
	 */
	anchorDate: string;
}

/**
 * A draft email or calendar event extracted from a memory.
 * `suggestedDate` / `suggestedTime` are only populated for calendar
 * events and are always in the user's local timezone, resolved against
 * the anchor date supplied to the provider.
 */
export interface ExtractedDraft {
	kind: 'email' | 'calendar-event';
	target: string | null;
	subject: string;
	body: string;
	suggestedDate: string | null;
	suggestedTime: string | null;
	confidence: number;
}

export interface ProposeDraftsInput {
	text: string;
	anchorDate: string;
}

export interface ClassifyResult {
	labels: ControlledLabel[];
	confidence: number;
}

export interface AskTurn {
	question: string;
	answer: string;
}

export interface AnswerWithContextInput {
	question: string;
	context: Array<{ memoryId: string; text: string }>;
	/**
	 * Optional prior turns of conversation. The provider should pass these
	 * to the model so follow-up questions can resolve pronouns and reference
	 * earlier discussion.
	 */
	priorTurns?: AskTurn[];
}

export interface AnsweredQuestion {
	answer: string;
	citations: string[]; // memoryIds used
}

export interface AliasMergeProposal {
	canonicalName: string;
	aliases: string[];
	confidence: number;
}

export interface TranscribeInput {
	audio: Blob;
	mimeType: string;
	language?: string; // ISO 639-1 hint, e.g. "en"
}

export interface TranscribeResult {
	text: string;
	segments: TranscriptSegment[];
	language?: string;
}

export interface TtsInput {
	text: string;
	voice?: string;
}

export interface TtsResult {
	audio: ArrayBuffer;
	mimeType: string;
}

export interface RealtimeSessionOptions {
	voice?: string;
	systemPrompt?: string;
}

export interface RealtimeSessionHandle {
	id: string;
	close(): Promise<void>;
}

// --- Provider interface -----------------------------------------------------

export interface ProviderCapabilities {
	id: string;
	target: ExecutionTarget;
	supportsRealtime: boolean;
	supportsTts: boolean;
	supportsTranscribe: boolean;
	maxContextTokens: number;
	models: string[];
}

export interface InferenceProvider {
	readonly capabilities: ProviderCapabilities;

	summarize(
		input: SummarizeInput,
		options?: TaskOptions
	): Promise<InferenceResult<string>>;

	summarizeMeeting(
		input: MeetingSummaryInput,
		options?: TaskOptions
	): Promise<InferenceResult<MeetingSummary>>;

	rewriteTranscript(
		input: RewriteTranscriptInput,
		options?: TaskOptions
	): Promise<InferenceResult<string>>;

	extractEntities(
		input: { text: string },
		options?: TaskOptions
	): Promise<InferenceResult<ExtractedEntity[]>>;

	extractActionItems(
		input: { text: string },
		options?: TaskOptions
	): Promise<InferenceResult<ExtractedActionItem[]>>;

	proposeReminders(
		input: ProposeRemindersInput,
		options?: TaskOptions
	): Promise<InferenceResult<ExtractedReminder[]>>;

	proposeDrafts(
		input: ProposeDraftsInput,
		options?: TaskOptions
	): Promise<InferenceResult<ExtractedDraft[]>>;

	classifyMemory(
		input: { text: string },
		options?: TaskOptions
	): Promise<InferenceResult<ClassifyResult>>;

	answerWithContext(
		input: AnswerWithContextInput,
		options?: TaskOptions
	): Promise<InferenceResult<AnsweredQuestion>>;

	generateTitle(
		input: { text: string },
		options?: TaskOptions
	): Promise<InferenceResult<string>>;

	proposeCanonicalLabels(
		input: { text: string },
		options?: TaskOptions
	): Promise<InferenceResult<ControlledLabel[]>>;

	mergeAliasCandidates(
		input: { names: string[] },
		options?: TaskOptions
	): Promise<InferenceResult<AliasMergeProposal[]>>;

	transcribe(
		input: TranscribeInput,
		options?: TaskOptions
	): Promise<InferenceResult<TranscribeResult>>;

	tts(input: TtsInput, options?: TaskOptions): Promise<InferenceResult<TtsResult>>;

	realtimeSessionStart(
		options?: RealtimeSessionOptions
	): Promise<InferenceResult<RealtimeSessionHandle>>;
}

// --- Router interface -------------------------------------------------------

export type InferenceTask = keyof Omit<InferenceProvider, 'capabilities'>;

export interface InferenceRouter {
	route(task: InferenceTask, ctx: RoutingContext): RoutingDecision;
	getProvider(decision: RoutingDecision): InferenceProvider;
}
