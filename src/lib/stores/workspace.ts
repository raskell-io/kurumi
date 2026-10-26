/**
 * Workspace state: recently-opened tab bar, focus mode, and outgoing
 * links tracking. In-memory for the current session, except the
 * recently-opened list, which is kept per device in localStorage.
 */

import { writable, derived, type Readable } from 'svelte/store';
import { memoryObjects } from '$lib/db';
import type { MemoryObject } from '$lib/db/types';

// --- Focus mode -------------------------------------------------------------

export const focusMode = writable(false);

export function toggleFocusMode(): void {
	focusMode.update((v) => !v);
}

// --- Split view -------------------------------------------------------------

/** Note shown in the right-hand split pane, next to the main note. */
export const splitNoteId = writable<string | null>(null);

export function openInSplit(memoryId: string): void {
	splitNoteId.set(memoryId);
}

export function closeSplit(): void {
	splitNoteId.set(null);
}

// --- Recently opened ------------------------------------------------------

const RECENT_KEY = 'kurumi-recent-notes';
const MAX_RECENT = 30;

function loadRecent(): string[] {
	try {
		const parsed = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
		return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : [];
	} catch {
		return [];
	}
}

/** Note ids this device opened, most recent first. Feeds the quick switcher. */
export const recentNoteIds = writable<string[]>(typeof localStorage === 'undefined' ? [] : loadRecent());

export function touchRecent(memoryId: string): void {
	recentNoteIds.update((ids) => {
		const next = [memoryId, ...ids.filter((id) => id !== memoryId)].slice(0, MAX_RECENT);
		try {
			localStorage.setItem(RECENT_KEY, JSON.stringify(next));
		} catch {
			// Storage full or blocked: recents just won't persist.
		}
		return next;
	});
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
export const openTabs: Readable<Array<{ id: string; title: string; icon?: string }>> = derived(
	[openTabIds, memoryObjects],
	([$ids, $memories]) => {
		const byId = new Map($memories.map((m) => [m.id, m]));
		return $ids.flatMap((id) => {
			const memory = byId.get(id);
			return memory ? [{ id, title: memory.title || 'Untitled', icon: memory.icon }] : [];
		});
	}
);
