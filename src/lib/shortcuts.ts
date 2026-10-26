/**
 * App-wide keyboard shortcuts: one table of actions with default key
 * combos, user overrides (Settings → Keyboard shortcuts, per device), and
 * matching of KeyboardEvents against the effective bindings.
 *
 * Combos are written like "mod+shift+a": `mod` is ⌘ on macOS and Ctrl
 * elsewhere; keys come from KeyboardEvent.code, so Shift/Option don't
 * change which key is seen (Option+F is still "f").
 */

import { writable, get } from 'svelte/store';

export type ShortcutId =
	| 'search'
	| 'quickSwitcher'
	| 'newNote'
	| 'toggleSidebar'
	| 'dailyNote'
	| 'graph'
	| 'references'
	| 'settings'
	| 'readMode'
	| 'actions'
	| 'inbox'
	| 'calendar'
	| 'focusMode'
	| 'voice'
	| 'agentPane'
	| 'undo'
	| 'find'
	| 'findReplace';

export interface ShortcutDef {
	id: ShortcutId;
	label: string;
	group: 'General' | 'Navigate' | 'Editor';
	defaults: string[];
	// Fires while typing in an input or the editor.
	inInputs?: boolean;
}

export const SHORTCUTS: ShortcutDef[] = [
	{ id: 'search', label: 'Search / command palette', group: 'General', defaults: ['mod+k'], inInputs: true },
	{ id: 'quickSwitcher', label: 'Quick switcher', group: 'General', defaults: ['mod+o', 'mod+p'], inInputs: true },
	{ id: 'newNote', label: 'New note', group: 'General', defaults: ['mod+n'], inInputs: true },
	{ id: 'toggleSidebar', label: 'Toggle sidebar', group: 'General', defaults: ['mod+\\'], inInputs: true },
	{ id: 'focusMode', label: 'Toggle focus mode', group: 'General', defaults: ['mod+shift+f'] },
	{ id: 'agentPane', label: 'Toggle agent pane', group: 'General', defaults: ['mod+`'] },
	{ id: 'voice', label: 'Voice assistant (push to talk)', group: 'General', defaults: ['mod+shift+v'] },
	{ id: 'undo', label: 'Undo last destructive action', group: 'General', defaults: ['mod+z'] },
	{ id: 'dailyNote', label: "Today's daily note", group: 'Navigate', defaults: ['mod+d'] },
	{ id: 'inbox', label: 'Inbox', group: 'Navigate', defaults: ['mod+shift+i'] },
	{ id: 'calendar', label: 'Calendar', group: 'Navigate', defaults: ['mod+shift+c'] },
	{ id: 'actions', label: 'Action items', group: 'Navigate', defaults: ['mod+shift+a'] },
	{ id: 'readMode', label: 'Read mode', group: 'Navigate', defaults: ['mod+shift+r'] },
	{ id: 'graph', label: 'Graph', group: 'Navigate', defaults: ['mod+g'] },
	{ id: 'references', label: 'References', group: 'Navigate', defaults: ['mod+r'] },
	{ id: 'settings', label: 'Settings', group: 'Navigate', defaults: ['mod+,'] },
	{ id: 'find', label: 'Find in note', group: 'Editor', defaults: ['mod+f'], inInputs: true },
	{ id: 'findReplace', label: 'Find and replace', group: 'Editor', defaults: ['mod+alt+f'], inInputs: true }
];

const STORAGE_KEY = 'kurumi-shortcuts';

function loadOverrides(): Partial<Record<ShortcutId, string[]>> {
	try {
		const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
		return parsed && typeof parsed === 'object' ? parsed : {};
	} catch {
		return {};
	}
}

/** User overrides; an action missing here uses its defaults. */
export const shortcutOverrides = writable<Partial<Record<ShortcutId, string[]>>>(
	typeof localStorage === 'undefined' ? {} : loadOverrides()
);

