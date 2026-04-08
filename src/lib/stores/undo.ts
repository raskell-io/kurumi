/**
 * Global undo stack.
 *
 * Destructive UI actions push an undo entry describing how to revert
 * themselves. A single UndoToast component renders the latest entry
 * briefly, and Cmd/Ctrl+Z pops and executes the most recent undo (if
 * still within the 5-minute window).
 *
 * The stack is intentionally in-memory only — it doesn't survive page
 * reloads. This keeps the semantics simple: if you close the tab, you
 * lose the ability to undo, which matches user expectations for a
 * temporary safety net.
 *
 * Not every destructive operation uses this — memory and folder
 * deletes already go through soft-delete / trash, which has its own
 * restore flow. This undo is for hard-delete paths: action items,
 * reminder proposals, draft proposals, people, and their bulk variants.
 */

import { writable, get, type Readable } from 'svelte/store';

const MAX_STACK = 30;
const MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes

export interface UndoEntry {
	id: string;
	label: string;
	undo: () => void;
	createdAt: number;
}

// The full stack (internal). The public store exposes only the head so
// the toast can render it without re-rendering on every push that
// leaves the head unchanged.
const stackStore = writable<UndoEntry[]>([]);

/**
 * Readable view of the latest undo entry (or null when the stack is
 * empty). UI components should subscribe to this.
 */
export const undoHead: Readable<UndoEntry | null> = {
	subscribe(run, invalidate) {
		return stackStore.subscribe((stack) => {
			const head = stack[stack.length - 1] ?? null;
			run(head);
		}, invalidate);
	}
};

function generateId(): string {
	return Math.random().toString(36).slice(2, 10);
}

/**
 * Push a new undo entry onto the stack. The entry will be trimmed off
 * if the stack is already at MAX_STACK entries. Returns the entry's id
 * so callers can dismiss it manually if they want.
 */
export function pushUndo(entry: Omit<UndoEntry, 'id' | 'createdAt'>): string {
	const full: UndoEntry = {
		...entry,
		id: generateId(),
		createdAt: Date.now()
	};
	stackStore.update((stack) => {
		const next = [...stack, full];
		if (next.length > MAX_STACK) {
			return next.slice(next.length - MAX_STACK);
		}
		return next;
	});
	return full.id;
}

/**
 * Pop and execute the most recent undo entry, but only if it's still
 * within MAX_AGE_MS. Returns true if something was undone.
 *
 * Expired entries are silently dropped — the semantics are "give me
 * the last thing you did recently", not "revert any ancient action".
 */
export function undoLast(): boolean {
	let didUndo = false;
	stackStore.update((stack) => {
		while (stack.length > 0) {
			const entry = stack[stack.length - 1];
			stack = stack.slice(0, -1);
			if (Date.now() - entry.createdAt > MAX_AGE_MS) {
				continue; // Expired, try the next one
			}
			try {
				entry.undo();
				didUndo = true;
			} catch (err) {
				console.error('Undo handler threw:', err);
			}
			return stack;
		}
		return stack;
	});
	return didUndo;
}

/**
 * Dismiss a specific undo entry by id without executing it. Used by
 * the toast's close button and by auto-dismiss timers.
 */
export function dismissUndo(id: string): void {
	stackStore.update((stack) => stack.filter((e) => e.id !== id));
}

/**
 * Clear the entire undo stack. Called on vault switch so an undo
 * doesn't accidentally modify a different vault.
 */
export function clearUndoStack(): void {
	stackStore.set([]);
}

/**
 * Peek at the current stack length (for testing/debug UIs). Not
 * reactive; use undoHead for reactive state.
 */
export function currentStackSize(): number {
	return get(stackStore).length;
}
