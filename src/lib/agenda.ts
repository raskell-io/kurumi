/**
 * Puts work on the date agenda: open to-dos on their due date and
 * recurring meetings on their next expected date, next to the
 * //YYYY-MM-DD references and events collected from notes.
 */

import type { DateWithEvents } from './db/store';
import type { ActionItem, MeetingSeries, MemoryObject } from './db/types';
import { meetingsOf, nextMeetingDate } from './meetings';

export function withWork(
	dates: DateWithEvents[],
	actionItems: ActionItem[],
	series: MeetingSeries[],
	memories: MemoryObject[]
): DateWithEvents[] {
	const byDate = new Map(dates.map((d) => [d.date, { ...d, todos: [...(d.todos ?? [])], meetings: [...(d.meetings ?? [])] }]));
	const entry = (date: string) => {
		let d = byDate.get(date);
		if (!d) {
			d = { date, events: [], mentioningMemories: [], todos: [], meetings: [] };
			byDate.set(date, d);
		}
		return d;
	};

	for (const item of actionItems) {
		if (!item.dueDate || (item.status !== 'open' && item.status !== 'in_progress')) continue;
		entry(item.dueDate.slice(0, 10)).todos.push(item);
	}
	for (const s of series) {
		const next = nextMeetingDate(s.cadence, meetingsOf(s.id, memories)[0]);
		if (next) entry(next).meetings.push(s);
	}

	return [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date));
}
