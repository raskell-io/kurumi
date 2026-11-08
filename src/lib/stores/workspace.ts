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
//
// Open tabs are for this session; pinned tabs ("sticky notes") stay on the
// left, survive restarts (per device, localStorage) and don't count toward
// the tab limit, so the notes you're working on stay one click away.

const MAX_TABS = 12;
const PINNED_KEY = 'kurumi-pinned-tabs';

function loadPinned(): string[] {
	try {
		const parsed = JSON.parse(localStorage.getItem(PINNED_KEY) ?? '[]');
		return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : [];
	} catch {
		return [];
	}
}

/** Pinned memory ids, in tab order. */
export const pinnedTabIds = writable<string[]>(typeof localStorage === 'undefined' ? [] : loadPinned());
pinnedTabIds.subscribe((ids) => {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem(PINNED_KEY, JSON.stringify(ids));
	} catch {
		// Storage full or blocked: pins last for this session.
	}
});

/** Ordered list of recently-opened (unpinned) memory IDs. Most recent last. */
export const openTabIds = writable<string[]>([]);

let pinnedNow: string[] = [];
pinnedTabIds.subscribe((ids) => (pinnedNow = ids));

/**
 * Mark a memory as just-opened. Adds it to the end of the tab bar
 * if not already present. Does NOT reorder existing tabs — their
 * position is preserved so the user can arrange them manually.
 */
export function touchTab(memoryId: string): void {
	if (pinnedNow.includes(memoryId)) return;
	openTabIds.update((ids) => {
		if (ids.includes(memoryId)) return ids; // already open, keep position
		const next = [...ids, memoryId];
		if (next.length > MAX_TABS) {
			return next.slice(next.length - MAX_TABS);
		}
		return next;
	});
}

export function isPinned(memoryId: string): boolean {
	return pinnedNow.includes(memoryId);
}

/** Pin a note's tab (it moves to the pinned group on the left). */
export function pinTab(memoryId: string): void {
	if (pinnedNow.includes(memoryId)) return;
	pinnedTabIds.update((ids) => [...ids, memoryId]);
	openTabIds.update((ids) => ids.filter((id) => id !== memoryId));
}

/** Unpin: it stays open, as the first ordinary tab. */
export function unpinTab(memoryId: string): void {
	if (!pinnedNow.includes(memoryId)) return;
	pinnedTabIds.update((ids) => ids.filter((id) => id !== memoryId));
	openTabIds.update((ids) => [memoryId, ...ids.filter((id) => id !== memoryId)].slice(0, MAX_TABS));
}

export function togglePinTab(memoryId: string): void {
	if (pinnedNow.includes(memoryId)) unpinTab(memoryId);
	else pinTab(memoryId);
}

/** Move tab `fromId` to where `toId` is, within its group (pinned or not). */
export function moveTabTo(fromId: string, toId: string): void {
	const reorder = (ids: string[]) => {
		const from = ids.indexOf(fromId);
		const to = ids.indexOf(toId);
		if (from < 0 || to < 0 || from === to) return ids;
		const next = [...ids];
		next.splice(from, 1);
		next.splice(to, 0, fromId);
		return next;
	};
	if (pinnedNow.includes(fromId)) pinnedTabIds.update(reorder);
	else openTabIds.update(reorder);
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

/** Close a tab; a pinned one is unpinned and closed. */
export function closeTab(memoryId: string): void {
	pinnedTabIds.update((ids) => (ids.includes(memoryId) ? ids.filter((id) => id !== memoryId) : ids));
	openTabIds.update((ids) => ids.filter((id) => id !== memoryId));
}

/** Derived store that resolves tab IDs to MemoryObject + title pairs
 *  so the UI can render them, pinned tabs first. Dead refs (deleted
 *  memories) are automatically dropped. */
export const openTabs: Readable<Array<{ id: string; title: string; icon?: string; pinned: boolean }>> = derived(
	[pinnedTabIds, openTabIds, memoryObjects],
	([$pinned, $ids, $memories]) => {
		const byId = new Map($memories.map((m) => [m.id, m]));
		const resolve = (id: string, pinned: boolean) => {
			const memory = byId.get(id);
			return memory && !memory.deletedAt ? [{ id, title: memory.title || 'Untitled', icon: memory.icon, pinned }] : [];
		};
		return [...$pinned.flatMap((id) => resolve(id, true)), ...$ids.filter((id) => !$pinned.includes(id)).flatMap((id) => resolve(id, false))];
	}
);
