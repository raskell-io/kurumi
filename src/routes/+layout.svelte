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
	import { X, Plus, Search, ChevronDown, Folder, List, GitFork, BookOpen, Settings, Menu } from 'lucide-svelte';

	let { children } = $props();

	let initialized = $state(false);
	let sidebarOpen = $state(false);
	let isMobile = $state(false);
	let showSearch = $state(false);
	let selectedTag = $state<string | null>(null);
	let showTags = $state(false);
	let theme = $state<'light' | 'dark' | 'system'>('system');
	let viewMode = $state<'list' | 'folders'>('folders');

	// Sidebar resizing (desktop only)
	const MIN_SIDEBAR_WIDTH = 200;
	const MAX_SIDEBAR_WIDTH = 480;
	const DEFAULT_SIDEBAR_WIDTH = 256;
	let sidebarWidth = $state(DEFAULT_SIDEBAR_WIDTH);
	let isResizing = $state(false);

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

		// Load sidebar width from localStorage
		const savedWidth = localStorage.getItem('kurumi-sidebar-width');
		if (savedWidth) {
			const width = parseInt(savedWidth, 10);
			if (width >= MIN_SIDEBAR_WIDTH && width <= MAX_SIDEBAR_WIDTH) {
				sidebarWidth = width;
			}
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

	// Sidebar resize handlers
	function startResize(e: MouseEvent) {
		if (isMobile) return;
		e.preventDefault();
		isResizing = true;
		document.body.style.cursor = 'col-resize';
		document.body.style.userSelect = 'none';
	}

	function handleResizeMove(e: MouseEvent) {
		if (!isResizing) return;
		const newWidth = Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, e.clientX));
		sidebarWidth = newWidth;
	}

	function handleResizeEnd() {
		if (!isResizing) return;
		isResizing = false;
		document.body.style.cursor = '';
		document.body.style.userSelect = '';
		// Save to localStorage
		localStorage.setItem('kurumi-sidebar-width', String(sidebarWidth));
	}

	// Use effect to manage global mouse events during resize
	$effect(() => {
		if (isResizing) {
			const onMove = (e: MouseEvent) => handleResizeMove(e);
			const onUp = () => handleResizeEnd();

			window.addEventListener('mousemove', onMove);
			window.addEventListener('mouseup', onUp);
			window.addEventListener('mouseleave', onUp);

			return () => {
				window.removeEventListener('mousemove', onMove);
				window.removeEventListener('mouseup', onUp);
				window.removeEventListener('mouseleave', onUp);
			};
		}
	});
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
			class="fixed inset-y-0 left-0 z-50 flex w-full flex-col border-r-0 border-[var(--color-border)] bg-[var(--color-bg-secondary)] transition-transform duration-300 ease-out md:relative md:z-auto md:border-r md:pt-6 {sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}"
			style:--sidebar-width="{sidebarWidth}px"
			style:width={isMobile ? undefined : `${sidebarWidth}px`}
		>
			<!-- Logo -->
			<div
				class="flex items-center justify-between border-b border-[var(--color-border)] px-4 pb-4 safe-top"
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
					<X class="h-5 w-5" />
				</button>
			</div>

			<!-- New Note & Search Buttons -->
			<div class="space-y-2 p-3">
				<button
					onclick={handleNewNote}
					class="flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--color-accent)] px-4 py-3 text-white transition-colors hover:bg-[var(--color-accent-hover)] active:scale-[0.98]"
				>
					<Plus class="h-5 w-5" />
					New Note
				</button>
				<button
					onclick={openSearch}
					class="flex w-full items-center justify-between rounded-lg border border-[var(--color-border)] px-4 py-2.5 text-[var(--color-text-muted)] transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-text)]"
				>
					<div class="flex items-center gap-2">
						<Search class="h-4 w-4" />
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
						<ChevronDown class="h-4 w-4 transition-transform {showTags ? 'rotate-180' : ''}" />
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
						<Folder class="h-4 w-4" />
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
						<List class="h-4 w-4" />
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
			<div class="border-t border-[var(--color-border)] p-2 safe-bottom">
				<div class="grid grid-cols-3 gap-1">
					<a
						href="/graph"
						onclick={handleNoteClick}
						class="flex flex-col items-center gap-1 rounded-lg px-2 py-2 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-border)] hover:text-[var(--color-text)]"
					>
						<GitFork class="h-5 w-5" />
						<span class="text-xs">Graph</span>
					</a>
					<a
						href="/references"
						onclick={handleNoteClick}
						class="flex flex-col items-center gap-1 rounded-lg px-2 py-2 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-border)] hover:text-[var(--color-text)]"
					>
						<BookOpen class="h-5 w-5" />
						<span class="text-xs">Refs</span>
					</a>
					<a
						href="/settings"
						onclick={handleNoteClick}
						class="flex flex-col items-center gap-1 rounded-lg px-2 py-2 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-border)] hover:text-[var(--color-text)]"
					>
						<Settings class="h-5 w-5" />
						<span class="text-xs">Settings</span>
					</a>
				</div>
			</div>

		</aside>

		<!-- Resize handle (desktop only) -->
		{#if !isMobile}
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="group flex w-3 shrink-0 cursor-col-resize items-center justify-center"
				onmousedown={startResize}
			>
				<div
					class="h-full w-0.5 rounded-full transition-colors group-hover:bg-[var(--color-accent)]"
					class:bg-[var(--color-accent)]={isResizing}
					class:bg-transparent={!isResizing}
				></div>
			</div>
		{/if}
		{/if}

		<!-- Main Content -->
		<main class="relative flex flex-1 flex-col" class:overflow-hidden={!isReadMode}>
			<!-- Mobile header (hidden in read mode and on desktop) -->
			{#if !isReadMode}
			<header
				class="flex items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-4 py-3 safe-top md:hidden"
			>
				<div class="flex items-center gap-3">
					<button
						onclick={toggleSidebar}
						class="rounded-lg p-2 text-[var(--color-text-muted)] hover:bg-[var(--color-border)]"
						aria-label="Open sidebar"
					>
						<Menu class="h-6 w-6" />
					</button>
					<div class="flex items-center gap-2">
						<img src="/icon-192.avif" alt="Kurumi" class="h-6 w-6 rounded" />
						<span class="font-semibold text-[var(--color-text)]">Kurumi</span>
					</div>
				</div>
				<a
					href="/read"
					class="rounded-lg p-2 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-border)] hover:text-[var(--color-text)]"
					aria-label="Read mode"
					title="Read mode"
				>
					<BookOpen class="h-6 w-6" />
				</a>
			</header>
			{/if}

			<!-- Read button - desktop only -->
			{#if !isReadMode}
			<a
				href="/read"
				class="absolute right-6 top-6 z-10 hidden rounded-lg p-2 text-[var(--color-text-muted)] transition-all hover:bg-[var(--color-border)] hover:text-[var(--color-text)] md:block"
				aria-label="Read mode"
				title="Read mode"
			>
				<BookOpen class="h-5 w-5" />
			</a>
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
