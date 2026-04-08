import MiniSearch from 'minisearch';
import { memoryObjects } from '$lib/db';
import { get } from 'svelte/store';
import type { MemoryObject } from '$lib/db/types';

export interface SearchResult {
	id: string;
	title: string;
	content: string;
	score: number;
	match: Record<string, string[]>;
}

let searchIndex: MiniSearch<MemoryObject>;

function createIndex(): MiniSearch<MemoryObject> {
	return new MiniSearch<MemoryObject>({
		fields: ['title', 'bodyMarkdown'],
		storeFields: ['title', 'bodyMarkdown'],
		searchOptions: {
			boost: { title: 2 },
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

export function search(query: string): SearchResult[] {
	if (!query.trim()) return [];

	const results = searchIndex.search(query, {
		boost: { title: 2 },
		fuzzy: 0.2,
		prefix: true
	});

	return results.map((result) => ({
		id: result.id,
		title: result.title || 'Untitled',
		content: result.bodyMarkdown || '',
		score: result.score,
		match: result.match
	}));
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
