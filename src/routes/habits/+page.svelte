<script lang="ts">
	import {
		habits,
		habitLogs,
		addHabit,
		removeHabit,
		toggleHabitDay,
		getStreak
	} from '$lib/stores/habits';
	import { Flame, Plus, Trash2, Check } from 'lucide-svelte';

	let newHabitName = $state('');
	const today = new Date().toISOString().slice(0, 10);

	// Generate last 60 days for heatmap
	let heatmapDays = $derived.by(() => {
		const days: string[] = [];
		for (let i = 59; i >= 0; i--) {
			const d = new Date();
			d.setDate(d.getDate() - i);
			days.push(d.toISOString().slice(0, 10));
		}
		return days;
	});

	// Last 7 days for quick toggle
	let weekDays = $derived.by(() => {
		const days: Array<{ iso: string; label: string }> = [];
		for (let i = 6; i >= 0; i--) {
			const d = new Date();
			d.setDate(d.getDate() - i);
			days.push({
				iso: d.toISOString().slice(0, 10),
				label: d.toLocaleDateString('en-US', { weekday: 'short' })
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

	function isChecked(habitId: string, date: string): boolean {
		return ($habitLogs[habitId] || []).includes(date);
	}

	function heatLevel(habitId: string, date: string): number {
		return isChecked(habitId, date) ? 1 : 0;
	}
</script>

<div class="habits-page">
	<header class="habits-header">
		<div class="habits-title">
			<Flame class="h-5 w-5" />
			<h1>Habits</h1>
		</div>
	</header>

	<!-- Add habit -->
	<form class="add-habit" onsubmit={(e) => { e.preventDefault(); handleAddHabit(); }}>
		<input
			bind:value={newHabitName}
			placeholder="New habit..."
			class="habit-input"
		/>
		<button type="submit" class="add-btn" disabled={!newHabitName.trim()}>
			<Plus class="h-4 w-4" />
		</button>
	</form>

	{#if $habits.length === 0}
		<div class="habits-empty">
			<Flame class="h-10 w-10 opacity-20" />
			<p>No habits yet. Add one above to start tracking.</p>
		</div>
	{:else}
		<div class="habits-list">
			{#each $habits as habit (habit.id)}
				{@const streak = getStreak(habit.id, $habitLogs)}
				<div class="habit-card">
					<div class="habit-top">
						<div class="habit-info">
							<span class="habit-name">{habit.name}</span>
							{#if streak > 0}
								<span class="streak-badge">
									<Flame class="h-3 w-3" /> {streak}d
								</span>
							{/if}
						</div>
						<button class="delete-btn" onclick={() => removeHabit(habit.id)} title="Delete habit">
							<Trash2 class="h-3.5 w-3.5" />
						</button>
					</div>

					<!-- Week quick-toggle -->
					<div class="week-row">
						{#each weekDays as day}
							<button
								class="week-cell"
								class:checked={isChecked(habit.id, day.iso)}
								onclick={() => toggleHabitDay(habit.id, day.iso)}
							>
								{#if isChecked(habit.id, day.iso)}
									<Check class="h-3 w-3" />
								{:else}
									<span class="week-label">{day.label}</span>
								{/if}
							</button>
						{/each}
					</div>

					<!-- Heatmap (last 60 days) -->
					<div class="heatmap">
						{#each heatmapDays as day}
							<div
								class="heat-cell"
								class:active={isChecked(habit.id, day)}
								title={day}
							></div>
						{/each}
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.habits-page {
		max-width: 640px;
		margin: 0 auto;
		padding: 1.5rem 1rem;
	}

	.habits-header {
		margin-bottom: 1rem;
	}

	.habits-title {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		color: var(--color-text);
	}

	.habits-title h1 {
		font-size: 1.25rem;
		font-weight: 700;
		margin: 0;
	}

	.add-habit {
		display: flex;
		gap: 0.375rem;
		margin-bottom: 1rem;
	}

	.habit-input {
		flex: 1;
		padding: 0.5rem 0.75rem;
		border: 1px solid var(--color-border);
		border-radius: 0.5rem;
		background: var(--color-bg);
		color: var(--color-text);
		font-size: 0.875rem;
		outline: none;
	}

	.habit-input:focus { border-color: var(--color-accent); }

	.add-btn {
		padding: 0.5rem;
		border: none;
		border-radius: 0.5rem;
		background: var(--color-accent);
		color: white;
		cursor: pointer;
	}

	.add-btn:disabled { opacity: 0.4; }

	.habits-empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.75rem;
		padding: 4rem 1rem;
		text-align: center;
		color: var(--color-text-muted);
	}

	.habits-list {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.habit-card {
		border: 1px solid var(--color-border);
		border-radius: 0.5rem;
		padding: 0.75rem;
	}

	.habit-top {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 0.5rem;
	}

	.habit-info {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.habit-name {
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--color-text);
	}

	.streak-badge {
		display: flex;
		align-items: center;
		gap: 0.125rem;
		padding: 0.0625rem 0.375rem;
		border-radius: 999px;
		background: rgba(249, 115, 22, 0.15);
		color: #f97316;
		font-size: 0.625rem;
		font-weight: 600;
	}

	.delete-btn {
		padding: 0.25rem;
		border: none;
		background: none;
		border-radius: 0.25rem;
		color: var(--color-text-muted);
		cursor: pointer;
		opacity: 0;
		transition: opacity 0.15s;
	}

	.habit-card:hover .delete-btn { opacity: 1; }
	.delete-btn:hover { color: #ef4444; }

	.week-row {
		display: flex;
		gap: 0.25rem;
		margin-bottom: 0.5rem;
	}

	.week-cell {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		height: 2rem;
		border: 1px solid var(--color-border);
		border-radius: 0.375rem;
		background: var(--color-bg);
		color: var(--color-text-muted);
		font-size: 0.5625rem;
		cursor: pointer;
		transition: all 0.15s;
	}

	.week-cell.checked {
		background: var(--color-accent);
		border-color: var(--color-accent);
		color: white;
	}

	.week-cell:hover:not(.checked) {
		border-color: var(--color-accent);
	}

	.heatmap {
		display: flex;
		flex-wrap: wrap;
		gap: 2px;
	}

	.heat-cell {
		width: 8px;
		height: 8px;
		border-radius: 2px;
		background: var(--color-border);
		transition: background 0.15s;
	}

	.heat-cell.active {
		background: var(--color-accent);
	}
</style>
