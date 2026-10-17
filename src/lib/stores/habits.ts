import { writable } from 'svelte/store';

export interface Habit {
	id: string;
	name: string;
	createdAt: string; // ISO date
}

export interface HabitLog {
	[habitId: string]: string[]; // array of ISO dates checked
}

const HABITS_KEY = 'kurumi-habits';
const LOGS_KEY = 'kurumi-habit-logs';

function loadHabits(): Habit[] {
	if (typeof localStorage === 'undefined') return [];
	try {
		return JSON.parse(localStorage.getItem(HABITS_KEY) || '[]');
	} catch { return []; }
}

function loadLogs(): HabitLog {
	if (typeof localStorage === 'undefined') return {};
	try {
		return JSON.parse(localStorage.getItem(LOGS_KEY) || '{}');
	} catch { return {}; }
}

export const habits = writable<Habit[]>(loadHabits());
export const habitLogs = writable<HabitLog>(loadLogs());

habits.subscribe((h) => {
	if (typeof localStorage !== 'undefined') {
		localStorage.setItem(HABITS_KEY, JSON.stringify(h));
	}
});

habitLogs.subscribe((l) => {
	if (typeof localStorage !== 'undefined') {
		localStorage.setItem(LOGS_KEY, JSON.stringify(l));
	}
});

/** YYYY-MM-DD for the user's local calendar day (not UTC). */
export function localIsoDate(date: Date = new Date()): string {
	const y = date.getFullYear();
	const m = String(date.getMonth() + 1).padStart(2, '0');
	const d = String(date.getDate()).padStart(2, '0');
	return `${y}-${m}-${d}`;
}

function previousIsoDate(iso: string): string {
	const [y, m, d] = iso.split('-').map(Number);
	return localIsoDate(new Date(y, m - 1, d - 1));
}

function genId(): string {
	return Math.random().toString(36).slice(2, 10);
}

export function addHabit(name: string): void {
	habits.update((h) => [
		...h,
		{ id: genId(), name, createdAt: localIsoDate() }
	]);
}

export function removeHabit(id: string): void {
	habits.update((h) => h.filter((x) => x.id !== id));
	habitLogs.update((l) => {
		const next = { ...l };
		delete next[id];
		return next;
	});
}

export function toggleHabitDay(habitId: string, isoDate: string): void {
	habitLogs.update((l) => {
		const days = l[habitId] || [];
		const idx = days.indexOf(isoDate);
		if (idx >= 0) {
			return { ...l, [habitId]: days.filter((d) => d !== isoDate) };
		} else {
			return { ...l, [habitId]: [...days, isoDate] };
		}
	});
}

export function getStreak(habitId: string, logs: HabitLog): number {
	const done = new Set(logs[habitId] || []);
	// A streak may end today or, if today isn't checked yet, yesterday.
	let cursor = localIsoDate();
	if (!done.has(cursor)) cursor = previousIsoDate(cursor);
	let streak = 0;
	while (done.has(cursor)) {
		streak++;
		cursor = previousIsoDate(cursor);
	}
	return streak;
}
