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
import { OpenAIProvider } from './providers/openai';

// Order matters: SimpleInferenceRouter.findProvider walks providers in
// insertion order and returns the first match. Local first → local wins.
inferenceRouter.register(new WhisperLocalProvider());
inferenceRouter.register(new TextLocalProvider());
inferenceRouter.register(new OpenAIProvider());

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
	type LocalInferenceSettings,
	type WhisperModelSize,
	type TextModelChoice
} from './settings';
export {
	localModelStatus,
	getModelStatus,
	loadPipeline,
	preloadPipeline,
	isPipelineReady,
	type ModelStatus,
	type LocalTask
} from './local-models';
