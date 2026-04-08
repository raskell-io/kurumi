/**
 * Semantic search via local embeddings.
 *
 * Pipeline:
 *   1. Load a small sentence-transformer model (default: all-MiniLM-L6-v2)
 *      via transformers.js. Same LocalModelManager handles caching + status.
 *   2. For each memory, hash a "summary text" (title + transcript/body) and
 *      cache the embedding in IndexedDB keyed by memory id + content hash.
 *      Re-embed only when content changes or when an embedding is missing.
 *   3. Encode the search query the same way and rank stored embeddings by
 *      cosine similarity.
 *
 * Embeddings live in their own idb-keyval store (separate from the
 * Automerge document and the blob store) because they're large dense
 * arrays that don't belong in the CRDT.
 */

import { createStore, set, get, del } from 'idb-keyval';
import { loadPipeline, getModelStatus } from './inference/local-models';
import {
	getLocalInferenceSettings,
	embedModelId
} from './inference/settings';
import { memoryObjects } from './db';
import { get as svelteGet } from 'svelte/store';
import type { MemoryObject } from './db/types';

const embeddingsStore = createStore('kurumi-embeddings', 'embeddings');

interface StoredEmbedding {
	memoryId: string;
	contentHash: string;
	vector: number[];
	updatedAt: number;
}

interface EmbedPipelineFn {
	(text: string, options?: { pooling?: 'mean'; normalize?: boolean }): Promise<{
		data: Float32Array | number[];
	}>;
}

let pipelineCache: EmbedPipelineFn | null = null;
let pipelineModelId: string | null = null;

/**
 * Cheap content hash so we re-embed only when the source text actually
 * changes. djb2-style — collisions are fine for our purpose since the
 * memoryId already isolates per-memory keying.
 */
function contentHash(text: string): string {
	let hash = 5381;
	for (let i = 0; i < text.length; i++) {
		hash = (hash * 33) ^ text.charCodeAt(i);
	}
	return (hash >>> 0).toString(36);
}

/**
 * Build the canonical text we feed into the embedding model. Mirrors what
 * Ask Kurumi feeds the LLM so retrieval and synthesis see the same content.
 */
function buildEmbedText(memory: MemoryObject): string {
	const title = memory.title || '';
	const summary = memory.summaryShort ?? '';
	const transcript = memory.transcript ?? '';
	const body = memory.bodyMarkdown ?? '';
	// Truncate aggressively — embedding context is small, and the title
	// + first chunk of body/transcript is enough for relevance.
	const sourceText = transcript.length > 0 ? transcript : body;
	return [title, summary, sourceText].filter(Boolean).join('\n').slice(0, 4000);
}

async function getEmbedPipeline(): Promise<EmbedPipelineFn | null> {
	const settings = getLocalInferenceSettings();
	if (!settings.enabled || !settings.embedModelEnabled) {
		return null;
	}
	const modelId = embedModelId(settings.embedModel);
	if (pipelineCache && pipelineModelId === modelId) {
		return pipelineCache;
	}
	pipelineCache = (await loadPipeline('embed', modelId)) as EmbedPipelineFn;
	pipelineModelId = modelId;
	return pipelineCache;
}

/**
 * Encode arbitrary text into a normalized embedding vector. Used by both
 * the indexing path (memories) and the query path (Ask Kurumi questions).
 */
export async function embedText(text: string): Promise<number[] | null> {
	const pipeline = await getEmbedPipeline();
	if (!pipeline) return null;
	const result = await pipeline(text, { pooling: 'mean', normalize: true });
	return Array.from(result.data);
}

/**
 * Generate or refresh embeddings for every memory in the current vault that
 * doesn't have a stored embedding for its current content. Idempotent — safe
 * to call repeatedly. Best-effort: errors on individual memories are logged
 * but don't abort the whole pass.
 */
export async function indexAllMemories(): Promise<{
	processed: number;
	skipped: number;
	errors: number;
}> {
	const settings = getLocalInferenceSettings();
	if (!settings.enabled || !settings.embedModelEnabled) {
		return { processed: 0, skipped: 0, errors: 0 };
	}

	const memories = svelteGet(memoryObjects);
	let processed = 0;
	let skipped = 0;
	let errors = 0;

	for (const memory of memories) {
		const text = buildEmbedText(memory);
		if (!text.trim()) {
			skipped++;
			continue;
		}
		const hash = contentHash(text);
		try {
			const existing = await get<StoredEmbedding>(memory.id, embeddingsStore);
			if (existing && existing.contentHash === hash) {
				skipped++;
				continue;
			}
			const vector = await embedText(text);
			if (!vector) {
				skipped++;
				continue;
			}
			const stored: StoredEmbedding = {
				memoryId: memory.id,
				contentHash: hash,
				vector,
				updatedAt: Date.now()
			};
			await set(memory.id, stored, embeddingsStore);
			processed++;
		} catch (err) {
			console.warn('[embeddings] failed to index memory', memory.id, err);
			errors++;
		}
	}

	return { processed, skipped, errors };
}

/**
 * Compute cosine similarity between two normalized vectors. Both inputs
 * MUST be unit-normalized — the embed pipeline does this when called with
 * { normalize: true }, so the caller doesn't have to think about it.
 */
function cosine(a: number[], b: number[]): number {
	if (a.length !== b.length) return 0;
	let dot = 0;
	for (let i = 0; i < a.length; i++) {
		dot += a[i] * b[i];
	}
	return dot;
}

export interface SemanticHit {
	memoryId: string;
	similarity: number;
}

/**
 * Find the top-K memories whose stored embeddings are most similar to the
 * query embedding. Returns an empty array if the embed pipeline isn't
 * available or no embeddings exist yet.
 */
export async function semanticSearch(
	query: string,
	topK = 8
): Promise<SemanticHit[]> {
	const settings = getLocalInferenceSettings();
	if (!settings.enabled || !settings.embedModelEnabled) {
		return [];
	}

	// Make sure the index is current. This is cheap if everything is already
	// indexed, since the hash check skips most memories.
	await indexAllMemories();

	const queryVector = await embedText(query);
	if (!queryVector) return [];

	const hits: SemanticHit[] = [];
	const memories = svelteGet(memoryObjects);
	const validIds = new Set(memories.map((m) => m.id));

	for (const memory of memories) {
		if (!validIds.has(memory.id)) continue;
		const stored = await get<StoredEmbedding>(memory.id, embeddingsStore);
		if (!stored) continue;
		const similarity = cosine(queryVector, stored.vector);
		hits.push({ memoryId: memory.id, similarity });
	}

	hits.sort((a, b) => b.similarity - a.similarity);
	return hits.slice(0, topK);
}

/**
 * Drop a memory's stored embedding. Called when memories are permanently
 * deleted so the embedding store doesn't accumulate orphans.
 */
export async function deleteEmbedding(memoryId: string): Promise<void> {
	try {
		await del(memoryId, embeddingsStore);
	} catch {
		// Ignore — best effort
	}
}

/**
 * Returns true iff the embedding pipeline can currently produce vectors.
 * Used by Ask Kurumi to decide whether to attempt semantic retrieval.
 */
export function isSemanticSearchReady(): boolean {
	const settings = getLocalInferenceSettings();
	if (!settings.enabled || !settings.embedModelEnabled) return false;
	const modelId = embedModelId(settings.embedModel);
	const status = getModelStatus('embed', modelId);
	return status.state === 'ready';
}
