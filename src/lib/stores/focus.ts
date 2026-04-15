import { writable, derived } from 'svelte/store';

export interface FocusSession {
	actionItemId: string | null;
	actionItemText: string;
	startedAt: number;
	duration: number; // target duration in seconds (default 25 min)
	paused: boolean;
	elapsed: number; // seconds elapsed
}

const STORAGE_KEY = 'kurumi-focus-session';

function loadSession(): FocusSession | null {
	if (typeof localStorage === 'undefined') return null;
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (raw) return JSON.parse(raw);
	} catch { /* ignore */ }
	return null;
}

function saveSession(session: FocusSession | null) {
	if (typeof localStorage === 'undefined') return;
	if (session) {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
	} else {
		localStorage.removeItem(STORAGE_KEY);
	}
}

export const focusSession = writable<FocusSession | null>(loadSession());

// Auto-persist
focusSession.subscribe(saveSession);

export const isFocusing = derived(focusSession, ($s) => $s !== null && !$s.paused);

export function startFocus(actionItemId: string | null, text: string, durationMinutes: number = 25) {
	focusSession.set({
		actionItemId,
		actionItemText: text,
		startedAt: Date.now(),
		duration: durationMinutes * 60,
		paused: false,
		elapsed: 0
	});
}

export function pauseFocus() {
	focusSession.update((s) => s ? { ...s, paused: true } : null);
}

export function resumeFocus() {
	focusSession.update((s) => s ? { ...s, paused: false } : null);
}

export function stopFocus() {
	focusSession.set(null);
}

export function tickFocus() {
	focusSession.update((s) => {
		if (!s || s.paused) return s;
		return { ...s, elapsed: s.elapsed + 1 };
	});
}
