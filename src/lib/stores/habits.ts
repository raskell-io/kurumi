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

function genId(): string {
	return Math.random().toString(36).slice(2, 10);
}

export function addHabit(name: string): void {
	habits.update((h) => [
		...h,
		{ id: genId(), name, createdAt: new Date().toISOString().slice(0, 10) }
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
	const days = logs[habitId] || [];
	if (days.length === 0) return 0;
	const sorted = [...days].sort().reverse();
	const today = new Date().toISOString().slice(0, 10);

	// Count consecutive days ending today or yesterday
	let streak = 0;
	let expected = today;
	for (const day of sorted) {
		if (day === expected) {
			streak++;
			const d = new Date(expected);
			d.setDate(d.getDate() - 1);
			expected = d.toISOString().slice(0, 10);
		} else if (streak === 0 && day === expected) {
			// Allow starting from yesterday
			continue;
		} else {
			break;
		}
	}
	// If today isn't checked, try starting from yesterday
	if (streak === 0) {
		const yesterday = new Date();
		yesterday.setDate(yesterday.getDate() - 1);
		expected = yesterday.toISOString().slice(0, 10);
		for (const day of sorted) {
			if (day === expected) {
				streak++;
				const d = new Date(expected);
				d.setDate(d.getDate() - 1);
				expected = d.toISOString().slice(0, 10);
			} else {
				break;
			}
		}
	}
	return streak;
}
