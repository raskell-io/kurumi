/// <reference lib="webworker" />
/**
 * Embedding inference off the main thread. Model inference takes tens of
 * milliseconds per note, and indexing a large vault runs it thousands of
 * times, which froze typing and search when it ran on the main thread.
 *
 * Protocol (see local-models.ts):
 *   → { id, kind: 'load' | 'embed', model, texts?, options? }
 *   ← { type: 'progress', model, event }   model download/initialisation
 *   ← { type: 'done', id, data?, dims? }   data: Float32Array (transferred)
 *   ← { type: 'error', id, message }
 */

import { pipeline } from '@huggingface/transformers';

type Extractor = (
	texts: string[],
	options: { pooling: 'mean'; normalize: boolean }
) => Promise<{ data: ArrayLike<number>; dims: number[] }>;

let loaded: { model: string; extractor: Promise<Extractor> } | null = null;

function load(model: string, options: Record<string, unknown>): Promise<Extractor> {
	if (loaded?.model !== model) {
		loaded = {
			model,
			extractor: pipeline('feature-extraction', model, {
				...options,
				progress_callback: (event: unknown) => self.postMessage({ type: 'progress', model, event })
			} as Parameters<typeof pipeline>[2]) as unknown as Promise<Extractor>
		};
	}
	return loaded.extractor;
}

self.onmessage = async ({ data }: MessageEvent) => {
	const { id, kind, model, texts, options } = data as {
		id: number;
		kind: 'load' | 'embed';
		model: string;
		texts?: string[];
		options?: Record<string, unknown>;
	};
	try {
		const extractor = await load(model, options ?? {});
		if (kind === 'load') {
			self.postMessage({ type: 'done', id });
			return;
		}
		const output = await extractor(texts ?? [], { pooling: 'mean', normalize: true });
		// Copy out of the runtime's buffers before transferring.
		const vectors = Float32Array.from(output.data);
		self.postMessage({ type: 'done', id, data: vectors, dims: output.dims }, [vectors.buffer]);
	} catch (err) {
		if (kind === 'load') loaded = null; // let a later call retry the download
		self.postMessage({ type: 'error', id, message: err instanceof Error ? err.message : String(err) });
	}
};
