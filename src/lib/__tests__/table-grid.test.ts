import { describe, expect, it } from 'vitest';
import { compareCells, deleteColumn, deleteRow, insertColumn, insertRow, moveColumn, moveRow, sortByColumn } from '$lib/editor/tableGrid';

const grid = () => [
	['Name', 'Count'],
	['beta', '10'],
	['alpha', '2'],
	['', '7']
];

describe('table grid', () => {
	it('never inserts above or deletes the header, and keeps one body row', () => {
		expect(insertRow(grid(), 0, () => 'x')[0]).toEqual(['Name', 'Count']);
		expect(insertRow(grid(), 0, () => 'x')[1]).toEqual(['x', 'x']);
		expect(deleteRow(grid(), 0)).toEqual(grid());
		expect(deleteRow([['h'], ['a']], 1)).toEqual([['h'], ['a']]);
		expect(deleteRow(grid(), 2).map((r) => r[0])).toEqual(['Name', 'beta', '']);
	});

	it('inserts, moves and deletes columns', () => {
		const wider = insertColumn(grid(), 1, (row) => (row === 0 ? 'New' : ''));
		expect(wider[0]).toEqual(['Name', 'New', 'Count']);
		expect(moveColumn(grid(), 0, 1)[0]).toEqual(['Count', 'Name']);
		expect(deleteColumn(grid(), 0)[1]).toEqual(['10']);
		expect(deleteColumn([['only'], ['x']], 0)).toEqual([['only'], ['x']]);
	});

	it('moves body rows only', () => {
		expect(moveRow(grid(), 1, 2).map((r) => r[0])).toEqual(['Name', 'alpha', 'beta', '']);
		expect(moveRow(grid(), 1, 0)).toEqual(grid());
	});

	it('sorts numbers by value and text naturally, empty cells last', () => {
		const text = (c: string) => c;
		expect(sortByColumn(grid(), 1, text).map((r) => r[1])).toEqual(['Count', '2', '7', '10']);
		expect(sortByColumn(grid(), 1, text, true).map((r) => r[1])).toEqual(['Count', '10', '7', '2']);
		expect(sortByColumn(grid(), 0, text).map((r) => r[0])).toEqual(['Name', 'alpha', 'beta', '']);
		expect(sortByColumn(grid(), 0, text, true).map((r) => r[0])).toEqual(['Name', 'beta', 'alpha', '']);
		expect(compareCells('item 2', 'item 10')).toBeLessThan(0);
		expect(compareCells('1,200', '900')).toBeGreaterThan(0);
	});
});
