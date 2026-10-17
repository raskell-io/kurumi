<script lang="ts">
	import { memoryObjects, actionItems, todayIso } from '$lib/db';
	import { goto } from '$app/navigation';
	import { ChevronLeft, ChevronRight } from 'lucide-svelte';

	let viewDate = $state(new Date());

	let year = $derived(viewDate.getFullYear());
	let month = $derived(viewDate.getMonth());
	let monthName = $derived(viewDate.toLocaleDateString('en-US', { month: 'long' }));

	const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

	interface DayCell {
		date: number;
		iso: string;
		isCurrentMonth: boolean;
		isToday: boolean;
		notes: number;
		voiceMemos: number;
		meetings: number;
		actionsDue: number;
	}

	// Local-time YYYY-MM-DD. toISOString() is UTC, which shifted every cell
	// (and every memory's day) by one for users east/west of Greenwich.
	function localIso(dt: Date): string {
		const m = String(dt.getMonth() + 1).padStart(2, '0');
		const d = String(dt.getDate()).padStart(2, '0');
		return `${dt.getFullYear()}-${m}-${d}`;
	}

	let grid = $derived.by((): DayCell[] => {
		const firstDay = new Date(year, month, 1);
		// Monday = 0 in our grid
		let startDow = firstDay.getDay() - 1;
		if (startDow < 0) startDow = 6; // Sunday wraps

		const daysInMonth = new Date(year, month + 1, 0).getDate();
		const daysInPrev = new Date(year, month, 0).getDate();

		const today = todayIso();

		// Pre-compute memory counts by date
		const memCounts = new Map<string, { notes: number; voiceMemos: number; meetings: number }>();
		for (const m of $memoryObjects) {
			if (m.deletedAt) continue;
			const d = localIso(new Date(m.createdAt));
			const existing = memCounts.get(d) || { notes: 0, voiceMemos: 0, meetings: 0 };
			if (m.type === 'note') existing.notes++;
			else if (m.type === 'voice-memo') existing.voiceMemos++;
			else if (m.type === 'meeting') existing.meetings++;
			memCounts.set(d, existing);
		}

		// Pre-compute action items due by date
		const actionCounts = new Map<string, number>();
		for (const a of $actionItems) {
			if ((a.status === 'open' || a.status === 'in_progress') && a.dueDate) {
				actionCounts.set(a.dueDate, (actionCounts.get(a.dueDate) || 0) + 1);
			}
		}

		const cells: DayCell[] = [];
		const push = (dt: Date, isCurrentMonth: boolean) => {
			const iso = localIso(dt);
			const mc = memCounts.get(iso) || { notes: 0, voiceMemos: 0, meetings: 0 };
			cells.push({
				date: dt.getDate(),
				iso,
				isCurrentMonth,
				isToday: iso === today,
				...mc,
				actionsDue: actionCounts.get(iso) || 0
			});
		};

		// Previous month trailing days
		for (let i = startDow - 1; i >= 0; i--) {
			push(new Date(year, month - 1, daysInPrev - i), false);
		}

		// Current month days
		for (let d = 1; d <= daysInMonth; d++) {
			push(new Date(year, month, d), true);
		}

		// Next month leading days (complete the last week)
		const remaining = 7 - (cells.length % 7);
		if (remaining < 7) {
			for (let d = 1; d <= remaining; d++) {
				push(new Date(year, month + 1, d), false);
			}
		}

		return cells;
	});

	function prevMonth() {
		viewDate = new Date(year, month - 1, 1);
	}

	function nextMonth() {
		viewDate = new Date(year, month + 1, 1);
	}

	function goToday() {
		viewDate = new Date();
	}

	function openDay(iso: string) {
		goto(`/daily/${iso}`);
	}

	function plural(n: number, word: string): string {
		return `${n} ${word}${n === 1 ? '' : 's'}`;
	}

	function cellLabel(cell: DayCell): string {
		const date = new Date(cell.iso + 'T00:00:00').toLocaleDateString('en-US', {
			weekday: 'long',
			month: 'long',
			day: 'numeric'
		});
		const parts = [date];
		if (cell.notes) parts.push(plural(cell.notes, 'note'));
		if (cell.voiceMemos) parts.push(plural(cell.voiceMemos, 'voice memo'));
		if (cell.meetings) parts.push(plural(cell.meetings, 'meeting'));
		if (cell.actionsDue) parts.push(`${plural(cell.actionsDue, 'action')} due`);
		return parts.join(', ');
	}
</script>

<svelte:head>
	<title>Calendar - Kurumi</title>
</svelte:head>

