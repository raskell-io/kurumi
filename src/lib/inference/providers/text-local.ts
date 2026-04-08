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

	async proposeReminders(
		_input: ProposeRemindersInput,
		_options?: TaskOptions
	): Promise<InferenceResult<ExtractedReminder[]>> {
		// Date-anchored reminder extraction needs reliable JSON-mode, which
		// small local text models don't do well. Fall back to the remote
		// provider via the router.
		return notImplemented('proposeReminders');
	}

	async proposeDrafts(
		_input: ProposeDraftsInput,
		_options?: TaskOptions
	): Promise<InferenceResult<ExtractedDraft[]>> {
		return notImplemented('proposeDrafts');
	}

	async classifyMemory(
		_input: { text: string },
		_options?: TaskOptions
	): Promise<InferenceResult<ClassifyResult>> {
		return notImplemented('classifyMemory');
	}

	async answerWithContext(
		input: AnswerWithContextInput,
		options?: TaskOptions
	): Promise<InferenceResult<AnsweredQuestion>> {
		const settings = getLocalInferenceSettings();
		const modelId = textModelId(settings.textModel);
		if (!settings.enabled || !settings.textModelEnabled) {
			return notEnabled(modelId);
		}

		const startedAt = Date.now();

		// Build the context blocks the same way the OpenAI provider does so
		// the model sees [n] markers and knows to cite by number.
		const contextBlocks = input.context
			.map((c, i) => `[${i + 1}] ${c.text}`)
			.join('\n\n---\n\n');

		// Optional prior conversation context
		let conversationHeader = '';
		if (input.priorTurns && input.priorTurns.length > 0) {
			const lines: string[] = ['Previous turns in this conversation:'];
			for (const turn of input.priorTurns) {
				const cleanedAnswer = turn.answer.replace(/\[\d+\]/g, '').trim();
				lines.push(`User: ${turn.question}`);
				lines.push(`Assistant: ${cleanedAnswer}`);
			}
			lines.push('');
			conversationHeader = lines.join('\n') + '\n';
		}

		// Small local models struggle with strict JSON, so we use a simple
		// natural-language format and parse it leniently. The model is asked
		// to use [n] markers in the answer text — we extract those after the
		// fact to build the citations array.
		const system = `You answer questions about a user's personal memories. You are given a question and a set of candidate memories tagged with [number] markers.

Rules:
- Base your answer ONLY on the provided memories.
- Use inline [n] markers to cite the memory number you used.
- Keep answers concise — 2-4 sentences unless more detail is needed.
- If the memories don't contain the answer, say so plainly.
- Do NOT include preamble like "Based on the memories..." — just answer.`;

		const userPrompt = `${conversationHeader}Question: ${input.question}\n\nCandidate memories:\n\n${contextBlocks}`;

		const result = await runChat(system, userPrompt, {
			...options,
			maxTokens: options?.maxTokens ?? 400,
			temperature: options?.temperature ?? 0.3
		});

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

		// Parse [n] markers from the answer in order of first appearance
		// and map them to memory IDs from the candidate list. The order
		// matches the [n] = candidate index convention used by the prompt.
		const answer = result.text.trim();
		const seenMarkers = new Set<number>();
		const citationOrder: number[] = [];
		const markerRegex = /\[(\d+)\]/g;
		let match: RegExpExecArray | null;
		while ((match = markerRegex.exec(answer)) !== null) {
			const n = parseInt(match[1], 10);
			if (!seenMarkers.has(n) && n >= 1 && n <= input.context.length) {
				seenMarkers.add(n);
				citationOrder.push(n);
			}
		}
		const citations = citationOrder.map((n) => input.context[n - 1].memoryId);

		return {
			ok: true,
			value: { answer, citations },
			target: 'local',
			providerId: 'text-local',
			model: modelId,
			latencyMs: Date.now() - startedAt
		};
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
