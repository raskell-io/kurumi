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

import { search, parseSearchQuery, filterMemories, hasAnyFilter } from './search';
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

/**
 * Hybrid retrieval over the current vault for a given question.
 * Returns a ranked list of candidate memories — the same list
 * askKurumi() feeds to answerWithContext. Exported so other surfaces
 * (e.g. the Realtime voice session's search_memory tool) can reuse
 * the same retrieval without the full answer-generation step.
 *
 * Filter operators in the question (`tag:work`, `person:alice`,
 * `type:meeting`, etc.) are honoured: keyword search already filters
 * internally, and semantic hits are post-filtered with the same
 * predicate so both retrieval paths respect the constraints.
 */
export async function retrieveMemoryContext(
	question: string,
	limit: number = MAX_CONTEXT_MEMORIES
): Promise<MemoryObject[]> {
	const trimmed = question.trim();
	if (!trimmed) return [];

	// Parse once so both retrieval paths share the same filters and the
	// semantic search runs against the plain-text portion only.
	const parsed = parseSearchQuery(trimmed);
	const filtersActive = hasAnyFilter(parsed.filters);
	const semanticQuery = parsed.text || trimmed;

	const [keywordHits, rawSemanticHits] = await Promise.all([
		Promise.resolve(search(trimmed)),
		semanticSearch(semanticQuery, limit).catch(() => [])
	]);

	// Semantic search doesn't know about filters — post-filter its hits
	// so a `tag:work` constraint still applies to embedding matches.
	let semanticHits = rawSemanticHits;
	if (filtersActive) {
		const filteredIds = new Set(
			filterMemories(
				rawSemanticHits
					.map((h) => getMemoryObject(h.memoryId))
					.filter((m): m is MemoryObject => !!m),
				parsed.filters
			).map((m) => m.id)
		);
		semanticHits = rawSemanticHits.filter((h) => filteredIds.has(h.memoryId));
	}

	const seen = new Set<string>();
	const candidates: MemoryObject[] = [];
	const pushMemory = (id: string) => {
		if (seen.has(id)) return;
		const memory = getMemoryObject(id);
		if (!memory) return;
		seen.add(id);
		candidates.push(memory);
	};

	const maxLen = Math.max(keywordHits.length, semanticHits.length);
	for (let i = 0; i < maxLen && candidates.length < limit; i++) {
		if (i < keywordHits.length) pushMemory(keywordHits[i].id);
		if (i < semanticHits.length) pushMemory(semanticHits[i].memoryId);
	}

	if (candidates.length === 0) {
		// Fallback: if nothing matched, use recent memories filtered by
		// the same constraints. This way "tag:work" with no text still
		// returns something useful even if neither retrieval path fired.
		const recent = get(memoryObjects);
		const pool = filtersActive
			? filterMemories(recent, parsed.filters)
			: recent;
		for (const m of pool.slice(0, limit)) pushMemory(m.id);
	}

	return candidates;
}

/**
 * Build compact {memoryId, text} context blocks from a list of
 * memories. Shared by askKurumi and the Realtime tool handler so both
 * surfaces agree on how much text each memory contributes.
 */
export function buildContextBlocks(
	memories: MemoryObject[]
): Array<{ memoryId: string; text: string }> {
	return memories.map((memory) => {
		const sourceText = pickContextText(memory);
		const excerpt = sourceText.slice(0, PER_MEMORY_CHAR_BUDGET);
		const titleLine = `# ${memory.title || 'Untitled'}`;
		return {
			memoryId: memory.id,
			text: `${titleLine}\n${excerpt}`
		};
	});
}

export async function askKurumi(
	question: string,
	priorTurns: AskTurn[] = []
): Promise<AskKurumiResult | AskKurumiError> {
	const trimmed = question.trim();
	if (!trimmed) {
		return { error: 'Please enter a question.' };
	}

	const candidateMemories = await retrieveMemoryContext(trimmed, MAX_CONTEXT_MEMORIES);

	if (candidateMemories.length === 0) {
		return { error: 'No memories yet. Capture a few notes or recordings first.' };
	}

	const contextBlocks = buildContextBlocks(candidateMemories);

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
