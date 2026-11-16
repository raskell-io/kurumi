import { describe, expect, it } from 'vitest';
import {
	daysFrom,
	formatDate,
	formatDay,
	formatDayLong,
	formatDayTime,
	formatDayWithWeekday,
	formatDue,
	formatMonth,
	formatRelative,
	formatTime,
	toDate
} from '$lib/dates/format';
import { dueInfo } from '$lib/utils/due';

const L = { locale: 'en-US' };
const now = new Date(2026, 10, 16, 10, 47, 45); // Mon, Nov 16 2026, 10:47:45 local

describe('dates/format', () => {
	it('reads an ISO day as that local day, not UTC midnight', () => {
		const d = toDate('2026-11-16');
		expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2026, 10, 16, 0]);
		expect(daysFrom('2026-11-17', now)).toBe(1);
		expect(daysFrom('2026-11-14', now)).toBe(-2);
	});

	it('writes a day with the year only when it is another year', () => {
		expect(formatDay('2026-11-16', { ...L, now })).toBe('Nov 16');
		expect(formatDay('2025-03-02', { ...L, now })).toBe('Mar 2, 2025');
		expect(formatDayWithWeekday('2026-11-16', { ...L, now })).toBe('Mon, Nov 16');
		expect(formatDayLong('2026-11-16', { ...L, now })).toBe('Monday, November 16');
		expect(formatMonth('2026-11-16', L)).toBe('November 2026');
	});

	it('follows the locale for order and names', () => {
		expect(formatDay('2026-11-16', { locale: 'de-CH', now })).toBe('16. Nov.');
		expect(formatDay('2026-11-16', { locale: 'en-GB', now })).toBe('16 Nov');
	});

	it('writes times and moments', () => {
		expect(formatTime(now, L)).toBe('10:47 AM');
		expect(formatDayTime(now, { ...L, now })).toBe('Today, 10:47 AM');
		expect(formatDayTime(new Date(2026, 10, 15, 9, 5), { ...L, now })).toBe('Yesterday, 9:05 AM');
		expect(formatDayTime(new Date(2026, 10, 2, 9, 5), { ...L, now })).toBe('Nov 2, 9:05 AM');
	});

	it('says how long ago in words', () => {
		const ago = (ms: number) => formatRelative(now.getTime() - ms, { ...L, now });
		expect(ago(10_000)).toBe('just now');
		expect(ago(-5_000)).toBe('just now');
		expect(ago(5 * 60_000)).toBe('5 min ago');
		expect(ago(60 * 60_000)).toBe('1 hour ago');
		expect(ago(3 * 3_600_000)).toBe('3 hours ago');
		expect(formatRelative(new Date(2026, 10, 15, 23, 0), { ...L, now })).toBe('yesterday');
		expect(formatRelative(new Date(2026, 10, 12), { ...L, now })).toBe('4 days ago');
		expect(formatRelative(new Date(2026, 10, 2), { ...L, now })).toBe('Nov 2');
	});

	it('names due days close by', () => {
		const due = (iso: string) => formatDue(iso, { ...L, now });
		expect(due('2026-11-16')).toBe('Today');
		expect(due('2026-11-17')).toBe('Tomorrow');
		expect(due('2026-11-15')).toBe('Yesterday');
		expect(due('2026-11-20')).toBe('Fri');
		expect(due('2026-11-23')).toBe('Nov 23');
		expect(due('2026-11-14')).toBe('Nov 14');
		expect(due('not a date')).toBe('not a date');
		expect(formatDate('2026-11-16', 'day-weekday', { ...L, now })).toBe('Mon, Nov 16');
	});

	it('gives to-dos a tone only while they are open', () => {
		expect(dueInfo('2026-11-14', true, '2026-11-16').tone).toBe('danger');
		expect(dueInfo('2026-11-16', true, '2026-11-16')).toEqual({ label: 'Today', tone: 'warn' });
		expect(dueInfo('2026-11-14', false, '2026-11-16').tone).toBe('');
	});
});
