import { writable } from 'svelte/store';

/**
 * One short informational message at a time (NoticeToast.svelte, in the
 * layout), for things that need telling but no action: "this file isn't
 * on this device yet". Errors that need action belong where they happen.
 */
export const notice = writable<{ id: number; text: string } | null>(null);

let next = 0;
export function showNotice(text: string): void {
	notice.set({ id: ++next, text });
}
