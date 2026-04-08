/**
 * Local text-generation provider.
 *
 * Runs a small instruction-tuned LLM (default: SmolLM2-360M) entirely in the
 * browser via transformers.js. Currently implements summarize() and
 * generateTitle(); other text tasks (entity extraction, classification, ...)
 * will land as the relevant epics come online.
 *
 * Like the Whisper provider, this is opt-in via local inference settings.
 * supportsTranscribe is false (text-only) and the chat-style methods only
 * activate when textModelEnabled is true.
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
import type { ControlledLabel } from '../../db/types';
import { loadPipeline } from '../local-models';
import { getLocalInferenceSettings, textModelId } from '../settings';

interface ChatMessage {
	role: 'system' | 'user' | 'assistant';
	content: string;
}

interface TextGenerationOutput {
	generated_text: ChatMessage[] | string;
}

type TextPipelineFn = (
	input: ChatMessage[],
	options?: {
		max_new_tokens?: number;
		temperature?: number;
		do_sample?: boolean;
		return_full_text?: boolean;
	}
) => Promise<TextGenerationOutput[]>;

function notImplemented<T>(method: string): InferenceResult<T> {
	return {
		ok: false,
		error: `Local text provider: ${method} not supported yet`,
		target: 'local',
		providerId: 'text-local',
		model: 'n/a',
		latencyMs: 0
	};
}

function notEnabled<T>(model: string): InferenceResult<T> {
	return {
		ok: false,
		error: 'Local text generation is disabled in settings',
		target: 'local',
		providerId: 'text-local',
		model,
		latencyMs: 0
	};
}

/**
 * Run an instruction-style chat completion through the local text pipeline.
 * Handles both v3 (returns string) and v4 (returns chat messages) shapes.
 */
async function runChat(
	system: string,
	user: string,
	options?: TaskOptions
): Promise<{ ok: true; text: string } | { ok: false; error: string; model: string }> {
	const settings = getLocalInferenceSettings();
	const modelId = textModelId(settings.textModel);

	try {
		const pipeline = (await loadPipeline('text-generation', modelId)) as TextPipelineFn;

		const messages: ChatMessage[] = [
			{ role: 'system', content: system },
			{ role: 'user', content: user }
		];

		const output = await pipeline(messages, {
			max_new_tokens: options?.maxTokens ?? 200,
			temperature: options?.temperature ?? 0.4,
			do_sample: true,
			return_full_text: false
		});

		const generated = output[0]?.generated_text;
		let text = '';
		if (typeof generated === 'string') {
			text = generated;
		} else if (Array.isArray(generated)) {
			// Find the assistant's reply
			const reply = generated.find((m) => m.role === 'assistant');
			text = reply?.content ?? '';
		}

		text = text.trim();
		if (!text) {
			return { ok: false, error: 'Local model returned empty output', model: modelId };
		}
		return { ok: true, text };
	} catch (err) {
		return {
			ok: false,
			error: err instanceof Error ? err.message : 'Local inference failed',
			model: modelId
		};
	}
}

export class TextLocalProvider implements InferenceProvider {
	get capabilities(): ProviderCapabilities {
		const settings = getLocalInferenceSettings();
		return {
			id: 'text-local',
			target: 'local',
			supportsRealtime: false,
			supportsTts: false,
			supportsTranscribe: false,
			maxContextTokens: 2048,
			models: [textModelId(settings.textModel)]
		};
	}

