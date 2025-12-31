<script lang="ts">
	import { page } from '$app/stores';
	import { getNotesByTag } from '$lib/db';
	import ReadNav from '$lib/components/ReadNav.svelte';
	import NoteCard from '$lib/components/NoteCard.svelte';
	import { Tag } from 'lucide-svelte';

	let tag = $derived($page.params.tag);
	let notes = $derived(getNotesByTag(tag));

	let breadcrumbs = $derived([{ label: `#${tag}`, href: `/read/tag/${tag}` }]);
</script>

<svelte:head>
	<title>#{tag} - Kurumi</title>
</svelte:head>

<ReadNav {breadcrumbs} />

<main class="filter-page">
	<header class="page-header">
		<div class="header-icon tag-icon">
			<Tag />
		</div>
		<h1>#{tag}</h1>
		<p class="count">{notes.length} note{notes.length === 1 ? '' : 's'}</p>
	</header>

	{#if notes.length > 0}
		<div class="notes-grid">
			{#each notes as note (note.id)}
				<NoteCard {note} />
			{/each}
		</div>
	{:else}
		<div class="empty-state">
			<p>No notes with this tag.</p>
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

	.tag-icon {
		background: rgba(245, 158, 11, 0.15);
		color: #f59e0b;
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
