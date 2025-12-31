<script lang="ts">
	import { notes, folders, getSubfolders, getNotesInFolder, getAllTags } from '$lib/db';
	import ReadNav from '$lib/components/ReadNav.svelte';
	import NoteCard from '$lib/components/NoteCard.svelte';
	import { FileText, Folder, ChevronRight } from 'lucide-svelte';

	type SortOption = 'recent' | 'alphabetical' | 'oldest';
	type ViewOption = 'all' | 'folders';

	let sortBy = $state<SortOption>('recent');
	let viewBy = $state<ViewOption>('all');
	let expandedFolders = $state<Set<string>>(new Set());

	// Get root folders
	let rootFolders = $derived(getSubfolders(null));

	// Get root notes (notes not in any folder)
	let rootNotes = $derived(getNotesInFolder(null));

	// Get all tags
	let allTags = $derived(getAllTags());

	// Sort notes based on selected option
	let sortedNotes = $derived.by(() => {
		const notesList = [...$notes];
		switch (sortBy) {
			case 'recent':
				return notesList.sort((a, b) => b.modified - a.modified);
			case 'oldest':
				return notesList.sort((a, b) => a.modified - b.modified);
			case 'alphabetical':
				return notesList.sort((a, b) => (a.title || 'Untitled').localeCompare(b.title || 'Untitled'));
			default:
				return notesList;
		}
	});

	function toggleFolder(folderId: string) {
		const newSet = new Set(expandedFolders);
		if (newSet.has(folderId)) {
			newSet.delete(folderId);
		} else {
			newSet.add(folderId);
		}
		expandedFolders = newSet;
	}

	function getFolderNotes(folderId: string) {
		return getNotesInFolder(folderId);
	}

	function getFolderSubfolders(folderId: string) {
		return getSubfolders(folderId);
	}
</script>

<svelte:head>
	<title>Kurumi - Read</title>
</svelte:head>

<ReadNav />

