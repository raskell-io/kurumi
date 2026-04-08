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

export interface LocalInferenceSettings {
	enabled: boolean;
	preloadOnStartup: boolean;
	whisperModel: WhisperModelSize;
}

const DEFAULTS: LocalInferenceSettings = {
	enabled: true,
	preloadOnStartup: true,
	whisperModel: 'base'
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
 * The Xenova org publishes ONNX-quantized variants of OpenAI Whisper.
 */
export function whisperModelId(size: WhisperModelSize): string {
	switch (size) {
		case 'tiny':
			return 'Xenova/whisper-tiny';
		case 'base':
			return 'Xenova/whisper-base';
		case 'small':
			return 'Xenova/whisper-small';
	}
}

export function whisperModelLabel(size: WhisperModelSize): string {
	switch (size) {
		case 'tiny':
			return 'Whisper Tiny (~75 MB) — fastest, lower accuracy';
		case 'base':
			return 'Whisper Base (~150 MB) — balanced (default)';
		case 'small':
			return 'Whisper Small (~470 MB) — slower, best accuracy';
	}
}
