<script lang="ts">
	import '../app.css';
	import { pwaInfo } from 'virtual:pwa-info';
	import { onMount } from 'svelte';
	import { initDB, notes, addNote, getAllTags, extractTags, folders } from '$lib/db';
	import { initSearch, rebuildIndex } from '$lib/search';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import CommandPalette from '$lib/components/CommandPalette.svelte';
	import FolderTree from '$lib/components/FolderTree.svelte';
	import VaultSelector from '$lib/components/VaultSelector.svelte';

	let { children } = $props();

	let initialized = $state(false);
	let sidebarOpen = $state(false);
	let isMobile = $state(false);
	let showSearch = $state(false);
	let selectedTag = $state<string | null>(null);
	let showTags = $state(false);
	let theme = $state<'light' | 'dark' | 'system'>('system');
	let viewMode = $state<'list' | 'folders'>('folders');

	// Check if we're in read mode (hide sidebar)
	let isReadMode = $derived($page.url.pathname.startsWith('/read'));

	// Derived: all tags
	let allTags = $derived(initialized ? getAllTags() : []);

	// Derived: filtered notes
	let filteredNotes = $derived.by(() => {
		if (!selectedTag) return $notes;
		const tag = selectedTag.toLowerCase();
		return $notes.filter((note) => {
			const tags = extractTags(note.content);
			return tags.includes(tag);
		});
	});

	function applyTheme(t: 'light' | 'dark' | 'system') {
		if (t === 'system') {
			document.documentElement.classList.remove('light', 'dark');
		} else {
			document.documentElement.classList.remove('light', 'dark');
			document.documentElement.classList.add(t);
		}
		localStorage.setItem('kurumi-theme', t);
	}

	function cycleTheme() {
		const next = theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system';
		theme = next;
		applyTheme(next);
	}

	// Check if mobile
	function checkMobile() {
		isMobile = window.innerWidth < 768;
		// On desktop, sidebar is always open by default
		if (!isMobile) {
			sidebarOpen = true;
		}
	}

	// Keyboard shortcuts handler
	function handleKeydown(e: KeyboardEvent) {
		// Don't trigger shortcuts when typing in inputs
		const target = e.target as HTMLElement;
		if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
			// Allow Escape in inputs
			if (e.key === 'Escape') {
				target.blur();
			}
			return;
		}

		if (e.metaKey || e.ctrlKey) {
			// Cmd+Shift shortcuts
			if (e.shiftKey && e.key === 'r') {
				e.preventDefault();
				goto('/read');
				if (isMobile) sidebarOpen = false;
				return;
			}

			switch (e.key) {
				case 'k':
					e.preventDefault();
					showSearch = true;
					break;
				case 'n':
					e.preventDefault();
					handleNewNote();
					break;
				case 'g':
					e.preventDefault();
					goto('/graph');
					if (isMobile) sidebarOpen = false;
					break;
				case 'r':
					e.preventDefault();
					goto('/references');
					if (isMobile) sidebarOpen = false;
					break;
				case ',':
					e.preventDefault();
					goto('/settings');
					if (isMobile) sidebarOpen = false;
					break;
			}
		} else if (e.key === 'Escape') {
			if (showSearch) {
				showSearch = false;
			} else if (sidebarOpen && isMobile) {
				sidebarOpen = false;
			}
		}
	}

	onMount(() => {
		// Load theme from localStorage
		const savedTheme = localStorage.getItem('kurumi-theme') as 'light' | 'dark' | 'system' | null;
		if (savedTheme) {
			theme = savedTheme;
			applyTheme(savedTheme);
		}

		// Initialize async stuff
		initDB().then(() => {
			initSearch();
			initialized = true;
		});

		checkMobile();
		window.addEventListener('resize', checkMobile);
		window.addEventListener('keydown', handleKeydown);

		return () => {
			window.removeEventListener('resize', checkMobile);
			window.removeEventListener('keydown', handleKeydown);
		};
	});

	// Rebuild search index when notes change
	$effect(() => {
		// Track notes length to trigger rebuild
		const noteCount = $notes.length;
		if (initialized && noteCount >= 0) {
			rebuildIndex();
		}
	});

	function handleNewNote() {
		const note = addNote();
		goto(`/note/${note.id}`);
		if (isMobile) sidebarOpen = false;
	}

	function handleNoteClick() {
		if (isMobile) sidebarOpen = false;
	}

	function isActive(noteId: string): boolean {
		return $page.url.pathname === `/note/${noteId}`;
	}

	function toggleSidebar() {
		sidebarOpen = !sidebarOpen;
	}

	function openSearch() {
		showSearch = true;
		if (isMobile) sidebarOpen = false;
	}

	function closeSearch() {
		showSearch = false;
	}
