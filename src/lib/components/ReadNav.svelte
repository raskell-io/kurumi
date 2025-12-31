<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { search } from '$lib/search';
	import { currentVault } from '$lib/db';
	import { getIconById } from '$lib/icons/vault-icons';

	interface Props {
		noteId?: string;
		title?: string;
		breadcrumbs?: { label: string; href: string }[];
	}

	let { noteId, title, breadcrumbs = [] }: Props = $props();

	let searchQuery = $state('');
	let searchOpen = $state(false);
	let searchResults = $state<{ id: string; title: string }[]>([]);
	let selectedIndex = $state(0);
	let searchInputRef: HTMLInputElement;

	// Theme state
	let theme = $state<'light' | 'dark' | 'system'>('system');

	$effect(() => {
		const savedTheme = localStorage.getItem('kurumi-theme') as 'light' | 'dark' | 'system' | null;
		if (savedTheme) {
			theme = savedTheme;
		}
	});

	function cycleTheme() {
		const next = theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system';
		theme = next;
		localStorage.setItem('kurumi-theme', next);
		if (next === 'system') {
			document.documentElement.classList.remove('light', 'dark');
		} else {
			document.documentElement.classList.remove('light', 'dark');
			document.documentElement.classList.add(next);
		}
	}

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
		<a href="/read" class="nav-logo">
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
		<div class="search-container">
			<div class="search-wrapper">
				<svg xmlns="http://www.w3.org/2000/svg" class="search-icon" viewBox="0 0 20 20" fill="currentColor">
					<path fill-rule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clip-rule="evenodd" />
				</svg>
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
							<svg xmlns="http://www.w3.org/2000/svg" class="result-icon" viewBox="0 0 20 20" fill="currentColor">
								<path fill-rule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clip-rule="evenodd" />
							</svg>
							{result.title || 'Untitled'}
						</a>
					{/each}
				</div>
			{/if}
		</div>

		<!-- Actions -->
		<div class="nav-actions">
			<!-- Theme toggle -->
			<button onclick={cycleTheme} class="nav-btn" title="Theme: {theme}">
				{#if theme === 'light'}
					<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
						<path fill-rule="evenodd" d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z" clip-rule="evenodd" />
					</svg>
				{:else if theme === 'dark'}
					<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
						<path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
					</svg>
				{:else}
					<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
						<path fill-rule="evenodd" d="M3 5a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2h-2.22l.123.489.804.321A.75.75 0 0113 17H7a.75.75 0 01-.191-1.475l.119-.029.166-.412a.75.75 0 01.138-.25L7.22 15H5a2 2 0 01-2-2V5zm2 0h10v8H5V5z" clip-rule="evenodd" />
					</svg>
				{/if}
			</button>

			<!-- Edit link (if viewing a note) -->
			{#if noteId}
				<a href="/note/{noteId}" class="nav-btn edit-btn" title="Edit this note">
					<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
						<path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
					</svg>
					<span class="btn-text">Edit</span>
				</a>
			{/if}

			<!-- Back to app -->
			<a href="/" class="nav-btn" title="Back to editor">
				<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
					<path fill-rule="evenodd" d="M3 3a1 1 0 011 1v12a1 1 0 11-2 0V4a1 1 0 011-1zm7.707 3.293a1 1 0 010 1.414L9.414 9H17a1 1 0 110 2H9.414l1.293 1.293a1 1 0 01-1.414 1.414l-3-3a1 1 0 010-1.414l3-3a1 1 0 011.414 0z" clip-rule="evenodd" />
				</svg>
			</a>
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
	}

	.nav-content {
		display: flex;
		align-items: center;
		gap: 1rem;
		max-width: 1200px;
		margin: 0 auto;
		padding: 0.75rem 1.5rem;
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
		width: 1.75rem;
		height: 1.75rem;
		border-radius: 4px;
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
		background: var(--color-accent);
		color: white;
		padding: 0.5rem 0.75rem;
	}

	.edit-btn:hover {
		background: var(--color-accent-hover);
		color: white;
	}

	.btn-text {
		font-size: 0.875rem;
		font-weight: 500;
	}

	@media (max-width: 768px) {
		.nav-content {
			padding: 0.625rem 1rem;
		}

		.logo-text {
			display: none;
		}

		.breadcrumbs {
			display: none;
		}

		.search-container {
			max-width: none;
			flex: 1;
		}

		.search-kbd {
			display: none;
		}

		.btn-text {
			display: none;
		}
	}
</style>
