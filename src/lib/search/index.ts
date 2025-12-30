import MiniSearch from 'minisearch';
import { notes } from '$lib/db';
import { get } from 'svelte/store';
import type { Note } from '$lib/db/types';

export interface SearchResult {
	id: string;
	title: string;
	content: string;
	score: number;
	match: Record<string, string[]>;
}

let searchIndex: MiniSearch<Note>;

function createIndex(): MiniSearch<Note> {
	return new MiniSearch<Note>({
		fields: ['title', 'content'],
		storeFields: ['title', 'content'],
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
	const allNotes = get(notes);
	searchIndex = createIndex();
	searchIndex.addAll(allNotes);
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
		content: result.content || '',
		score: result.score,
		match: result.match
	}));
}

export function addToIndex(note: Note): void {
	// Remove existing entry if present
	try {
		searchIndex.discard(note.id);
	} catch {
		// Note wasn't in index
	}
	searchIndex.add(note);
}

export function removeFromIndex(noteId: string): void {
	try {
		searchIndex.discard(noteId);
	} catch {
		// Note wasn't in index
	}
}
