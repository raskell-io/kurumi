/**
 * "Waiting for": open to-dos assigned to someone other than you.
 *
 * Kurumi has no user account, so who "you" are is a setting (Settings →
 * Profile, per device): the names meeting extraction may use for you,
 * plus "me" / "I" / "myself".
 */

import { writable, get } from 'svelte/store';
import type { ActionItem } from './db/types';

const KEY = 'kurumi-my-names';
const ALWAYS_ME = ['me', 'i', 'myself'];

function load(): string[] {
	try {
		const parsed = JSON.parse(localStorage.getItem(KEY) ?? '[]');
		return Array.isArray(parsed) ? parsed.filter((n) => typeof n === 'string') : [];
	} catch {
		return [];
	}
}

/** Names that mean "you" on this device. */
export const myNames = writable<string[]>(typeof localStorage === 'undefined' ? [] : load());

myNames.subscribe((names) => {
	try {
		if (names.length) localStorage.setItem(KEY, JSON.stringify(names));
		else localStorage.removeItem(KEY);
	} catch {
		// Not persisted; fine.
	}
});

const norm = (s: string) => s.trim().replace(/^@/, '').toLowerCase();

/** Whether an assignee is you (unassigned counts as yours). */
export function isMine(assignee: string | null | undefined, names = get(myNames)): boolean {
	if (!assignee || !assignee.trim()) return true;
	const who = norm(assignee);
	return ALWAYS_ME.includes(who) || names.some((n) => norm(n) === who);
}

export function isOpen(item: ActionItem): boolean {
	return item.status === 'open' || item.status === 'in_progress';
}

/** Open to-dos someone else is doing for you. */
export function isWaitingFor(item: ActionItem, names = get(myNames)): boolean {
	return isOpen(item) && !isMine(item.assignee, names);
}

/** Group open waiting-for items by assignee, people with the most first. */
export function waitingByPerson(items: ActionItem[], names = get(myNames)): { person: string; items: ActionItem[] }[] {
	const groups = new Map<string, ActionItem[]>();
	for (const item of items) {
		if (!isWaitingFor(item, names)) continue;
		const person = item.assignee!.trim().replace(/^@/, '');
		const key = [...groups.keys()].find((k) => norm(k) === norm(person)) ?? person;
		groups.set(key, [...(groups.get(key) ?? []), item]);
	}
	return [...groups.entries()]
		.map(([person, list]) => ({ person, items: list }))
		.sort((a, b) => b.items.length - a.items.length || a.person.localeCompare(b.person));
}
