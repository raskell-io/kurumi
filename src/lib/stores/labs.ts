/**
 * Labs: features that work but aren't polished enough to show everyone
 * (habits, flashcards, timeline, smart folders). Off by default; when on,
 * they get a sidebar section and command-palette entries. Per device.
 */

import { writable } from 'svelte/store';

const KEY = 'kurumi-labs';

function load(): boolean {
	try {
		return localStorage.getItem(KEY) === '1';
	} catch {
		return false;
	}
}

export const labsEnabled = writable<boolean>(typeof localStorage === 'undefined' ? false : load());

labsEnabled.subscribe((on) => {
	try {
		if (on) localStorage.setItem(KEY, '1');
		else localStorage.removeItem(KEY);
	} catch {
		// Not persisted; fine.
	}
});

export const LAB_PAGES = [
	{ href: '/habits', label: 'Habits', description: 'Daily habit tracker with streaks' },
	{ href: '/flashcards', label: 'Flashcards', description: 'Spaced-repetition cards from your notes' },
	{ href: '/timeline', label: 'Timeline', description: 'Everything you captured, by date' },
	{ href: '/smart-folders', label: 'Smart folders', description: 'Saved filters that stay up to date' }
] as const;
