/**
 * Whisper-based local transcription provider.
 *
 * Uses transformers.js (loaded lazily) to run an ONNX Whisper model entirely
 * in the browser via WebGPU when available, falling back to WASM. The model
 * is downloaded once on first use (or via boot-time preload) and cached in
 * IndexedDB by transformers.js.
 *
 * This provider is registered before the remote OpenAIProvider so the
 * inference router prefers it for transcription. Other InferenceProvider
 * methods are stubbed because Whisper only does speech-to-text — text
 * generation will live in a separate local provider (Gemma family) once a
 * task actually needs it.
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
import { loadPipeline } from '../local-models';
import { getLocalInferenceSettings, whisperModelId } from '../settings';

function notImplemented<T>(method: string): InferenceResult<T> {
	return {
		ok: false,
		error: `Whisper local provider: ${method} not supported (text-only tasks should use a different provider)`,
		target: 'local',
		providerId: 'whisper-local',
		model: 'n/a',
		latencyMs: 0
	};
}

interface WhisperPipelineOutput {
	text: string;
	chunks?: Array<{
		text: string;
		timestamp: [number, number | null];
	}>;
}

type WhisperPipelineFn = (
	audio: Float32Array,
	options?: { return_timestamps?: boolean; chunk_length_s?: number; stride_length_s?: number }
) => Promise<WhisperPipelineOutput>;

export class WhisperLocalProvider implements InferenceProvider {
	get capabilities(): ProviderCapabilities {
		const settings = getLocalInferenceSettings();
		return {
			id: 'whisper-local',
			target: 'local',
			supportsRealtime: false,
			supportsTts: false,
			// When local inference is disabled in settings we expose
			// supportsTranscribe=false so the router skips us and falls through
			// to a remote provider (or fails cleanly if none is configured).
			supportsTranscribe: settings.enabled,
			maxContextTokens: 0,
			models: [whisperModelId(settings.whisperModel)]
		};
	}

	async transcribe(
		input: TranscribeInput,
		_options?: TaskOptions
	): Promise<InferenceResult<TranscribeResult>> {
		const settings = getLocalInferenceSettings();
		const modelId = whisperModelId(settings.whisperModel);
		const startedAt = Date.now();

		try {
			// Decode the audio blob into a Float32Array sampled at 16kHz mono
			// (Whisper's required input format).
			const samples = await decodeAudioToFloat32(input.audio, 16000);

			// dtype: 'fp32' avoids onnx-runtime QDQ bugs that hit q4/q8 variants
			// of the merged decoder. Bigger files but actually works in current
			// transformers.js + onnxruntime-web combinations.
			const pipeline = (await loadPipeline('transcribe', modelId, {
				dtype: 'fp32'
			})) as WhisperPipelineFn;

			const output = await pipeline(samples, {
				return_timestamps: true,
				chunk_length_s: 30,
				stride_length_s: 5
			});

			const segments: TranscriptSegment[] = (output.chunks ?? []).map((c) => ({
				start: c.timestamp[0] ?? 0,
				end: c.timestamp[1] ?? c.timestamp[0] ?? 0,
				text: c.text.trim()
			}));

			return {
				ok: true,
				value: {
					text: output.text.trim(),
					segments,
					language: input.language
				},
				target: 'local',
				providerId: 'whisper-local',
				model: modelId,
				latencyMs: Date.now() - startedAt
			};
		} catch (err) {
			return {
				ok: false,
				error: err instanceof Error ? err.message : 'Local transcription failed',
				target: 'local',
				providerId: 'whisper-local',
				model: modelId,
				latencyMs: Date.now() - startedAt
			};
		}
	}

	// --- stubs --------------------------------------------------------------

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

	async tts(_input: TtsInput, _options?: TaskOptions): Promise<InferenceResult<TtsResult>> {
		return notImplemented('tts');
	}

	async realtimeSessionStart(
		_options?: RealtimeSessionOptions
	): Promise<InferenceResult<RealtimeSessionHandle>> {
		return notImplemented('realtimeSessionStart');
	}
}

/**
 * Decode an arbitrary audio blob (webm/opus, mp4, mp3, ...) into mono PCM
 * samples at the target sample rate. Whisper expects 16kHz mono Float32.
 *
 * Uses the Web Audio API which all modern browsers support.
 */
async function decodeAudioToFloat32(blob: Blob, targetRate: number): Promise<Float32Array> {
	const arrayBuffer = await blob.arrayBuffer();
	const Ctx = window.AudioContext || (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
	if (!Ctx) {
		throw new Error('Web Audio API not available');
	}

	// A short-lived context just for decoding. We close it once done.
	const tempCtx = new Ctx();
	let audioBuffer: AudioBuffer;
	try {
		audioBuffer = await tempCtx.decodeAudioData(arrayBuffer.slice(0));
	} finally {
		await tempCtx.close().catch(() => {});
	}

	// Mix down to mono by averaging channels.
	const channelCount = audioBuffer.numberOfChannels;
	const sourceLength = audioBuffer.length;
	const mono = new Float32Array(sourceLength);
	for (let ch = 0; ch < channelCount; ch++) {
		const channelData = audioBuffer.getChannelData(ch);
		for (let i = 0; i < sourceLength; i++) {
			mono[i] += channelData[i] / channelCount;
		}
	}

	// Resample if necessary using a linear interpolation. For higher quality
	// we could use OfflineAudioContext, but linear is plenty for Whisper input.
	if (audioBuffer.sampleRate === targetRate) {
		return mono;
	}

	const ratio = audioBuffer.sampleRate / targetRate;
	const targetLength = Math.floor(sourceLength / ratio);
	const resampled = new Float32Array(targetLength);
	for (let i = 0; i < targetLength; i++) {
		const sourceIndex = i * ratio;
		const lower = Math.floor(sourceIndex);
		const upper = Math.min(lower + 1, sourceLength - 1);
		const frac = sourceIndex - lower;
		resampled[i] = mono[lower] * (1 - frac) + mono[upper] * frac;
	}
	return resampled;
}
