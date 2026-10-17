<script lang="ts">
	import { get } from 'svelte/store';
	import {
		habits,
		habitLogs,
		addHabit,
		removeHabit,
		toggleHabitDay,
		getStreak,
		type Habit,
		localIsoDate
	} from '$lib/stores/habits';
	import { pushUndo } from '$lib/stores/undo';
	import { Flame, Plus, Trash2, Check } from 'lucide-svelte';

	let newHabitName = $state('');
	// Local calendar days, matching how the habits store logs and computes
	// streaks.
	const today = localIsoDate();

	// Generate last 60 days for heatmap
	let heatmapDays = $derived.by(() => {
		const days: string[] = [];
		for (let i = 59; i >= 0; i--) {
			const d = new Date();
			d.setDate(d.getDate() - i);
			days.push(localIsoDate(d));
		}
		return days;
	});

	// Last 7 days for quick toggle
	let weekDays = $derived.by(() => {
		const days: Array<{ iso: string; label: string; day: number; long: string }> = [];
		for (let i = 6; i >= 0; i--) {
			const d = new Date();
			d.setDate(d.getDate() - i);
			days.push({
				iso: localIsoDate(d),
				label: d.toLocaleDateString('en-US', { weekday: 'short' }),
				day: d.getDate(),
				long: d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
			});
		}
		return days;
	});

	function handleAddHabit() {
		const name = newHabitName.trim();
		if (!name) return;
		addHabit(name);
		newHabitName = '';
	}

	function handleRemoveHabit(habit: Habit) {
		// Deleting drops the habit's whole log, so offer an undo that puts
		// both back where they were.
		const index = get(habits).findIndex((h) => h.id === habit.id);
		const log = get(habitLogs)[habit.id];
		removeHabit(habit.id);
		pushUndo({
			label: `Deleted habit "${habit.name}"`,
			undo: () => {
				habits.update((list) => {
					if (list.some((h) => h.id === habit.id)) return list;
					const next = [...list];
					next.splice(Math.min(index, next.length), 0, habit);
					return next;
				});
				if (log) habitLogs.update((l) => ({ ...l, [habit.id]: log }));
			}
		});
	}

	function isChecked(habitId: string, date: string): boolean {
		return ($habitLogs[habitId] || []).includes(date);
	}
</script>

<svelte:head>
	<title>Habits - Kurumi</title>
</svelte:head>

