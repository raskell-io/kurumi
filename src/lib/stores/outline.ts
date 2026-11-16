/**
 * Whether a long note shows its outline beside it (NoteOutline.svelte).
 * Per device, on unless turned off from the note's menu.
 */
import { writable } from 'svelte/store';

const KEY = 'kurumi-outline';

function initial(): boolean {
	try {
		return localStorage.getItem(KEY) !== 'off';
	} catch {
		return true;
	}
}

export const outlineShown = writable(typeof localStorage === 'undefined' ? true : initial());

outlineShown.subscribe((on) => {
	try {
		if (typeof localStorage === 'undefined') return;
		if (on) localStorage.removeItem(KEY);
		else localStorage.setItem(KEY, 'off');
	} catch {
		/* private mode */
	}
});
