<script lang="ts">
	import { page } from '$app/stores';
	import {
		getAllPeopleWithMetadata,
		people,
		memoryObjects,
		actionItems,
		questions,
		meetingSeries,
		todayIso
	} from '$lib/db';
	import PersonProfile from '$lib/components/PersonProfile.svelte';
	import NoteCard from '$lib/components/NoteCard.svelte';
	import { dueInfo } from '$lib/utils/due';
	import { myNames, isWaitingFor } from '$lib/work';
	import { User, UserRoundCheck, HelpCircle, CalendarClock, NotebookText, BookOpen } from 'lucide-svelte';

	// One page per person: contact profile, what's open with them, and the
	// notes that mention them. References, @mentions and the People list
	// all link here.
	let name = $derived(decodeURIComponent($page.params.name ?? ''));

	let person = $derived.by(() => {
		void $people; // Dependency triggers: the lookup reads the doc directly
		void $memoryObjects;
		const key = name.trim().toLowerCase();
		return (
			getAllPeopleWithMetadata().find((p) => p.name.toLowerCase() === key) ?? {
				name,
				count: 0,
				person: null,
				mentioningMemories: []
			}
		);
	});
	let mentions = $derived([...person.mentioningMemories].sort((a, b) => b.updatedAt - a.updatedAt));

	// What's open with this person: to-dos they owe you, questions for
	// them, and recurring meetings they're in.
	const today = todayIso();
	const same = (a: string | null | undefined, b: string) => !!a && a.trim().replace(/^@/, '').toLowerCase() === b.trim().toLowerCase();
	let waiting = $derived($actionItems.filter((a) => same(a.assignee, name) && isWaitingFor(a, $myNames)));
	let theirQuestions = $derived($questions.filter((q) => q.status === 'open' && same(q.assignee, name)));
	let theirMeetings = $derived($meetingSeries.filter((m) => m.people.some((p) => same(p, name))));
</script>

<svelte:head>
	<title>@{person.name} - Kurumi</title>
</svelte:head>

<div class="k-page">
	<header class="k-page-header">
		<div class="min-w-0">
			<p class="eyebrow"><User class="h-3.5 w-3.5 text-[var(--color-ref-person)]" /> <a href="/references?tab=people">People</a></p>
			<h1 class="k-page-title break-words">@{person.name}</h1>
			<p class="k-page-subtitle">
				{[person.person?.title, person.person?.company].filter(Boolean).join(' · ') ||
					`${mentions.length} note${mentions.length === 1 ? '' : 's'} mentioning this person`}
			</p>
		</div>
		{#if mentions.length}
			<a href="/read/person/{encodeURIComponent(person.name)}" class="k-btn k-btn-ghost k-btn-sm shrink-0">
				<BookOpen class="h-3.5 w-3.5" /> Read mode
			</a>
		{/if}
	</header>

	<section class="mb-6">
		<PersonProfile {person} />
	</section>

	{#if waiting.length || theirQuestions.length || theirMeetings.length}
		<section class="mb-6 grid gap-1">
			{#if waiting.length}
				<h2 class="k-section-title !mt-0"><UserRoundCheck class="h-3.5 w-3.5" /> Waiting for from {person.name} <span class="font-normal tabular-nums">{waiting.length}</span></h2>
				{#each waiting as item (item.id)}
					{@const due = item.dueDate ? dueInfo(item.dueDate, true, today) : null}
					<a href={item.memoryObjectId ? `/memory/${item.memoryObjectId}` : '/actions?filter=waiting'} class="k-row">
						<span class="min-w-0 flex-1 truncate">{item.text}</span>
						{#if due}<span class="text-xs" class:text-[var(--color-danger)]={due.tone === 'danger'} class:text-[var(--color-text-faint)]={due.tone !== 'danger'}>{due.label}</span>{/if}
					</a>
				{/each}
			{/if}
			{#if theirQuestions.length}
				<h2 class="k-section-title"><HelpCircle class="h-3.5 w-3.5" /> Questions for {person.name} <span class="font-normal tabular-nums">{theirQuestions.length}</span></h2>
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
		</section>
	{/if}

	<h2 class="k-section-title"><NotebookText class="h-3.5 w-3.5" /> Mentioned in <span class="font-normal tabular-nums">{mentions.length}</span></h2>
	{#if mentions.length > 0}
		<div class="note-list">
			{#each mentions as memory (memory.id)}
				<NoteCard {memory} />
			{/each}
		</div>
	{:else}
		<p class="text-sm text-[var(--color-text-muted)]">No notes mention @{person.name} yet.</p>
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

	.eyebrow a {
		color: inherit;
		text-decoration: none;
	}

	.eyebrow a:hover {
		color: var(--color-text);
	}

	/* Bleed into the gutter so entry text aligns with the title */
	.note-list {
		display: flex;
		flex-direction: column;
		margin: 0 -0.75rem;
	}
</style>