<div class="h-full overflow-y-auto">
	<div class="k-page">
		<header class="k-page-header">
			<div>
				<h1 class="k-page-title">Habits</h1>
				<p class="k-page-subtitle">Check off a day to keep the streak going.</p>
			</div>
		</header>

		<form class="add-habit" onsubmit={(e) => { e.preventDefault(); handleAddHabit(); }}>
			<input
				bind:value={newHabitName}
				placeholder="New habit…"
				class="k-input"
				aria-label="New habit name"
			/>
			<button type="submit" class="k-btn k-btn-primary" disabled={!newHabitName.trim()}>
				<Plus class="h-4 w-4" />
				Add
			</button>
		</form>

		{#if $habits.length === 0}
			<div class="k-empty">
				<Flame />
				<div class="k-empty-title">No habits yet</div>
				<p>Add one above to start tracking it day by day.</p>
			</div>
		{:else}
			<div class="habit-grid" role="table" aria-label="Habits, last 7 days">
				<div class="habit-row habit-head" role="row">
					<div class="name-cell" role="columnheader">Habit</div>
					{#each weekDays as day (day.iso)}
						<div class="day-head" class:is-today={day.iso === today} role="columnheader">
							<span>{day.label}</span>
							<span class="day-num">{day.day}</span>
						</div>
					{/each}
					<div role="columnheader" aria-label="Actions"></div>
				</div>

				{#each $habits as habit (habit.id)}
					{@const streak = getStreak(habit.id, $habitLogs)}
					<div class="habit-row" role="row">
						<div class="name-cell" role="rowheader">
							<span class="habit-name">{habit.name}</span>
							{#if streak > 0}
								<span class="k-badge streak" title="{streak}-day streak">
									<Flame class="h-3 w-3" />{streak}d
								</span>
							{/if}
						</div>
						{#each weekDays as day (day.iso)}
							{@const done = isChecked(habit.id, day.iso)}
							<div class="check-wrap" role="cell">
								<button
									class="check-cell"
									class:checked={done}
									class:is-today={day.iso === today}
									onclick={() => toggleHabitDay(habit.id, day.iso)}
									aria-pressed={done}
									aria-label="{habit.name}, {day.long}"
								>
									{#if done}
										<Check class="h-3.5 w-3.5" strokeWidth={3} />
									{/if}
								</button>
							</div>
						{/each}
						<div class="check-wrap" role="cell">
							<button
								class="k-icon-btn delete-btn"
								onclick={() => handleRemoveHabit(habit)}
								aria-label="Delete habit {habit.name}"
								title="Delete habit"
							>
								<Trash2 class="h-3.5 w-3.5" />
							</button>
						</div>
						<!-- Last 60 days at a glance -->
						<div class="heatmap" aria-hidden="true">
							{#each heatmapDays as day (day)}
								<span class="heat-cell" class:active={isChecked(habit.id, day)} title={day}></span>
							{/each}
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</div>
</div>

<style>
	.add-habit {
		display: flex;
		gap: 0.5rem;
		margin-bottom: 1.5rem;
	}

	.habit-grid {
		display: flex;
		flex-direction: column;
	}

	/* Shared column template keeps header and rows aligned */
	.habit-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) repeat(7, 2rem) 1.75rem;
		align-items: center;
		column-gap: 0.25rem;
		padding: 0.5rem 0.25rem 0.5rem 0.625rem;
		border-radius: var(--radius-md);
	}

	.habit-row:not(.habit-head):hover {
		background: var(--color-hover);
	}

	.habit-head {
		padding-top: 0;
		padding-bottom: 0.25rem;
		font-size: 0.6875rem;
		color: var(--color-text-faint);
	}

	.day-head {
		display: flex;
		flex-direction: column;
		align-items: center;
		line-height: 1.3;
	}

	.day-num {
		font-variant-numeric: tabular-nums;
		color: var(--color-text-muted);
	}

	.day-head.is-today,
	.day-head.is-today .day-num {
		color: var(--color-accent);
		font-weight: 600;
	}

	.name-cell {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-width: 0;
	}

	.habit-head .name-cell {
		font-weight: 500;
	}

	.habit-name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--color-text);
	}

	.streak {
		flex-shrink: 0;
		gap: 0.125rem;
	}

	.check-wrap {
		display: flex;
		justify-content: center;
	}

	.check-cell {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.625rem;
		height: 1.625rem;
		border: 1.5px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-bg);
		/* bg color reads as white on Latte and as Mocha base on dark accent */
		color: var(--color-bg);
		cursor: pointer;
	}

	.check-cell:hover:not(.checked) {
		border-color: color-mix(in srgb, var(--color-accent) 60%, var(--color-border));
		background: var(--color-accent-soft);
	}

	.check-cell.is-today:not(.checked) {
		border-color: color-mix(in srgb, var(--color-accent) 45%, var(--color-border));
	}

	.check-cell.checked {
		border-color: var(--color-accent);
		background: var(--color-accent);
	}

	.check-cell.checked:hover {
		border-color: var(--color-accent-hover);
		background: var(--color-accent-hover);
	}

	.delete-btn {
		opacity: 0;
	}

	.habit-row:hover .delete-btn,
	.delete-btn:focus-visible {
		opacity: 1;
	}

	.delete-btn:hover {
		color: var(--color-danger);
	}

	@media (hover: none) {
		.delete-btn {
			opacity: 1;
		}
	}

	.heatmap {
		grid-column: 1 / -1;
		display: flex;
		flex-wrap: wrap;
		gap: 2px;
		margin-top: 0.5rem;
	}

	.heat-cell {
		width: 7px;
		height: 7px;
		border-radius: 2px;
		background: color-mix(in srgb, var(--color-text) 9%, transparent);
	}

	.heat-cell.active {
		background: var(--color-accent);
	}

	/* The global 44px touch-target floor would overflow the 1fr day columns */
	@media (hover: none) and (pointer: coarse) {
		.check-cell {
			min-width: 0;
			width: 100%;
			max-width: 2.75rem;
			height: 2.25rem;
			min-height: 2.25rem;
		}
	}

	/* Narrow screens: habit name gets its own line above the checks */
	@media (max-width: 480px) {
		.habit-row {
			grid-template-columns: repeat(7, minmax(0, 1fr)) 1.75rem;
			row-gap: 0.375rem;
		}

		.name-cell {
			grid-column: 1 / -1;
		}

		.habit-head .name-cell {
			display: none;
		}
	}
</style>
