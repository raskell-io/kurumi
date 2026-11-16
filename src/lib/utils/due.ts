import { daysFrom, formatDue } from '$lib/dates/format';

/**
 * Human label + tone for an action item's due date ("Today", "Tomorrow",
 * "Fri", "Mar 3"; $lib/dates/format). Only active items get overdue/today
 * colouring; a finished item's due date is just history.
 */
export function dueInfo(
	iso: string,
	active: boolean,
	today?: string
): { label: string; tone: '' | 'danger' | 'warn' } {
	const now = today ?? new Date();
	const label = formatDue(iso, { now });
	if (label === iso) return { label: iso, tone: '' };
	const days = daysFrom(iso, now);
	const tone = !active ? '' : days < 0 ? 'danger' : days === 0 ? 'warn' : '';
	return { label, tone };
}
