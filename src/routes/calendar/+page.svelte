<script lang="ts">
	import { memoryObjects, actionItems } from '$lib/db';
	import { goto } from '$app/navigation';
	import {
		ChevronLeft,
		ChevronRight,
		Calendar,
		FileText,
		Mic,
		Users,
		CheckSquare
	} from 'lucide-svelte';

	let viewDate = $state(new Date());

	let year = $derived(viewDate.getFullYear());
	let month = $derived(viewDate.getMonth());
	let monthLabel = $derived(
		viewDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
	);

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

	let grid = $derived.by((): DayCell[] => {
		const firstDay = new Date(year, month, 1);
		// Monday = 0 in our grid
		let startDow = firstDay.getDay() - 1;
		if (startDow < 0) startDow = 6; // Sunday wraps

		const daysInMonth = new Date(year, month + 1, 0).getDate();
		const daysInPrev = new Date(year, month, 0).getDate();

		const todayIso = new Date().toISOString().slice(0, 10);

		// Pre-compute memory counts by date
		const memCounts = new Map<string, { notes: number; voiceMemos: number; meetings: number }>();
		for (const m of $memoryObjects) {
			if (m.deletedAt) continue;
			const d = new Date(m.createdAt).toISOString().slice(0, 10);
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

		// Previous month trailing days
		for (let i = startDow - 1; i >= 0; i--) {
			const d = daysInPrev - i;
			const dt = new Date(year, month - 1, d);
			const iso = dt.toISOString().slice(0, 10);
			const mc = memCounts.get(iso) || { notes: 0, voiceMemos: 0, meetings: 0 };
			cells.push({
				date: d,
				iso,
				isCurrentMonth: false,
				isToday: iso === todayIso,
				...mc,
				actionsDue: actionCounts.get(iso) || 0
			});
		}

		// Current month days
		for (let d = 1; d <= daysInMonth; d++) {
			const dt = new Date(year, month, d);
			const iso = dt.toISOString().slice(0, 10);
			const mc = memCounts.get(iso) || { notes: 0, voiceMemos: 0, meetings: 0 };
			cells.push({
				date: d,
				iso,
				isCurrentMonth: true,
				isToday: iso === todayIso,
				...mc,
				actionsDue: actionCounts.get(iso) || 0
			});
		}

		// Next month leading days (fill to complete 6 rows max)
		const remaining = 7 - (cells.length % 7);
		if (remaining < 7) {
			for (let d = 1; d <= remaining; d++) {
				const dt = new Date(year, month + 1, d);
				const iso = dt.toISOString().slice(0, 10);
				const mc = memCounts.get(iso) || { notes: 0, voiceMemos: 0, meetings: 0 };
				cells.push({
					date: d,
					iso,
					isCurrentMonth: false,
					isToday: iso === todayIso,
					...mc,
					actionsDue: actionCounts.get(iso) || 0
				});
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

	function hasActivity(cell: DayCell): boolean {
		return cell.notes > 0 || cell.voiceMemos > 0 || cell.meetings > 0 || cell.actionsDue > 0;
	}
</script>

<div class="cal-page">
	<header class="cal-header">
		<div class="cal-title">
			<Calendar class="h-5 w-5" />
			<h1>{monthLabel}</h1>
		</div>
		<div class="cal-nav">
			<button class="nav-btn" onclick={goToday}>Today</button>
			<button class="nav-btn icon" onclick={prevMonth}>
				<ChevronLeft class="h-4 w-4" />
			</button>
			<button class="nav-btn icon" onclick={nextMonth}>
				<ChevronRight class="h-4 w-4" />
			</button>
		</div>
	</header>

	<div class="cal-grid">
		<!-- Day headers -->
		{#each DAYS as day}
			<div class="cal-day-header">{day}</div>
		{/each}

		<!-- Day cells -->
		{#each grid as cell}
			<button
				class="cal-cell"
				class:other-month={!cell.isCurrentMonth}
				class:today={cell.isToday}
				class:has-activity={hasActivity(cell)}
				onclick={() => openDay(cell.iso)}
			>
				<span class="cell-date">{cell.date}</span>
				{#if hasActivity(cell)}
					<div class="cell-dots">
						{#if cell.notes > 0}
							<span class="dot dot-note" title="{cell.notes} note{cell.notes === 1 ? '' : 's'}"></span>
						{/if}
						{#if cell.voiceMemos > 0}
							<span class="dot dot-voice" title="{cell.voiceMemos} voice memo{cell.voiceMemos === 1 ? '' : 's'}"></span>
						{/if}
						{#if cell.meetings > 0}
							<span class="dot dot-meeting" title="{cell.meetings} meeting{cell.meetings === 1 ? '' : 's'}"></span>
						{/if}
						{#if cell.actionsDue > 0}
							<span class="dot dot-action" title="{cell.actionsDue} action{cell.actionsDue === 1 ? '' : 's'} due"></span>
						{/if}
					</div>
				{/if}
			</button>
		{/each}
	</div>

	<div class="cal-legend">
		<span class="legend-item"><span class="dot dot-note"></span> Notes</span>
		<span class="legend-item"><span class="dot dot-voice"></span> Voice</span>
		<span class="legend-item"><span class="dot dot-meeting"></span> Meetings</span>
		<span class="legend-item"><span class="dot dot-action"></span> Actions due</span>
	</div>
</div>

<style>
	.cal-page {
		max-width: 640px;
		margin: 0 auto;
		padding: 1.5rem 1rem;
	}

	.cal-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 1rem;
	}

	.cal-title {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		color: var(--color-text);
	}

	.cal-title h1 {
		font-size: 1.25rem;
		font-weight: 700;
		margin: 0;
	}

	.cal-nav {
		display: flex;
		gap: 0.25rem;
	}

	.nav-btn {
		padding: 0.375rem 0.75rem;
		border: 1px solid var(--color-border);
		border-radius: 0.375rem;
		background: var(--color-bg);
		color: var(--color-text-muted);
		font-size: 0.75rem;
		cursor: pointer;
	}

	.nav-btn.icon {
		padding: 0.375rem;
	}

	.nav-btn:hover {
		background: var(--color-bg-secondary);
		color: var(--color-text);
	}

	.cal-grid {
		display: grid;
		grid-template-columns: repeat(7, 1fr);
		gap: 1px;
		background: var(--color-border);
		border: 1px solid var(--color-border);
		border-radius: 0.5rem;
		overflow: hidden;
	}

	.cal-day-header {
		padding: 0.5rem;
		text-align: center;
		font-size: 0.6875rem;
		font-weight: 600;
		text-transform: uppercase;
		color: var(--color-text-muted);
		background: var(--color-bg-secondary);
	}

	.cal-cell {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.25rem;
		padding: 0.5rem 0.25rem;
		min-height: 3.5rem;
		background: var(--color-bg);
		border: none;
		cursor: pointer;
		transition: background 0.1s;
	}

	.cal-cell:hover {
		background: var(--color-bg-secondary);
	}

	.cal-cell.other-month {
		opacity: 0.35;
	}

	.cal-cell.today .cell-date {
		background: var(--color-accent);
		color: white;
		border-radius: 50%;
		width: 1.5rem;
		height: 1.5rem;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.cell-date {
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--color-text);
	}

	.cell-dots {
		display: flex;
		gap: 0.1875rem;
		flex-wrap: wrap;
		justify-content: center;
	}

	.dot {
		width: 0.375rem;
		height: 0.375rem;
		border-radius: 50%;
	}

	.dot-note { background: var(--color-accent); }
	.dot-voice { background: #a78bfa; }
	.dot-meeting { background: #34d399; }
	.dot-action { background: #f59e0b; }

	.cal-legend {
		display: flex;
		gap: 1rem;
		justify-content: center;
		margin-top: 0.75rem;
		font-size: 0.6875rem;
		color: var(--color-text-muted);
	}

	.legend-item {
		display: flex;
		align-items: center;
		gap: 0.25rem;
	}
</style>
