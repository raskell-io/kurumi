<script lang="ts">
	import { page } from '$app/stores';
	import { getMemoryObjectsByTopic } from '$lib/db';
	import ReadNav from '$lib/components/ReadNav.svelte';
	import NoteCard from '$lib/components/NoteCard.svelte';
	import { Hash } from 'lucide-svelte';

	let topic = $derived(decodeURIComponent($page.params.topic ?? ''));
	let memories = $derived(getMemoryObjectsByTopic(topic));

	let breadcrumbs = $derived([
		{ label: topic, href: `/read/topic/${encodeURIComponent(topic)}` }
	]);
</script>

<svelte:head>
	<title>{topic} - Kurumi</title>
</svelte:head>

<ReadNav {breadcrumbs} />

<div class="k-page">
	<header class="k-page-header">
		<div class="min-w-0">
			<p class="eyebrow"><Hash class="h-3.5 w-3.5" /> Topic</p>
			<h1 class="k-page-title break-words">{topic}</h1>
			<p class="k-page-subtitle">
				{memories.length} memor{memories.length === 1 ? 'y' : 'ies'} on this topic
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
			<Hash />
			<p class="k-empty-title">No memories on this topic</p>
			<p>Topics are extracted from your memories as they're processed.</p>
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
