<script lang="ts">
	import '../app.css';
	import { pwaInfo } from 'virtual:pwa-info';
	import { onMount } from 'svelte';
	import { initDB, notes, addNote, getAllTags, extractTags, folders } from '$lib/db';
	import { initSearch, rebuildIndex } from '$lib/search';
	import { setupVisibilitySync, teardownVisibilitySync, syncState, isSyncConfigured, sync } from '$lib/sync';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import CommandPalette from '$lib/components/CommandPalette.svelte';
	import FolderTree from '$lib/components/FolderTree.svelte';
	import VaultSelector from '$lib/components/VaultSelector.svelte';
	import Snackbar from '$lib/components/Snackbar.svelte';
	import { X, Plus, Search, ChevronDown, Folder, List, GitFork, BookOpen, Settings, Menu, Cloud, RefreshCw, CheckCircle, AlertCircle, Pencil, Tag } from 'lucide-svelte';

	let { children } = $props();

	let initialized = $state(false);
	let sidebarOpen = $state(false);
	let isMobile = $state(false);
	let showSearch = $state(false);
	let selectedTag = $state<string | null>(null);
	let showTags = $state(false);
	let theme = $state<'light' | 'dark' | 'system'>('system');
	let viewMode = $state<'list' | 'folders'>('folders');
	let showNewNoteAnimation = $state(false);
	let showNewFolderAnimation = $state(false);

	// Sidebar resizing (desktop only)
	const MIN_SIDEBAR_WIDTH = 200;
	const MAX_SIDEBAR_WIDTH = 480;
	const DEFAULT_SIDEBAR_WIDTH = 256;
	let sidebarWidth = $state(DEFAULT_SIDEBAR_WIDTH);
	let isResizing = $state(false);

	// Check if we're in read mode
	let isReadMode = $derived($page.url.pathname.startsWith('/read'));

	// Get current note ID from path (for edit link in read mode)
	let currentNoteId = $derived.by(() => {
		const match = $page.url.pathname.match(/^\/read\/([a-zA-Z0-9-]+)$/);
		return match ? match[1] : null;
	});

	// Get current note ID from edit path
	let editNoteId = $derived.by(() => {
		const match = $page.url.pathname.match(/^\/note\/([a-zA-Z0-9-]+)$/);
		return match ? match[1] : null;
	});

	// Breadcrumb for current note location
	let breadcrumb = $derived.by(() => {
		if (!editNoteId) return null;
		const note = $notes.find(n => n.id === editNoteId);
		if (!note) return null;

		// Build folder path
		const path: string[] = [];
		let currentFolderId = note.folderId;
		while (currentFolderId) {
			const folder = $folders.find(f => f.id === currentFolderId);
			if (folder) {
				path.unshift(folder.name);
				currentFolderId = folder.parentId;
			} else {
				break;
			}
		}

		// Add note title
		path.push(note.title || 'Untitled');
		return path;
	});

	// Sync status
	let showSyncStatus = $derived(initialized && isSyncConfigured());

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
			setupVisibilitySync();
			initialized = true;
		});

		checkMobile();
		window.addEventListener('resize', checkMobile);
		window.addEventListener('keydown', handleKeydown);

		return () => {
			window.removeEventListener('resize', checkMobile);
			window.removeEventListener('keydown', handleKeydown);
			teardownVisibilitySync();
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

	async function handleNewNote() {
		const note = addNote();
		if (isMobile) sidebarOpen = false;
		await goto(`/note/${note.id}`);
		// Show snackbar after navigation completes
		showNewNoteAnimation = true;
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
	<!-- Primary Meta Tags -->
	<title>Kurumi - Your Second Brain</title>
	<meta name="title" content="Kurumi - Your Second Brain" />
	<meta name="description" content="A local-first personal knowledge management system. Capture, connect, and cultivate your ideas with AI-augmented note-taking that works offline." />
	<meta name="keywords" content="note-taking, knowledge management, second brain, PKM, markdown, local-first, offline, AI, wikilinks, personal wiki" />
	<meta name="author" content="Kurumi" />
	<meta name="robots" content="index, follow" />
	<meta name="language" content="English" />
	<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
	<meta name="theme-color" content="#1e1e2e" />

	<!-- Open Graph / Facebook -->
	<meta property="og:type" content="website" />
	<meta property="og:url" content="https://kurumi.app/" />
	<meta property="og:title" content="Kurumi - Your Second Brain" />
	<meta property="og:description" content="A local-first personal knowledge management system. Capture, connect, and cultivate your ideas with AI-augmented note-taking that works offline." />
	<meta property="og:image" content="https://kurumi.app/og-image.png" />
	<meta property="og:image:width" content="1200" />
	<meta property="og:image:height" content="630" />
	<meta property="og:image:alt" content="Kurumi - Your Second Brain" />
	<meta property="og:site_name" content="Kurumi" />
	<meta property="og:locale" content="en_US" />

	<!-- Twitter -->
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:url" content="https://kurumi.app/" />
	<meta name="twitter:title" content="Kurumi - Your Second Brain" />
	<meta name="twitter:description" content="A local-first personal knowledge management system. Capture, connect, and cultivate your ideas with AI-augmented note-taking that works offline." />
	<meta name="twitter:image" content="https://kurumi.app/og-image.png" />
	<meta name="twitter:image:alt" content="Kurumi - Your Second Brain" />

	<!-- Apple/PWA -->
	<meta name="apple-mobile-web-app-capable" content="yes" />
	<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
	<meta name="apple-mobile-web-app-title" content="Kurumi" />
	<meta name="mobile-web-app-capable" content="yes" />
	<meta name="application-name" content="Kurumi" />
	<meta name="format-detection" content="telephone=no" />

	<!-- Favicons -->
	<link rel="icon" href="/favicon.ico" type="image/x-icon" />
	<link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png" />
	<link rel="icon" type="image/png" sizes="512x512" href="/icon-512.png" />
	<link rel="apple-touch-icon" href="/apple-touch-icon.png" />

	<!-- Canonical -->
	<link rel="canonical" href="https://kurumi.app/" />

	<!-- JSON-LD Structured Data -->
	{@html `<script type="application/ld+json">
	{
		"@context": "https://schema.org",
		"@type": "WebApplication",
		"name": "Kurumi",
		"alternateName": "Kurumi - Your Second Brain",
		"description": "A local-first personal knowledge management system. Capture, connect, and cultivate your ideas with AI-augmented note-taking that works offline.",
		"url": "https://kurumi.app/",
		"applicationCategory": "Productivity",
		"operatingSystem": "Any",
		"offers": {
			"@type": "Offer",
			"price": "0",
			"priceCurrency": "USD"
		},
		"featureList": [
			"Offline-first architecture",
			"Markdown support",
			"Wikilinks for connecting notes",
			"AI-powered text assistance",
			"Full-text search",
			"Graph visualization",
			"Cross-device sync",
			"PWA installable"
		],
		"screenshot": "https://kurumi.app/og-image.png",
		"softwareVersion": "1.0.0",
		"author": {
			"@type": "Organization",
			"name": "Kurumi"
		}
	}
	</script>`}

	<!-- PWA Manifest -->
	{#if pwaInfo}
		<link rel="manifest" href={pwaInfo.webManifest.href} />
	{/if}
</svelte:head>

{#if !initialized}
	<div class="flex h-[100dvh] items-center justify-center bg-[var(--color-bg)]">
		<div class="text-center">
			<img src="/icon-192.avif" alt="Kurumi" class="mx-auto mb-6 h-24 w-24 rounded-2xl" />
			<div
				class="mx-auto mb-4 h-6 w-6 animate-spin rounded-full border-2 border-[var(--color-accent)] border-t-transparent"
			></div>
			<p class="text-[var(--color-text-muted)]">Loading Kurumi...</p>
		</div>
	</div>
{:else}
	<div class="flex h-[100dvh] bg-[var(--color-bg)]">
		<!-- Mobile overlay -->
		{#if isMobile && sidebarOpen}
			<button
				class="animate-backdrop fixed inset-0 z-40 bg-black/50"
				onclick={() => (sidebarOpen = false)}
				aria-label="Close sidebar"
			></button>
		{/if}

		<!-- Sidebar -->
		<aside
			class="fixed inset-y-0 left-0 z-50 flex w-full flex-col border-r-0 border-[var(--color-border)] bg-[var(--color-bg-secondary)] md:relative md:z-auto md:border-r {sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}"
			style="transition: transform 250ms cubic-bezier(0.4, 0, 0.2, 1); --sidebar-width: {sidebarWidth}px; width: {isMobile ? undefined : `${sidebarWidth}px`};"
			role="navigation"
			aria-label="Main navigation"
		>
			<!-- Logo -->
			<div
				class="flex min-h-16 items-center justify-between border-b border-[var(--color-border)] px-4 py-2 safe-top md:min-h-0 md:py-2"
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

			<!-- New Note Button (desktop only) -->
			<div class="hidden space-y-2 p-3 md:block">
				<button
					type="button"
					onclick={handleNewNote}
					class="flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--color-accent)] px-4 py-3 text-white transition-colors hover:bg-[var(--color-accent-hover)] active:scale-[0.98]"
				>
					<Plus class="h-5 w-5" />
					New Note
				</button>
			</div>

			<!-- Search & View Toggle Row -->
			<div class="flex items-center gap-2 p-3 pt-0 md:pt-3">
				<button
					onclick={openSearch}
					class="flex flex-1 items-center justify-between rounded-lg border border-[var(--color-border)] px-3 py-2 text-[var(--color-text-muted)] transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-text)]"
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
				<!-- View toggle (mobile: inline with search, desktop: hidden here) -->
				<div class="flex rounded-lg bg-[var(--color-bg)] p-0.5 md:hidden">
					<button
						onclick={() => (viewMode = 'folders')}
						class="flex items-center justify-center rounded-md p-2 transition-colors"
						class:bg-[var(--color-accent)]={viewMode === 'folders'}
						class:text-white={viewMode === 'folders'}
						class:text-[var(--color-text-muted)]={viewMode !== 'folders'}
						aria-label="Folder view"
						title="Folder view"
					>
						<Folder class="h-5 w-5" />
					</button>
					<button
						onclick={() => (viewMode = 'list')}
						class="flex items-center justify-center rounded-md p-2 transition-colors"
						class:bg-[var(--color-accent)]={viewMode === 'list'}
						class:text-white={viewMode === 'list'}
						class:text-[var(--color-text-muted)]={viewMode !== 'list'}
						aria-label="List view"
						title="List view"
					>
						<List class="h-5 w-5" />
					</button>
				</div>
			</div>

			<!-- Tags Filter -->
			{#if allTags.length > 0}
				<div class="border-b border-[var(--color-border)] px-3 py-2" role="region" aria-label="Tags filter">
					<button
						onclick={() => (showTags = !showTags)}
						class="flex w-full items-center justify-between text-xs font-medium uppercase text-[var(--color-text-muted)]"
						aria-expanded={showTags}
						aria-controls="tags-list"
					>
						<span>Tags</span>
						<ChevronDown class="h-4 w-4 transition-transform {showTags ? 'rotate-180' : ''}" aria-hidden="true" />
					</button>
					{#if showTags}
						<div id="tags-list" class="mt-2 flex flex-wrap gap-1" role="listbox" aria-label="Available tags">
							{#if selectedTag}
								<button
									onclick={() => (selectedTag = null)}
									class="rounded-full bg-[var(--color-accent)] px-2 py-0.5 text-xs text-white"
									aria-label="Clear tag filter: {selectedTag}"
								>
									#{selectedTag} &times;
								</button>
							{/if}
							{#each allTags.slice(0, 10) as { tag, count }}
								{#if tag !== selectedTag}
									<button
										onclick={() => (selectedTag = tag)}
										class="rounded-full bg-[var(--color-border)] px-2 py-0.5 text-xs text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-accent)] hover:text-white"
										role="option"
										aria-label="Filter by tag: {tag}, {count} notes"
									>
										#{tag}
										<span class="opacity-60" aria-hidden="true">({count})</span>
									</button>
								{/if}
							{/each}
						</div>
					{/if}
				</div>
			{/if}

			<!-- View Mode Toggle (desktop only - mobile is in search row) -->
			<div class="hidden items-center justify-between border-b border-[var(--color-border)] px-3 py-2 md:flex">
				<span class="text-xs font-medium uppercase text-[var(--color-text-muted)]">View</span>
				<div class="flex rounded-lg bg-[var(--color-bg)] p-0.5">
					<button
						onclick={() => (viewMode = 'folders')}
						class="flex items-center justify-center rounded-md p-1.5 transition-colors"
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
						class="flex items-center justify-center rounded-md p-1.5 transition-colors"
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
			<nav class="flex-1 overflow-y-auto overscroll-contain p-2" aria-label="Notes list">
				{#if viewMode === 'folders'}
					<FolderTree onNoteClick={handleNoteClick} onNoteCreate={() => showNewNoteAnimation = true} onFolderCreate={() => showNewFolderAnimation = true} />
				{:else}
					{#if selectedTag}
						<div class="mb-2 flex items-center justify-between px-1 text-xs text-[var(--color-text-muted)]" role="status" aria-live="polite">
							<span>Filtered by #{selectedTag}</span>
							<button
								onclick={() => (selectedTag = null)}
								class="text-[var(--color-accent)] hover:underline"
								aria-label="Clear tag filter"
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
							aria-current={isActive(note.id) ? 'page' : undefined}
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

			<!-- Sync Status (clickable to force sync) -->
			{#if showSyncStatus}
				<button
					onclick={() => sync()}
					disabled={$syncState.status === 'syncing'}
					class="flex w-full items-center gap-2 border-t border-[var(--color-border)] px-3 py-2 text-left transition-colors hover:bg-[var(--color-border)] disabled:opacity-70"
					title="Click to sync"
				>
					{#if $syncState.status === 'syncing'}
						<RefreshCw class="h-4 w-4 animate-spin text-[var(--color-accent)]" />
						<span class="text-xs text-[var(--color-text-muted)]">Syncing...</span>
					{:else if $syncState.status === 'success'}
						<CheckCircle class="h-4 w-4 text-green-500" />
						<span class="text-xs text-[var(--color-text-muted)]">Synced</span>
					{:else if $syncState.status === 'error'}
						<AlertCircle class="h-4 w-4 text-red-500" />
						<span class="text-xs text-red-500">{$syncState.error || 'Sync failed'}</span>
					{:else}
						<Cloud class="h-4 w-4 text-[var(--color-text-muted)]" />
						<span class="text-xs text-[var(--color-text-muted)]">Sync ready</span>
					{/if}
				</button>
			{/if}

			<!-- Footer -->
			<div class="border-t border-[var(--color-border)] p-2 safe-bottom">
				<div class="grid grid-cols-4 gap-1">
					<a
						href="/references"
						onclick={handleNoteClick}
						class="flex flex-col items-center gap-1 rounded-lg px-2 py-2 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-border)] hover:text-[var(--color-text)]"
					>
						<Tag class="h-5 w-5" />
						<span class="text-xs">Refs</span>
					</a>
					<a
						href="/graph"
						onclick={handleNoteClick}
						class="flex flex-col items-center gap-1 rounded-lg px-2 py-2 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-border)] hover:text-[var(--color-text)]"
					>
						<GitFork class="h-5 w-5" />
						<span class="text-xs">Graph</span>
					</a>
					{#if isReadMode}
						<a
							href={currentNoteId ? `/note/${currentNoteId}` : '/'}
							onclick={handleNoteClick}
							class="flex flex-col items-center gap-1 rounded-lg px-2 py-2 text-[var(--color-accent)] transition-colors hover:bg-[var(--color-border)]"
						>
							<Pencil class="h-5 w-5" />
							<span class="text-xs">Edit</span>
						</a>
					{:else}
						<a
							href="/read"
							onclick={handleNoteClick}
							class="flex flex-col items-center gap-1 rounded-lg px-2 py-2 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-border)] hover:text-[var(--color-text)]"
						>
							<BookOpen class="h-5 w-5" />
							<span class="text-xs">Read</span>
						</a>
					{/if}
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

		<!-- Main Content -->
		<main class="relative flex flex-1 flex-col" class:overflow-hidden={!isReadMode} role="main" aria-label="Main content">
			<!-- Mobile header (hidden in read mode and on desktop) -->
			{#if !isReadMode}
			<header
				class="flex items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-4 py-3 safe-top md:hidden"
			>
				<div class="flex min-w-0 flex-1 items-center gap-2">
					<button
						onclick={toggleSidebar}
						class="shrink-0 rounded-lg p-2 text-[var(--color-text-muted)] hover:bg-[var(--color-border)]"
						aria-label="Open sidebar"
					>
						<Menu class="h-6 w-6" />
					</button>
					{#if breadcrumb && breadcrumb.length > 0}
						<div class="flex min-w-0 items-center gap-1 text-sm text-[var(--color-text-muted)]">
							{#each breadcrumb as segment, i}
								{#if i > 0}
									<ChevronDown class="h-3 w-3 shrink-0 -rotate-90" />
								{/if}
								<span class="truncate" class:text-[var(--color-text)]={i === breadcrumb.length - 1} class:font-medium={i === breadcrumb.length - 1}>
									{segment}
								</span>
							{/each}
						</div>
					{/if}
				</div>
				<button
					type="button"
					onclick={handleNewNote}
					class="rounded-lg p-2 text-[var(--color-accent)] transition-colors hover:bg-[var(--color-border)]"
					aria-label="New note"
					title="New note"
				>
					<Plus class="h-6 w-6" />
				</button>
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

	<!-- Snackbars -->
	{#if showNewNoteAnimation}
		<Snackbar
			message="New note created"
			resourceType="note"
			duration={2000}
			onClose={() => showNewNoteAnimation = false}
		/>
	{/if}
	{#if showNewFolderAnimation}
		<Snackbar
			message="New folder created"
			resourceType="folder"
			duration={2000}
			onClose={() => showNewFolderAnimation = false}
		/>
	{/if}
{/if}
