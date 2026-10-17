<script lang="ts">
	import {
		memoryObjects,
		folders,
		getSubfolders,
		getMemoryObjectsInFolder,
		getAllTags,
		currentVault
	} from '$lib/db';
	import ReadNav from '$lib/components/ReadNav.svelte';
	import NoteCard from '$lib/components/NoteCard.svelte';
	import { NotebookText, Folder, ChevronRight, Search, X, ArrowDownWideNarrow, ArrowUpRight, Check, SearchX } from 'lucide-svelte';

	type SortOption = 'recent' | 'alphabetical' | 'oldest';
	type ViewOption = 'all' | 'folders';

	let sortBy = $state<SortOption>('recent');
	let viewBy = $state<ViewOption>('all');
	let expandedFolders = $state<Set<string>>(new Set());
	let searchQuery = $state('');
	let sortDropdownOpen = $state(false);

	const sortOptions: { value: SortOption; label: string }[] = [
		{ value: 'recent', label: 'Most recent' },
		{ value: 'oldest', label: 'Oldest first' },
		{ value: 'alphabetical', label: 'Alphabetical' },
	];

	function toggleSortDropdown() {
		sortDropdownOpen = !sortDropdownOpen;
	}

	function selectSort(value: SortOption) {
		sortBy = value;
		sortDropdownOpen = false;
	}

	function closeSortDropdown() {
		sortDropdownOpen = false;
	}

	// Get root folders
	let rootFolders = $derived(getSubfolders(null));

	// Get root memories (memories not in any folder)
	let rootMemories = $derived(getMemoryObjectsInFolder(null));

	// Get all tags
	let allTags = $derived(getAllTags());

	// Filter and sort memories based on search and selected option
	let sortedMemories = $derived.by(() => {
		let list = [...$memoryObjects];

		// Filter by search query
		if (searchQuery.trim()) {
			const query = searchQuery.toLowerCase();
			list = list.filter(
				(m) =>
					(m.title || '').toLowerCase().includes(query) ||
					m.bodyMarkdown.toLowerCase().includes(query)
			);
		}

		// Sort
		switch (sortBy) {
			case 'recent':
				return list.sort((a, b) => b.updatedAt - a.updatedAt);
			case 'oldest':
				return list.sort((a, b) => a.updatedAt - b.updatedAt);
			case 'alphabetical':
				return list.sort((a, b) => (a.title || 'Untitled').localeCompare(b.title || 'Untitled'));
			default:
				return list;
		}
	});

	// Filtered root memories for folder view
	let filteredRootMemories = $derived.by(() => {
		if (!searchQuery.trim()) return rootMemories;
		const query = searchQuery.toLowerCase();
		return rootMemories.filter(
			(m) =>
				(m.title || '').toLowerCase().includes(query) ||
				m.bodyMarkdown.toLowerCase().includes(query)
		);
	});

	function clearSearch() {
		searchQuery = '';
	}

	function toggleFolder(folderId: string) {
		const newSet = new Set(expandedFolders);
		if (newSet.has(folderId)) {
			newSet.delete(folderId);
		} else {
			newSet.add(folderId);
		}
		expandedFolders = newSet;
	}

	function getFolderMemories(folderId: string) {
		const list = getMemoryObjectsInFolder(folderId);
		if (!searchQuery.trim()) return list;
		const query = searchQuery.toLowerCase();
		return list.filter(
			(m) =>
				(m.title || '').toLowerCase().includes(query) ||
				m.bodyMarkdown.toLowerCase().includes(query)
		);
	}

	function getFolderSubfolders(folderId: string) {
		return getSubfolders(folderId);
	}

	let filterInput: HTMLInputElement | undefined = $state();

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape' && sortDropdownOpen) {
			closeSortDropdown();
			return;
		}
		// "/" jumps to the filter, like the read-mode search elsewhere
		if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
		const target = e.target as HTMLElement;
		if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
		e.preventDefault();
		filterInput?.focus();
	}
</script>

<svelte:window
	onclick={(e) => {
		if (sortDropdownOpen && !(e.target as HTMLElement).closest('.sort-dropdown')) {
			closeSortDropdown();
		}
	}}
	onkeydown={handleKeydown}
/>

<svelte:head>
	<title>Kurumi - Read</title>
</svelte:head>

<ReadNav showSearch={false} />

