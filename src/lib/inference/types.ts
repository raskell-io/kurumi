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

export interface ClassifyResult {
	labels: ControlledLabel[];
	confidence: number;
}

export interface AnswerWithContextInput {
	question: string;
	context: Array<{ memoryId: string; text: string }>;
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
