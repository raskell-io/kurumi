<script lang="ts">
	import { goto } from '$app/navigation';
	import { search } from '$lib/search';
	import { ArrowLeft, BookOpen, Search, NotebookText, Pencil, PenSquare } from 'lucide-svelte';

	interface Props {
		noteId?: string;
		title?: string;
		breadcrumbs?: { label: string; href: string }[];
		showSearch?: boolean;
	}

	let { noteId, title, breadcrumbs = [], showSearch = true }: Props = $props();

	let searchQuery = $state('');
	let searchOpen = $state(false);
	let searchResults = $state<{ id: string; title: string }[]>([]);
	let selectedIndex = $state(0);
	let searchInputRef: HTMLInputElement | undefined = $state();

	$effect(() => {
		if (searchQuery.trim()) {
			const results = search(searchQuery);
			searchResults = results.slice(0, 8).map((r) => ({ id: r.id, title: r.title }));
			selectedIndex = 0;
		} else {
			searchResults = [];
		}
	});

	function handleSearchKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			searchOpen = false;
			searchQuery = '';
		} else if (e.key === 'ArrowDown') {
			e.preventDefault();
			selectedIndex = Math.min(selectedIndex + 1, searchResults.length - 1);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			selectedIndex = Math.max(selectedIndex - 1, 0);
		} else if (e.key === 'Enter' && searchResults.length > 0) {
			e.preventDefault();
			goto(`/read/${searchResults[selectedIndex].id}`);
			searchOpen = false;
			searchQuery = '';
		}
	}

	function handleSearchFocus() {
		searchOpen = true;
	}

	function handleSearchBlur() {
		// Delay to allow click on results
		setTimeout(() => {
			searchOpen = false;
		}, 150);
	}

	function openSearch() {
		searchOpen = true;
		setTimeout(() => searchInputRef?.focus(), 0);
	}

	// "/" focuses the read-mode search. (Cmd+K belongs to the global
	// command palette; grabbing it here stole focus from the palette.)
	function handleGlobalKeydown(e: KeyboardEvent) {
		if (!showSearch || e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
		const target = e.target as HTMLElement;
		if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
		e.preventDefault();
		openSearch();
	}

	function goBack() {
		history.back();
	}

	// The last crumb (or the note title) is the current location
	let current = $derived(title ?? breadcrumbs.at(-1)?.label);
	let trail = $derived(title !== undefined ? breadcrumbs : breadcrumbs.slice(0, -1));
</script>

<svelte:window onkeydown={handleGlobalKeydown} />

<nav class="read-nav" aria-label="Read mode">
	<button class="k-icon-btn" onclick={goBack} title="Back" aria-label="Back">
		<ArrowLeft class="h-4 w-4" />
	</button>

	<div class="crumbs">
		<a href="/read" class="crumb crumb-root" title="All notes">
			<BookOpen class="h-3.5 w-3.5 shrink-0" />
			<span>Read</span>
		</a>
		{#each trail as crumb (crumb.href)}
			<span class="crumb-sep">/</span>
			<a href={crumb.href} class="crumb">{crumb.label}</a>
		{/each}
		{#if current}
			<span class="crumb-sep">/</span>
			<span class="crumb crumb-current" aria-current="page">{current || 'Untitled'}</span>
		{/if}
	</div>

	{#if showSearch}
		<div class="search-container">
			<Search class="search-icon h-3.5 w-3.5" />
			<input
				bind:this={searchInputRef}
				bind:value={searchQuery}
				type="text"
				placeholder="Search notes"
				aria-label="Search notes"
				class="search-input"
				onfocus={handleSearchFocus}
				onblur={handleSearchBlur}
				onkeydown={handleSearchKeydown}
			/>
			<kbd class="k-kbd search-kbd">/</kbd>

			{#if searchOpen && searchResults.length > 0}
				<div class="k-menu search-results" role="listbox">
					{#each searchResults as result, i (result.id)}
						<a
							href="/read/{result.id}"
							class="k-menu-item"
							class:selected={i === selectedIndex}
							role="option"
							aria-selected={i === selectedIndex}
							onclick={() => { searchOpen = false; searchQuery = ''; }}
						>
							<NotebookText class="h-4 w-4 shrink-0 text-[var(--color-text-faint)]" />
							<span class="truncate">{result.title || 'Untitled'}</span>
						</a>
					{/each}
				</div>
			{/if}
		</div>
	{/if}

	<!-- Edit link: note-specific when viewing a note, general when not -->
	{#if noteId}
		<a href="/memory/{noteId}" class="k-btn k-btn-sm edit-btn" title="Edit this note">
			<Pencil class="h-3.5 w-3.5" />
			Edit
		</a>
	{:else}
		<a href="/?sidebar=open" class="k-icon-btn" title="Back to editor" aria-label="Back to editor">
			<PenSquare class="h-4 w-4" />
		</a>
	{/if}
</nav>

<style>
	.read-nav {
		position: sticky;
		top: 0;
		z-index: 30;
		display: flex;
		align-items: center;
		gap: 0.375rem;
		height: 2.75rem;
		padding: 0 0.75rem;
		background: color-mix(in srgb, var(--color-bg) 88%, transparent);
		backdrop-filter: blur(8px);
		-webkit-backdrop-filter: blur(8px);
	}

	@media (min-width: 768px) {
		.read-nav {
			padding: 0 1rem;
		}
	}

	.crumbs {
		display: flex;
		flex: 1;
		align-items: center;
		gap: 0.125rem;
		min-width: 0;
		font-size: 0.8125rem;
		color: var(--color-text-muted);
	}

	.crumb {
		display: inline-flex;
		align-items: center;
		gap: 0.3125rem;
		min-width: 0;
		max-width: 12rem;
		padding: 0.125rem 0.25rem;
		border-radius: var(--radius-sm);
		overflow: hidden;
		color: inherit;
		text-decoration: none;
		white-space: nowrap;
		text-overflow: ellipsis;
	}

	a.crumb:hover {
		background: var(--color-hover);
		color: var(--color-text);
	}

	.crumb-root {
		flex-shrink: 0;
	}

	.crumb-current {
		display: block;
		flex: 0 1 auto;
		max-width: none;
		color: var(--color-text);
	}

	.crumb-sep {
		flex-shrink: 0;
		color: var(--color-text-faint);
	}

	.search-container {
		position: relative;
		display: flex;
		align-items: center;
		width: 15rem;
		flex-shrink: 1;
		min-width: 0;
	}

	.search-container :global(.search-icon) {
		position: absolute;
		left: 0.5rem;
		color: var(--color-text-faint);
		pointer-events: none;
	}

	.search-input {
		width: 100%;
		height: 1.75rem;
		padding: 0 1.75rem 0 1.75rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-bg);
		font-size: 0.8125rem;
		color: var(--color-text);
		outline: none;
	}

	.search-input::placeholder {
		color: var(--color-text-faint);
	}

	.search-input:focus {
		border-color: color-mix(in srgb, var(--color-accent) 60%, var(--color-border));
		box-shadow: 0 0 0 3px var(--color-accent-soft);
	}

	.search-kbd {
		position: absolute;
		right: 0.375rem;
		pointer-events: none;
	}

	.search-input:focus ~ .search-kbd {
		display: none;
	}

	.search-results {
		position: absolute;
		top: calc(100% + 0.25rem);
		right: 0;
		left: 0;
		z-index: 40;
	}

	.search-results .k-menu-item {
		text-decoration: none;
	}

	.search-results .k-menu-item.selected {
		background: var(--color-hover);
	}

	.edit-btn {
		flex-shrink: 0;
		text-decoration: none;
	}

	@media (max-width: 640px) {
		/* On phones keep only root + current location */
		.crumbs a.crumb:not(.crumb-root),
		.crumbs a.crumb:not(.crumb-root) + .crumb-sep {
			display: none;
		}

		.crumb-root span {
			display: none;
		}

		.search-container {
			width: 9rem;
		}

		.search-kbd {
			display: none;
		}
	}
</style>
