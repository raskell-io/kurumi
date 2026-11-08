import { describe, it, expect } from 'vitest';
import { parseCsv } from '$lib/utils/csv';
import { readNotionDatabase, stripNotionPropertyLines } from '$lib/utils/notion-import';
import { filterRows, inferPropertyType, newPropertyKey, parseInput, sortRows, toIsoDate } from '$lib/database';
import type { MemoryObject, PropertyDefinition } from '$lib/db/types';

const row = (title: string, customProps: Record<string, unknown>, updatedAt = 1) =>
	({ id: title, title, bodyMarkdown: '', tags: [], customProps, updatedAt, createdAt: 1, type: 'note' }) as unknown as MemoryObject;

describe('csv', () => {
	it('reads quotes, commas and line breaks in fields', () => {
		expect(parseCsv('﻿Name,Notes\r\n"Smith, J","said ""hi""\nthen left"\nB,\n')).toEqual([
			['Name', 'Notes'],
			['Smith, J', 'said "hi"\nthen left'],
			['B', '']
		]);
	});
});

describe('property types', () => {
	it('guesses a type from imported values', () => {
		expect(inferPropertyType(['Yes', 'No', ''])).toEqual({ type: 'checkbox' });
		expect(inferPropertyType(['3', '1,200', '4.5'])).toEqual({ type: 'number' });
		expect(inferPropertyType(['November 5, 2026', 'December 1, 2026 3:00 PM'])).toEqual({ type: 'date' });
		expect(inferPropertyType(['https://a.org', 'https://b.org/x'])).toEqual({ type: 'url' });
		expect(inferPropertyType(['Done', 'In progress', 'Done', 'Not started'])).toEqual({
			type: 'select',
			options: ['Done', 'In progress', 'Not started']
		});
		expect(inferPropertyType(['ux, web', 'web', 'ios, web'])).toEqual({ type: 'multiSelect', options: ['ux', 'web', 'ios'] });
		expect(inferPropertyType(['A long unique sentence', 'Another one'])).toEqual({ type: 'text' });
		expect(inferPropertyType(['Project 2024', 'Plan 2025'])).toEqual({ type: 'text' });
	});

	it('parses typed input and dates', () => {
		expect(parseInput('number', '1,200')).toBe(1200);
		expect(parseInput('multiSelect', 'a, b, a')).toEqual(['a', 'b']);
		expect(parseInput('checkbox', 'Yes')).toBe(true);
		expect(toIsoDate('November 5, 2026')).toBe('2026-11-05');
		expect(toIsoDate('2026/1/9')).toBe('2026-01-09');
		expect(toIsoDate('Project 2024')).toBeNull();
	});

	it('makes unique keys', () => {
		const existing = [{ key: 'status' }] as PropertyDefinition[];
		expect(newPropertyKey('Status', existing)).toBe('status-2');
		expect(newPropertyKey('Due date', existing)).toBe('due-date');
	});
});

describe('rows', () => {
	const props: PropertyDefinition[] = [
		{ key: 'status', label: 'Status', type: 'select', options: ['Todo', 'Done'] },
		{ key: 'points', label: 'Points', type: 'number' }
	];
	const rows = [row('a', { status: 'Done', points: 3 }), row('b', { status: 'Todo', points: 10 }), row('c', {})];

	it('filters by property', () => {
		expect(filterRows(rows, [{ field: 'prop:status', op: 'is', value: 'done' }], props).map((r) => r.id)).toEqual(['a']);
		expect(filterRows(rows, [{ field: 'prop:status', op: 'empty' }], props).map((r) => r.id)).toEqual(['c']);
		expect(filterRows(rows, [{ field: 'prop:points', op: 'after', value: '5' }], props).map((r) => r.id)).toEqual(['b']);
	});

	it('sorts numbers as numbers, empty values last', () => {
		expect(sortRows(rows, 'prop:points', 'desc', props).map((r) => r.id)).toEqual(['b', 'a', 'c']);
		expect(sortRows(rows, 'prop:points', 'asc', props).map((r) => r.id)).toEqual(['a', 'b', 'c']);
	});
});

describe('Notion databases', () => {
	const csv = 'Name,Status,Tags,Due,Done\nWrite brief,In progress,"ux, web","November 5, 2026",No\nShip,Done,web,"November 9, 2026",Yes\nReview,Done,"ux",,No\n';

	it('turns a CSV into properties and row values', () => {
		const db = readNotionDatabase('Work/Tasks 1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d_all.csv', csv)!;
		expect(db.dir).toBe('Work/Tasks 1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d');
		expect(db.properties.map((p) => [p.label, p.type])).toEqual([
			['Status', 'select'],
			['Tags', 'multiSelect'],
			['Due', 'date'],
			['Done', 'checkbox']
		]);
		expect(db.rows[1]).toEqual({ title: 'Ship', values: { status: 'Done', tags: ['web'], due: '2026-11-09', done: true } });
	});

	it("drops the property lines at the top of a row's page", () => {
		expect(stripNotionPropertyLines('Status: Done\nDue: November 9, 2026\n\nThe body', ['Status', 'Due'])).toBe('The body');
		expect(stripNotionPropertyLines('Status is unrelated', ['Status'])).toBe('Status is unrelated');
	});
});
