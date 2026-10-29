/**
 * Scheduling helpers for recurring meetings (MeetingSeries).
 */

import type { MeetingCadence, MemoryObject } from './db/types';

const CADENCE_DAYS: Record<MeetingCadence, number | null> = { weekly: 7, biweekly: 14, monthly: 30, none: null };

export const CADENCE_LABELS: Record<MeetingCadence, string> = {
	weekly: 'Weekly',
	biweekly: 'Every two weeks',
	monthly: 'Monthly',
	none: 'No fixed rhythm'
};

/** The series' meeting notes, newest first. */
export function meetingsOf(seriesId: string, memories: MemoryObject[]): MemoryObject[] {
	return memories.filter((m) => m.seriesId === seriesId).sort((a, b) => b.createdAt - a.createdAt);
}

/** ISO date the next meeting is due (last meeting + cadence), or null. */
export function nextMeetingDate(cadence: MeetingCadence, lastMeeting: MemoryObject | undefined): string | null {
	const days = CADENCE_DAYS[cadence];
	if (!days || !lastMeeting) return null;
	const next = new Date(lastMeeting.createdAt);
	next.setDate(next.getDate() + days);
	return next.toISOString().slice(0, 10);
}