	async summarize(
		input: SummarizeInput,
		options?: TaskOptions
	): Promise<InferenceResult<string>> {
		const settings = getLocalInferenceSettings();
		const modelId = textModelId(settings.textModel);
		if (!settings.enabled || !settings.textModelEnabled) {
			return notEnabled(modelId);
		}

		const startedAt = Date.now();
		const styleInstruction =
			input.style === 'long'
				? 'Write a thorough summary in a few paragraphs.'
				: input.style === 'bullets'
					? 'Write a bullet-point summary, one bullet per key point.'
					: 'Write a concise summary in 1-3 sentences.';

		const result = await runChat(
			`You summarize text accurately and concisely. ${styleInstruction} Return only the summary.`,
			input.text,
			options
		);

		if (!result.ok) {
			return {
				ok: false,
				error: result.error,
				target: 'local',
				providerId: 'text-local',
				model: modelId,
				latencyMs: Date.now() - startedAt
			};
		}

		return {
			ok: true,
			value: result.text,
			target: 'local',
			providerId: 'text-local',
			model: modelId,
			latencyMs: Date.now() - startedAt
		};
	}

	async generateTitle(
		input: { text: string },
		options?: TaskOptions
	): Promise<InferenceResult<string>> {
		const settings = getLocalInferenceSettings();
		const modelId = textModelId(settings.textModel);
		if (!settings.enabled || !settings.textModelEnabled) {
			return notEnabled(modelId);
		}

		const startedAt = Date.now();
		const result = await runChat(
			'Generate a short, descriptive title (3-8 words) for the following text. Return only the title, no quotes, no preamble, no trailing punctuation.',
			input.text,
			{ ...options, maxTokens: 32, temperature: 0.4 }
		);

		if (!result.ok) {
			return {
				ok: false,
				error: result.error,
				target: 'local',
				providerId: 'text-local',
				model: modelId,
				latencyMs: Date.now() - startedAt
			};
		}

		const cleaned = result.text.replace(/^["'`]+|["'`]+$/g, '').replace(/[.!?]+$/, '').trim();

		return {
			ok: true,
			value: cleaned,
			target: 'local',
			providerId: 'text-local',
			model: modelId,
			latencyMs: Date.now() - startedAt
		};
	}

	// --- stubs --------------------------------------------------------------

	async transcribe(
		_input: TranscribeInput,
		_options?: TaskOptions
	): Promise<InferenceResult<TranscribeResult>> {
		return notImplemented('transcribe');
	}

	async summarizeMeeting(
		_input: MeetingSummaryInput,
		_options?: TaskOptions
	): Promise<InferenceResult<MeetingSummary>> {
		return notImplemented('summarizeMeeting');
	}

	async rewriteTranscript(
		_input: RewriteTranscriptInput,
		_options?: TaskOptions
	): Promise<InferenceResult<string>> {
		return notImplemented('rewriteTranscript');
	}

	async extractEntities(
		_input: { text: string },
		_options?: TaskOptions
	): Promise<InferenceResult<ExtractedEntity[]>> {
		return notImplemented('extractEntities');
	}

	async extractActionItems(
		_input: { text: string },
		_options?: TaskOptions
	): Promise<InferenceResult<ExtractedActionItem[]>> {
		return notImplemented('extractActionItems');
	}

	async classifyMemory(
		_input: { text: string },
		_options?: TaskOptions
	): Promise<InferenceResult<ClassifyResult>> {
		return notImplemented('classifyMemory');
	}

	async answerWithContext(
		_input: AnswerWithContextInput,
		_options?: TaskOptions
	): Promise<InferenceResult<AnsweredQuestion>> {
		return notImplemented('answerWithContext');
	}

	async proposeCanonicalLabels(
		_input: { text: string },
		_options?: TaskOptions
	): Promise<InferenceResult<ControlledLabel[]>> {
		return notImplemented('proposeCanonicalLabels');
	}

	async mergeAliasCandidates(
		_input: { names: string[] },
		_options?: TaskOptions
	): Promise<InferenceResult<AliasMergeProposal[]>> {
		return notImplemented('mergeAliasCandidates');
	}

	async tts(_input: TtsInput, _options?: TaskOptions): Promise<InferenceResult<TtsResult>> {
		return notImplemented('tts');
	}

	async realtimeSessionStart(
		_options?: RealtimeSessionOptions
	): Promise<InferenceResult<RealtimeSessionHandle>> {
		return notImplemented('realtimeSessionStart');
	}
}
