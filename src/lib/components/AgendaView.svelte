<script lang="ts">
	import { groupDatesByPeriod, type DateWithEvents } from '$lib/db/store';
	import EventCard from './EventCard.svelte';
	import { Calendar, AlertCircle, Clock, CalendarDays, CalendarRange } from 'lucide-svelte';

	interface Props {
		dates: DateWithEvents[];
	}

	let { dates }: Props = $props();

	let expandedItem = $state<string | null>(null);

	let groups = $derived(groupDatesByPeriod(dates));

	function toggleExpand(date: string) {
		expandedItem = expandedItem === date ? null : date;
	}

	// Group configs
	const groupConfig = {
		overdue: { label: 'Overdue', icon: AlertCircle, color: 'text-red-500' },
		today: { label: 'Today', icon: Clock, color: 'text-green-500' },
		tomorrow: { label: 'Tomorrow', icon: Calendar, color: 'text-blue-500' },
		thisWeek: { label: 'This Week', icon: CalendarDays, color: 'text-purple-500' },
		nextWeek: { label: 'Next Week', icon: CalendarDays, color: 'text-indigo-500' },
		thisMonth: { label: 'This Month', icon: CalendarRange, color: 'text-cyan-500' },
		later: { label: 'Later', icon: CalendarRange, color: 'text-gray-500' }
	};
</script>

<div class="agenda-view">
	{#each Object.entries(groupConfig) as [key, config]}
		{@const groupDates = groups[key as keyof typeof groups]}
		{#if groupDates.length > 0}
			<div class="agenda-group">
				<div class="group-header">
					<svelte:component this={config.icon} class="h-4 w-4 {config.color}" />
					<h3>{config.label}</h3>
					<span class="group-count">{groupDates.length}</span>
				</div>
				<ul class="group-items">
					{#each groupDates as dateInfo (dateInfo.date)}
						<EventCard
							{dateInfo}
							expanded={expandedItem === dateInfo.date}
							onToggle={() => toggleExpand(dateInfo.date)}
						/>
					{/each}
				</ul>
			</div>
		{/if}
	{/each}

	{#if dates.length === 0}
		<div class="empty-state">
			<Calendar class="h-12 w-12" />
			<h3>No dates yet</h3>
			<p>Use //YYYY-MM-DD in your notes to reference dates</p>
		</div>
	{/if}
</div>

<style>
	.agenda-view {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}

	.agenda-group {
		/* Group container */
	}

	.group-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 0.75rem;
		padding-bottom: 0.5rem;
		border-bottom: 1px solid var(--color-border);
	}

	.group-header h3 {
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--color-text);
		flex: 1;
	}

	.group-count {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		background: var(--color-bg-secondary);
		padding: 0.125rem 0.5rem;
		border-radius: 1rem;
	}

	.group-items {
		list-style: none;
		padding: 0;
		margin: 0;
	}

	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 4rem 2rem;
		text-align: center;
		color: var(--color-text-muted);
	}

	.empty-state h3 {
		font-size: 1.125rem;
		font-weight: 600;
		color: var(--color-text);
		margin: 1rem 0 0.5rem;
	}

	.empty-state p {
		font-size: 0.875rem;
	}
</style>