</script>

<svelte:head>
	<title>Kurumi</title>
	<meta name="description" content="A local-first personal knowledge management system" />
	<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
	<meta name="apple-mobile-web-app-capable" content="yes" />
	<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
	<link rel="icon" href="/favicon.ico" type="image/x-icon" />
	{#if pwaInfo}
		<link rel="manifest" href={pwaInfo.webManifest.href} />
	{/if}
</svelte:head>

{#if !initialized}
	<div class="flex h-[100dvh] items-center justify-center bg-[var(--color-bg)]">
		<div class="text-center">
			<div
				class="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-[var(--color-accent)] border-t-transparent"
			></div>
			<p class="text-[var(--color-text-muted)]">Loading Kurumi...</p>
		</div>
	</div>
{:else}
	<div class="flex h-[100dvh] bg-[var(--color-bg)]">
		<!-- Mobile overlay (hidden in read mode) -->
		{#if !isReadMode && isMobile && sidebarOpen}
			<button
				class="fixed inset-0 z-40 bg-black/50"
				onclick={() => (sidebarOpen = false)}
				aria-label="Close sidebar"
			></button>
		{/if}

		<!-- Sidebar (hidden in read mode) -->
		{#if !isReadMode}
		<aside
			class="fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r border-[var(--color-border)] bg-[var(--color-bg-secondary)] transition-transform duration-300 ease-out md:relative md:z-auto md:w-64 md:translate-x-0"
			class:-translate-x-full={!sidebarOpen}
		>
			<!-- Logo -->
			<div
				class="flex items-center justify-between border-b border-[var(--color-border)] p-4 safe-top"
			>
				<div class="flex items-center gap-2">
					<img src="/icon-192.avif" alt="Kurumi" class="h-8 w-8 rounded" />
					<VaultSelector />
				</div>
				<!-- Close button (mobile only) -->
				<button
					onclick={() => (sidebarOpen = false)}
					class="rounded-lg p-2 text-[var(--color-text-muted)] hover:bg-[var(--color-border)] md:hidden"
					aria-label="Close sidebar"
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						class="h-5 w-5"
						viewBox="0 0 20 20"
						fill="currentColor"
					>
						<path
							fill-rule="evenodd"
							d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
							clip-rule="evenodd"
						/>
					</svg>
				</button>
			</div>

			<!-- New Note & Search Buttons -->
			<div class="space-y-2 p-3">
				<button
					onclick={handleNewNote}
					class="flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--color-accent)] px-4 py-3 text-white transition-colors hover:bg-[var(--color-accent-hover)] active:scale-[0.98]"
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						class="h-5 w-5"
						viewBox="0 0 20 20"
						fill="currentColor"
					>
						<path
							fill-rule="evenodd"
							d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z"
							clip-rule="evenodd"
						/>
					</svg>
					New Note
				</button>
				<button
					onclick={openSearch}
					class="flex w-full items-center justify-between rounded-lg border border-[var(--color-border)] px-4 py-2.5 text-[var(--color-text-muted)] transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-text)]"
				>
					<div class="flex items-center gap-2">
						<svg
							xmlns="http://www.w3.org/2000/svg"
							class="h-4 w-4"
							viewBox="0 0 20 20"
							fill="currentColor"
						>
							<path
								fill-rule="evenodd"
								d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z"
								clip-rule="evenodd"
							/>
						</svg>
						<span class="text-sm">Search</span>
					</div>
					<kbd
						class="hidden rounded bg-[var(--color-bg)] px-1.5 py-0.5 text-xs md:inline"
					>
						{navigator?.platform?.includes('Mac') ? '⌘' : 'Ctrl'}K
					</kbd>
				</button>
			</div>

			<!-- Tags Filter -->
			{#if allTags.length > 0}
				<div class="border-b border-[var(--color-border)] px-3 py-2">
					<button
						onclick={() => (showTags = !showTags)}
						class="flex w-full items-center justify-between text-xs font-medium uppercase text-[var(--color-text-muted)]"
					>
						<span>Tags</span>
						<svg
							xmlns="http://www.w3.org/2000/svg"
							class="h-4 w-4 transition-transform"
							class:rotate-180={showTags}
							viewBox="0 0 20 20"
							fill="currentColor"
						>
							<path
								fill-rule="evenodd"
								d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
								clip-rule="evenodd"
							/>
						</svg>
					</button>
					{#if showTags}
						<div class="mt-2 flex flex-wrap gap-1">
							{#if selectedTag}
								<button
									onclick={() => (selectedTag = null)}
									class="rounded-full bg-[var(--color-accent)] px-2 py-0.5 text-xs text-white"
								>
									#{selectedTag} &times;
								</button>
							{/if}
							{#each allTags.slice(0, 10) as { tag, count }}
								{#if tag !== selectedTag}
									<button
										onclick={() => (selectedTag = tag)}
										class="rounded-full bg-[var(--color-border)] px-2 py-0.5 text-xs text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-accent)] hover:text-white"
									>
										#{tag}
										<span class="opacity-60">({count})</span>
									</button>
								{/if}
							{/each}
						</div>
					{/if}
				</div>
			{/if}

			<!-- View Mode Toggle -->
			<div class="flex items-center justify-between border-b border-[var(--color-border)] px-3 py-2">
				<span class="text-xs font-medium uppercase text-[var(--color-text-muted)]">View</span>
				<div class="flex rounded-lg bg-[var(--color-bg)] p-0.5">
					<button
						onclick={() => (viewMode = 'folders')}
						class="rounded-md px-2 py-1 text-xs transition-colors"
						class:bg-[var(--color-accent)]={viewMode === 'folders'}
						class:text-white={viewMode === 'folders'}
						class:text-[var(--color-text-muted)]={viewMode !== 'folders'}
						aria-label="Folder view"
						title="Folder view"
					>
						<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
							<path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
						</svg>
					</button>
					<button
						onclick={() => (viewMode = 'list')}
						class="rounded-md px-2 py-1 text-xs transition-colors"
						class:bg-[var(--color-accent)]={viewMode === 'list'}
						class:text-white={viewMode === 'list'}
						class:text-[var(--color-text-muted)]={viewMode !== 'list'}
						aria-label="List view"
						title="List view"
					>
						<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
							<path fill-rule="evenodd" d="M3 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clip-rule="evenodd" />
						</svg>
					</button>
				</div>
			</div>

			<!-- Notes List -->
			<nav class="flex-1 overflow-y-auto overscroll-contain p-2">
				{#if viewMode === 'folders'}
					<FolderTree onNoteClick={handleNoteClick} />
				{:else}
					{#if selectedTag}
						<div class="mb-2 flex items-center justify-between px-1 text-xs text-[var(--color-text-muted)]">
							<span>Filtered by #{selectedTag}</span>
							<button
								onclick={() => (selectedTag = null)}
								class="text-[var(--color-accent)] hover:underline"
							>
								Clear
							</button>
						</div>
					{/if}
					{#each filteredNotes as note (note.id)}
						<a
							href="/note/{note.id}"
							onclick={handleNoteClick}
							class="mb-1 block rounded-lg px-3 py-3 transition-colors hover:bg-[var(--color-border)] active:scale-[0.98]"
							class:bg-[var(--color-accent)]={isActive(note.id)}
							class:text-white={isActive(note.id)}
						>
							<div class="truncate font-medium">
								{note.title || 'Untitled'}
							</div>
							<div
								class="mt-0.5 truncate text-sm"
								class:text-[var(--color-text-muted)]={!isActive(note.id)}
								class:text-white={isActive(note.id)}
								class:opacity-75={isActive(note.id)}
							>
								{note.content.slice(0, 50) || 'Empty note...'}
							</div>
						</a>
					{:else}
						<div class="px-3 py-8 text-center text-[var(--color-text-muted)]">
							{#if selectedTag}
								<p>No notes with #{selectedTag}</p>
								<button
									onclick={() => (selectedTag = null)}
									class="mt-2 text-sm text-[var(--color-accent)] hover:underline"
								>
									Clear filter
								</button>
							{:else}
								<p>No notes yet</p>
								<p class="mt-1 text-sm">Tap "New Note" to get started</p>
							{/if}
						</div>
					{/each}
				{/if}
			</nav>

			<!-- Footer -->
			<div class="border-t border-[var(--color-border)] p-3 safe-bottom">
				<div class="flex items-center gap-1">
					<a
						href="/graph"
						onclick={handleNoteClick}
						class="flex flex-1 items-center gap-2 rounded-lg px-3 py-3 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-border)] hover:text-[var(--color-text)]"
					>
						<svg
							xmlns="http://www.w3.org/2000/svg"
							class="h-5 w-5"
							viewBox="0 0 20 20"
							fill="currentColor"
						>
							<path
								fill-rule="evenodd"
								d="M17.707 9.293a1 1 0 010 1.414l-7 7a1 1 0 01-1.414 0l-7-7A.997.997 0 012 10V5a3 3 0 013-3h5c.256 0 .512.098.707.293l7 7zM5 6a1 1 0 100-2 1 1 0 000 2z"
								clip-rule="evenodd"
							/>
						</svg>
						Graph
					</a>
					<a
						href="/references"
						onclick={handleNoteClick}
						class="flex flex-1 items-center gap-2 rounded-lg px-3 py-3 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-border)] hover:text-[var(--color-text)]"
					>
						<svg
							xmlns="http://www.w3.org/2000/svg"
							class="h-5 w-5"
							viewBox="0 0 20 20"
							fill="currentColor"
						>
							<path d="M9 4.804A7.968 7.968 0 005.5 4c-1.255 0-2.443.29-3.5.804v10A7.969 7.969 0 015.5 14c1.669 0 3.218.51 4.5 1.385A7.962 7.962 0 0114.5 14c1.255 0 2.443.29 3.5.804v-10A7.968 7.968 0 0014.5 4c-1.255 0-2.443.29-3.5.804V12a1 1 0 11-2 0V4.804z" />
						</svg>
						Refs
					</a>
					<a
						href="/read"
						onclick={handleNoteClick}
						class="flex flex-1 items-center gap-2 rounded-lg px-3 py-3 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-border)] hover:text-[var(--color-text)]"
						title="Read Mode"
					>
						<svg
							xmlns="http://www.w3.org/2000/svg"
							class="h-5 w-5"
							viewBox="0 0 20 20"
							fill="currentColor"
						>
							<path d="M9 4.804A7.968 7.968 0 005.5 4c-1.255 0-2.443.29-3.5.804v10A7.969 7.969 0 015.5 14c1.669 0 3.218.51 4.5 1.385A7.962 7.962 0 0114.5 14c1.255 0 2.443.29 3.5.804v-10A7.968 7.968 0 0014.5 4c-1.255 0-2.443.29-3.5.804V12a1 1 0 11-2 0V4.804z" />
						</svg>
						Read
					</a>
					<button
						onclick={cycleTheme}
						class="rounded-lg p-3 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-border)] hover:text-[var(--color-text)]"
						title="Theme: {theme}"
					>
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
				</div>
				<a
					href="/settings"
					onclick={handleNoteClick}
					class="flex items-center gap-2 rounded-lg px-3 py-3 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-border)] hover:text-[var(--color-text)]"
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						class="h-5 w-5"
						viewBox="0 0 20 20"
						fill="currentColor"
					>
						<path
							fill-rule="evenodd"
							d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z"
							clip-rule="evenodd"
						/>
					</svg>
					Settings
				</a>
			</div>
		</aside>
		{/if}

		<!-- Main Content -->
		<main class="flex flex-1 flex-col" class:overflow-hidden={!isReadMode}>
			<!-- Mobile header (hidden in read mode) -->
			{#if !isReadMode}
			<header
				class="flex items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-4 py-3 safe-top md:hidden"
			>
				<button
					onclick={toggleSidebar}
					class="rounded-lg p-2 text-[var(--color-text-muted)] hover:bg-[var(--color-border)]"
					aria-label="Open sidebar"
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						class="h-6 w-6"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M4 6h16M4 12h16M4 18h16"
						/>
					</svg>
				</button>
				<div class="flex items-center gap-2">
					<img src="/icon-192.avif" alt="Kurumi" class="h-6 w-6 rounded" />
					<span class="font-semibold text-[var(--color-text)]">Kurumi</span>
				</div>
			</header>
			{/if}

			<div class="flex-1" class:overflow-hidden={!isReadMode} class:overflow-auto={isReadMode}>
				{@render children()}
			</div>
		</main>
	</div>

	<!-- Command Palette -->
	{#if showSearch}
		<CommandPalette onClose={closeSearch} />
	{/if}
{/if}
