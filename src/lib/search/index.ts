import MiniSearch from 'minisearch';
import { memoryObjects, extractTags, extractPeople, getFolderPath } from '$lib/db';
import { get } from 'svelte/store';
import type { MemoryObject, MemoryType } from '$lib/db/types';

export interface SearchResult {
	id: string;
	title: string;
	content: string;
	score: number;
	match: Record<string, string[]>;
}

/**
 * Parsed filter operators extracted from a query string. Multiple
 * values are ORed within a field; different fields are ANDed together.
 *
 *   tag:work tag:urgent      → items with (#work OR #urgent)
 *   tag:work person:alice    → items with #work AND @alice
 *
 * Date filters are half-open: `after:2026-01-01` is strictly greater
 * than that ISO date, `before:2026-02-01` is strictly less.
 */
export interface SearchFilters {
	tag: string[];
	person: string[];
	folder: string[];
	type: MemoryType[];
	has: Array<'audio' | 'transcript' | 'meeting' | 'summary'>;
	after: string | null;
	before: string | null;
}

export interface ParsedQuery {
	text: string;
	filters: SearchFilters;
}

const ALL_MEMORY_TYPES: MemoryType[] = [
	'note',
	'voice-memo',
	'meeting',
	'task',
	'reference',
	'file'
];
const ALL_HAS: SearchFilters['has'] = ['audio', 'transcript', 'meeting', 'summary'];

function emptyFilters(): SearchFilters {
	return {
		tag: [],
		person: [],
		folder: [],
		type: [],
		has: [],
		after: null,
		before: null
	};
}

