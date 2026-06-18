<script lang="ts">
	import '../app.css';
	import { pwaInfo } from 'virtual:pwa-info';
	import { onMount } from 'svelte';
	import { afterNavigate } from '$app/navigation';
	import {
		initDB,
		memoryObjects,
		addMemoryObject,
		addMeetingMemo,
		transcribeMemoryAudio,
		getAllTags,
		folders,
		trashCount,
		actionItems,
		reminderProposals,
		rolloverRecurringActionItems,
		savedSearches
	} from '$lib/db';
	import { storeBlob } from '$lib/db/blob-store';
	import { initHashRouter, updateHashFromPath } from '$lib/hash-router';
	import { generateDailyDigest } from '$lib/digest';
	import { initSearch, rebuildIndex } from '$lib/search';
	import { setupVisibilitySync, teardownVisibilitySync, setupAutoSync, teardownAutoSync, syncIndicator, isSyncConfigured, sync } from '$lib/sync';
	import SyncFab from '$lib/components/SyncFab.svelte';
	import { gitSyncState } from '$lib/git';
	import GitConflictModal from '$lib/components/GitConflictModal.svelte';
	import UndoToast from '$lib/components/UndoToast.svelte';
	import AgentPane from '$lib/components/AgentPane.svelte';
	import FocusTimer from '$lib/components/FocusTimer.svelte';
	import LockScreen from '$lib/components/LockScreen.svelte';
	import { lockEnabled, isLocked, lock, autoLockMinutes, hasPinSet } from '$lib/stores/lock';
	import { undoLast } from '$lib/stores/undo';
	import { focusMode, toggleFocusMode, openTabs, touchTab, closeTab, moveTab } from '$lib/stores/workspace';
	import {
		bootNotifications,
		stopNotificationLoop,
		stopDueCacheSync
	} from '$lib/notifications';
	import {
		getLocalInferenceSettings,
		preloadPipeline,
		whisperModelId,
		textModelId,
		embedModelId
	} from '$lib/inference';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import CommandPalette from '$lib/components/CommandPalette.svelte';
	import FolderTree from '$lib/components/FolderTree.svelte';
	import VaultSelector from '$lib/components/VaultSelector.svelte';
	import TemplatePicker from '$lib/components/TemplatePicker.svelte';
	import VoiceCaptureModal from '$lib/components/VoiceCaptureModal.svelte';
	import Snackbar from '$lib/components/Snackbar.svelte';
	import { X, Plus, Search, ChevronDown, GitFork, BookOpen, Settings, ListTree, Cloud, RefreshCw, CheckCircle, AlertCircle, Pencil, Tag, Trash2, Mic, Users, CalendarDays, CheckSquare, Bell, Bot, Inbox, Calendar } from 'lucide-svelte';
	import {
		showNewNoteSnackbar,
		triggerSearch,
		triggerVoiceCapture,
		triggerMeetingCapture,
		triggerUploadRecording,
		triggerVoiceAssistant
	} from '$lib/stores/snackbar';

	let { children } = $props();

	let initialized = $state(false);
	let sidebarOpen = $state(false);
	let isMobile = $state(false);
	let showSearch = $state(false);
	let showTemplatePicker = $state(false);
	let showVoiceCapture = $state(false);
	let captureMode = $state<'voice-memo' | 'meeting'>('voice-memo');
	let uploadFileInput = $state<HTMLInputElement | undefined>();
	let uploadingFile = $state(false);

	async function handleUploadFile(event: Event) {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;

		uploadingFile = true;
		try {
			const ref = await storeBlob(file, file.type || 'audio/webm');
			const now = Date.now();
			const memory = addMeetingMemo({
				title: file.name.replace(/\.[^.]+$/, '') || 'Uploaded recording',
				rawAudioRef: ref,
				captureMode: 'upload',
				startedAt: now,
				endedAt: now
			});
			await goto(`/memory/${memory.id}`);
			void transcribeMemoryAudio(memory.id, file, file.type || 'audio/webm');
		} catch (err) {
			console.error('Upload failed:', err);
		} finally {
			uploadingFile = false;
			input.value = '';
		}
	}
	let selectedTag = $state<string | null>(null);
	let showTags = $state(false);
	let theme = $state<'light' | 'dark' | 'system'>('system');
	let showNewNoteAnimation = $state(false);
	let showNewFolderAnimation = $state(false);
	let deleteNoteSnackbar = $state<string | null>(null);
	let deleteFolderSnackbar = $state<string | null>(null);
	let showConflictModal = $state(false);
	let showAgentPane = $state(false);
	// Auto-open when a sync attempt surfaces conflicts.
	$effect(() => {
		if ($gitSyncState.status === 'conflict' && $gitSyncState.conflicts.length > 0) {
			showConflictModal = true;
		}
	});

	// Subscribe to snackbar store from other pages
	$effect(() => {
		const unsubscribe = showNewNoteSnackbar.subscribe(value => {
			if (value) {
				showNewNoteAnimation = true;
				showNewNoteSnackbar.set(false);
			}
		});
		return unsubscribe;
	});

	// Subscribe to search trigger from other pages
	$effect(() => {
		const unsubscribe = triggerSearch.subscribe(value => {
			if (value) {
				showSearch = true;
				triggerSearch.set(false);
			}
		});
		return unsubscribe;
	});

	// Subscribe to voice-capture trigger from other pages
	$effect(() => {
		const unsubscribe = triggerVoiceCapture.subscribe((value) => {
			if (value) {
				captureMode = 'voice-memo';
				showVoiceCapture = true;
				triggerVoiceCapture.set(false);
			}
		});
		return unsubscribe;
	});

	// Subscribe to meeting-capture trigger
	$effect(() => {
		const unsubscribe = triggerMeetingCapture.subscribe((value) => {
			if (value) {
				captureMode = 'meeting';
				showVoiceCapture = true;
				triggerMeetingCapture.set(false);
			}
		});
		return unsubscribe;
	});

	// Subscribe to upload-recording trigger — open the hidden file picker
	$effect(() => {
		const unsubscribe = triggerUploadRecording.subscribe((value) => {
			if (value) {
				uploadFileInput?.click();
				triggerUploadRecording.set(false);
			}
		});
		return unsubscribe;
	});

	// Sidebar resizing (desktop only)
	const MIN_SIDEBAR_WIDTH = 200;
	const MAX_SIDEBAR_WIDTH = 480;
	const DEFAULT_SIDEBAR_WIDTH = 360;
	let sidebarWidth = $state(DEFAULT_SIDEBAR_WIDTH);
	let isResizing = $state(false);

	// Check if we're in read mode
	let isReadMode = $derived($page.url.pathname.startsWith('/read'));

	// Get current note ID from path (for edit link in read mode)
	let currentNoteId = $derived.by(() => {
		const match = $page.url.pathname.match(/^\/read\/([a-zA-Z0-9-]+)$/);
		return match ? match[1] : null;
	});

	// Get current memory ID from edit path
	let editNoteId = $derived.by(() => {
		const match = $page.url.pathname.match(/^\/memory\/([a-zA-Z0-9-]+)$/);
		return match ? match[1] : null;
	});

	// Breadcrumb for current memory location
	let breadcrumb = $derived.by(() => {
		if (!editNoteId) return null;
		const memory = $memoryObjects.find((m) => m.id === editNoteId);
		if (!memory) return null;

		// Build folder path
		const path: string[] = [];
		let currentFolderId = memory.folderId;
		while (currentFolderId) {
			const folder = $folders.find((f) => f.id === currentFolderId);
			if (folder) {
				path.unshift(folder.name);
				currentFolderId = folder.parentId;
			} else {
				break;
			}
		}

		// Add memory title
		path.push(memory.title || 'Untitled');
		return path;
	});

	// Sync status
	let showSyncStatus = $derived(initialized && isSyncConfigured());

	// Derived: all tags
	let allTags = $derived(initialized ? getAllTags() : []);

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
			// Cmd+Z: pop the last undo entry from the global stack
			if (!e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
				e.preventDefault();
				undoLast();
				return;
			}

			// Cmd+` (backtick): toggle the agentic chat pane
			if (e.key === '`') {
				e.preventDefault();
				showAgentPane = !showAgentPane;
				return;
			}

			// Cmd+Shift shortcuts
			if (e.shiftKey && e.key === 'r') {
				e.preventDefault();
				goto('/read');
				if (isMobile) sidebarOpen = false;
				return;
			}
			if (e.shiftKey && e.key === 'a') {
				e.preventDefault();
				goto('/actions');
				if (isMobile) sidebarOpen = false;
				return;
			}
			if (e.shiftKey && e.key === 'i') {
				e.preventDefault();
				goto('/inbox');
				if (isMobile) sidebarOpen = false;
				return;
			}
			if (e.shiftKey && e.key === 'c') {
				e.preventDefault();
				goto('/calendar');
				if (isMobile) sidebarOpen = false;
				return;
			}
			if (e.shiftKey && (e.key === 'F' || e.key === 'f')) {
				e.preventDefault();
				toggleFocusMode();
				return;
			}
			if (e.shiftKey && (e.key === 'V' || e.key === 'v')) {
				// Global push-to-talk toggle: hop to home and flip the
				// voice assistant signal. The home page's Ask Kurumi view
				// picks it up via a $effect and runs start / stop-and-submit
				// alternately.
				e.preventDefault();
				if ($page.url.pathname !== '/') {
					goto('/');
				}
				triggerVoiceAssistant.update((n) => n + 1);
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
				case 'd':
					e.preventDefault();
					goto('/daily');
					if (isMobile) sidebarOpen = false;
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

	// Initialize hash router and sync on navigation
	let cleanupHashRouter: (() => void) | null = null;

	afterNavigate(({ to }) => {
		if (to?.url?.pathname) {
			updateHashFromPath(to.url.pathname);
			// Track recently-opened memories for the tab bar.
			const memoryMatch = to.url.pathname.match(/^\/memory\/([a-zA-Z0-9]+)/);
			if (memoryMatch) {
				touchTab(memoryMatch[1]);
			}
		}
	});

	onMount(() => {
		// Initialize hash-based routing for GitHub Pages compatibility
		cleanupHashRouter = initHashRouter();

		// Load theme from localStorage
		const savedTheme = localStorage.getItem('kurumi-theme') as 'light' | 'dark' | 'system' | null;
		if (savedTheme) {
			theme = savedTheme;
			applyTheme(savedTheme);
		}

		// Load editor font from localStorage
		const savedFont = localStorage.getItem('kurumi-editor-font') as 'quattro' | 'geist' | null;
		if (savedFont) {
			document.documentElement.classList.add(`font-${savedFont}`);
		} else {
			// Default to quattro
			document.documentElement.classList.add('font-quattro');
		}

		// Load editor font size from localStorage
		const savedFontSize = localStorage.getItem('kurumi-editor-font-size') as 'small' | 'medium' | 'large' | null;
		if (savedFontSize) {
			document.documentElement.classList.add(`font-size-${savedFontSize}`);
		} else {
			// Default to medium
			document.documentElement.classList.add('font-size-medium');
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
			setupAutoSync();
			initialized = true;
			// Start the notification loop if the user previously opted in.
			// No-op if disabled or permission not granted.
			bootNotifications();

			// Auto-generate yesterday's daily digest on first open each day.
			// Fire-and-forget so it doesn't block boot. Idempotent: checks
			// localStorage for the last generated date to avoid duplicates.
			const DIGEST_DATE_KEY = 'kurumi-last-auto-digest';
			const today = new Date().toISOString().split('T')[0];
			if (localStorage.getItem(DIGEST_DATE_KEY) !== today) {
				setTimeout(() => {
					generateDailyDigest().then(() => {
						localStorage.setItem(DIGEST_DATE_KEY, today);
					}).catch(() => {
						// Silently fail — no inference provider configured, etc.
					});
				}, 5000); // delay to not compete with initial render
			}
		});

		// Preload local inference models if enabled (default). Fire-and-forget;
		// the model manager updates its own status store and the UI can reflect
		// progress in the Local AI settings panel.
		const localSettings = getLocalInferenceSettings();
		if (localSettings.enabled && localSettings.preloadOnStartup) {
			// Slight delay so we don't compete with the initial app render.
			setTimeout(() => {
				preloadPipeline('transcribe', whisperModelId(localSettings.whisperModel), {
					dtype: 'fp32'
				});
				if (localSettings.textModelEnabled) {
					preloadPipeline('text-generation', textModelId(localSettings.textModel));
				}
				if (localSettings.embedModelEnabled) {
					preloadPipeline('embed', embedModelId(localSettings.embedModel));
				}
			}, 1500);
		}

		checkMobile();

		// Check for sidebar=open query parameter (from read mode)
		if ($page.url.searchParams.get('sidebar') === 'open') {
			sidebarOpen = true;
			// Clear the query parameter from URL
			goto('/', { replaceState: true });
		}

		window.addEventListener('resize', checkMobile);
		window.addEventListener('keydown', handleKeydown);

		// Auto-lock on idle when PIN is set
		if (hasPinSet()) {
			let idleTimer: ReturnType<typeof setTimeout> | null = null;
			const resetIdle = () => {
				if (idleTimer) clearTimeout(idleTimer);
				const mins = $autoLockMinutes;
				if (mins > 0 && !$isLocked) {
					idleTimer = setTimeout(() => lock(), mins * 60 * 1000);
				}
			};
			window.addEventListener('mousemove', resetIdle);
			window.addEventListener('keydown', resetIdle);
			window.addEventListener('touchstart', resetIdle);
			resetIdle();
			// Lock on visibility hidden (e.g. switching tabs)
			document.addEventListener('visibilitychange', () => {
				if (document.visibilityState === 'hidden' && hasPinSet()) lock();
			});
		}

		// Listen for voice/meeting capture requests from note pages
		const handleVoiceMemoEvent = () => {
			showVoiceCapture = true;
			captureMode = 'voice-memo';
		};
		const handleMeetingEvent = () => {
			showVoiceCapture = true;
			captureMode = 'meeting';
		};
		window.addEventListener('kurumi-voice-memo', handleVoiceMemoEvent);
		window.addEventListener('kurumi-meeting', handleMeetingEvent);

		// Periodic + visibility-triggered recurring rollover so long-lived
		// tabs don't miss rollover just because they never reloaded.
		// One hour is well under the shortest recurrence granularity
		// (daily), and the function is idempotent so extra calls are free.
		// The visibility listener also fires when the laptop wakes from
		// sleep, catching up anything that drifted while the timer was
		// paused by the browser's background throttling.
		const rolloverTick = () => {
			rolloverRecurringActionItems();
		};
		const ROLLOVER_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
		const rolloverInterval = window.setInterval(rolloverTick, ROLLOVER_INTERVAL_MS);
		const handleVisibility = () => {
			if (document.visibilityState === 'visible') {
				rolloverTick();
			}
		};
		document.addEventListener('visibilitychange', handleVisibility);

		return () => {
			window.removeEventListener('resize', checkMobile);
			window.removeEventListener('keydown', handleKeydown);
			window.removeEventListener('kurumi-voice-memo', handleVoiceMemoEvent);
			window.removeEventListener('kurumi-meeting', handleMeetingEvent);
			document.removeEventListener('visibilitychange', handleVisibility);
			window.clearInterval(rolloverInterval);
			teardownVisibilitySync();
			teardownAutoSync();
			cleanupHashRouter?.();
			stopNotificationLoop();
			stopDueCacheSync();
		};
	});

	// Rebuild search index when memories change
	$effect(() => {
		// Track length to trigger rebuild
		const count = $memoryObjects.length;
		if (initialized && count >= 0) {
			rebuildIndex();
		}
	});

	async function handleNewNote() {
		const memory = addMemoryObject();
		if (isMobile) sidebarOpen = false;
		await goto(`/memory/${memory.id}`);
		showNewNoteAnimation = true;
	}

	async function handleNewNoteInFolder(folderId: string | null) {
		const memory = addMemoryObject(undefined, undefined, folderId);
		if (isMobile) sidebarOpen = false;
		await goto(`/memory/${memory.id}`);
		showNewNoteAnimation = true;
	}

	function handleNoteClick() {
		if (isMobile) sidebarOpen = false;
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
			class:hidden={$focusMode && !isMobile}
			style="transition: transform 250ms cubic-bezier(0.4, 0, 0.2, 1); --sidebar-width: {sidebarWidth}px; width: {isMobile ? undefined : `${sidebarWidth}px`};"
			role="navigation"
			aria-label="Main navigation"
		>
			<!-- Logo -->
			<div
				class="flex min-h-16 items-center justify-between border-b border-[var(--color-border)] px-4 py-2 safe-top md:min-h-0 md:py-2"
			>
				<div class="flex items-center gap-2">
					<a href="/" class="shrink-0" aria-label="Go to home" onclick={() => { if (isMobile) sidebarOpen = false; }}>
						<img src="/icon-192.avif" alt="Kurumi" class="h-11 w-11 rounded" />
					</a>
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

			<!-- New Note + Voice Memo Buttons -->
			<div class="space-y-2 p-3">
				<button
					type="button"
					onclick={handleNewNote}
					class="flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--color-accent)] px-4 py-3 text-white transition-colors hover:bg-[var(--color-accent-hover)] active:scale-[0.98]"
				>
					<Plus class="h-5 w-5" />
					New Note
				</button>
				<!-- Voice/meeting buttons moved to the in-note toolbar -->
			</div>

			<!-- Search + Today + Actions -->
			<div class="space-y-2 p-3 pt-0 md:pt-3">
				<button
					onclick={openSearch}
					class="flex w-full items-center justify-between rounded-lg border border-[var(--color-border)] px-3 py-2 text-[var(--color-text-muted)] transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-text)]"
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
				<div class="grid grid-cols-3 gap-1.5">
					<a
						href="/inbox"
						onclick={handleNoteClick}
						class="relative flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-2 py-2 text-[var(--color-text-muted)] transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-text)]"
						title="Inbox"
					>
						<Inbox class="h-4 w-4 shrink-0" />
						<span class="text-xs truncate">Inbox</span>
					</a>
					<a
						href="/calendar"
						onclick={handleNoteClick}
						class="flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-2 py-2 text-[var(--color-text-muted)] transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-text)]"
						title="Calendar"
					>
						<Calendar class="h-4 w-4 shrink-0" />
						<span class="text-xs truncate">Calendar</span>
					</a>
					<a
						href="/daily"
						onclick={handleNoteClick}
						class="flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-2 py-2 text-[var(--color-text-muted)] transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-text)]"
						title="Today's daily note"
					>
						<CalendarDays class="h-4 w-4 shrink-0" />
						<span class="text-xs truncate">Today</span>
					</a>
					<a
						href="/actions"
						onclick={handleNoteClick}
						class="relative flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-2 py-2 text-[var(--color-text-muted)] transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-text)]"
						title="Action items"
					>
						<CheckSquare class="h-4 w-4 shrink-0" />
						<span class="text-xs truncate">Actions</span>
						{#if $actionItems.filter((i) => i.status === 'open').length > 0}
							<span class="ml-auto rounded-full bg-[var(--color-accent)] px-1 text-[10px] font-medium text-white">
								{$actionItems.filter((i) => i.status === 'open').length}
							</span>
						{/if}
					</a>
					<a
						href="/proposals"
						onclick={handleNoteClick}
						class="relative flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-2 py-2 text-[var(--color-text-muted)] transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-text)]"
						title="Reminder proposals"
					>
						<Bell class="h-4 w-4 shrink-0" />
						<span class="text-xs truncate">Proposals</span>
						{#if $reminderProposals.filter((p) => p.status === 'pending').length > 0}
							<span class="ml-auto rounded-full bg-yellow-500 px-1 text-[10px] font-medium text-white">
								{$reminderProposals.filter((p) => p.status === 'pending').length}
							</span>
						{/if}
					</a>
					<a
						href="/drafts"
						onclick={handleNoteClick}
						class="flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-2 py-2 text-[var(--color-text-muted)] transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-text)]"
						title="Draft proposals"
					>
						<Pencil class="h-4 w-4 shrink-0" />
						<span class="text-xs truncate">Drafts</span>
					</a>
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
										aria-selected="false"
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

			<!-- Saved searches -->
			{#if $savedSearches.length > 0}
				<div class="border-b border-[var(--color-border)] px-3 py-2">
					<div class="mb-1 text-xs font-medium uppercase text-[var(--color-text-muted)]">
						Saved searches
					</div>
					{#each $savedSearches as saved (saved.id)}
						<a
							href="/?q={encodeURIComponent(saved.query)}"
							onclick={handleNoteClick}
							class="flex items-center gap-2 rounded-md px-2 py-1 text-sm text-[var(--color-text-muted)] hover:bg-[var(--color-bg-secondary)] hover:text-[var(--color-text)]"
						>
							{#if saved.icon}
								<span>{saved.icon}</span>
							{:else}
								<Search class="h-3 w-3" />
							{/if}
							<span class="truncate">{saved.name}</span>
						</a>
					{/each}
				</div>
			{/if}

			<!-- Notes List -->
			<nav class="flex-1 overflow-y-auto overscroll-contain p-2" aria-label="Notes list">
				<FolderTree
							onNoteClick={handleNoteClick}
							onNoteCreate={() => showNewNoteAnimation = true}
							onNewNoteInFolder={handleNewNoteInFolder}
							onFolderCreate={() => showNewFolderAnimation = true}
							onNoteDelete={(name) => deleteNoteSnackbar = name}
							onFolderDelete={(name) => deleteFolderSnackbar = name}
						/>
			</nav>

			<!-- Sync Status (clickable to force sync, or open conflict modal) -->
			{#if showSyncStatus}
				<button
					onclick={() => {
						if ($syncIndicator.status === 'conflict') {
							showConflictModal = true;
						} else {
							sync();
						}
					}}
					disabled={$syncIndicator.status === 'syncing'}
					class="flex w-full items-center gap-2 border-t border-[var(--color-border)] px-3 py-2 text-left transition-colors hover:bg-[var(--color-border)] disabled:opacity-70"
					title={$syncIndicator.status === 'conflict' ? 'Resolve conflicts' : 'Click to sync'}
				>
					{#if $syncIndicator.status === 'conflict'}
						<AlertCircle class="h-4 w-4 text-yellow-500" />
						<span class="text-xs text-yellow-500">
							{$syncIndicator.conflictCount} conflict{$syncIndicator.conflictCount === 1 ? '' : 's'}
						</span>
					{:else if $syncIndicator.status === 'syncing'}
						<RefreshCw class="h-4 w-4 animate-spin text-[var(--color-accent)]" />
						<span class="text-xs text-[var(--color-text-muted)]">Syncing...</span>
					{:else if $syncIndicator.status === 'success'}
						<CheckCircle class="h-4 w-4 text-green-500" />
						<span class="text-xs text-[var(--color-text-muted)]">Synced</span>
					{:else if $syncIndicator.status === 'error'}
						<AlertCircle class="h-4 w-4 text-red-500" />
						<span class="text-xs text-red-500">{$syncIndicator.error || 'Sync failed'}</span>
					{:else}
						<Cloud class="h-4 w-4 text-[var(--color-text-muted)]" />
						<span class="text-xs text-[var(--color-text-muted)]">Sync ready</span>
					{/if}
				</button>
			{/if}

			<!-- Footer -->
			<div class="border-t border-[var(--color-border)] p-2 safe-bottom">
				<div class="grid grid-cols-6 gap-1">
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
							href={currentNoteId ? `/memory/${currentNoteId}` : '/'}
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
					<button
						onclick={() => (showAgentPane = !showAgentPane)}
						class="flex flex-col items-center gap-1 rounded-lg px-2 py-2 transition-colors hover:bg-[var(--color-border)] {showAgentPane ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}"
						title="Kurumi Agent (⌘`)"
					>
						<Bot class="h-5 w-5" />
						<span class="text-xs">Agent</span>
					</button>
					<a
						href="/trash"
						onclick={handleNoteClick}
						class="relative flex flex-col items-center gap-1 rounded-lg px-2 py-2 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-border)] hover:text-[var(--color-text)]"
					>
						<Trash2 class="h-5 w-5" />
						<span class="text-xs">Trash</span>
						{#if $trashCount > 0}
							<span class="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--color-accent)] px-1 text-[10px] font-medium text-white">
								{$trashCount > 99 ? '99+' : $trashCount}
							</span>
						{/if}
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

		<!-- Main Content -->
		<main class="relative flex flex-1 flex-col" class:overflow-hidden={!isReadMode} aria-label="Main content">
			<!-- Tab bar (recently-opened memories) -->
			{#if $openTabs.length > 0 && !$focusMode}
				<div class="tab-bar">
					{#each $openTabs as tab, i (tab.id)}
						<a
							href="/memory/{tab.id}"
							class="tab-item"
							class:tab-active={$page.url.pathname === `/memory/${tab.id}`}
							draggable="true"
							ondragstart={(e) => { e.dataTransfer?.setData('text/plain', String(i)); e.dataTransfer!.effectAllowed = 'move'; }}
							ondragover={(e) => e.preventDefault()}
							ondrop={(e) => { e.preventDefault(); const from = parseInt(e.dataTransfer?.getData('text/plain') ?? '-1', 10); if (from >= 0) moveTab(from, i); }}
						>
							<span class="truncate">{tab.title}</span>
							<button
								class="tab-close"
								onclick={(e) => { e.preventDefault(); e.stopPropagation(); closeTab(tab.id); }}
								aria-label="Close tab"
							>
								<X class="h-3 w-3" />
							</button>
						</a>
					{/each}
				</div>
			{/if}

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
						<ListTree class="h-6 w-6" />
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
					onclick={openSearch}
					class="rounded-lg p-2 text-[var(--color-accent)] transition-colors hover:bg-[var(--color-border)]"
					aria-label="Search"
					title="Search"
				>
					<Search class="h-6 w-6" />
				</button>
			</header>
			{/if}

			<FocusTimer />
			<div class="flex-1" class:overflow-hidden={!isReadMode} class:overflow-auto={isReadMode}>
				{@render children()}
			</div>
		</main>

		{#if showAgentPane}
			<AgentPane onClose={() => (showAgentPane = false)} />
		{/if}
	</div>

	<!-- Command Palette -->
	{#if showSearch}
		<CommandPalette onClose={closeSearch} onShowTemplatePicker={() => (showTemplatePicker = true)} />
	{/if}

	<!-- Template Picker -->
	<TemplatePicker bind:open={showTemplatePicker} onClose={() => (showTemplatePicker = false)} />

	<!-- Voice Capture Modal -->
	<VoiceCaptureModal
		open={showVoiceCapture}
		mode={captureMode}
		onClose={() => (showVoiceCapture = false)}
	/>

	<!-- Hidden file input for "Upload audio/video file" command palette action -->
	<input
		bind:this={uploadFileInput}
		type="file"
		accept="audio/*,video/*"
		class="hidden"
		onchange={handleUploadFile}
	/>

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
	{#if deleteNoteSnackbar}
		<Snackbar
			message={`"${deleteNoteSnackbar}" moved to Trash`}
			resourceType="action"
			duration={2000}
			onClose={() => deleteNoteSnackbar = null}
		/>
	{/if}
	{#if deleteFolderSnackbar}
		<Snackbar
			message={`"${deleteFolderSnackbar}" moved to Trash`}
			resourceType="action"
			duration={2000}
			onClose={() => deleteFolderSnackbar = null}
		/>
	{/if}

	{#if showConflictModal}
		<GitConflictModal onClose={() => (showConflictModal = false)} />
	{/if}

	<UndoToast />
	<LockScreen />

	<!-- Floating sync sign + force-sync button (bottom-right) -->
	{#if !$isLocked}
		<SyncFab visible={showSyncStatus} onConflict={() => (showConflictModal = true)} />
	{/if}
{/if}

<style>
	.tab-bar {
		display: flex;
		align-items: stretch;
		gap: 1px;
		overflow-x: auto;
		border-bottom: 1px solid var(--color-border);
		background: var(--color-bg-secondary);
		padding: 0 0.375rem;
		scrollbar-width: none;
	}

	.tab-bar::-webkit-scrollbar {
		display: none;
	}

	.tab-item {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		max-width: 180px;
		padding: 0.5rem 0.75rem;
		font-size: 0.75rem;
		color: var(--color-text-muted);
		text-decoration: none;
		white-space: nowrap;
		border-bottom: 2px solid transparent;
		transition: color 0.1s, border-color 0.1s, background 0.1s;
		cursor: grab;
		user-select: none;
	}

	.tab-item:hover {
		background: var(--color-border);
		color: var(--color-text);
	}

	.tab-item.tab-active {
		color: var(--color-text);
		background: var(--color-bg);
		border-bottom-color: var(--color-accent);
	}

	.tab-item:active {
		cursor: grabbing;
	}

	.tab-close {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0.125rem;
		border: none;
		border-radius: 0.25rem;
		background: none;
		color: var(--color-text-muted);
		cursor: pointer;
		opacity: 0;
		transition: opacity 0.1s;
		flex-shrink: 0;
	}

	.tab-item:hover .tab-close {
		opacity: 1;
	}

	.tab-close:hover {
		background: var(--color-border);
		color: var(--color-text);
	}
</style>
