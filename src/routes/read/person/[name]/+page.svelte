<script lang="ts">
	import { page } from '$app/stores';
	import { getMemoryObjectsByPerson, actionItems, questions, meetingSeries, todayIso } from '$lib/db';
	import ReadNav from '$lib/components/ReadNav.svelte';
	import NoteCard from '$lib/components/NoteCard.svelte';
	import { dueInfo } from '$lib/utils/due';
	import { myNames, isWaitingFor } from '$lib/work';
	import { User, UserRoundCheck, HelpCircle, CalendarClock } from 'lucide-svelte';

	let name = $derived(decodeURIComponent($page.params.name ?? ''));
	let memories = $derived(getMemoryObjectsByPerson(name));

	// What's open with this person: to-dos they owe you, questions for
	// them, and recurring meetings they're in.
	const today = todayIso();
	const same = (a: string | null | undefined, b: string) => !!a && a.trim().replace(/^@/, '').toLowerCase() === b.trim().toLowerCase();
	let waiting = $derived($actionItems.filter((a) => same(a.assignee, name) && isWaitingFor(a, $myNames)));
	let theirQuestions = $derived($questions.filter((q) => q.status === 'open' && same(q.assignee, name)));
	let theirMeetings = $derived($meetingSeries.filter((m) => m.people.some((p) => same(p, name))));

	let breadcrumbs = $derived([{ label: `@${name}`, href: `/read/person/${encodeURIComponent(name)}` }]);
</script>

<svelte:head>
	<title>@{name} - Kurumi</title>
</svelte:head>

<ReadNav {breadcrumbs} />

<div class="k-page">
	<header class="k-page-header">
		<div class="min-w-0">
			<p class="eyebrow"><User class="h-3.5 w-3.5 text-[var(--color-ref-person)]" /> Person</p>
			<h1 class="k-page-title break-words">@{name}</h1>
			<p class="k-page-subtitle">
				{memories.length} note{memories.length === 1 ? '' : 's'} mentioning this person
			</p>
		</div>
	</header>

	{#if waiting.length || theirQuestions.length || theirMeetings.length}
		<div class="mb-6 grid gap-1">
			{#if waiting.length}
				<h2 class="k-section-title !mt-0"><UserRoundCheck class="h-3.5 w-3.5" /> Waiting for from {name} <span class="font-normal tabular-nums">{waiting.length}</span></h2>
				{#each waiting as item (item.id)}
					{@const due = item.dueDate ? dueInfo(item.dueDate, true, today) : null}
					<a href={item.memoryObjectId ? `/memory/${item.memoryObjectId}` : '/actions?filter=waiting'} class="k-row">
						<span class="min-w-0 flex-1 truncate">{item.text}</span>
						{#if due}<span class="text-xs" class:text-[var(--color-danger)]={due.tone === 'danger'} class:text-[var(--color-text-faint)]={due.tone !== 'danger'}>{due.label}</span>{/if}
					</a>
				{/each}
			{/if}
			{#if theirQuestions.length}
				<h2 class="k-section-title"><HelpCircle class="h-3.5 w-3.5" /> Questions for {name} <span class="font-normal tabular-nums">{theirQuestions.length}</span></h2>
				{#each theirQuestions as q (q.id)}
					<a href="/questions" class="k-row"><span class="min-w-0 flex-1 truncate">{q.text}</span></a>
				{/each}
			{/if}
			{#if theirMeetings.length}
				<h2 class="k-section-title"><CalendarClock class="h-3.5 w-3.5" /> Meetings</h2>
				{#each theirMeetings as m (m.id)}
					<a href="/meetings/{m.id}" class="k-row">
						<span class="min-w-0 flex-1 truncate">{m.name}</span>
						<span class="text-xs text-[var(--color-text-faint)]">{m.agenda.filter((a) => !a.meetingId).length} on the agenda</span>
					</a>
				{/each}
			{/if}
		</div>
	{/if}

	{#if memories.length > 0}
		<div class="note-list">
			{#each memories as memory (memory.id)}
				<NoteCard {memory} />
			{/each}
		</div>
	{:else}
		<div class="k-empty">
			<User />
			<p class="k-empty-title">No mentions yet</p>
			<p>Notes that mention @{name} will show up here.</p>
			<a href="/read" class="k-btn mt-2">All notes</a>
		</div>
	{/if}
</div>

<style>
	.eyebrow {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		margin-bottom: 0.375rem;
		font-size: 0.75rem;
		font-weight: 500;
		color: var(--color-text-faint);
	}

	/* Bleed into the gutter so entry text aligns with the title */
	.note-list {
		display: flex;
		flex-direction: column;
		margin: 0 -0.75rem;
	}
</style>
