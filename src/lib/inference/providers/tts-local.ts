/**
 * Local TTS provider using transformers.js's text-to-speech pipeline.
 *
 * Hardcoded to Facebook's MMS TTS (`Xenova/mms-tts-eng`) for simplicity
 * — it loads cleanly via the generic `text-to-speech` pipeline, doesn't
 * require speaker embeddings the way SpeechT5 does, and produces
 * reasonable quality on CPU. Model is downloaded once and cached by
 * transformers.js.
 *
 * This provider is registered AFTER the OpenAI provider so the router
 * prefers remote TTS (gpt-4o-mini-tts is much higher quality). Callers
 * that want to explicitly route to local should iterate the providers
 * and pick the local one; see voice.ts speak() for the fallback loop.
 *
 * Every other InferenceProvider method is stubbed — this provider only
 * does TTS.
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
import { getLocalInferenceSettings } from '../settings';

const TTS_MODEL = 'Xenova/mms-tts-eng';

function notImplemented<T>(method: string): InferenceResult<T> {
	return {
		ok: false,
		error: `TTS local provider: ${method} not supported`,
		target: 'local',
		providerId: 'tts-local',
		model: TTS_MODEL,
		latencyMs: 0
	};
}

interface TtsPipelineOutput {
	audio: Float32Array;
	sampling_rate: number;
}

type TtsPipelineFn = (text: string) => Promise<TtsPipelineOutput>;

/**
 * Encode a raw Float32Array of PCM samples into a WAV (RIFF) blob's
 * ArrayBuffer so the HTMLAudioElement can play it. 16-bit little-endian
 * signed samples, mono. 44-byte header.
 */
function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
	const numChannels = 1;
	const bitsPerSample = 16;
	const bytesPerSample = bitsPerSample / 8;
	const byteRate = sampleRate * numChannels * bytesPerSample;
	const blockAlign = numChannels * bytesPerSample;
	const dataSize = samples.length * bytesPerSample;
	const headerSize = 44;
	const totalSize = headerSize + dataSize;

	const buffer = new ArrayBuffer(totalSize);
	const view = new DataView(buffer);

	// "RIFF" chunk descriptor
	writeString(view, 0, 'RIFF');
	view.setUint32(4, totalSize - 8, true);
	writeString(view, 8, 'WAVE');

	// "fmt " sub-chunk
	writeString(view, 12, 'fmt ');
	view.setUint32(16, 16, true); // Subchunk1Size (PCM)
	view.setUint16(20, 1, true); // AudioFormat (PCM=1)
	view.setUint16(22, numChannels, true);
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, byteRate, true);
	view.setUint16(32, blockAlign, true);
	view.setUint16(34, bitsPerSample, true);

	// "data" sub-chunk
	writeString(view, 36, 'data');
	view.setUint32(40, dataSize, true);

	// Write samples, clamping to [-1, 1] then scaling to int16 range.
	for (let i = 0; i < samples.length; i++) {
		const sample = Math.max(-1, Math.min(1, samples[i]));
		view.setInt16(
			headerSize + i * 2,
			sample < 0 ? sample * 0x8000 : sample * 0x7fff,
			true
		);
	}

	return buffer;
}

function writeString(view: DataView, offset: number, str: string): void {
	for (let i = 0; i < str.length; i++) {
		view.setUint8(offset + i, str.charCodeAt(i));
	}
}

export class TtsLocalProvider implements InferenceProvider {
	get capabilities(): ProviderCapabilities {
		const settings = getLocalInferenceSettings();
		return {
			id: 'tts-local',
			target: 'local',
			supportsRealtime: false,
			// Only advertise TTS when local inference is turned on
			supportsTts: settings.enabled,
			supportsTranscribe: false,
			maxContextTokens: 0,
			models: [TTS_MODEL]
		};
	}

	async tts(input: TtsInput, _options?: TaskOptions): Promise<InferenceResult<TtsResult>> {
		const startedAt = Date.now();
		if (!input.text.trim()) {
			return {
				ok: false,
				error: 'TTS input is empty',
				target: 'local',
				providerId: 'tts-local',
				model: TTS_MODEL,
				latencyMs: 0
			};
		}

		try {
			const pipeline = (await loadPipeline('tts', TTS_MODEL)) as TtsPipelineFn;
			const result = await pipeline(input.text);
			const wav = encodeWav(result.audio, result.sampling_rate);
			return {
				ok: true,
				value: { audio: wav, mimeType: 'audio/wav' },
				target: 'local',
				providerId: 'tts-local',
				model: TTS_MODEL,
				latencyMs: Date.now() - startedAt
			};
		} catch (err) {
			return {
				ok: false,
				error: err instanceof Error ? err.message : 'Local TTS failed',
				target: 'local',
				providerId: 'tts-local',
				model: TTS_MODEL,
				latencyMs: Date.now() - startedAt
			};
		}
	}

	// --- Everything else is stubbed ---------------------------------------

	async summarize(
		_input: SummarizeInput,
		_options?: TaskOptions
	): Promise<InferenceResult<string>> {
		return notImplemented('summarize');
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
		_input: AnswerWithContextInput,
		_options?: TaskOptions
	): Promise<InferenceResult<AnsweredQuestion>> {
		return notImplemented('answerWithContext');
	}

	async generateTitle(
		_input: { text: string },
		_options?: TaskOptions
	): Promise<InferenceResult<string>> {
		return notImplemented('generateTitle');
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

	async transcribe(
		_input: TranscribeInput,
		_options?: TaskOptions
	): Promise<InferenceResult<TranscribeResult>> {
		return notImplemented('transcribe');
	}

	async realtimeSessionStart(
		_options?: RealtimeSessionOptions
	): Promise<InferenceResult<RealtimeSessionHandle>> {
		return notImplemented('realtimeSessionStart');
	}
}
