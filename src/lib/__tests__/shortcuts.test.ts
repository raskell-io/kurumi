import { describe, it, expect, beforeEach } from 'vitest';
import {
	comboFromEvent,
	matchShortcut,
	setBinding,
	resetAllBindings,
	bindingsFor,
	conflictsFor,
	isMac
} from '../shortcuts';

// Minimal KeyboardEvent stand-in (node has no DOM).
function key(code: string, mods: { mod?: boolean; shift?: boolean; alt?: boolean } = {}): KeyboardEvent {
	return {
		code,
		metaKey: isMac && !!mods.mod,
		ctrlKey: !isMac && !!mods.mod,
		shiftKey: !!mods.shift,
		altKey: !!mods.alt
	} as KeyboardEvent;
}

describe('shortcuts', () => {
	beforeEach(() => resetAllBindings());

	it('builds combos from key codes, unaffected by Shift/Option producing other characters', () => {
		expect(comboFromEvent(key('KeyK', { mod: true }))).toBe('mod+k');
		expect(comboFromEvent(key('KeyF', { mod: true, alt: true }))).toBe('mod+alt+f');
		expect(comboFromEvent(key('Backslash', { mod: true }))).toBe('mod+\\');
		expect(comboFromEvent(key('ShiftLeft', { shift: true }))).toBeNull();
	});

	it('matches defaults, including actions with two bindings', () => {
		expect(matchShortcut(key('KeyK', { mod: true }))?.id).toBe('search');
		expect(matchShortcut(key('KeyO', { mod: true }))?.id).toBe('quickSwitcher');
		expect(matchShortcut(key('KeyP', { mod: true }))?.id).toBe('quickSwitcher');
		expect(matchShortcut(key('KeyA', { mod: true, shift: true }))?.id).toBe('actions');
		expect(matchShortcut(key('KeyA', { mod: true }))).toBeNull();
	});

	it('applies overrides and reports conflicts', () => {
		setBinding('graph', ['mod+shift+g']);
		expect(matchShortcut(key('KeyG', { mod: true }))).toBeNull();
		expect(matchShortcut(key('KeyG', { mod: true, shift: true }))?.id).toBe('graph');
		expect(bindingsFor('graph')).toEqual(['mod+shift+g']);
		expect(conflictsFor('mod+d', 'inbox').map((s) => s.id)).toEqual(['dailyNote']);
		resetAllBindings();
		expect(bindingsFor('graph')).toEqual(['mod+g']);
	});
});
