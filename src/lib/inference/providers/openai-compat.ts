/**
 * Factory for OpenAI API-compatible inference providers.
 *
 * Most modern LLM APIs (Mistral, Perplexity, Grok/xAI, Qwen/DashScope,
 * Azure OpenAI, Together, Groq, Fireworks, etc.) speak the OpenAI chat
 * completions format. This factory creates a full InferenceProvider
 * from a config object — each provider is just a configured instance,
 * not a separate class.
 *
 * The factory reuses the same system prompts, JSON-mode patterns, and
 * response parsing as the native OpenAI provider. The only differences
 * are the base URL, auth header, and model names.
 */

import type {
	InferenceProvider,
	InferenceResult,
	ProviderCapabilities,
	TaskOptions,
	TranscribeInput,
	TranscribeResult,
	SummarizeInput,
	MeetingSummary,
	MeetingSummaryInput,
	RewriteTranscriptInput,
	ExtractedEntity,
	ExtractedActionItem,
	ExtractedReminder,
	ProposeRemindersInput,
	ExtractedDraft,
	ProposeDraftsInput,
	ClassifyResult,
	AnswerWithContextInput,
	AnsweredQuestion,
	AliasMergeProposal,
	TtsInput,
	TtsResult,
	RealtimeSessionOptions,
	RealtimeSessionHandle
} from '../types';
import type { ControlledLabel } from '../../db/types';

export interface OpenAICompatConfig {
	id: string;
	name: string; // Human-readable name for errors
	baseUrl: string; // e.g. "https://api.mistral.ai/v1"
	apiKeyStorageKey: string; // localStorage key for the API key
	authHeader?: 'bearer' | 'api-key'; // default 'bearer'
	defaultModel: string;
	models: string[];
	maxContextTokens?: number;
	supportsJsonMode?: boolean; // default true
}

function getApiKey(storageKey: string): string | null {
	if (typeof localStorage === 'undefined') return null;
	return localStorage.getItem(storageKey);
}

function notImplemented<T>(providerId: string, method: string): InferenceResult<T> {
	return {
		ok: false,
		error: `${providerId}: ${method} not supported`,
		target: 'remote',
		providerId,
		model: 'n/a',
		latencyMs: 0
	};
}

async function callChat(
	config: OpenAICompatConfig,
	messages: Array<{ role: string; content: string }>,
	options?: {
		signal?: AbortSignal;
		temperature?: number;
		maxTokens?: number;
		jsonMode?: boolean;
		model?: string;
	}
): Promise<InferenceResult<string>> {
	const apiKey = getApiKey(config.apiKeyStorageKey);
	const model = options?.model ?? config.defaultModel;
	const startedAt = Date.now();

	if (!apiKey) {
		return {
			ok: false,
			error: `${config.name} API key not configured`,
			target: 'remote',
			providerId: config.id,
			model,
			latencyMs: 0
		};
	}

	const headers: Record<string, string> = {
		'Content-Type': 'application/json'
	};
	if (config.authHeader === 'api-key') {
		headers['api-key'] = apiKey;
	} else {
		headers['Authorization'] = `Bearer ${apiKey}`;
	}

	const body: Record<string, unknown> = {
		model,
		messages,
		temperature: options?.temperature ?? 0.3
	};
	if (options?.maxTokens) body.max_tokens = options.maxTokens;
	if (options?.jsonMode && config.supportsJsonMode !== false) {
		body.response_format = { type: 'json_object' };
	}

	try {
		const response = await fetch(`${config.baseUrl}/chat/completions`, {
			method: 'POST',
			headers,
			signal: options?.signal,
			body: JSON.stringify(body)
		});

		if (!response.ok) {
			const text = await response.text().catch(() => '');
			return {
				ok: false,
				error: `${config.name} error (${response.status}): ${text.slice(0, 200) || 'no body'}`,
				target: 'remote',
				providerId: config.id,
				model,
				latencyMs: Date.now() - startedAt
			};
		}

		const data = await response.json();
		const content = data.choices?.[0]?.message?.content?.trim();
		if (!content) {
			return {
				ok: false,
				error: `${config.name} returned empty response`,
				target: 'remote',
				providerId: config.id,
				model,
				latencyMs: Date.now() - startedAt
			};
		}

		return {
			ok: true,
			value: content,
			target: 'remote',
			providerId: config.id,
			model,
			latencyMs: Date.now() - startedAt
		};
	} catch (err) {
		return {
			ok: false,
			error: err instanceof Error ? err.message : 'Network error',
			target: 'remote',
			providerId: config.id,
			model,
			latencyMs: Date.now() - startedAt
		};
	}
}

