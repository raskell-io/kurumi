<script lang="ts">
	import { page } from '$app/stores';
	import { getNotesByPerson } from '$lib/db';
	import ReadNav from '$lib/components/ReadNav.svelte';
	import NoteCard from '$lib/components/NoteCard.svelte';

	let name = $derived(decodeURIComponent($page.params.name));
	let notes = $derived(getNotesByPerson(name));

	let breadcrumbs = $derived([{ label: `@${name}`, href: `/read/person/${encodeURIComponent(name)}` }]);
</script>

<svelte:head>
	<title>@{name} - Kurumi</title>
</svelte:head>

<ReadNav {breadcrumbs} />

<main class="filter-page">
	<header class="page-header">
		<div class="header-icon person-icon">
			<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
				<path fill-rule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clip-rule="evenodd" />
			</svg>
		</div>
		<h1>@{name}</h1>
		<p class="count">{notes.length} note{notes.length === 1 ? '' : 's'} mentioning this person</p>
	</header>

	{#if notes.length > 0}
		<div class="notes-grid">
			{#each notes as note (note.id)}
				<NoteCard {note} />
			{/each}
		</div>
	{:else}
		<div class="empty-state">
			<p>No notes mentioning this person.</p>
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

	.person-icon {
		background: rgba(34, 197, 94, 0.15);
		color: #22c55e;
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
