import { describe, it, expect } from 'vitest';
import { isMine, isWaitingFor, waitingByPerson } from '../work';
import { nextMeetingDate, meetingsOf } from '../meetings';
import type { ActionItem, MemoryObject } from '../db/types';

const item = (over: Partial<ActionItem>): ActionItem =>
	({ id: Math.random().toString(36), text: 't', status: 'open', assignee: null, ...over }) as ActionItem;

describe('waiting for', () => {
	const me = ['Zara', 'Zara Z.'];

	it('treats unassigned, "me"/"I" and your own names as yours', () => {
		expect(isMine(null, me)).toBe(true);
		expect(isMine('  ', me)).toBe(true);
		expect(isMine('Me', me)).toBe(true);
		expect(isMine('@zara', me)).toBe(true);
		expect(isMine('Zara Z.', me)).toBe(true);
		expect(isMine('Sam', me)).toBe(false);
	});

	it('only counts open items assigned to others', () => {
		expect(isWaitingFor(item({ assignee: 'Sam' }), me)).toBe(true);
		expect(isWaitingFor(item({ assignee: 'Sam', status: 'done' }), me)).toBe(false);
		expect(isWaitingFor(item({ assignee: 'Zara' }), me)).toBe(false);
	});

	it('groups by person, merging case and @ variants', () => {
		const groups = waitingByPerson(
			[item({ assignee: 'Sam' }), item({ assignee: '@sam' }), item({ assignee: 'Ana' }), item({ assignee: 'Zara' })],
			me
		);
		expect(groups.map((g) => [g.person, g.items.length])).toEqual([
			['Sam', 2],
			['Ana', 1]
		]);
	});
});

describe('recurring meetings', () => {
	const note = (seriesId: string, createdAt: number) => ({ id: String(createdAt), seriesId, createdAt }) as MemoryObject;

	it('finds the series meetings newest first', () => {
		const notes = [note('a', 1), note('b', 2), note('a', 3)];
		expect(meetingsOf('a', notes).map((n) => n.createdAt)).toEqual([3, 1]);
	});

	it('schedules the next one from the last meeting and the cadence', () => {
		const last = note('a', new Date('2026-10-01T10:00:00Z').getTime());
		expect(nextMeetingDate('weekly', last)).toBe('2026-10-08');
		expect(nextMeetingDate('biweekly', last)).toBe('2026-10-15');
		expect(nextMeetingDate('none', last)).toBeNull();
		expect(nextMeetingDate('weekly', undefined)).toBeNull();
	});
});
