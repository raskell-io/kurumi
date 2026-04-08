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

<main class="filter-page">
	<header class="page-header">
		<div class="header-icon topic-icon">
			<Hash />
		</div>
		<h1>{topic}</h1>
		<p class="count">
			{memories.length} memor{memories.length === 1 ? 'y' : 'ies'} on this topic
		</p>
	</header>

	{#if memories.length > 0}
		<div class="notes-grid">
			{#each memories as memory (memory.id)}
				<NoteCard memory={memory} />
			{/each}
		</div>
	{:else}
		<div class="empty-state">
			<p>No memories on this topic.</p>
			<a href="/read" class="back-link">Back to all notes</a>
		</div>
	{/if}
</main>

<style>
	.filter-page {
		max-width: 1000px;
		margin: 0 auto;
		padding: 2rem 1.5rem 4rem;
	}

	.page-header {
		text-align: center;
		margin-bottom: 2rem;
	}

	.header-icon {
		width: 4rem;
		height: 4rem;
		margin: 0 auto 1rem;
		padding: 1rem;
		border-radius: 1rem;
	}

	.header-icon svg {
		width: 100%;
		height: 100%;
	}

	.topic-icon {
		background: color-mix(in srgb, var(--color-accent) 15%, transparent);
		color: var(--color-accent);
	}

	.page-header h1 {
		font-size: 2rem;
		font-weight: 700;
		color: var(--color-text);
		margin-bottom: 0.5rem;
	}

	.count {
		color: var(--color-text-muted);
		font-size: 0.875rem;
	}

	.notes-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
		gap: 1rem;
	}

	.empty-state {
		text-align: center;
		padding: 4rem 2rem;
		color: var(--color-text-muted);
	}

	.back-link {
		display: inline-block;
		margin-top: 1rem;
		padding: 0.75rem 1.5rem;
		background: var(--color-accent);
		color: white;
		text-decoration: none;
		border-radius: 0.5rem;
	}

	.back-link:hover {
		background: var(--color-accent-hover);
	}
</style>