shortcutOverrides.subscribe((value) => {
	if (typeof localStorage === 'undefined') return;
	try {
		if (Object.keys(value).length) localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
		else localStorage.removeItem(STORAGE_KEY);
	} catch {
		// Not persisted; the binding still applies for this session.
	}
});

export function bindingsFor(id: ShortcutId, overrides = get(shortcutOverrides)): string[] {
	return overrides[id] ?? SHORTCUTS.find((s) => s.id === id)?.defaults ?? [];
}

export function setBinding(id: ShortcutId, combos: string[]): void {
	shortcutOverrides.update((o) => ({ ...o, [id]: combos }));
}

export function resetBinding(id: ShortcutId): void {
	shortcutOverrides.update((o) => {
		const next = { ...o };
		delete next[id];
		return next;
	});
}

export function resetAllBindings(): void {
	shortcutOverrides.set({});
}

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

const CODE_KEYS: Record<string, string> = {
	Backslash: '\\',
	Backquote: '`',
	Comma: ',',
	Period: '.',
	Slash: '/',
	Semicolon: ';',
	Quote: "'",
	BracketLeft: '[',
	BracketRight: ']',
	Minus: '-',
	Equal: '=',
	Space: 'space',
	Enter: 'enter',
	Escape: 'escape',
	Backspace: 'backspace',
	Tab: 'tab'
};

function keyFromCode(code: string): string | null {
	if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
	if (/^Digit\d$/.test(code)) return code.slice(5);
	if (/^F\d{1,2}$/.test(code)) return code.toLowerCase();
	if (/^Arrow/.test(code)) return code.slice(5).toLowerCase();
	return CODE_KEYS[code] ?? null;
}

/** The combo string for a key event, or null for a lone modifier press. */
export function comboFromEvent(e: KeyboardEvent): string | null {
	const key = keyFromCode(e.code);
	if (!key) return null;
	const parts: string[] = [];
	if (isMac ? e.metaKey : e.ctrlKey) parts.push('mod');
	if (isMac && e.ctrlKey) parts.push('ctrl');
	if (e.altKey) parts.push('alt');
	if (e.shiftKey) parts.push('shift');
	parts.push(key);
	return parts.join('+');
}

/** The action bound to this key event, if any. */
export function matchShortcut(e: KeyboardEvent): ShortcutDef | null {
	const combo = comboFromEvent(e);
	if (!combo) return null;
	const overrides = get(shortcutOverrides);
	const find = (c: string) => SHORTCUTS.find((s) => bindingsFor(s.id, overrides).includes(c)) ?? null;
	// On macOS, Ctrl also works as "mod" (as it always has here) unless
	// something is bound to the Ctrl combo itself.
	return find(combo) ?? (isMac && !e.metaKey && e.ctrlKey ? find(combo.replace(/^ctrl\+/, 'mod+')) : null);
}

/** Display form, e.g. "⌘⇧A" on macOS or "Ctrl+Shift+A" elsewhere. */
export function formatCombo(combo: string): string {
	const parts = combo.split('+');
	const key = parts.pop() ?? '';
	const keyLabel = key.length === 1 ? key.toUpperCase() : key[0].toUpperCase() + key.slice(1);
	const mods = parts.map((m) =>
		isMac
			? ({ mod: '⌘', ctrl: '⌃', alt: '⌥', shift: '⇧' } as Record<string, string>)[m]
			: ({ mod: 'Ctrl', ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift' } as Record<string, string>)[m]
	);
	return isMac ? mods.join('') + keyLabel : [...mods, keyLabel].join('+');
}

/** Other actions already using `combo` (for conflict warnings). */
export function conflictsFor(combo: string, except: ShortcutId): ShortcutDef[] {
	const overrides = get(shortcutOverrides);
	return SHORTCUTS.filter((s) => s.id !== except && bindingsFor(s.id, overrides).includes(combo));
}
