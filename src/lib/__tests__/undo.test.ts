import { describe, it, expect, beforeEach } from 'vitest';
import { pushUndo, undoLast, dismissUndo, clearUndoStack, currentStackSize, undoHead } from '../stores/undo';
import { get } from 'svelte/store';

describe('undo stack', () => {
	beforeEach(() => {
		clearUndoStack();
	});

	it('starts empty', () => {
		expect(currentStackSize()).toBe(0);
		expect(get(undoHead)).toBeNull();
	});

	it('pushes entries and exposes the head', () => {
		pushUndo({ label: 'first', undo: () => {} });
		pushUndo({ label: 'second', undo: () => {} });
		expect(currentStackSize()).toBe(2);
		expect(get(undoHead)?.label).toBe('second');
	});

	it('undoLast calls the handler and pops', () => {
		let called = false;
		pushUndo({ label: 'test', undo: () => { called = true; } });
		const result = undoLast();
		expect(result).toBe(true);
		expect(called).toBe(true);
		expect(currentStackSize()).toBe(0);
	});

	it('undoLast returns false when stack is empty', () => {
		expect(undoLast()).toBe(false);
	});

	it('dismissUndo removes a specific entry by id', () => {
		const id = pushUndo({ label: 'to-dismiss', undo: () => {} });
		pushUndo({ label: 'keep', undo: () => {} });
		expect(currentStackSize()).toBe(2);
		dismissUndo(id);
		expect(currentStackSize()).toBe(1);
		expect(get(undoHead)?.label).toBe('keep');
	});

	it('clearUndoStack removes everything', () => {
		pushUndo({ label: 'a', undo: () => {} });
		pushUndo({ label: 'b', undo: () => {} });
		pushUndo({ label: 'c', undo: () => {} });
		clearUndoStack();
		expect(currentStackSize()).toBe(0);
	});

	it('limits the stack to 30 entries', () => {
		for (let i = 0; i < 40; i++) {
			pushUndo({ label: `entry-${i}`, undo: () => {} });
		}
		expect(currentStackSize()).toBe(30);
		// Head should be the most recent
		expect(get(undoHead)?.label).toBe('entry-39');
	});
});
