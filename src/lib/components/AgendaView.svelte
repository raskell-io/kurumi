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
	// Icons stay faint; only Overdue (danger) and Today (accent) get color.
	const groupConfig = {
		overdue: { label: 'Overdue', icon: AlertCircle, tone: 'danger' },
		today: { label: 'Today', icon: Clock, tone: 'accent' },
		tomorrow: { label: 'Tomorrow', icon: Calendar, tone: '' },
		thisWeek: { label: 'This week', icon: CalendarDays, tone: '' },
		nextWeek: { label: 'Next week', icon: CalendarDays, tone: '' },
		thisMonth: { label: 'This month', icon: CalendarRange, tone: '' },
		later: { label: 'Later', icon: CalendarRange, tone: '' }
	};
</script>

<div class="agenda-view">
	{#each Object.entries(groupConfig) as [key, config]}
		{@const groupDates = groups[key as keyof typeof groups]}
		{#if groupDates.length > 0}
			{@const Icon = config.icon}
			<section class="agenda-group">
				<h3 class="k-section-title group-header {config.tone}">
					<Icon class="h-3.5 w-3.5" />
					{config.label}
					<span class="group-count">{groupDates.length}</span>
				</h3>
				<ul class="group-items">
					{#each groupDates as dateInfo (dateInfo.date)}
						<EventCard
							{dateInfo}
							expanded={expandedItem === dateInfo.date}
							onToggle={() => toggleExpand(dateInfo.date)}
						/>
					{/each}
				</ul>
			</section>
		{/if}
	{/each}

	{#if dates.length === 0}
		<div class="k-empty">
			<Calendar />
			<div class="k-empty-title">No dates yet</div>
			<p>Type //YYYY-MM-DD in a note to reference a date.</p>
		</div>
	{/if}
</div>

<style>
	.agenda-view {
		display: flex;
		flex-direction: column;
	}

	.agenda-group:first-child .group-header {
		margin-top: 0;
	}

	.group-header.danger {
		color: var(--color-danger);
	}

	.group-header.accent {
		color: var(--color-accent);
	}

	.group-count {
		font-weight: 500;
		font-variant-numeric: tabular-nums;
		color: var(--color-text-faint);
	}

	.group-items {
		display: flex;
		flex-direction: column;
		gap: 0.0625rem;
		list-style: none;
		padding: 0;
		margin: 0;
	}
</style>
