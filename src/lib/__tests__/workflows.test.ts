import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/db', () => ({}));
const { nextRunAfter, isDue, scheduleLabel } = await import('$lib/workflows');

const at = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min).getTime();

describe('workflow schedules', () => {
	it('finds the next daily, weekly and monthly slot', () => {
		// 2026-11-09 is a Monday.
		expect(nextRunAfter({ kind: 'daily', time: '09:00' }, at(2026, 11, 9, 8))).toBe(at(2026, 11, 9, 9));
		expect(nextRunAfter({ kind: 'daily', time: '09:00' }, at(2026, 11, 9, 9))).toBe(at(2026, 11, 10, 9));
		expect(nextRunAfter({ kind: 'weekly', time: '08:30', weekday: 1 }, at(2026, 11, 9, 10))).toBe(at(2026, 11, 16, 8, 30));
		expect(nextRunAfter({ kind: 'weekly', time: '08:30', weekday: 5 }, at(2026, 11, 9, 10))).toBe(at(2026, 11, 13, 8, 30));
		expect(nextRunAfter({ kind: 'monthly', time: '09:00', day: 1 }, at(2026, 11, 9))).toBe(at(2026, 12, 1, 9));
		// Day 31 in a 30-day month: its last day.
		expect(nextRunAfter({ kind: 'monthly', time: '09:00', day: 31 }, at(2026, 11, 9))).toBe(at(2026, 11, 30, 9));
		expect(nextRunAfter({ kind: 'manual', time: '09:00' }, at(2026, 11, 9))).toBeNull();
	});

	it('is due once after missed slots, not before the first one', () => {
		const schedule = { kind: 'daily' as const, time: '09:00' };
		const createdAt = at(2026, 11, 9, 10);
		expect(isDue({ enabled: true, schedule, lastRunAt: null, createdAt }, at(2026, 11, 9, 23))).toBe(false);
		expect(isDue({ enabled: true, schedule, lastRunAt: null, createdAt }, at(2026, 11, 10, 9))).toBe(true);
		// Closed for three days, then opened: due (once; running sets lastRunAt to now).
		const ranAt = at(2026, 11, 10, 9);
		expect(isDue({ enabled: true, schedule, lastRunAt: ranAt, createdAt }, at(2026, 11, 13, 12))).toBe(true);
		expect(isDue({ enabled: true, schedule, lastRunAt: at(2026, 11, 13, 12), createdAt }, at(2026, 11, 13, 20))).toBe(false);
		expect(isDue({ enabled: false, schedule, lastRunAt: null, createdAt }, at(2026, 12, 1))).toBe(false);
	});

	it('describes schedules', () => {
		expect(scheduleLabel({ kind: 'weekly', time: '08:30', weekday: 1 })).toBe('Every Monday at 08:30');
		expect(scheduleLabel({ kind: 'monthly', time: '09:00', day: 22 })).toBe('Monthly on the 22nd at 09:00');
		expect(scheduleLabel({ kind: 'manual', time: '09:00' })).toBe('When you run it');
	});
});
