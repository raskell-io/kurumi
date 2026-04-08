/**
 * OpenAI inference provider.
 *
 * Currently implements only `transcribe()` via Whisper. Other methods are
 * stubs that return a "not implemented" error so the provider satisfies the
 * full InferenceProvider interface — they'll be filled in as later epics
 * (summarization, entity extraction, ...) come online.
 *
 * The API key is read from the same localStorage slot used by the legacy
 * src/lib/ai/ helpers so the existing settings UI continues to work.
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
	ClassifyResult,
	AnswerWithContextInput,
	AnsweredQuestion,
	AliasMergeProposal,
	TtsInput,
	TtsResult,
	RealtimeSessionOptions,
	RealtimeSessionHandle
} from '../types';
import type { ControlledLabel, TranscriptSegment } from '../../db/types';

const OPENAI_KEY_STORAGE = 'kurumi-openai-key';
const TRANSCRIBE_MODEL = 'whisper-1';
const CHAT_MODEL = 'gpt-4o-mini';

function getApiKey(): string | null {
	if (typeof localStorage === 'undefined') return null;
	const key = localStorage.getItem(OPENAI_KEY_STORAGE);
	return key && key.length > 0 ? key : null;
}

function notImplemented<T>(method: string, target: 'remote'): InferenceResult<T> {
	return {
		ok: false,
		error: `OpenAI provider: ${method} not implemented yet`,
		target,
		providerId: 'openai',
		model: 'n/a',
		latencyMs: 0
	};
}

interface WhisperVerboseResponse {
	text: string;
	language?: string;
	segments?: Array<{
		start: number;
		end: number;
		text: string;
	}>;
}

interface ChatCompletionResponse {
	choices?: Array<{
		message?: {
			content?: string;
		};
	}>;
}

/**
 * Shared helper for chat-completion calls. Returns the assistant text or
 * an error message; latency is computed by the caller.
 */
async function callChat(
	apiKey: string,
	system: string,
	user: string,
	options?: TaskOptions
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
	try {
		const response = await fetch('https://api.openai.com/v1/chat/completions', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${apiKey}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				model: CHAT_MODEL,
				messages: [
					{ role: 'system', content: system },
					{ role: 'user', content: user }
				],
				max_tokens: options?.maxTokens ?? 512,
				temperature: options?.temperature ?? 0.3
			}),
			signal: options?.signal
		});

		if (!response.ok) {
			const errText = await response.text().catch(() => '');
			return {
				ok: false,
				error:
					response.status === 401
						? 'Invalid OpenAI API key'
						: `OpenAI request failed (${response.status}): ${errText.slice(0, 200)}`
			};
		}

		const data = (await response.json()) as ChatCompletionResponse;
		const text = data.choices?.[0]?.message?.content?.trim();
		if (!text) {
			return { ok: false, error: 'OpenAI returned an empty response' };
		}
		return { ok: true, text };
	} catch (err) {
		return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
	}
}

export class OpenAIProvider implements InferenceProvider {
	readonly capabilities: ProviderCapabilities = {
		id: 'openai',
		target: 'remote',
		supportsRealtime: false,
		supportsTts: false,
		supportsTranscribe: true,
		maxContextTokens: 128_000,
		models: ['gpt-4o', 'gpt-4o-mini', TRANSCRIBE_MODEL]
	};

	async transcribe(
		input: TranscribeInput,
		options?: TaskOptions
	): Promise<InferenceResult<TranscribeResult>> {
		const apiKey = getApiKey();
		const startedAt = Date.now();

		if (!apiKey) {
			return {
				ok: false,
				error: 'OpenAI API key not configured',
				target: 'remote',
				providerId: 'openai',
				model: TRANSCRIBE_MODEL,
				latencyMs: 0
			};
		}

		const form = new FormData();
		// Whisper expects a filename with an audio extension; pick one based on the mime type.
		const ext = pickExtension(input.mimeType);
		form.append('file', new File([input.audio], `recording.${ext}`, { type: input.mimeType }));
		form.append('model', TRANSCRIBE_MODEL);
		form.append('response_format', 'verbose_json');
		if (input.language) {
			form.append('language', input.language);
		}

		try {
			const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
				method: 'POST',
				headers: { Authorization: `Bearer ${apiKey}` },
				body: form,
				signal: options?.signal
			});

			if (!response.ok) {
				const errText = await response.text().catch(() => '');
				return {
					ok: false,
					error:
						response.status === 401
							? 'Invalid OpenAI API key'
							: `Whisper request failed (${response.status}): ${errText.slice(0, 200)}`,
					target: 'remote',
					providerId: 'openai',
					model: TRANSCRIBE_MODEL,
					latencyMs: Date.now() - startedAt
				};
			}

			const data = (await response.json()) as WhisperVerboseResponse;
			const segments: TranscriptSegment[] =
				data.segments?.map((s) => ({
					start: s.start,
					end: s.end,
					text: s.text.trim()
				})) ?? [];

