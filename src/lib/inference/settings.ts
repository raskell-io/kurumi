/**
 * Local inference settings — persisted in localStorage and exposed as a
 * Svelte store so UI can react.
 *
 * Defaults are deliberately permissive: local inference is enabled and
 * preloaded out of the box so capture-time features (transcription, etc.)
 * work offline without any per-user configuration.
 */

import { writable, get, type Writable } from 'svelte/store';

const STORAGE_KEY = 'kurumi-local-inference';

export type WhisperModelSize = 'tiny' | 'base' | 'small';
export type TextModelChoice = 'smollm2-360m' | 'qwen2-0_5b';

export interface LocalInferenceSettings {
	enabled: boolean;
	preloadOnStartup: boolean;
	whisperModel: WhisperModelSize;
	// Text generation is opt-in because the model download is significant
	// (~360 MB minimum) and inference quality at this size is uneven.
	textModelEnabled: boolean;
	textModel: TextModelChoice;
}

const DEFAULTS: LocalInferenceSettings = {
	enabled: true,
	preloadOnStartup: true,
	// Default to tiny because we run it un-quantized (fp32) for compatibility,
	// which makes base/small unreasonably large as a default download.
	whisperModel: 'tiny',
	textModelEnabled: false,
	textModel: 'smollm2-360m'
};

function loadFromStorage(): LocalInferenceSettings {
	if (typeof localStorage === 'undefined') return DEFAULTS;
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return DEFAULTS;
		const parsed = JSON.parse(raw) as Partial<LocalInferenceSettings>;
		return { ...DEFAULTS, ...parsed };
	} catch {
		return DEFAULTS;
	}
}

function saveToStorage(value: LocalInferenceSettings): void {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
	} catch {
		// Out of quota or disabled — ignore
	}
}

export const localInferenceSettings: Writable<LocalInferenceSettings> = writable(loadFromStorage());

localInferenceSettings.subscribe((value) => {
	saveToStorage(value);
});

export function getLocalInferenceSettings(): LocalInferenceSettings {
	return get(localInferenceSettings);
}

export function updateLocalInferenceSettings(patch: Partial<LocalInferenceSettings>): void {
	localInferenceSettings.update((current) => ({ ...current, ...patch }));
}

/**
 * Map a Whisper model size to the actual transformers.js model id.
 *
 * We use the `onnx-community` org's exports rather than the older
 * `Xenova/*` ones. The Xenova exports use a quantization metadata format
 * that the current onnxruntime-web (shipped with transformers.js v4)
 * rejects with "Missing required scale" errors. The onnx-community
 * variants are maintained against the current runtime.
 */
export function whisperModelId(size: WhisperModelSize): string {
	switch (size) {
		case 'tiny':
			return 'onnx-community/whisper-tiny';
		case 'base':
			return 'onnx-community/whisper-base';
		case 'small':
			return 'onnx-community/whisper-small';
	}
}

export function whisperModelLabel(size: WhisperModelSize): string {
	// Sizes assume fp32 weights — we use unquantized models to avoid the
	// onnx-runtime QDQ bugs that hit q4 variants.
	switch (size) {
		case 'tiny':
			return 'Whisper Tiny (~150 MB) — fastest, default';
		case 'base':
			return 'Whisper Base (~290 MB) — balanced';
		case 'small':
			return 'Whisper Small (~970 MB) — slower, best accuracy';
	}
}

/**
 * Map a text model choice to a transformers.js model id. These are
 * onnx-quantized variants suitable for in-browser inference via WebGPU/WASM.
 */
export function textModelId(choice: TextModelChoice): string {
	switch (choice) {
		case 'smollm2-360m':
			return 'HuggingFaceTB/SmolLM2-360M-Instruct';
		case 'qwen2-0_5b':
			return 'onnx-community/Qwen2.5-0.5B-Instruct';
	}
}

export function textModelLabel(choice: TextModelChoice): string {
	switch (choice) {
		case 'smollm2-360m':
			return 'SmolLM2 360M (~360 MB) — small, fast';
		case 'qwen2-0_5b':
			return 'Qwen2.5 0.5B (~500 MB) — slightly bigger, better';
	}
}
