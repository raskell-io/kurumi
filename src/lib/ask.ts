/**
 * Ask Kurumi — natural-language question answering over the user's memories.
 *
 * Pipeline:
 *   1. Use the existing MiniSearch index to find candidate memories whose
 *      title / body / transcript / participants / topics match the question.
 *   2. Build bounded context blocks from the top N candidates.
 *   3. Call answerWithContext on the inference router (currently OpenAI only).
 *   4. Return the answer plus the cited memories so the UI can render
 *      clickable citations.
 *
 * This is the v1 retrieval-augmented generation flow. It uses keyword
 * retrieval rather than semantic embeddings — semantic search is a separate
 * future epic that can plug in here without changing the call site.
 */

import { search } from './search';
import { getMemoryObject, memoryObjects } from './db';
import type { MemoryObject } from './db/types';
import { inferenceRouter } from './inference';
import type { AskTurn } from './inference';
import { semanticSearch } from './embeddings';
import { get } from 'svelte/store';

const MAX_CONTEXT_MEMORIES = 8;
// Roughly the per-memory text budget. Keeps total prompt well within
// gpt-4o-mini's window even with 8 memories — 8 × 1500 chars ≈ 3-4k tokens.
const PER_MEMORY_CHAR_BUDGET = 1500;

export interface AskKurumiResult {
	answer: string;
	citations: MemoryObject[];
	candidates: MemoryObject[];
	model: string;
	latencyMs: number;
}

export interface AskKurumiError {
	error: string;
}

/**
 * Returns true iff a provider that can answer questions is currently
 * registered. Used by UI to decide whether to show the Ask input or fall
 * back to the recent-captures view.
 */
export function isAskKurumiAvailable(): boolean {
	return !!inferenceRouter.findProvider(() => true);
}

export async function askKurumi(
	question: string,
	priorTurns: AskTurn[] = []
): Promise<AskKurumiResult | AskKurumiError> {
	const trimmed = question.trim();
	if (!trimmed) {
		return { error: 'Please enter a question.' };
	}

	// 1. Hybrid retrieval: union of keyword hits (MiniSearch) and semantic
	// hits (local embeddings). Both run in parallel; we then dedupe by
	// memory id and take the top N. The order interleaves the two ranked
	// lists so the strongest match from each path is at the top.
	const [keywordHits, semanticHits] = await Promise.all([
		Promise.resolve(search(trimmed)),
		semanticSearch(trimmed, MAX_CONTEXT_MEMORIES).catch(() => [])
	]);

	const seen = new Set<string>();
	const candidateMemories: MemoryObject[] = [];
	const pushMemory = (id: string) => {
		if (seen.has(id)) return;
		const memory = getMemoryObject(id);
		if (!memory) return;
		seen.add(id);
		candidateMemories.push(memory);
	};

	// Interleave: best keyword, best semantic, second keyword, second semantic, ...
	const maxLen = Math.max(keywordHits.length, semanticHits.length);
	for (let i = 0; i < maxLen && candidateMemories.length < MAX_CONTEXT_MEMORIES; i++) {
		if (i < keywordHits.length) pushMemory(keywordHits[i].id);
		if (i < semanticHits.length) pushMemory(semanticHits[i].memoryId);
	}

	// Fallback: if both retrieval paths returned nothing (e.g. brand-new
	// vault, no embeddings yet, very short question), use the most recent
	// memories so the model has at least something to look at instead of
	// failing immediately.
	if (candidateMemories.length === 0) {
		const recent = get(memoryObjects).slice(0, MAX_CONTEXT_MEMORIES);
		for (const m of recent) pushMemory(m.id);
	}

	if (candidateMemories.length === 0) {
		return { error: 'No memories yet. Capture a few notes or recordings first.' };
	}

	// 2. Build context blocks: title + best-available text excerpt.
	const contextBlocks = candidateMemories.map((memory) => {
		const sourceText = pickContextText(memory);
		const excerpt = sourceText.slice(0, PER_MEMORY_CHAR_BUDGET);
		const titleLine = `# ${memory.title || 'Untitled'}`;
		return {
			memoryId: memory.id,
			text: `${titleLine}\n${excerpt}`
		};
	});

	// 3. Find a provider that can answer with context. The router doesn't
	// have a per-task capability flag for this yet, so we walk providers
	// and try the first one whose answerWithContext succeeds.
	for (const provider of inferenceRouter.allProviders()) {
		try {
			const result = await provider.answerWithContext({
				question: trimmed,
				context: contextBlocks,
				priorTurns
			});
			if (result.ok && result.value) {
				const citationIds = new Set(result.value.citations);
				const citations = candidateMemories.filter((m) => citationIds.has(m.id));
				return {
					answer: result.value.answer,
					citations,
					candidates: candidateMemories,
					model: result.model,
					latencyMs: result.latencyMs
				};
			}
		} catch {
			// Try next provider
		}
	}

	return {
		error:
			'No inference provider could answer the question. Configure your OpenAI API key in Settings → AI Assistant.'
	};
}

/**
 * Pick the most useful text representation of a memory for Q&A context.
 * For voice memos and meetings the transcript is the source of truth; for
 * notes the markdown body is. Falls back gracefully when fields are empty.
 */
function pickContextText(memory: MemoryObject): string {
	if (memory.summaryShort && memory.summaryLong) {
		return `${memory.summaryShort}\n\n${memory.summaryLong}`;
	}
	if (memory.transcript && memory.transcript.length > 0) {
		return memory.transcript;
	}
	if (memory.bodyMarkdown && memory.bodyMarkdown.length > 0) {
		return memory.bodyMarkdown;
	}
	if (memory.summaryShort) return memory.summaryShort;
	return '';
}

export function isAskKurumiResult(
	value: AskKurumiResult | AskKurumiError
): value is AskKurumiResult {
	return 'answer' in value;
}
