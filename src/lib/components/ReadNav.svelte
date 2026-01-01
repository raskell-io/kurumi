<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { search } from '$lib/search';
	import { currentVault } from '$lib/db';
	import { getIconById } from '$lib/icons/vault-icons';
	import { Search, NotebookText, Pencil, PenSquare } from 'lucide-svelte';

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
	let searchInputRef: HTMLInputElement;

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
		}, 200);
	}

	function openSearch() {
		searchOpen = true;
		setTimeout(() => searchInputRef?.focus(), 0);
	}

	// Global keyboard shortcut
	function handleGlobalKeydown(e: KeyboardEvent) {
		if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
			e.preventDefault();
			openSearch();
		}
	}
</script>

<svelte:window on:keydown={handleGlobalKeydown} />

<nav class="read-nav">
	<div class="nav-content">
		<!-- Logo/Home -->
		<a href="/" class="nav-logo">
			<img src="/icon-192.avif" alt="Kurumi" class="logo-icon" />
			<span class="logo-text">
				{#if $currentVault?.icon}
					{@const vaultIcon = getIconById($currentVault.icon)}
					{#if vaultIcon}
						<svg
							xmlns="http://www.w3.org/2000/svg"
							class="vault-icon"
							viewBox="0 0 20 20"
							fill="currentColor"
						>
							<path fill-rule="evenodd" d={vaultIcon.path} clip-rule="evenodd" />
						</svg>
					{/if}
				{/if}
				{$currentVault?.name || 'Kurumi'}
			</span>
		</a>

		<!-- Read Mode Badge -->
		<span class="read-mode-badge">Read mode</span>

		<!-- Breadcrumbs -->
		{#if breadcrumbs.length > 0}
			<div class="breadcrumbs">
				<span class="breadcrumb-sep">/</span>
				{#each breadcrumbs as crumb, i}
					<a href={crumb.href} class="breadcrumb">{crumb.label}</a>
					{#if i < breadcrumbs.length - 1}
						<span class="breadcrumb-sep">/</span>
					{/if}
				{/each}
			</div>
		{/if}

		<!-- Spacer -->
		<div class="nav-spacer"></div>

		<!-- Search -->
		{#if showSearch}
			<div class="search-container">
				<div class="search-wrapper">
					<Search class="search-icon" />
					<input
						bind:this={searchInputRef}
						bind:value={searchQuery}
						type="text"
						placeholder="Search..."
						class="search-input"
						onfocus={handleSearchFocus}
						onblur={handleSearchBlur}
						onkeydown={handleSearchKeydown}
					/>
					<kbd class="search-kbd">
						{navigator?.platform?.includes('Mac') ? '⌘' : 'Ctrl'}K
					</kbd>
				</div>

				{#if searchOpen && searchResults.length > 0}
					<div class="search-results">
						{#each searchResults as result, i}
							<a
								href="/read/{result.id}"
								class="search-result"
								class:selected={i === selectedIndex}
								onclick={() => { searchOpen = false; searchQuery = ''; }}
							>
								<NotebookText class="result-icon" />
								{result.title || 'Untitled'}
							</a>
						{/each}
					</div>
				{/if}
			</div>
		{/if}

		<!-- Actions -->
		<div class="nav-actions">
			<!-- Edit link: show note-specific when viewing a note, general when not -->
			{#if noteId}
				<a href="/note/{noteId}" class="nav-btn edit-btn" title="Edit this note">
					<Pencil class="h-5 w-5" />
					<span class="btn-text">Edit</span>
				</a>
			{:else}
				<a href="/?sidebar=open" class="nav-btn" title="Back to editor">
					<PenSquare class="h-5 w-5" />
				</a>
			{/if}
		</div>
	</div>
</nav>

<style>
	.read-nav {
		position: sticky;
		top: 0;
		z-index: 100;
		background: var(--color-bg);
		border-bottom: 1px solid var(--color-border);
		backdrop-filter: blur(8px);
		max-width: 100vw;
		overflow-x: hidden;
	}

	.nav-content {
		display: flex;
		align-items: center;
		gap: 1rem;
		max-width: 1200px;
		margin: 0 auto;
		padding: 0.75rem 1rem;
		box-sizing: border-box;
	}

	.nav-logo {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		text-decoration: none;
		color: var(--color-text);
		font-weight: 600;
		flex-shrink: 0;
	}

	.logo-icon {
		width: 2.25rem;
		height: 2.25rem;
		border-radius: 6px;
	}

	.logo-text {
		font-size: 1.125rem;
		display: flex;
		align-items: center;
		gap: 0.375rem;
	}

	.vault-icon {
		width: 1rem;
		height: 1rem;
		color: var(--color-accent);
	}

	.read-mode-badge {
		font-size: 0.75rem;
		font-weight: 500;
		color: var(--color-text-muted);
		background: var(--color-bg-secondary);
		padding: 0.25rem 0.5rem;
		border-radius: 0.25rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.breadcrumbs {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.875rem;
		color: var(--color-text-muted);
		overflow: hidden;
	}

	.breadcrumb {
		color: var(--color-text-muted);
		text-decoration: none;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.breadcrumb:hover {
		color: var(--color-accent);
	}

	.breadcrumb-sep {
		color: var(--color-border);
		flex-shrink: 0;
	}

	.nav-spacer {
		flex: 1;
	}

	.search-container {
		position: relative;
		width: 100%;
		max-width: 320px;
	}

	.search-wrapper {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.75rem;
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border);
		border-radius: 0.5rem;
		transition: border-color 0.15s;
	}

	.search-wrapper:focus-within {
		border-color: var(--color-accent);
	}

	.search-icon {
		width: 1rem;
		height: 1rem;
		color: var(--color-text-muted);
		flex-shrink: 0;
	}

	.search-input {
		flex: 1;
		background: transparent;
		border: none;
		outline: none;
		font-size: 0.875rem;
		color: var(--color-text);
		min-width: 0;
	}

	.search-input::placeholder {
		color: var(--color-text-muted);
	}

	.search-kbd {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		background: var(--color-bg);
		padding: 0.125rem 0.375rem;
		border-radius: 0.25rem;
		flex-shrink: 0;
	}

	.search-results {
		position: absolute;
		top: 100%;
		left: 0;
		right: 0;
		margin-top: 0.25rem;
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 0.5rem;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
		overflow: hidden;
	}

	.search-result {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.625rem 0.75rem;
		color: var(--color-text);
		text-decoration: none;
		font-size: 0.875rem;
		transition: background 0.1s;
	}

	.search-result:hover,
	.search-result.selected {
		background: var(--color-bg-secondary);
	}

	.result-icon {
		width: 1rem;
		height: 1rem;
		color: var(--color-text-muted);
		flex-shrink: 0;
	}

	.nav-actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-shrink: 0;
		margin-left: auto;
	}

	.nav-btn {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.5rem;
		background: transparent;
		border: none;
		border-radius: 0.5rem;
		color: var(--color-text-muted);
		cursor: pointer;
		transition: all 0.15s;
		text-decoration: none;
	}

	.nav-btn:hover {
		background: var(--color-bg-secondary);
		color: var(--color-text);
	}

	.edit-btn {
		background: linear-gradient(135deg, #89b4fa, #cba6f7, #f5c2e7);
		color: #1e1e2e;
		padding: 0.5rem 0.75rem;
		justify-content: center;
		box-shadow: 0 4px 12px -2px rgba(203, 166, 247, 0.4);
		font-weight: 500;
	}

	.edit-btn:hover {
		background: linear-gradient(135deg, #74c7ec, #b4befe, #f5c2e7);
		color: #1e1e2e;
		box-shadow: 0 6px 16px -2px rgba(203, 166, 247, 0.5);
	}

	.btn-text {
		font-size: 0.875rem;
		font-weight: 500;
	}

	@media (max-width: 768px) {
		.nav-content {
			padding: 0.5rem 0.75rem;
			gap: 0.5rem;
		}

		.logo-text {
			display: none;
		}

		.breadcrumbs {
			display: none;
		}

		.nav-spacer {
			display: none;
		}

		.search-container {
			max-width: none;
			flex: 1;
			min-width: 0;
		}

		.search-wrapper {
			padding: 0.375rem 0.5rem;
		}

		.search-kbd {
			display: none;
		}

		.nav-actions {
			gap: 0.25rem;
		}

		.nav-btn {
			padding: 0.375rem;
		}

		.edit-btn {
			padding: 0.375rem 0.5rem;
		}

		.btn-text {
			display: none;
		}
	}
</style>
