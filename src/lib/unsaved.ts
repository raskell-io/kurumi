/**
 * Last-moment edits when the page goes away (reload, closing the tab, a
 * shared file opening in this window). The IndexedDB write the editors
 * start on pagehide can be cut off by the unload, so the text is also put
 * in localStorage, which is written synchronously, and applied on the next
 * start if the note didn't get it.
 */

import { get } from 'svelte/store';
import { allMemoryObjects, updateMemoryObject } from '$lib/db';

const KEY = 'kurumi-unsaved-edits';

interface Stash {
	title: string;
	body: string;
	at: number;
}

function read(): Record<string, Stash> {
	try {
		return JSON.parse(localStorage.getItem(KEY) ?? '{}');
	} catch {
		return {};
	}
}

/** Keep a note's live text for the next start. Call from pagehide. */
export function stashEdit(id: string, title: string, body: string): void {
	try {
		localStorage.setItem(KEY, JSON.stringify({ ...read(), [id]: { title, body, at: Date.now() } }));
	} catch {
		// Storage full or blocked: the IndexedDB save is all we have.
	}
}

/** Apply stashed edits the stored notes are missing. Call once after the database loads. */
export function restoreStashedEdits(): number {
	const stashes = read();
	const ids = Object.keys(stashes);
	if (!ids.length) return 0;
	const notes = get(allMemoryObjects);
	let restored = 0;
	for (const id of ids) {
		const note = notes.find((m) => m.id === id);
		const stash = stashes[id];
		// Skip if the save made it, or the note changed after (sync, another tab).
		if (!note || (note.bodyMarkdown === stash.body && note.title === stash.title) || note.updatedAt > stash.at) continue;
		updateMemoryObject(id, { title: stash.title, bodyMarkdown: stash.body });
		restored++;
	}
	localStorage.removeItem(KEY);
	return restored;
}