function isIsoDate(value: string): boolean {
	return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/**
 * Parse a query string into filter operators plus residual free text.
 *
 * Supported operators:
 *   tag:<name>            — #tag filter (lowercased)
 *   person:<name>         — @mentioned or participant (spaces stripped)
 *   folder:<name>         — folder name substring match (case-insensitive)
 *   after:<YYYY-MM-DD>    — createdAt >= date
 *   before:<YYYY-MM-DD>   — createdAt < date
 *   type:<memory-type>    — exact type match (note|voice-memo|meeting|…)
 *   has:audio|transcript|meeting|summary
 *
 * Operators can be repeated (multi-value, ORed). Quoted values like
 * `person:"Alice Smith"` are supported so names with spaces work.
 * Anything that doesn't match an operator is appended to the free-text
 * query that the MiniSearch index actually sees.
 */
export function parseSearchQuery(raw: string): ParsedQuery {
	const filters = emptyFilters();
	const textParts: string[] = [];

	// Regex splits on whitespace but keeps quoted strings intact.
	const tokenRegex = /("[^"]*"|\S+)/g;
	const matches = raw.match(tokenRegex) ?? [];

	for (const rawToken of matches) {
		const token = rawToken.replace(/^"|"$/g, '');
		const colonIndex = token.indexOf(':');
		if (colonIndex <= 0 || colonIndex >= token.length - 1) {
			if (token) textParts.push(token);
			continue;
		}
		const key = token.slice(0, colonIndex).toLowerCase();
		const rawValue = token.slice(colonIndex + 1).replace(/^"|"$/g, '');
		const value = rawValue.trim();
		if (!value) {
			textParts.push(token);
			continue;
		}

		switch (key) {
			case 'tag':
			case '#':
				filters.tag.push(value.toLowerCase().replace(/^#/, ''));
				break;
			case 'person':
			case '@':
				filters.person.push(value.toLowerCase().replace(/^@/, ''));
				break;
			case 'folder':
				filters.folder.push(value.toLowerCase());
				break;
			case 'after':
			case 'from':
				if (isIsoDate(value)) filters.after = value;
				else textParts.push(token);
				break;
			case 'before':
			case 'until':
				if (isIsoDate(value)) filters.before = value;
				else textParts.push(token);
				break;
			case 'type': {
				const lower = value.toLowerCase() as MemoryType;
				if ((ALL_MEMORY_TYPES as string[]).includes(lower)) {
					filters.type.push(lower);
				} else {
					textParts.push(token);
				}
				break;
			}
			case 'has': {
				const lower = value.toLowerCase() as SearchFilters['has'][number];
				if ((ALL_HAS as string[]).includes(lower)) {
					filters.has.push(lower);
				} else {
					textParts.push(token);
				}
				break;
			}
			default:
				// Unknown operator — keep the raw token in the text so the
				// user's typo doesn't silently swallow words.
				textParts.push(token);
		}
	}

	return {
		text: textParts.join(' ').trim(),
		filters
	};
}

export function hasAnyFilter(filters: SearchFilters): boolean {
	return (
		filters.tag.length > 0 ||
		filters.person.length > 0 ||
		filters.folder.length > 0 ||
		filters.type.length > 0 ||
		filters.has.length > 0 ||
		filters.after !== null ||
		filters.before !== null
	);
}

// --- Filter application -----------------------------------------------------

function memoryMatchesFilters(memory: MemoryObject, filters: SearchFilters): boolean {
	if (filters.type.length > 0 && !filters.type.includes(memory.type)) {
		return false;
	}
	if (filters.after && memory.createdAt < Date.parse(`${filters.after}T00:00:00`)) {
		return false;
	}
	if (filters.before && memory.createdAt >= Date.parse(`${filters.before}T00:00:00`)) {
		return false;
	}

	if (filters.tag.length > 0) {
		const memoryTags = new Set(
			[...memory.tags, ...extractTags(memory.bodyMarkdown)].map((t) => t.toLowerCase())
		);
		const hit = filters.tag.some((t) => memoryTags.has(t));
		if (!hit) return false;
	}

	if (filters.person.length > 0) {
		const memoryPeople = new Set<string>();
		for (const p of memory.participants ?? []) {
			memoryPeople.add(p.toLowerCase());
			memoryPeople.add(p.toLowerCase().replace(/\s+/g, ''));
		}
		for (const name of extractPeople(memory.bodyMarkdown)) {
			memoryPeople.add(name.toLowerCase());
			memoryPeople.add(name.toLowerCase().replace(/\s+/g, ''));
		}
		const hit = filters.person.some((p) => {
			const normalized = p.replace(/\s+/g, '');
			return memoryPeople.has(p) || memoryPeople.has(normalized);
		});
		if (!hit) return false;
	}

	if (filters.folder.length > 0) {
		if (!memory.folderId) return false;
		const path = getFolderPath(memory.folderId);
		const pathNames = path.map((f) => f.name.toLowerCase());
		const hit = filters.folder.some((f) => pathNames.some((name) => name.includes(f)));
		if (!hit) return false;
	}

	if (filters.has.length > 0) {
		for (const cap of filters.has) {
			switch (cap) {
				case 'audio':
					if (!memory.rawAudioRef) return false;
					break;
				case 'transcript':
					if (!memory.transcript || memory.transcript.trim().length === 0) return false;
					break;
				case 'meeting':
					if (memory.type !== 'meeting') return false;
					break;
				case 'summary':
					if (!memory.summaryShort && !memory.summaryLong) return false;
					break;
			}
		}
	}

	return true;
}

export function filterMemories(
	memories: MemoryObject[],
	filters: SearchFilters
): MemoryObject[] {
	if (!hasAnyFilter(filters)) return memories;
	return memories.filter((m) => memoryMatchesFilters(m, filters));
}

// --- Search index -----------------------------------------------------------

let searchIndex: MiniSearch<MemoryObject>;

function createIndex(): MiniSearch<MemoryObject> {
	return new MiniSearch<MemoryObject>({
		fields: ['title', 'bodyMarkdown', 'transcript', 'participants', 'topics', 'projects'],
		storeFields: ['title', 'bodyMarkdown'],
		extractField: (memory, fieldName) => {
			if (fieldName === 'transcript') return memory.transcript ?? '';
			if (fieldName === 'participants') return (memory.participants ?? []).join(' ');
			if (fieldName === 'topics') return (memory.topics ?? []).join(' ');
			if (fieldName === 'projects') return (memory.projects ?? []).join(' ');
			const value = (memory as unknown as Record<string, unknown>)[fieldName];
			return typeof value === 'string' ? value : '';
		},
		searchOptions: {
			boost: { title: 2, participants: 1.5, topics: 1.2 },
			fuzzy: 0.2,
			prefix: true
		}
	});
}

export function initSearch(): void {
	searchIndex = createIndex();
	rebuildIndex();
}

export function rebuildIndex(): void {
	const all = get(memoryObjects);
	searchIndex = createIndex();
	searchIndex.addAll(all);
}

function memoryToResult(memory: MemoryObject, score: number): SearchResult {
	return {
		id: memory.id,
		title: memory.title || 'Untitled',
		content: memory.bodyMarkdown || '',
		score,
		match: {}
	};
}

/**
 * Run a search query with optional filter operators.
 *
 * Three modes depending on what the parse produces:
 *
 *   1. Only filters (no text): return all memories matching the
 *      filters, sorted by updatedAt desc. Used for queries like
 *      "tag:work type:meeting" with no free-text.
 *   2. Only text: existing MiniSearch behavior.
 *   3. Text + filters: two-tier result. Tier 1 is text hits that also
 *      pass the filter (ranked by MiniSearch score). Tier 2 is
 *      filter-matching memories that had NO text match, ranked by
 *      updatedAt desc and appended below tier 1. This way filters
 *      act as a real scope — asking "tag:work budget" returns work
 *      memories mentioning budget at the top AND the rest of the
 *      work memories below, rather than the tiny intersection that
 *      post-filtering alone would produce.
 */
export function search(query: string): SearchResult[] {
	const trimmed = query.trim();
	if (!trimmed) return [];

	const parsed = parseSearchQuery(trimmed);
	const hasFilters = hasAnyFilter(parsed.filters);

	// Filters-only mode: bypass MiniSearch entirely.
	if (!parsed.text && hasFilters) {
		return filterMemories(get(memoryObjects), parsed.filters)
			.slice()
			.sort((a, b) => b.updatedAt - a.updatedAt)
			.map((memory) => memoryToResult(memory, 1));
	}

	// Text-only mode: unchanged MiniSearch pass.
	if (parsed.text && !hasFilters) {
		return searchIndex
			.search(parsed.text, {
				boost: { title: 2 },
				fuzzy: 0.2,
				prefix: true
			})
			.map((result) => ({
				id: result.id,
				title: result.title || 'Untitled',
				content: result.bodyMarkdown || '',
				score: result.score,
				match: result.match
			}));
	}

	// Text + filters mode: two-tier.
	if (parsed.text && hasFilters) {
		const allMemories = get(memoryObjects);
		const byId = new Map(allMemories.map((m) => [m.id, m]));

		// Tier 1: use MiniSearch's built-in filter callback so ranking
		// only considers memories that already pass the predicate.
		// Cleaner than post-filtering because MiniSearch's internal
		// scoring isn't wasted on documents that would be dropped.
		const tier1Results = searchIndex.search(parsed.text, {
			boost: { title: 2 },
			fuzzy: 0.2,
			prefix: true,
			filter: (result) => {
				const memory = byId.get(result.id as string);
				return memory ? memoryMatchesFilters(memory, parsed.filters) : false;
			}
		});
		const tier1Ids = new Set(tier1Results.map((r) => r.id as string));

		// Tier 2: filter-matching memories that didn't appear in tier 1,
		// sorted by updatedAt desc so the most recent ones bubble up.
		// This gives "everything matching the filter" semantics while
		// still letting text-match ranking take priority at the top.
		const tier2 = filterMemories(allMemories, parsed.filters)
			.filter((m) => !tier1Ids.has(m.id))
			.sort((a, b) => b.updatedAt - a.updatedAt)
			.map((memory) => memoryToResult(memory, 0));

		return [
			...tier1Results.map((result) => ({
				id: result.id,
				title: result.title || 'Untitled',
				content: result.bodyMarkdown || '',
				score: result.score,
				match: result.match
			})),
			...tier2
		];
	}

	return [];
}

export function addToIndex(memory: MemoryObject): void {
	// Remove existing entry if present
	try {
		searchIndex.discard(memory.id);
	} catch {
		// Wasn't in index
	}
	searchIndex.add(memory);
}

export function removeFromIndex(memoryId: string): void {
	try {
		searchIndex.discard(memoryId);
	} catch {
		// Wasn't in index
	}
}
