/**
 * Workspace state: recently-opened tab bar, focus mode, and outgoing
 * links tracking. All in-memory for the current session.
 */

import { writable, derived, type Readable } from 'svelte/store';
import { memoryObjects } from '$lib/db';
import type { MemoryObject } from '$lib/db/types';

// --- Focus mode -------------------------------------------------------------

export const focusMode = writable(false);

export function toggleFocusMode(): void {
	focusMode.update((v) => !v);
}

// --- Tab bar ----------------------------------------------------------------

const MAX_TABS = 12;

/** Ordered list of recently-opened memory IDs. Most recent last. */
export const openTabIds = writable<string[]>([]);

/**
 * Mark a memory as just-opened. Moves it to the end of the tab bar
 * (most recent position) or adds it if not already present.
 */
export function touchTab(memoryId: string): void {
	openTabIds.update((ids) => {
		const filtered = ids.filter((id) => id !== memoryId);
		filtered.push(memoryId);
		if (filtered.length > MAX_TABS) {
			return filtered.slice(filtered.length - MAX_TABS);
		}
		return filtered;
	});
}

export function closeTab(memoryId: string): void {
	openTabIds.update((ids) => ids.filter((id) => id !== memoryId));
}

/** Derived store that resolves tab IDs to MemoryObject + title pairs
 *  so the UI can render them. Dead refs (deleted memories) are
 *  automatically dropped. */
export const openTabs: Readable<Array<{ id: string; title: string }>> = derived(
	[openTabIds, memoryObjects],
	([$ids, $memories]) => {
		const byId = new Map($memories.map((m) => [m.id, m]));
		return $ids
			.map((id) => {
				const memory = byId.get(id);
				return memory ? { id, title: memory.title || 'Untitled' } : null;
			})
			.filter((t): t is { id: string; title: string } => t !== null);
	}
);