<div class="h-full overflow-y-auto">
	<div class="k-page k-page-wide">
		<header class="k-page-header cal-header">
			<h1 class="k-page-title">
				{monthName} <span class="cal-year">{year}</span>
			</h1>
			<div class="cal-nav">
				<button class="k-btn k-btn-sm" onclick={goToday}>Today</button>
				<button class="k-icon-btn" onclick={prevMonth} aria-label="Previous month" title="Previous month">
					<ChevronLeft class="h-4 w-4" />
				</button>
				<button class="k-icon-btn" onclick={nextMonth} aria-label="Next month" title="Next month">
					<ChevronRight class="h-4 w-4" />
				</button>
			</div>
		</header>

		<div class="cal-weekdays" aria-hidden="true">
			{#each DAYS as day}
				<div>{day}</div>
			{/each}
		</div>

		<div class="cal-grid">
			{#each grid as cell (cell.iso)}
				<button
					class="cal-cell"
					class:other-month={!cell.isCurrentMonth}
					class:today={cell.isToday}
					onclick={() => openDay(cell.iso)}
					aria-label={cellLabel(cell)}
					aria-current={cell.isToday ? 'date' : undefined}
				>
					<span class="cell-date">{cell.date}</span>
					<span class="cell-pills">
						{#if cell.meetings > 0}
							<span class="pill">
								<span class="pill-dot"></span>
								<span class="pill-label">{plural(cell.meetings, 'meeting')}</span>
							</span>
						{/if}
						{#if cell.voiceMemos > 0}
							<span class="pill">
								<span class="pill-dot"></span>
								<span class="pill-label">{plural(cell.voiceMemos, 'memo')}</span>
							</span>
						{/if}
						{#if cell.notes > 0}
							<span class="pill">
								<span class="pill-dot"></span>
								<span class="pill-label">{plural(cell.notes, 'note')}</span>
							</span>
						{/if}
						{#if cell.actionsDue > 0}
							<span class="pill pill-due">
								<span class="pill-dot"></span>
								<span class="pill-label">{cell.actionsDue} due</span>
							</span>
						{/if}
					</span>
				</button>
			{/each}
		</div>

		<div class="cal-legend">
			<span class="legend-item"><span class="pill-dot"></span> Notes, memos &amp; meetings</span>
			<span class="legend-item pill-due"><span class="pill-dot"></span> Actions due</span>
		</div>
	</div>
</div>

<style>
	.cal-header {
		align-items: center;
		margin-bottom: 1.25rem;
	}

	.cal-year {
		font-weight: 400;
		color: var(--color-text-faint);
	}

	.cal-nav {
		display: flex;
		align-items: center;
		gap: 0.125rem;
	}

	.cal-nav .k-btn {
		margin-right: 0.25rem;
	}

	.cal-weekdays {
		display: grid;
		grid-template-columns: repeat(7, minmax(0, 1fr));
		padding-bottom: 0.375rem;
		font-size: 0.6875rem;
		font-weight: 500;
		color: var(--color-text-faint);
	}

	.cal-weekdays > div {
		padding: 0 0.5rem;
	}

	/* Hairline grid: 1px gaps over a border-colored background */
	.cal-grid {
		display: grid;
		grid-template-columns: repeat(7, minmax(0, 1fr));
		gap: 1px;
		background: var(--color-border);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		overflow: hidden;
	}

	.cal-cell {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.25rem;
		min-width: 0;
		min-height: 6rem;
		padding: 0.375rem;
		background: var(--color-bg);
		text-align: left;
		cursor: pointer;
	}

	.cal-cell:hover {
		background: color-mix(in srgb, var(--color-text) 4%, var(--color-bg));
	}

	.cal-cell:focus-visible {
		outline-offset: -2px;
	}

	.cell-date {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 1.5rem;
		height: 1.5rem;
		padding: 0 0.25rem;
		border-radius: 999px;
		font-size: 0.75rem;
		font-weight: 500;
		font-variant-numeric: tabular-nums;
		color: var(--color-text);
	}

	.other-month .cell-date {
		color: var(--color-text-faint);
	}

	.other-month .cell-pills {
		opacity: 0.55;
	}

	.today .cell-date {
		background: var(--color-accent);
		/* bg color reads as white on Latte and as Mocha base on dark accent */
		color: var(--color-bg);
		font-weight: 600;
	}

	.cell-pills {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		width: 100%;
		min-width: 0;
	}

	.pill {
		--pill-color: var(--color-ref-date);
		display: flex;
		align-items: center;
		gap: 0.3125rem;
		min-width: 0;
		height: 1.125rem;
		padding: 0 0.375rem;
		border-radius: var(--radius-sm);
		background: color-mix(in srgb, var(--pill-color) 12%, transparent);
		font-size: 0.6875rem;
		line-height: 1;
		color: var(--pill-color);
	}

	.pill-due {
		--pill-color: var(--color-ref-tag);
	}

	.pill-dot {
		width: 0.375rem;
		height: 0.375rem;
		flex-shrink: 0;
		border-radius: 999px;
		background: var(--pill-color, var(--color-ref-date));
	}

	.pill-label {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.cal-legend {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 1rem;
		margin-top: 0.75rem;
		padding: 0 0.25rem;
		font-size: 0.75rem;
		color: var(--color-text-faint);
	}

	.legend-item {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
	}

	.legend-item.pill-due .pill-dot {
		background: var(--color-ref-tag);
	}

	/* Narrow screens: pills collapse to a row of dots under the date */
	@media (max-width: 640px) {
		.cal-cell {
			align-items: center;
			min-height: 3.5rem;
			padding: 0.375rem 0.125rem;
		}

		.cell-pills {
			flex-direction: row;
			flex-wrap: wrap;
			justify-content: center;
			gap: 0.1875rem;
		}

		.pill {
			height: auto;
			padding: 0;
			background: none;
		}

		.pill-label {
			display: none;
		}

		.cal-weekdays > div {
			padding: 0;
			text-align: center;
		}
	}
</style>
