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
 * Mark a memory as just-opened. Adds it to the end of the tab bar
 * if not already present. Does NOT reorder existing tabs — their
 * position is preserved so the user can arrange them manually.
 */
export function touchTab(memoryId: string): void {
	openTabIds.update((ids) => {
		if (ids.includes(memoryId)) return ids; // already open, keep position
		const next = [...ids, memoryId];
		if (next.length > MAX_TABS) {
			return next.slice(next.length - MAX_TABS);
		}
		return next;
	});
}

/**
 * Move a tab from one position to another (drag-and-drop reorder).
 */
export function moveTab(fromIndex: number, toIndex: number): void {
	openTabIds.update((ids) => {
		if (fromIndex < 0 || fromIndex >= ids.length) return ids;
		if (toIndex < 0 || toIndex >= ids.length) return ids;
		if (fromIndex === toIndex) return ids;
		const next = [...ids];
		const [moved] = next.splice(fromIndex, 1);
		next.splice(toIndex, 0, moved);
		return next;
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
