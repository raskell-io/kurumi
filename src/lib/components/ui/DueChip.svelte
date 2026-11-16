<script lang="ts">
	import { dueInfo } from '$lib/utils/due';
	import { formatDayWithWeekday } from '$lib/dates/format';

	/**
	 * A to-do's due date, the same everywhere: a small chip, red when
	 * overdue, amber for today (active to-dos only), and the full day on hover.
	 */
	interface Props {
		date: string;
		active?: boolean;
		today?: string;
	}
	let { date, active = true, today }: Props = $props();
	const due = $derived(dueInfo(date, active, today));
</script>

<span
	class="k-badge shrink-0"
	class:k-badge-danger={due.tone === 'danger'}
	class:k-badge-warn={due.tone === 'warn'}
	title="Due {formatDayWithWeekday(date)}"
>
	{due.label}
</span>
