import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/db', () => ({}));
vi.mock('$lib/inference', () => ({ inferenceRouter: { allProviders: () => [] } }));
vi.mock('$lib/work', () => ({
	myNames: { subscribe: () => () => {} },
	isWaitingFor: (item: { assignee: string | null }, names: string[]) =>
		!!item.assignee && !names.includes(item.assignee) && !['me', 'i'].includes(item.assignee.toLowerCase())
}));

const { buildWeeklyReview, mondayOf, previousWeek, addDays } = await import('$lib/weekly-review');

const at = (iso: string, hour = 12) => {
	const [y, m, d] = iso.split('-').map(Number);
	return new Date(y, m - 1, d, hour).getTime();
};
const memory = (id: string, title: string, created: string, extra: Record<string, unknown> = {}) =>
	({ id, title, type: 'note', createdAt: at(created), updatedAt: at(created), projects: [], ...extra }) as never;
const item = (id: string, text: string, status: string, extra: Record<string, unknown> = {}) =>
	({ id, text, status, dueDate: null, assignee: null, createdAt: at('2026-10-01'), updatedAt: at('2026-10-01'), projectId: null, memoryObjectId: null, ...extra }) as never;

describe('weekly review', () => {
	it('works out weeks from Monday to Sunday', () => {
		expect(mondayOf('2026-11-08')).toBe('2026-11-02'); // a Sunday
		expect(mondayOf('2026-11-09')).toBe('2026-11-09'); // a Monday
		expect(previousWeek('2026-11-10')).toEqual({ start: '2026-11-02', end: '2026-11-08' });
		expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
	});

	const week = { start: '2026-11-02', end: '2026-11-08' };
	const base = { decisions: [], questions: [], proposals: [], series: [], projects: [], names: ['Zara'], today: '2026-11-10' };

	it('says nothing about an empty week with nothing pending', () => {
		expect(buildWeeklyReview(week, { ...base, memories: [], items: [] })).toBeNull();
	});

	it('lists the week and what carries over, never as checkboxes', () => {
		const review = buildWeeklyReview(week, {
			...base,
			memories: [
				memory('m1', 'Kickoff', '2026-11-03', { type: 'meeting', summaryShort: 'Agreed scope', projects: ['Falcon'] }),
				memory('m2', 'Idea', '2026-11-05'),
				memory('old', 'Before', '2026-10-20'),
				memory('review-default-2026-10-26', 'Weekly review — 2026-10-26 to 2026-11-01', '2026-11-02')
			],
			items: [
				item('a1', 'Ship it', 'done', { updatedAt: at('2026-11-04'), memoryObjectId: 'm1' }),
				item('a2', 'Late thing', 'open', { dueDate: '2026-11-01' }),
				item('a3', 'Next week thing', 'open', { dueDate: '2026-11-12' }),
				item('a4', 'Ask Bob', 'open', { assignee: 'Bob' })
			],
			projects: [{ id: 'p', name: 'Falcon' } as never],
			decisions: [{ id: 'd', text: 'Go with plan B', rationale: 'cheaper', decidedOn: '2026-11-04', createdAt: 0 } as never]
		})!;
		expect(review.body).toMatch(/^2 new notes · 1 of 4 to-dos done · 1 decision/);
		expect(review.body).toContain('## Meetings\n\n- [Kickoff](/memory/m1): Agreed scope');
		expect(review.body).toContain('- Go with plan B (cheaper)');
		expect(review.body).toContain('## Done\n\n- Ship it');
		expect(review.body).toContain('- **Falcon**: 1 note, 1 done');
		expect(review.body).toContain('- Late thing (due 2026-11-01)');
		expect(review.body).toContain('- Ask Bob (Bob)');
		expect(review.body).toContain('## Next week (2026-11-09 to 2026-11-15)\n\n- Next week thing (due 2026-11-12)');
		expect(review.body).not.toContain('Before');
		expect(review.body).not.toContain('Weekly review —');
		expect(review.body).not.toMatch(/- \[[ x]\]/);
	});
});
