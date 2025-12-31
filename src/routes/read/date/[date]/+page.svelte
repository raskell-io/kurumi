<script lang="ts">
	import { page } from '$app/stores';
	import { getNotesByDate } from '$lib/db';
	import ReadNav from '$lib/components/ReadNav.svelte';
	import NoteCard from '$lib/components/NoteCard.svelte';
	import { Calendar } from 'lucide-svelte';

	let dateStr = $derived($page.params.date);
	let notes = $derived(getNotesByDate(dateStr));

	let breadcrumbs = $derived([{ label: formatDate(dateStr), href: `/read/date/${dateStr}` }]);

	function formatDate(date: string): string {
		try {
			const d = new Date(date + 'T00:00:00');
			return d.toLocaleDateString('en-US', {
				weekday: 'long',
				year: 'numeric',
				month: 'long',
				day: 'numeric'
			});
		} catch {
			return date;
		}
	}

	function getRelativeDate(date: string): string {
		const today = new Date();
		today.setHours(0, 0, 0, 0);
		const d = new Date(date + 'T00:00:00');
		const diffDays = Math.floor((d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

		if (diffDays === 0) return 'Today';
		if (diffDays === 1) return 'Tomorrow';
		if (diffDays === -1) return 'Yesterday';
		if (diffDays > 1 && diffDays <= 7) return `In ${diffDays} days`;
		if (diffDays < -1 && diffDays >= -7) return `${Math.abs(diffDays)} days ago`;
		return '';
	}
</script>

<svelte:head>
	<title>{formatDate(dateStr)} - Kurumi</title>
</svelte:head>

<ReadNav {breadcrumbs} />

<main class="filter-page">
	<header class="page-header">
		<div class="header-icon date-icon">
			<Calendar />
		</div>
		<h1>{formatDate(dateStr)}</h1>
		{#if getRelativeDate(dateStr)}
			<p class="relative-date">{getRelativeDate(dateStr)}</p>
		{/if}
		<p class="count">{notes.length} note{notes.length === 1 ? '' : 's'} referencing this date</p>
	</header>

	{#if notes.length > 0}
		<div class="notes-grid">
			{#each notes as note (note.id)}
				<NoteCard {note} />
			{/each}
		</div>
	{:else}
		<div class="empty-state">
			<p>No notes referencing this date.</p>
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

	.date-icon {
		background: rgba(59, 130, 246, 0.15);
		color: #3b82f6;
	}

	.page-header h1 {
		font-size: 2rem;
		font-weight: 700;
		color: var(--color-text);
		margin-bottom: 0.25rem;
	}

	.relative-date {
		color: #3b82f6;
		font-size: 1rem;
		font-weight: 500;
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
