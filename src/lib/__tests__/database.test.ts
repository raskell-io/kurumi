import { describe, it, expect } from 'vitest';
import { parseCsv } from '$lib/utils/csv';
import { readNotionDatabase, stripNotionPropertyLines } from '$lib/utils/notion-import';
import { filterRows, inferPropertyType, newPropertyKey, parseInput, sortRows, toIsoDate, parseCondition, meetsCondition, propertyValue, groupRows } from '$lib/database';
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

describe('query conditions', () => {
	const props: PropertyDefinition[] = [
		{ key: 'status', label: 'Status', type: 'select' },
		{ key: 'rating', label: 'Rating', type: 'number' },
		{ key: 'due', label: 'Due date', type: 'date' },
		{ key: 'fiction', label: 'Fiction', type: 'checkbox' }
	];
	const book = row('Dune', { status: 'Done', rating: 5, due: '2026-11-03', fiction: true });
	const other = row('Other', { status: 'Todo', rating: 3 });
	const meets = (text: string, m = book) => meetsCondition(m, parseCondition(text)!, props, '2026-11-08');

	it('parses and evaluates conditions', () => {
		expect(parseCondition('Due date before today')).toEqual({ label: 'Due date', op: 'before', value: 'today' });
		expect(meets('Status = Done')).toBe(true);
		expect(meets('status is not Done')).toBe(false);
		expect(meets('Rating > 4')).toBe(true);
		expect(meets('Rating >= 5')).toBe(true);
		expect(meets('Rating <= 3', other)).toBe(true);
		expect(meets('Due date before today')).toBe(true);
		expect(meets('Fiction')).toBe(true);
		expect(meets('not Fiction', other)).toBe(true);
		expect(meets('Due date is empty', other)).toBe(true);
		expect(meets('Fiction = yes')).toBe(true);
		expect(meets('Unknown = x')).toBe(false);
	});
});

describe('relations, rollups and formulas', () => {
	const tasksProps: PropertyDefinition[] = [
		{ key: 'points', label: 'Points', type: 'number' },
		{ key: 'done', label: 'Done', type: 'checkbox' }
	];
	const projectProps: PropertyDefinition[] = [
		{ key: 'tasks', label: 'Tasks', type: 'relation', relationTo: 'tasksFolder' },
		{ key: 'total', label: 'Total', type: 'rollup', rollup: { relation: 'tasks', property: 'points', fn: 'sum' } },
		{ key: 'progress', label: 'Progress', type: 'rollup', rollup: { relation: 'tasks', property: 'done', fn: 'percentChecked' } },
		{ key: 'names', label: 'Names', type: 'rollup', rollup: { relation: 'tasks', property: 'title', fn: 'list' } },
		{ key: 'label', label: 'Label', type: 'formula', formula: 'concat(prop("Title"), ": ", prop("Total"), " pts")' },
		{ key: 'big', label: 'Big', type: 'formula', formula: 'prop("Total") > 5' }
	];
	const t1 = { ...row('Spec', { points: 3, done: true }), folderId: 'tasksFolder' } as MemoryObject;
	const t2 = { ...row('Build', { points: 5 }), folderId: 'tasksFolder' } as MemoryObject;
	const project = { ...row('Launch', { tasks: ['Spec', 'Build', 'gone'] }), folderId: 'projects' } as MemoryObject;
	const ctx = {
		byId: new Map([t1, t2, project].map((m) => [m.id, m])),
		schemaOf: (f: string | null | undefined) => (f === 'tasksFolder' ? tasksProps : f === 'projects' ? projectProps : []),
		today: '2026-11-08'
	};
	const value = (key: string) => propertyValue(project, projectProps.find((p) => p.key === key)!, projectProps, ctx);

	it('computes rollups over related rows, ignoring missing ones', () => {
		expect(value('tasks')).toEqual(['Spec', 'Build']);
		expect(value('total')).toBe(8);
		expect(value('progress')).toBe('50%');
		expect(value('names')).toEqual(['Spec', 'Build']);
	});

	it('evaluates formulas over other properties, rollups included', () => {
		expect(value('label')).toBe('Launch: 8 pts');
		expect(value('big')).toBe(true);
		const broken = { key: 'x', label: 'X', type: 'formula', formula: 'prop("Total" +' } as PropertyDefinition;
		expect(String(propertyValue(project, broken, projectProps, ctx))).toMatch(/^#ERROR/);
	});

	it('filters and sorts on computed values', () => {
		const other = { ...row('Small', { tasks: ['Spec'] }), folderId: 'projects' } as MemoryObject;
		ctx.byId.set(other.id, other);
		expect(filterRows([project, other], [{ field: 'prop:big', op: 'is', value: '✓' }], projectProps, '', ctx).map((r) => r.id)).toEqual(['Launch']);
		expect(sortRows([other, project], 'prop:total', 'desc', projectProps, ctx).map((r) => r.id)).toEqual(['Launch', 'Small']);
		expect(filterRows([project, other], [{ field: 'prop:tasks', op: 'contains', value: 'build' }], projectProps, '', ctx).map((r) => r.id)).toEqual(['Launch']);
	});
});

describe('grouping', () => {
	it('groups by select options in order, empty last', () => {
		const props: PropertyDefinition[] = [{ key: 's', label: 'Stage', type: 'select', options: ['Todo', 'Doing', 'Done'] }];
		const rows = [row('a', { s: 'Done' }), row('b', { s: 'Todo' }), row('c', {}), row('d', { s: 'Other' })];
		expect(groupRows(rows, 'prop:s', props).map((g) => `${g.label}:${g.rows.map((r) => r.id).join('')}`)).toEqual(['Todo:b', 'Done:a', 'Other:d', 'No Stage:c']);
	});
});
