/**
 * Local model manager.
 *
 * Wraps transformers.js so the rest of the app doesn't need to know how
 * Hugging Face pipelines are loaded or cached. Models are downloaded once
 * by transformers.js into IndexedDB and re-used on subsequent runs.
 *
 * The transformers.js runtime is dynamically imported so it doesn't bloat
 * the initial bundle — only users who actually need local inference pay the
 * download cost (the runtime itself, not the model weights).
 */

import { writable, get, type Writable } from 'svelte/store';

// --- Public types -----------------------------------------------------------

export type LocalTask = 'transcribe' | 'text-generation';

export type ModelStatus =
	| { state: 'idle' }
	| { state: 'loading'; progress: number; phase: string }
	| { state: 'ready' }
	| { state: 'error'; error: string };

export interface LocalModelStatuses {
	[key: string]: ModelStatus; // key = `${task}:${model}`
}

// --- Status store -----------------------------------------------------------

export const localModelStatus: Writable<LocalModelStatuses> = writable({});

function setStatus(key: string, status: ModelStatus): void {
	localModelStatus.update((current) => ({ ...current, [key]: status }));
}

export function getModelStatus(task: LocalTask, model: string): ModelStatus {
	return get(localModelStatus)[`${task}:${model}`] ?? { state: 'idle' };
}

// --- Pipeline cache ---------------------------------------------------------

// Pipelines are heavyweight, so we cache instances by `${task}:${model}` and
// share concurrent load promises so two callers don't trigger two downloads.
const pipelineCache = new Map<string, unknown>();
const pendingLoads = new Map<string, Promise<unknown>>();

interface ProgressEvent {
	status: string;
	progress?: number;
	loaded?: number;
	total?: number;
	file?: string;
}

/**
 * Load (or retrieve from cache) the transformers.js pipeline for a given
 * task + model. Updates the localModelStatus store as the download/load
 * progresses so UI can show feedback.
 */
export async function loadPipeline(task: LocalTask, model: string): Promise<unknown> {
	const key = `${task}:${model}`;

	// Already loaded
	if (pipelineCache.has(key)) {
		return pipelineCache.get(key);
	}

	// Already loading — share the promise
	if (pendingLoads.has(key)) {
		return pendingLoads.get(key)!;
	}

	const loadPromise = (async () => {
		setStatus(key, { state: 'loading', progress: 0, phase: 'starting' });

		try {
			// Dynamic import keeps transformers.js out of the initial bundle.
			const transformers = await import('@huggingface/transformers');
			const { pipeline } = transformers;

			const transformersTask = mapTaskToTransformers(task) as Parameters<typeof pipeline>[0];
			const instance = await pipeline(transformersTask, model, {
				progress_callback: (event: ProgressEvent) => {
					if (event.status === 'progress' && typeof event.progress === 'number') {
						setStatus(key, {
							state: 'loading',
							progress: event.progress,
							phase: event.file || 'downloading'
						});
					} else if (event.status === 'done') {
						setStatus(key, { state: 'loading', progress: 100, phase: 'initializing' });
					} else if (event.status === 'ready') {
						setStatus(key, { state: 'ready' });
					}
				}
			});

			pipelineCache.set(key, instance);
			setStatus(key, { state: 'ready' });
			return instance;
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Failed to load model';
			setStatus(key, { state: 'error', error: message });
			throw err;
		} finally {
			pendingLoads.delete(key);
		}
	})();

	pendingLoads.set(key, loadPromise);
	return loadPromise;
}

/**
 * Trigger a pipeline load without awaiting it. Used for boot-time preloading.
 * Errors are swallowed because preload is best-effort.
 */
export function preloadPipeline(task: LocalTask, model: string): void {
	loadPipeline(task, model).catch((err) => {
		console.warn(`[local-models] preload of ${task}:${model} failed:`, err);
	});
}

export function isPipelineReady(task: LocalTask, model: string): boolean {
	return pipelineCache.has(`${task}:${model}`);
}

// --- Internal helpers -------------------------------------------------------

function mapTaskToTransformers(task: LocalTask): string {
	switch (task) {
		case 'transcribe':
			return 'automatic-speech-recognition';
		case 'text-generation':
			return 'text-generation';
		default:
			throw new Error(`Unknown local task: ${task}`);
	}
}