<main class="blog-index">
	<!-- Hero -->
	<header class="hero">
		<h1>Kurumi</h1>
		<p class="tagline">Your personal knowledge base</p>
		<div class="stats">
			<span>{$notes.length} notes</span>
			<span class="dot"></span>
			<span>{$folders.length} folders</span>
			<span class="dot"></span>
			<span>{allTags.length} tags</span>
		</div>
	</header>

	<!-- Controls -->
	<div class="controls">
		<div class="view-toggle">
			<button
				class="toggle-btn"
				class:active={viewBy === 'all'}
				onclick={() => (viewBy = 'all')}
			>
				All Notes
			</button>
			<button
				class="toggle-btn"
				class:active={viewBy === 'folders'}
				onclick={() => (viewBy = 'folders')}
			>
				By Folder
			</button>
		</div>

		<div class="sort-select">
			<label for="sort">Sort:</label>
			<select id="sort" bind:value={sortBy}>
				<option value="recent">Most Recent</option>
				<option value="oldest">Oldest First</option>
				<option value="alphabetical">Alphabetical</option>
			</select>
		</div>
	</div>

	<!-- Tags -->
	{#if allTags.length > 0}
		<div class="tags-section">
			<h2 class="section-title">Tags</h2>
			<div class="tags-list">
				{#each allTags.slice(0, 15) as tag}
					<a href="/read/tag/{tag.tag}" class="tag-pill">
						#{tag.tag}
						<span class="tag-count">{tag.count}</span>
					</a>
				{/each}
				{#if allTags.length > 15}
					<span class="more-tags">+{allTags.length - 15} more</span>
				{/if}
			</div>
		</div>
	{/if}

	<!-- Content -->
	{#if viewBy === 'all'}
		<!-- All Notes -->
		<section class="notes-section">
			<h2 class="section-title">All Notes</h2>
			{#if sortedNotes.length === 0}
				<div class="empty-state">
					<p>No notes yet. Start writing in edit mode!</p>
					<a href="/" class="empty-cta">Go to Editor</a>
				</div>
			{:else}
				<div class="notes-grid">
					{#each sortedNotes as note (note.id)}
						<NoteCard {note} />
					{/each}
				</div>
			{/if}
		</section>
	{:else}
		<!-- By Folder -->
		<section class="folders-section">
			<!-- Root Notes -->
			{#if rootNotes.length > 0}
				<div class="folder-group">
					<h2 class="folder-title">
						<FileText class="folder-icon" />
						Unfiled Notes
						<span class="folder-count">{rootNotes.length}</span>
					</h2>
					<div class="notes-grid">
						{#each rootNotes as note (note.id)}
							<NoteCard {note} showFolder={false} />
						{/each}
					</div>
				</div>
			{/if}

			<!-- Folders -->
			{#each rootFolders as folder (folder.id)}
				{@const folderNotes = getFolderNotes(folder.id)}
				{@const subfolders = getFolderSubfolders(folder.id)}
				{@const isExpanded = expandedFolders.has(folder.id)}

				<div class="folder-group">
					<button class="folder-header" onclick={() => toggleFolder(folder.id)}>
						<ChevronRight class="chevron {isExpanded ? 'expanded' : ''}" />
						<Folder class="folder-icon" />
						<span class="folder-name">{folder.name}</span>
						<span class="folder-count">{folderNotes.length} notes</span>
					</button>

					{#if isExpanded}
						<div class="folder-content">
							{#if folderNotes.length === 0 && subfolders.length === 0}
								<p class="empty-folder">Empty folder</p>
							{:else}
								<div class="notes-grid">
									{#each folderNotes as note (note.id)}
										<NoteCard {note} showFolder={false} />
									{/each}
								</div>
							{/if}
						</div>
					{/if}
				</div>
			{/each}

			{#if rootFolders.length === 0 && rootNotes.length === 0}
				<div class="empty-state">
					<p>No notes yet. Start writing in edit mode!</p>
					<a href="/" class="empty-cta">Go to Editor</a>
				</div>
			{/if}
		</section>
	{/if}
</main>

<style>
	.blog-index {
		max-width: 1000px;
		margin: 0 auto;
		padding: 2rem 1.5rem 4rem;
	}

	/* Hero */
	.hero {
		text-align: center;
		margin-bottom: 3rem;
		padding: 2rem 0;
	}

	.hero h1 {
		font-size: 2.5rem;
		font-weight: 700;
		color: var(--color-text);
		margin-bottom: 0.5rem;
	}

	.tagline {
		font-size: 1.125rem;
		color: var(--color-text-muted);
		margin-bottom: 1rem;
	}

	.stats {
		display: flex;
		justify-content: center;
		align-items: center;
		gap: 0.75rem;
		font-size: 0.875rem;
		color: var(--color-text-muted);
	}

	.dot {
		width: 4px;
		height: 4px;
		background: var(--color-border);
		border-radius: 50%;
	}

	/* Controls */
	.controls {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 2rem;
		flex-wrap: wrap;
		gap: 1rem;
	}

	.view-toggle {
		display: flex;
		background: var(--color-bg-secondary);
		border-radius: 0.5rem;
		padding: 0.25rem;
	}

	.toggle-btn {
		padding: 0.5rem 1rem;
		border: none;
		background: transparent;
		border-radius: 0.375rem;
		font-size: 0.875rem;
		color: var(--color-text-muted);
		cursor: pointer;
		transition: all 0.15s;
	}

	.toggle-btn.active {
		background: var(--color-bg);
		color: var(--color-text);
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
	}

	.sort-select {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.875rem;
		color: var(--color-text-muted);
	}

	.sort-select select {
		padding: 0.5rem 0.75rem;
		border: 1px solid var(--color-border);
		border-radius: 0.375rem;
		background: var(--color-bg);
		color: var(--color-text);
		font-size: 0.875rem;
		cursor: pointer;
	}

	/* Tags */
	.tags-section {
		margin-bottom: 2rem;
	}

	.section-title {
		font-size: 1rem;
		font-weight: 600;
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		margin-bottom: 1rem;
	}

	.tags-list {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.tag-pill {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.375rem 0.75rem;
		background: rgba(250, 179, 135, 0.15);
		color: #fab387;
		border-radius: 1rem;
		font-size: 0.875rem;
		text-decoration: none;
		transition: all 0.15s;
	}

	.tag-pill:hover {
		background: rgba(250, 179, 135, 0.25);
	}

	.tag-count {
		font-size: 0.75rem;
		opacity: 0.7;
	}

	.more-tags {
		padding: 0.375rem 0.75rem;
		color: var(--color-text-muted);
		font-size: 0.875rem;
	}

	/* Notes Grid */
	.notes-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
		gap: 1rem;
	}

	/* Folders */
	.folder-group {
		margin-bottom: 1.5rem;
	}

	.folder-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		padding: 0.75rem 1rem;
		background: var(--color-bg-secondary);
		border: none;
		border-radius: 0.5rem;
		cursor: pointer;
		text-align: left;
		transition: background 0.15s;
	}

	.folder-header:hover {
		background: var(--color-border);
	}

	.folder-title {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 1rem;
		font-weight: 600;
		color: var(--color-text);
		margin-bottom: 1rem;
	}

	.chevron {
		width: 1.25rem;
		height: 1.25rem;
		color: var(--color-text-muted);
		transition: transform 0.15s;
		flex-shrink: 0;
	}

	.chevron.expanded {
		transform: rotate(90deg);
	}

	.folder-icon {
		width: 1.25rem;
		height: 1.25rem;
		color: var(--color-accent);
		flex-shrink: 0;
	}

	.folder-name {
		flex: 1;
		font-weight: 500;
		color: var(--color-text);
	}

	.folder-count {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		background: var(--color-bg);
		padding: 0.25rem 0.5rem;
		border-radius: 1rem;
	}

	.folder-content {
		padding: 1rem 0 0 2rem;
	}

	.empty-folder {
		color: var(--color-text-muted);
		font-size: 0.875rem;
		font-style: italic;
	}

	/* Empty State */
	.empty-state {
		text-align: center;
		padding: 4rem 2rem;
		color: var(--color-text-muted);
	}

	.empty-cta {
		display: inline-block;
		margin-top: 1rem;
		padding: 0.75rem 1.5rem;
		background: var(--color-accent);
		color: white;
		text-decoration: none;
		border-radius: 0.5rem;
		font-weight: 500;
		transition: background 0.15s;
	}

	.empty-cta:hover {
		background: var(--color-accent-hover);
	}

	@media (max-width: 640px) {
		.blog-index {
			padding: 1rem;
		}

		.hero h1 {
			font-size: 2rem;
		}

		.notes-grid {
			grid-template-columns: 1fr;
		}

		.controls {
			flex-direction: column;
			align-items: stretch;
		}

		.view-toggle {
			width: 100%;
		}

		.toggle-btn {
			flex: 1;
		}
	}
</style>