/**
 * Create a full InferenceProvider from an OpenAI-compatible config.
 * Supports: summarize, summarizeMeeting, answerWithContext,
 * generateTitle, extractEntities, proposeReminders, proposeDrafts.
 * Does NOT support: transcribe, tts, realtime (those need
 * provider-specific APIs).
 */
export function createOpenAICompatProvider(config: OpenAICompatConfig): InferenceProvider {
	const id = config.id;

	return {
		get capabilities(): ProviderCapabilities {
			return {
				id,
				target: 'remote',
				supportsRealtime: false,
				supportsTts: false,
				supportsTranscribe: false,
				maxContextTokens: config.maxContextTokens ?? 128_000,
				models: config.models
			};
		},

		async summarize(input: SummarizeInput, options?: TaskOptions) {
			const style = input.style ?? 'short';
			const prompt =
				style === 'bullets'
					? 'Summarize the following text as bullet points:'
					: style === 'long'
						? 'Write a detailed summary of the following:'
						: 'Write a concise 1-2 sentence summary:';
			return callChat(config, [
				{ role: 'system', content: prompt },
				{ role: 'user', content: input.text }
			], { signal: options?.signal, temperature: 0.3 });
		},

		async summarizeMeeting(input: MeetingSummaryInput, options?: TaskOptions) {
			const system = [
				'You summarize meeting transcripts. Output strict JSON:',
				'{"title": string, "summaryShort": string, "summaryLong": string,',
				' "participants": string[], "keyTopics": string[],',
				' "actionItems": [{"text": string, "assignee": string|null, "dueDate": string|null}],',
				' "decisions": string[], "unresolvedQuestions": string[],',
				' "followUpSuggestions": string[]}'
			].join('\n');
			const result = await callChat(config, [
				{ role: 'system', content: system },
				{ role: 'user', content: input.transcript }
			], { signal: options?.signal, temperature: 0.2, jsonMode: true });

			if (!result.ok || !result.value) {
				return { ...result, value: undefined } as InferenceResult<MeetingSummary>;
			}
			try {
				const parsed = JSON.parse(result.value);
				return {
					...result,
					value: {
						title: parsed.title ?? '',
						summaryShort: parsed.summaryShort ?? '',
						summaryLong: parsed.summaryLong ?? '',
						participants: parsed.participants ?? [],
						keyTopics: parsed.keyTopics ?? [],
						actionItems: parsed.actionItems ?? [],
						decisions: parsed.decisions ?? [],
						unresolvedQuestions: parsed.unresolvedQuestions ?? [],
						followUpSuggestions: parsed.followUpSuggestions ?? []
					}
				};
			} catch {
				return { ...result, ok: false, error: 'Failed to parse meeting summary JSON', value: undefined } as InferenceResult<MeetingSummary>;
			}
		},

		async rewriteTranscript(input: RewriteTranscriptInput, options?: TaskOptions) {
			return callChat(config, [
				{ role: 'system', content: 'Clean up and rewrite this transcript for readability. Fix grammar, remove filler words, but keep the meaning intact.' },
				{ role: 'user', content: input.transcript }
			], { signal: options?.signal });
		},

		async extractEntities(input: { text: string }, options?: TaskOptions) {
			const system = [
				'Extract named entities from the text. Output strict JSON:',
				'{"entities": [{"type": "person"|"project"|"topic"|"organization"|"place",',
				' "canonicalName": string, "aliases": string[], "confidence": number}]}'
			].join('\n');
			const result = await callChat(config, [
				{ role: 'system', content: system },
				{ role: 'user', content: input.text }
			], { signal: options?.signal, jsonMode: true });

			if (!result.ok || !result.value) return { ...result, value: undefined } as InferenceResult<ExtractedEntity[]>;
			try {
				const parsed = JSON.parse(result.value);
				return { ...result, value: Array.isArray(parsed.entities) ? parsed.entities : [] };
			} catch {
				return { ...result, value: [] };
			}
		},

		async extractActionItems(_input: { text: string }, _options?: TaskOptions) {
			return notImplemented(id, 'extractActionItems');
		},

		async proposeReminders(input: ProposeRemindersInput, options?: TaskOptions) {
			const system = [
				'Extract time-anchored reminders. Output strict JSON:',
				`Anchor date: ${input.anchorDate}. Resolve relative dates.`,
				'{"reminders": [{"text": string, "suggestedDate": "YYYY-MM-DD",',
				' "reason": string|null, "confidence": number,',
				' "recurrence": "none"|"daily"|"weekly"|"monthly"|"yearly"}]}',
				'Return {"reminders": []} if none found.'
			].join('\n');
			const result = await callChat(config, [
				{ role: 'system', content: system },
				{ role: 'user', content: input.text }
			], { signal: options?.signal, jsonMode: true });

			if (!result.ok || !result.value) return { ...result, value: undefined } as InferenceResult<ExtractedReminder[]>;
			try {
				const parsed = JSON.parse(result.value);
				return { ...result, value: Array.isArray(parsed.reminders) ? parsed.reminders : [] };
			} catch {
				return { ...result, value: [] };
			}
		},

		async proposeDrafts(input: ProposeDraftsInput, options?: TaskOptions) {
			const system = [
				'Identify follow-up emails or calendar events. Output strict JSON:',
				`Anchor date: ${input.anchorDate}.`,
				'{"drafts": [{"kind": "email"|"calendar-event", "target": string|null,',
				' "subject": string, "body": string,',
				' "suggestedDate": string|null, "suggestedTime": string|null,',
				' "confidence": number}]}',
				'Return {"drafts": []} if none.'
			].join('\n');
			const result = await callChat(config, [
				{ role: 'system', content: system },
				{ role: 'user', content: input.text }
			], { signal: options?.signal, jsonMode: true });

			if (!result.ok || !result.value) return { ...result, value: undefined } as InferenceResult<ExtractedDraft[]>;
			try {
				const parsed = JSON.parse(result.value);
				return { ...result, value: Array.isArray(parsed.drafts) ? parsed.drafts : [] };
			} catch {
				return { ...result, value: [] };
			}
		},

		async classifyMemory(_input: { text: string }, _options?: TaskOptions) {
			return notImplemented(id, 'classifyMemory');
		},

		async answerWithContext(input: AnswerWithContextInput, options?: TaskOptions) {
			const contextStr = input.context
				.map((c, i) => `[${i + 1}] ${c.text}`)
				.join('\n\n');
			const system = [
				'Answer the question using ONLY the provided context.',
				'Cite sources using [n] notation. Output strict JSON:',
				'{"answer": string, "citations": string[]}',
				'',
				'Context:',
				contextStr
			].join('\n');

			const messages = [
				{ role: 'system', content: system },
				...(input.priorTurns ?? []).flatMap((t) => [
					{ role: 'user' as const, content: t.question },
					{ role: 'assistant' as const, content: t.answer }
				]),
				{ role: 'user', content: input.question }
			];

			const result = await callChat(config, messages, {
				signal: options?.signal,
				jsonMode: true
			});

			if (!result.ok || !result.value) return { ...result, value: undefined } as InferenceResult<AnsweredQuestion>;
			try {
				const parsed = JSON.parse(result.value);
				return {
					...result,
					value: {
						answer: parsed.answer ?? result.value,
						citations: Array.isArray(parsed.citations)
							? parsed.citations.filter((c: unknown) => typeof c === 'string')
							: input.context.map((c) => c.memoryId)
					}
				};
			} catch {
				return { ...result, value: { answer: result.value, citations: [] } };
			}
		},

		async generateTitle(input: { text: string }, options?: TaskOptions) {
			return callChat(config, [
				{ role: 'system', content: 'Generate a short, descriptive title (under 60 chars) for this content. Output only the title, nothing else.' },
				{ role: 'user', content: input.text.slice(0, 2000) }
			], { signal: options?.signal, temperature: 0.5 });
		},

		async proposeCanonicalLabels(_input: { text: string }, _options?: TaskOptions) {
			return notImplemented(id, 'proposeCanonicalLabels');
		},

		async mergeAliasCandidates(_input: { names: string[] }, _options?: TaskOptions) {
			return notImplemented(id, 'mergeAliasCandidates');
		},

		async transcribe(_input: TranscribeInput, _options?: TaskOptions) {
			return notImplemented(id, 'transcribe');
		},

		async tts(_input: TtsInput, _options?: TaskOptions) {
			return notImplemented(id, 'tts');
		},

		async realtimeSessionStart(_options?: RealtimeSessionOptions) {
			return notImplemented(id, 'realtimeSessionStart');
		}
	};
}

