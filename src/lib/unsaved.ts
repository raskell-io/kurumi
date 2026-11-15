/**
 * Last-moment edits when the page goes away (reload, closing the tab, a
 * shared file opening in this window). The IndexedDB write the editors
 * start on pagehide can be cut off by the unload, so the text is also put
 * in localStorage, which is written synchronously, and applied on the next
 * start if the note didn't get it.
 */

import { get } from 'svelte/store';
import { allMemoryObjects, updateMemoryObject } from '$lib/db';
import { getOpenLinkedVaultId, isLinkedNoteId, linkedNote, linkedNoteInfo, parseLinkedId, raiseLinkedConflict, saveLinkedNote } from '$lib/linked/backend';

const KEY = 'kurumi-unsaved-edits';

interface Stash {
	title: string;
	body: string;
	at: number;
	/** A linked note: the hash of the file the text was made for. */
	hash?: string;
}

function read(): Record<string, Stash> {
	try {
		return JSON.parse(localStorage.getItem(KEY) ?? '{}');
	} catch {
		return {};
	}
}

/**
 * Keep a note's live text for the next start. Call from pagehide. For a note
 * of a linked folder, `body` is the text for its file and `hash` the hash
 * of the file it was made for.
 */
export function stashEdit(id: string, title: string, body: string, hash?: string): void {
	try {
		localStorage.setItem(KEY, JSON.stringify({ ...read(), [id]: { title, body, at: Date.now(), ...(hash ? { hash } : {}) } }));
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
	// Notes of linked folders wait for their folder (restoreLinkedStashes).
	const later: Record<string, Stash> = {};
	for (const id of ids) {
		if (isLinkedNoteId(id)) {
			later[id] = stashes[id];
			continue;
		}
		const note = notes.find((m) => m.id === id);
		const stash = stashes[id];
		// Skip if the save made it, or the note changed after (sync, another tab).
		if (!note || (note.bodyMarkdown === stash.body && note.title === stash.title) || note.updatedAt > stash.at) continue;
		updateMemoryObject(id, { title: stash.title, bodyMarkdown: stash.body });
		restored++;
	}
	if (Object.keys(later).length) localStorage.setItem(KEY, JSON.stringify(later));
	else localStorage.removeItem(KEY);
	return restored;
}

/**
 * The same for the linked folder that was just opened. A stashed edit is
 * written only if its file is still the one it was made for (same hash);
 * if the file changed since, the edit is held for the user to decide
 * (`linkedSaveIssues`), never written over it. Call after openLinkedVault.
 */
export function restoreLinkedStashes(): number {
	const vaultId = getOpenLinkedVaultId();
	const stashes = read();
	let restored = 0;
	for (const [id, stash] of Object.entries(stashes)) {
		if (!isLinkedNoteId(id) || parseLinkedId(id)?.vaultId !== vaultId) continue;
		delete stashes[id];
		const note = linkedNote(id);
		if (!note || note.bodyMarkdown === stash.body) continue;
		if (linkedNoteInfo(id)?.baseHash === stash.hash) saveLinkedNote(id, { title: stash.title, bodyMarkdown: stash.body });
		else raiseLinkedConflict(id, { title: stash.title, body: stash.body });
		restored++;
	}
	try {
		if (Object.keys(stashes).length) localStorage.setItem(KEY, JSON.stringify(stashes));
		else localStorage.removeItem(KEY);
	} catch {
		// Nothing to keep it in: it was applied or held above.
	}
	return restored;
}
