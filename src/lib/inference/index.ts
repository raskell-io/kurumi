/**
 * Public entry point for the inference layer.
 *
 * Importing this module registers the built-in providers with the shared
 * inferenceRouter as a side effect. Local providers are registered FIRST so
 * the router prefers on-device inference and only falls back to remote when
 * the local path is unavailable or disabled.
 *
 * Providers self-check whether they're configured (settings, API keys, model
 * downloads) at call time, so it's safe to register them unconditionally.
 */

import { inferenceRouter } from './router';
import { WhisperLocalProvider } from './providers/whisper-local';
import { TextLocalProvider } from './providers/text-local';
import { TtsLocalProvider } from './providers/tts-local';
import { OpenAIProvider } from './providers/openai';

// Order matters: SimpleInferenceRouter.findProvider walks providers in
// insertion order and returns the first match. Local first → local wins
// for transcribe + text generation. TTS is the exception — remote
// OpenAI TTS is much higher quality than the local MMS model, so the
// OpenAI provider is registered BEFORE TtsLocalProvider. voice.ts
// speak() iterates providers in order and tries each until one returns
// ok, so TtsLocalProvider acts as a graceful fallback when the OpenAI
// API key is missing or the request fails.
inferenceRouter.register(new WhisperLocalProvider());
inferenceRouter.register(new TextLocalProvider());
inferenceRouter.register(new OpenAIProvider());
inferenceRouter.register(new TtsLocalProvider());

export * from './types';
export { inferenceRouter, SimpleInferenceRouter } from './router';
export {
	localInferenceSettings,
	getLocalInferenceSettings,
	updateLocalInferenceSettings,
	whisperModelId,
	whisperModelLabel,
	textModelId,
	textModelLabel,
	embedModelId,
	embedModelLabel,
	type LocalInferenceSettings,
	type WhisperModelSize,
	type TextModelChoice,
	type EmbedModelChoice
} from './settings';
export {
	localModelStatus,
	getModelStatus,
	loadPipeline,
	preloadPipeline,
	isPipelineReady,
	clearLocalModelCache,
	type ModelStatus,
	type LocalTask
} from './local-models';
