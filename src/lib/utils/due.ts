/**
 * Human label + tone for an action item's due date ("Today", "Tomorrow",
 * "Fri", "Mar 3"). Only active items get overdue/today colouring; a
 * finished item's due date is just history.
 */
export function dueInfo(
	iso: string,
	active: boolean,
	today: string
): { label: string; tone: '' | 'danger' | 'warn' } {
	const date = new Date(iso + 'T00:00:00');
	if (Number.isNaN(date.getTime())) return { label: iso, tone: '' };
	const days = Math.round((date.getTime() - new Date(today + 'T00:00:00').getTime()) / 86_400_000);
	let label: string;
	if (days === 0) label = 'Today';
	else if (days === 1) label = 'Tomorrow';
	else if (days === -1) label = 'Yesterday';
	else if (days > 1 && days < 7) label = date.toLocaleDateString(undefined, { weekday: 'short' });
	else
		label = date.toLocaleDateString(undefined, {
			month: 'short',
			day: 'numeric',
			year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric'
		});
	const tone = !active ? '' : days < 0 ? 'danger' : days === 0 ? 'warn' : '';
	return { label, tone };
}
