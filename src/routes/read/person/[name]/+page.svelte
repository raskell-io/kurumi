<script lang="ts">
	import { page } from '$app/stores';
	import { getMemoryObjectsByPerson } from '$lib/db';
	import ReadNav from '$lib/components/ReadNav.svelte';
	import NoteCard from '$lib/components/NoteCard.svelte';
	import { User } from 'lucide-svelte';

	let name = $derived(decodeURIComponent($page.params.name ?? ''));
	let memories = $derived(getMemoryObjectsByPerson(name));

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
