import { describe, it, expect } from 'vitest';
import { withWork } from '../agenda';
import type { ActionItem, MeetingSeries, MemoryObject } from '../db/types';

const todo = (id: string, dueDate: string | null, status: ActionItem['status'] = 'open') => ({ id, text: id, dueDate, status }) as ActionItem;
const series = { id: 's1', name: 'Weekly sync', cadence: 'weekly', agenda: [], people: [] } as unknown as MeetingSeries;
const meeting = { id: 'm1', seriesId: 's1', createdAt: new Date('2026-10-01T10:00:00').getTime() } as MemoryObject;

describe('withWork', () => {
	it('adds open to-dos on their due date and meetings on their next date', () => {
		const note = { date: '2026-10-08', events: [], mentioningMemories: [] };
		const dates = withWork([note], [todo('a', '2026-10-08'), todo('b', '2026-10-20'), todo('c', '2026-10-20', 'done'), todo('d', null)], [series], [meeting]);

		expect(dates.map((d) => d.date)).toEqual(['2026-10-20', '2026-10-08']);
		expect(dates[0].todos?.map((t) => t.id)).toEqual(['b']);
		expect(dates[1].todos?.map((t) => t.id)).toEqual(['a']);
		expect(dates[1].meetings?.map((s) => s.id)).toEqual(['s1']);
		// The input isn't mutated
		expect(note).toEqual({ date: '2026-10-08', events: [], mentioningMemories: [] });
	});

	it('skips series that have never met', () => {
		expect(withWork([], [], [series], [])).toEqual([]);
	});
});
