/**
 * Public entry point for the inference layer.
 *
 * Importing this module also registers the built-in providers with the
 * shared inferenceRouter as a side effect. Providers self-check whether
 * they're configured (API keys etc.) at call time, so it's safe to
 * register them unconditionally.
 */

import { inferenceRouter } from './router';
import { OpenAIProvider } from './providers/openai';

inferenceRouter.register(new OpenAIProvider());

export * from './types';
export { inferenceRouter, SimpleInferenceRouter } from './router';
