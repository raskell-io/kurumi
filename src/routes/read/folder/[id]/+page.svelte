<script lang="ts">
	import { page } from '$app/stores';
	import { getFolder, getFolderPath, getNotesInFolder, getSubfolders } from '$lib/db';
	import ReadNav from '$lib/components/ReadNav.svelte';
	import NoteCard from '$lib/components/NoteCard.svelte';

	let folder = $derived(getFolder($page.params.id));
	let folderPath = $derived(getFolderPath($page.params.id));
	let notes = $derived(getNotesInFolder($page.params.id));
	let subfolders = $derived(getSubfolders($page.params.id));

	let breadcrumbs = $derived(
		folderPath.map((f) => ({ label: f.name, href: `/read/folder/${f.id}` }))
	);
</script>

<svelte:head>
	<title>{folder?.name || 'Folder'} - Kurumi</title>
</svelte:head>

<ReadNav {breadcrumbs} />

{#if folder}
	<main class="filter-page">
		<header class="page-header">
			<div class="header-icon folder-icon">
				<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
					<path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
				</svg>
			</div>
			<h1>{folder.name}</h1>
			<p class="count">{notes.length} note{notes.length === 1 ? '' : 's'}</p>
		</header>

		{#if subfolders.length > 0}
			<section class="subfolders">
				<h2 class="section-title">Subfolders</h2>
				<div class="subfolder-list">
					{#each subfolders as subfolder (subfolder.id)}
						<a href="/read/folder/{subfolder.id}" class="subfolder-card">
							<svg xmlns="http://www.w3.org/2000/svg" class="subfolder-icon" viewBox="0 0 20 20" fill="currentColor">
								<path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
							</svg>
							<span>{subfolder.name}</span>
						</a>
					{/each}
				</div>
			</section>
		{/if}

		{#if notes.length > 0}
			<section class="notes-section">
				<h2 class="section-title">Notes</h2>
				<div class="notes-grid">
					{#each notes as note (note.id)}
						<NoteCard {note} showFolder={false} />
					{/each}
				</div>
			</section>
		{:else if subfolders.length === 0}
			<div class="empty-state">
				<p>This folder is empty.</p>
				<a href="/read" class="back-link">Back to all notes</a>
			</div>
		{/if}
	</main>
{:else}
	<div class="not-found">
		<h1>Folder not found</h1>
		<a href="/read" class="back-link">Back to all notes</a>
	</div>
{/if}

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

	.folder-icon {
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

	.section-title {
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		margin-bottom: 1rem;
	}

	.subfolders {
		margin-bottom: 2rem;
	}

	.subfolder-list {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
	}

	.subfolder-card {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.625rem 1rem;
		background: var(--color-bg-secondary);
		border-radius: 0.5rem;
		text-decoration: none;
		color: var(--color-text);
		font-weight: 500;
		transition: all 0.15s;
	}

	.subfolder-card:hover {
		background: var(--color-border);
	}

	.subfolder-icon {
		width: 1.25rem;
		height: 1.25rem;
		color: var(--color-accent);
	}

	.notes-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
		gap: 1rem;
	}

	.empty-state, .not-found {
		text-align: center;
		padding: 4rem 2rem;
		color: var(--color-text-muted);
	}

	.not-found h1 {
		font-size: 1.5rem;
		color: var(--color-text);
		margin-bottom: 1rem;
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