			return {
				ok: true,
				value: {
					text: data.text.trim(),
					segments,
					language: data.language
				},
				target: 'remote',
				providerId: 'openai',
				model: TRANSCRIBE_MODEL,
				latencyMs: Date.now() - startedAt
			};
		} catch (err) {
			return {
				ok: false,
				error: err instanceof Error ? err.message : 'Network error',
				target: 'remote',
				providerId: 'openai',
				model: TRANSCRIBE_MODEL,
				latencyMs: Date.now() - startedAt
			};
		}
	}

	// --- chat-completion-backed tasks ---------------------------------------

	async summarize(
		input: SummarizeInput,
		options?: TaskOptions
	): Promise<InferenceResult<string>> {
		const apiKey = getApiKey();
		const startedAt = Date.now();
		if (!apiKey) {
			return {
				ok: false,
				error: 'OpenAI API key not configured',
				target: 'remote',
				providerId: 'openai',
				model: CHAT_MODEL,
				latencyMs: 0
			};
		}

		const styleInstruction =
			input.style === 'long'
				? 'Write a thorough summary in a few paragraphs.'
				: input.style === 'bullets'
					? 'Write a bullet-point summary, one bullet per key point.'
					: 'Write a concise summary in 1-3 sentences.';

		const result = await callChat(
			apiKey,
			`You summarize text accurately and concisely. ${styleInstruction} Return only the summary, no preamble.`,
			input.text,
			options
		);

		if (!result.ok) {
			return {
				ok: false,
				error: result.error,
				target: 'remote',
				providerId: 'openai',
				model: CHAT_MODEL,
				latencyMs: Date.now() - startedAt
			};
		}

		return {
			ok: true,
			value: result.text,
			target: 'remote',
			providerId: 'openai',
			model: CHAT_MODEL,
			latencyMs: Date.now() - startedAt
		};
	}

	// --- stubs for tasks not yet implemented on this provider ---------------

	async summarizeMeeting(
		_input: MeetingSummaryInput,
		_options?: TaskOptions
	): Promise<InferenceResult<MeetingSummary>> {
		return notImplemented('summarizeMeeting', 'remote');
	}

	async rewriteTranscript(
		_input: RewriteTranscriptInput,
		_options?: TaskOptions
	): Promise<InferenceResult<string>> {
		return notImplemented('rewriteTranscript', 'remote');
	}

	async extractEntities(
		_input: { text: string },
		_options?: TaskOptions
	): Promise<InferenceResult<ExtractedEntity[]>> {
		return notImplemented('extractEntities', 'remote');
	}

	async extractActionItems(
		_input: { text: string },
		_options?: TaskOptions
	): Promise<InferenceResult<ExtractedActionItem[]>> {
		return notImplemented('extractActionItems', 'remote');
	}

	async classifyMemory(
		_input: { text: string },
		_options?: TaskOptions
	): Promise<InferenceResult<ClassifyResult>> {
		return notImplemented('classifyMemory', 'remote');
	}

	async answerWithContext(
		_input: AnswerWithContextInput,
		_options?: TaskOptions
	): Promise<InferenceResult<AnsweredQuestion>> {
		return notImplemented('answerWithContext', 'remote');
	}

	async generateTitle(
		input: { text: string },
		options?: TaskOptions
	): Promise<InferenceResult<string>> {
		const apiKey = getApiKey();
		const startedAt = Date.now();
		if (!apiKey) {
			return {
				ok: false,
				error: 'OpenAI API key not configured',
				target: 'remote',
				providerId: 'openai',
				model: CHAT_MODEL,
				latencyMs: 0
			};
		}

		const result = await callChat(
			apiKey,
			'Generate a short, descriptive title (3-8 words) for the following text. Return only the title, no quotes, no preamble, no trailing punctuation.',
			input.text,
			{ ...options, maxTokens: 32, temperature: 0.4 }
		);

		if (!result.ok) {
			return {
				ok: false,
				error: result.error,
				target: 'remote',
				providerId: 'openai',
				model: CHAT_MODEL,
				latencyMs: Date.now() - startedAt
			};
		}

		// Strip trailing punctuation and any wrapping quotes the model might add.
		const cleaned = result.text.replace(/^["'`]+|["'`]+$/g, '').replace(/[.!?]+$/, '').trim();

		return {
			ok: true,
			value: cleaned,
			target: 'remote',
			providerId: 'openai',
			model: CHAT_MODEL,
			latencyMs: Date.now() - startedAt
		};
	}

	async proposeCanonicalLabels(
		_input: { text: string },
		_options?: TaskOptions
	): Promise<InferenceResult<ControlledLabel[]>> {
		return notImplemented('proposeCanonicalLabels', 'remote');
	}

	async mergeAliasCandidates(
		_input: { names: string[] },
		_options?: TaskOptions
	): Promise<InferenceResult<AliasMergeProposal[]>> {
		return notImplemented('mergeAliasCandidates', 'remote');
	}

	async tts(_input: TtsInput, _options?: TaskOptions): Promise<InferenceResult<TtsResult>> {
		return notImplemented('tts', 'remote');
	}

	async realtimeSessionStart(
		_options?: RealtimeSessionOptions
	): Promise<InferenceResult<RealtimeSessionHandle>> {
		return notImplemented('realtimeSessionStart', 'remote');
	}
}

function pickExtension(mimeType: string): string {
	if (mimeType.includes('webm')) return 'webm';
	if (mimeType.includes('mp4')) return 'm4a';
	if (mimeType.includes('mpeg')) return 'mp3';
	if (mimeType.includes('wav')) return 'wav';
	if (mimeType.includes('ogg')) return 'ogg';
	return 'webm';
}
