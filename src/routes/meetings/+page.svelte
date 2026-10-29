<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { meetingSeries, projects, memoryObjects, addMeetingSeries, todayIso, type MeetingCadence } from '$lib/db';
	import { CADENCE_LABELS, meetingsOf, nextMeetingDate } from '$lib/meetings';
	import { dueInfo } from '$lib/utils/due';
	import { CalendarClock, Users } from 'lucide-svelte';

	const today = todayIso();

	// New series form (project preselected when coming from a project page)
	let name = $state('');
	let people = $state('');
	let cadence = $state<MeetingCadence>('weekly');
	let projectId = $state($page.url.searchParams.get('project') ?? '');

	function create(e: SubmitEvent) {
		e.preventDefault();
		if (!name.trim()) return;
		const series = addMeetingSeries({
			name,
			people: people.split(',').map((p) => p.trim()).filter(Boolean),
			cadence,
			projectId: projectId || null
		});
		goto(`/meetings/${series.id}`);
	}
</script>

<svelte:head>
	<title>Meetings - Kurumi</title>
</svelte:head>

<div class="k-page">
	<header class="k-page-header">
		<div class="min-w-0">
			<h1 class="k-page-title">Recurring meetings</h1>
			<p class="k-page-subtitle">1:1s, stand-ups and syncs, each with a running agenda for next time.</p>
		</div>
	</header>

	<form class="k-card mb-5 grid gap-2 p-3" onsubmit={create}>
		<input class="k-input" bind:value={name} placeholder="Meeting name, e.g. 1:1 with Sam" aria-label="Meeting name" />
		<input class="k-input" bind:value={people} placeholder="People, comma separated" aria-label="People" />
		<div class="flex flex-wrap items-center gap-2">
			<select class="k-input !h-8 !w-auto !py-0" bind:value={cadence} aria-label="How often">
				{#each Object.entries(CADENCE_LABELS) as [value, label] (value)}<option {value}>{label}</option>{/each}
			</select>
			<select class="k-input !h-8 !w-auto !py-0" bind:value={projectId} aria-label="Project">
				<option value="">No project</option>
				{#each $projects as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
			</select>
			<button class="k-btn k-btn-primary k-btn-sm ml-auto" disabled={!name.trim()}>Create</button>
		</div>
	</form>

	{#if $meetingSeries.length === 0}
		<div class="k-empty">
			<CalendarClock />
			<p class="k-empty-title">No recurring meetings yet</p>
			<p>Create one above. Add agenda items whenever they come up, then start the meeting from its page.</p>
		</div>
	{:else}
		<ul class="grid gap-2">
			{#each $meetingSeries as series (series.id)}
				{@const last = meetingsOf(series.id, $memoryObjects)[0]}
				{@const next = nextMeetingDate(series.cadence, last)}
				{@const due = next ? dueInfo(next, true, today) : null}
				{@const agenda = series.agenda.filter((a) => !a.meetingId).length}
				<li>
					<a href="/meetings/{series.id}" class="series-card k-card">
						<div class="flex items-center gap-2">
							<CalendarClock class="h-4 w-4 shrink-0 text-[var(--color-accent)]" />
							<span class="min-w-0 flex-1 truncate font-medium">{series.name}</span>
							{#if due}<span class="k-badge" class:k-badge-danger={due.tone === 'danger'} class:k-badge-warn={due.tone === 'warn'}>Next {due.label}</span>{/if}
						</div>
						<p class="mt-1 flex flex-wrap gap-x-2 text-xs text-[var(--color-text-muted)]">
							{#if series.people.length}<span class="inline-flex items-center gap-1"><Users class="h-3 w-3" />{series.people.join(', ')}</span>{/if}
							<span>{CADENCE_LABELS[series.cadence]}</span>
							<span>{agenda} on the agenda</span>
							{#if last}<span>last {new Date(last.createdAt).toLocaleDateString()}</span>{/if}
						</p>
					</a>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.series-card {
		display: block;
		padding: 0.75rem 1rem;
		font-size: 0.9375rem;
		color: var(--color-text);
		text-decoration: none;
	}

	.series-card:hover {
		border-color: var(--color-accent);
	}
</style>