<div class="k-page">
	<header class="k-page-header">
		<div class="min-w-0">
			<h1 class="k-page-title">{$currentVault?.name || 'Notes'}</h1>
			<p class="k-page-subtitle">
				{$memoryObjects.length} note{$memoryObjects.length === 1 ? '' : 's'} ·
				{$folders.length} folder{$folders.length === 1 ? '' : 's'} ·
				{allTags.length} tag{allTags.length === 1 ? '' : 's'}
			</p>
		</div>
	</header>

	<!-- Controls -->
	<div class="controls">
		<div class="k-segmented" role="group" aria-label="View">
			<button aria-pressed={viewBy === 'all'} onclick={() => (viewBy = 'all')}>All notes</button>
			<button aria-pressed={viewBy === 'folders'} onclick={() => (viewBy = 'folders')}>By folder</button>
		</div>

		<div class="filter">
			<Search class="filter-icon h-3.5 w-3.5" />
			<input
				bind:this={filterInput}
				type="text"
				bind:value={searchQuery}
				placeholder="Filter notes"
				aria-label="Filter notes"
				class="k-input filter-input"
				onkeydown={(e) => e.key === 'Escape' && clearSearch()}
			/>
			{#if searchQuery}
				<button class="k-icon-btn filter-clear" onclick={clearSearch} aria-label="Clear filter">
					<X class="h-3.5 w-3.5" />
				</button>
			{/if}
		</div>

		<div class="sort-dropdown">
			<button
				class="k-icon-btn"
				class:bg-[var(--color-hover)]={sortDropdownOpen}
				onclick={toggleSortDropdown}
				aria-label="Sort order"
				title="Sort order"
				aria-haspopup="menu"
				aria-expanded={sortDropdownOpen}
			>
				<ArrowDownWideNarrow class="h-4 w-4" />
			</button>
			{#if sortDropdownOpen}
				<div class="k-menu sort-menu" role="menu">
					<div class="k-menu-label">Sort by</div>
					{#each sortOptions as option (option.value)}
						<button
							class="k-menu-item"
							role="menuitemradio"
							aria-checked={sortBy === option.value}
							onclick={() => selectSort(option.value)}
						>
							<span class="flex-1">{option.label}</span>
							{#if sortBy === option.value}
								<Check class="h-3.5 w-3.5 text-[var(--color-accent)]" />
							{/if}
						</button>
					{/each}
				</div>
			{/if}
		</div>
	</div>

	<!-- Tags -->
	{#if allTags.length > 0}
		<div class="tag-cloud">
			{#each allTags.slice(0, 15) as tag (tag.tag)}
				<a href="/read/tag/{tag.tag}" class="tag-link">
					#{tag.tag}<span class="tag-count">{tag.count}</span>
				</a>
			{/each}
			{#if allTags.length > 15}
				<a href="/references?tab=tags" class="tag-link">+{allTags.length - 15} more</a>
			{/if}
		</div>
	{/if}

	<!-- Content -->
	{#if viewBy === 'all'}
		{#if sortedMemories.length === 0}
			{#if searchQuery.trim()}
				<div class="k-empty">
					<SearchX />
					<p class="k-empty-title">No matches</p>
					<p>No notes match “{searchQuery}”.</p>
					<button class="k-btn mt-2" onclick={clearSearch}>Clear filter</button>
				</div>
			{:else}
				<div class="k-empty">
					<NotebookText />
					<p class="k-empty-title">Nothing to read yet</p>
					<p>Notes you write show up here as a quiet reading list.</p>
					<a href="/" class="k-btn mt-2">Go to editor</a>
				</div>
			{/if}
		{:else}
			<div class="note-list">
				{#each sortedMemories as memory (memory.id)}
					<NoteCard {memory} />
				{/each}
			</div>
		{/if}
	{:else}
		<!-- By Folder -->
		<div class="folder-list">
			{#each rootFolders as folder (folder.id)}
				{@const folderMemories = getFolderMemories(folder.id)}
				{@const subfolders = getFolderSubfolders(folder.id)}
				{@const isExpanded = expandedFolders.has(folder.id)}

				{#if !searchQuery.trim() || folderMemories.length > 0}
					<div class="folder-group">
						<div class="folder-row">
							<button
								class="k-row folder-toggle"
								onclick={() => toggleFolder(folder.id)}
								aria-expanded={isExpanded}
							>
								<ChevronRight class="chevron h-3.5 w-3.5 shrink-0 text-[var(--color-text-faint)] {isExpanded ? 'expanded' : ''}" />
								<Folder class="h-4 w-4 shrink-0 text-[var(--color-text-faint)]" />
								<span class="folder-name">{folder.name}</span>
								<span class="folder-count">{folderMemories.length}</span>
							</button>
							<a href="/read/folder/{folder.id}" class="k-icon-btn folder-open" title="Open folder" aria-label="Open {folder.name}">
								<ArrowUpRight class="h-4 w-4" />
							</a>
						</div>

						{#if isExpanded}
							<div class="folder-content">
								{#each subfolders as sub (sub.id)}
									<a href="/read/folder/{sub.id}" class="k-row">
										<Folder class="h-4 w-4 shrink-0 text-[var(--color-text-faint)]" />
										<span class="folder-name">{sub.name}</span>
									</a>
								{/each}
								{#if folderMemories.length === 0 && subfolders.length === 0}
									<p class="empty-folder">Empty folder</p>
								{:else}
									<div class="note-list">
										{#each folderMemories as memory (memory.id)}
											<NoteCard {memory} showFolder={false} />
										{/each}
									</div>
								{/if}
							</div>
						{/if}
					</div>
				{/if}
			{/each}
		</div>

		<!-- Unfiled Notes -->
		{#if filteredRootMemories.length > 0}
			<h2 class="k-section-title">
				Unfiled
				<span class="font-normal">{filteredRootMemories.length}</span>
			</h2>
			<div class="note-list">
				{#each filteredRootMemories as memory (memory.id)}
					<NoteCard {memory} showFolder={false} />
				{/each}
			</div>
		{/if}

		{#if rootFolders.length === 0 && rootMemories.length === 0}
			<div class="k-empty">
				<NotebookText />
				<p class="k-empty-title">Nothing to read yet</p>
				<p>Notes you write show up here as a quiet reading list.</p>
				<a href="/" class="k-btn mt-2">Go to editor</a>
			</div>
		{/if}
	{/if}
</div>

<style>
	/* Controls */
	.controls {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 1.25rem;
	}

	.filter {
		position: relative;
		display: flex;
		flex: 1;
		align-items: center;
		min-width: 10rem;
	}

	.filter :global(.filter-icon) {
		position: absolute;
		left: 0.625rem;
		color: var(--color-text-faint);
		pointer-events: none;
	}

	.filter-input {
		height: 2rem;
		padding-left: 1.875rem;
		padding-right: 2rem;
		font-size: 0.8125rem;
	}

	.filter-clear {
		position: absolute;
		right: 0.25rem;
		width: 1.5rem;
		height: 1.5rem;
	}

	.sort-dropdown {
		position: relative;
	}

	.sort-menu {
		position: absolute;
		top: calc(100% + 0.25rem);
		right: 0;
		z-index: 40;
		min-width: 11rem;
	}

	/* Tags as quiet inline text */
	.tag-cloud {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 0.875rem;
		margin-bottom: 1.25rem;
		padding: 0 0.125rem;
		font-size: 0.8125rem;
	}

	.tag-link {
		color: var(--color-text-muted);
		text-decoration: none;
	}

	.tag-link:hover {
		color: var(--color-ref-tag);
	}

	.tag-count {
		margin-left: 0.25rem;
		font-size: 0.6875rem;
		color: var(--color-text-faint);
		font-variant-numeric: tabular-nums;
	}

	/* Lists bleed into the gutter so text aligns with the title */
	.note-list {
		display: flex;
		flex-direction: column;
		margin: 0 -0.75rem;
	}

	.folder-list {
		display: flex;
		flex-direction: column;
		gap: 0.0625rem;
		margin: 0 -0.625rem;
	}

	.folder-row {
		display: flex;
		align-items: center;
		gap: 0.125rem;
	}

	.folder-toggle {
		flex: 1;
		min-width: 0;
		text-align: left;
	}

	.folder-open {
		opacity: 0;
	}

	.folder-row:hover .folder-open,
	.folder-open:focus-visible {
		opacity: 1;
	}

	@media (hover: none) {
		.folder-open {
			opacity: 1;
		}
	}

	.folder-name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}

	.folder-count {
		font-size: 0.75rem;
		color: var(--color-text-faint);
		font-variant-numeric: tabular-nums;
	}

	.folder-content {
		margin: 0.125rem 0 0.75rem 1.25rem;
		padding-left: 0.5rem;
		border-left: 1px solid var(--color-border);
	}

	.folder-content .note-list {
		margin: 0;
	}

	.empty-folder {
		padding: 0.375rem 0.625rem;
		font-size: 0.8125rem;
		color: var(--color-text-faint);
	}
</style>