// ---------------------------------------------------------------------------
// Pre-configured provider instances
// ---------------------------------------------------------------------------

export const PROVIDER_CONFIGS: OpenAICompatConfig[] = [
	{
		id: 'mistral',
		name: 'Mistral AI',
		baseUrl: 'https://api.mistral.ai/v1',
		apiKeyStorageKey: 'kurumi-mistral-key',
		defaultModel: 'mistral-large-latest',
		models: ['mistral-large-latest', 'mistral-small-latest', 'codestral-latest', 'mistral-medium-latest']
	},
	{
		id: 'perplexity',
		name: 'Perplexity',
		baseUrl: 'https://api.perplexity.ai',
		apiKeyStorageKey: 'kurumi-perplexity-key',
		defaultModel: 'llama-3.1-sonar-large-128k-online',
		models: ['llama-3.1-sonar-large-128k-online', 'llama-3.1-sonar-small-128k-online', 'llama-3.1-sonar-huge-128k-online']
	},
	{
		id: 'grok',
		name: 'Grok (xAI)',
		baseUrl: 'https://api.x.ai/v1',
		apiKeyStorageKey: 'kurumi-grok-key',
		defaultModel: 'grok-2',
		models: ['grok-2', 'grok-2-mini']
	},
	{
		id: 'qwen',
		name: 'Qwen (DashScope)',
		baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
		apiKeyStorageKey: 'kurumi-qwen-key',
		defaultModel: 'qwen-max',
		models: ['qwen-max', 'qwen-plus', 'qwen-turbo', 'qwen-long']
	},
	{
		id: 'azure-openai',
		name: 'Azure OpenAI',
		baseUrl: '', // Set by user — e.g. https://myresource.openai.azure.com/openai/deployments/mydeployment
		apiKeyStorageKey: 'kurumi-azure-key',
		authHeader: 'api-key',
		defaultModel: 'gpt-4o',
		models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4'],
		supportsJsonMode: true
	},
	{
		id: 'groq',
		name: 'Groq',
		baseUrl: 'https://api.groq.com/openai/v1',
		apiKeyStorageKey: 'kurumi-groq-key',
		defaultModel: 'llama-3.3-70b-versatile',
		models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768', 'gemma2-9b-it']
	}
];

/** All provider instances, ready to register. */
export const openAICompatProviders = PROVIDER_CONFIGS.map(createOpenAICompatProvider);
