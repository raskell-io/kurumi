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
	import { initHashRouter, updateHashFromPath, currentRoutePath } from '$lib/hash-router';
	import { generateDailyDigest } from '$lib/digest';
	import { initSearch, rebuildIndex } from '$lib/search';
	import { setupVisibilitySync, teardownVisibilitySync, setupAutoSync, teardownAutoSync, isSyncConfigured } from '$lib/sync';
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
	import {
		X,
		Search,
		ChevronRight,
		GitFork,
		BookOpen,
		Settings,
		Pencil,
		Tag,
		Trash2,
		CalendarDays,
		CheckSquare,
		Bell,
		Bot,
		Inbox,
		Calendar,
		Sparkles,
		SquarePen,
		PanelLeftClose,
		PanelLeftOpen,
		Menu,
		Sun,
		Moon,
		Monitor
	} from 'lucide-svelte';
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
	let showTags = $state(false);
	let theme = $state<'light' | 'dark' | 'system'>('system');
	let sidebarCollapsed = $state(false);
	let showConflictModal = $state(false);
	let showAgentPane = $state(false);
	// Auto-open when a sync attempt surfaces conflicts.
	$effect(() => {
		if ($gitSyncState.status === 'conflict' && $gitSyncState.conflicts.length > 0) {
			showConflictModal = true;
		}
	});

	// Other pages still raise this signal after creating a note. Opening the
	// note is feedback enough, so just acknowledge it instead of toasting.
	$effect(() => {
		const unsubscribe = showNewNoteSnackbar.subscribe(value => {
			if (value) showNewNoteSnackbar.set(false);
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
	const MIN_SIDEBAR_WIDTH = 220;
	const MAX_SIDEBAR_WIDTH = 480;
	const DEFAULT_SIDEBAR_WIDTH = 272;
	let sidebarWidth = $state(DEFAULT_SIDEBAR_WIDTH);
	let isResizing = $state(false);

	// Check if we're in read mode
	let isReadMode = $derived(currentRoutePath($page.route.id, $page.params, $page.url.pathname).startsWith('/read'));

	// Get current note ID from path (for edit link in read mode)
	let currentNoteId = $derived.by(() => {
		const match = currentRoutePath($page.route.id, $page.params, $page.url.pathname).match(/^\/read\/([a-zA-Z0-9-]+)$/);
		return match ? match[1] : null;
	});

	// Get current memory ID from edit path
	let editNoteId = $derived.by(() => {
		const match = currentRoutePath($page.route.id, $page.params, $page.url.pathname).match(/^\/memory\/([a-zA-Z0-9-]+)$/);
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

	const modKey = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';

	type NavItem = {
		href: string;
		label: string;
		icon: typeof Search;
		hint?: string;
		count?: () => number;
		warn?: boolean;
	};

	let openActionCount = $derived($actionItems.filter((i) => i.status === 'open').length);
	let pendingProposalCount = $derived($reminderProposals.filter((p) => p.status === 'pending').length);

	const primaryNav: NavItem[] = [
		{ href: '/', label: 'Ask Kurumi', icon: Sparkles },
		{ href: '/daily', label: 'Today', icon: CalendarDays, hint: `Today's daily note (${modKey}D)` },
		{ href: '/inbox', label: 'Inbox', icon: Inbox, hint: `Inbox (${modKey}⇧I)` },
		{ href: '/calendar', label: 'Calendar', icon: Calendar, hint: `Calendar (${modKey}⇧C)` },
		{ href: '/actions', label: 'Actions', icon: CheckSquare, hint: `Action items (${modKey}⇧A)`, count: () => openActionCount },
		{ href: '/proposals', label: 'Proposals', icon: Bell, hint: 'Reminder proposals', count: () => pendingProposalCount, warn: true },
		{ href: '/drafts', label: 'Drafts', icon: Pencil, hint: 'Email & calendar drafts' }
	];

	let footerNav = $derived<NavItem[]>([
		{ href: '/graph', label: `Graph (${modKey}G)`, icon: GitFork },
		isReadMode
			? { href: currentNoteId ? `/memory/${currentNoteId}` : '/', label: 'Edit', icon: Pencil }
			: { href: '/read', label: `Read mode (${modKey}⇧R)`, icon: BookOpen },
		{ href: '/references', label: `References (${modKey}R)`, icon: Tag },
		{ href: '/trash', label: 'Trash', icon: Trash2 },
		{ href: '/settings', label: `Settings (${modKey},)`, icon: Settings }
	]);

	let currentPath = $derived(currentRoutePath($page.route.id, $page.params, $page.url.pathname));

	function isActive(href: string): boolean {
		const path = currentPath;
		if (href === '/') return path === '/';
		return path === href || path.startsWith(href + '/');
	}

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
		// Settings can change the theme too, so start from what's persisted.
		const saved = localStorage.getItem('kurumi-theme');
		if (saved === 'light' || saved === 'dark' || saved === 'system') theme = saved;
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
		// App-level shortcuts that should work even while writing
		if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
			if (e.key === '\\') {
				e.preventDefault();
				toggleSidebar();
				return;
			}
			if (e.key === 'k') {
				e.preventDefault();
				showSearch = !showSearch;
				return;
			}
			if (e.key === 'n') {
				e.preventDefault();
				handleNewNote();
				return;
			}
		}

		// Don't trigger other shortcuts when typing in inputs
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
				if (currentPath !== '/') {
					goto('/');
				}
				triggerVoiceAssistant.update((n) => n + 1);
				if (isMobile) sidebarOpen = false;
				return;
			}

			switch (e.key) {
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

		sidebarCollapsed = localStorage.getItem('kurumi-sidebar-collapsed') === '1';

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
	}

	async function handleNewNoteInFolder(folderId: string | null) {
		const memory = addMemoryObject(undefined, undefined, folderId);
		if (isMobile) sidebarOpen = false;
		await goto(`/memory/${memory.id}`);
	}

	function handleNoteClick() {
		if (isMobile) sidebarOpen = false;
	}

	function toggleSidebar() {
		if (isMobile) {
			sidebarOpen = !sidebarOpen;
			return;
		}
		sidebarCollapsed = !sidebarCollapsed;
		localStorage.setItem('kurumi-sidebar-collapsed', sidebarCollapsed ? '1' : '0');
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
	<div class="boot-screen flex h-[100dvh] items-center justify-center bg-[var(--color-bg)]">
		<div class="flex flex-col items-center gap-4">
			<img src="/icon-192.avif" alt="Kurumi" class="h-14 w-14 rounded-xl" />
			<div class="h-0.5 w-24 overflow-hidden rounded-full bg-[var(--color-border)]">
				<div class="boot-bar h-full w-1/3 rounded-full bg-[var(--color-accent)]"></div>
			</div>
		</div>
	</div>
{:else}
	<div class="flex h-[100dvh] bg-[var(--color-bg)]">
		<!-- Mobile overlay -->
		{#if isMobile && sidebarOpen}
			<button
				class="animate-backdrop fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]"
				onclick={() => (sidebarOpen = false)}
				aria-label="Close sidebar"
			></button>
		{/if}

		<!-- Sidebar -->
		<aside
			class="sidebar fixed inset-y-0 left-0 z-50 flex w-[85vw] max-w-[340px] flex-col bg-[var(--color-bg-secondary)] md:relative md:z-auto md:max-w-none md:border-r md:border-[var(--color-border)] {sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}"
			class:hidden={($focusMode || sidebarCollapsed) && !isMobile}
			class:shadow-2xl={isMobile}
			style="transition: transform 250ms cubic-bezier(0.4, 0, 0.2, 1); width: {isMobile ? undefined : `${sidebarWidth}px`};"
			role="navigation"
			aria-label="Main navigation"
		>
			<!-- Header: vault + quick actions -->
			<div class="flex items-center gap-1 px-2 pb-1 pt-2 safe-top">
				<a href="/" class="shrink-0 rounded-md p-1 hover:bg-[var(--color-hover)]" aria-label="Go to home" onclick={handleNoteClick}>
					<img src="/icon-192.avif" alt="" class="h-6 w-6 rounded-md" />
				</a>
				<div class="min-w-0 flex-1">
					<VaultSelector />
				</div>
				<button
					onclick={handleNewNote}
					class="k-icon-btn"
					title="New note ({modKey}N)"
					aria-label="New note"
				>
					<SquarePen class="h-4 w-4" />
				</button>
				{#if isMobile}
					<button onclick={() => (sidebarOpen = false)} class="k-icon-btn" aria-label="Close sidebar">
						<X class="h-4 w-4" />
					</button>
				{:else}
					<button
						onclick={toggleSidebar}
						class="k-icon-btn"
						title={'Collapse sidebar (' + modKey + '\\)'}
						aria-label="Collapse sidebar"
					>
						<PanelLeftClose class="h-4 w-4" />
					</button>
				{/if}
			</div>

			<div class="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
				<!-- Primary navigation -->
				<div class="space-y-px px-2 py-1">
					<button onclick={openSearch} class="nav-row w-full">
						<Search class="nav-icon" />
						<span class="flex-1 truncate text-left">Search</span>
						<span class="k-kbd hidden md:inline-flex">{modKey}K</span>
					</button>
					{#each primaryNav as item (item.href)}
						{@const count = item.count?.() ?? 0}
						<a
							href={item.href}
							onclick={handleNoteClick}
							class="nav-row"
							class:nav-row-active={isActive(item.href)}
							aria-current={isActive(item.href) ? 'page' : undefined}
							title={item.hint}
						>
							<item.icon class="nav-icon" />
							<span class="flex-1 truncate">{item.label}</span>
							{#if count > 0}
								<span class="nav-count" class:nav-count-warn={item.warn}>{count > 99 ? '99+' : count}</span>
							{/if}
						</a>
					{/each}
				</div>

				<!-- Tags -->
				{#if allTags.length > 0}
					<div class="px-2 pt-3">
						<button
							onclick={() => (showTags = !showTags)}
							class="section-label w-full"
							aria-expanded={showTags}
							aria-controls="tags-list"
						>
							<ChevronRight class="h-3 w-3 transition-transform {showTags ? 'rotate-90' : ''}" aria-hidden="true" />
							Tags
						</button>
						{#if showTags}
							<div id="tags-list" class="flex flex-wrap gap-1 px-1.5 pb-1 pt-1">
								{#each allTags.slice(0, 16) as { tag, count }}
									<a
										href="/read/tag/{encodeURIComponent(tag)}"
										onclick={handleNoteClick}
										class="rounded-md px-1.5 py-0.5 text-xs text-[var(--color-text-muted)] hover:bg-[var(--color-hover)] hover:text-[var(--color-text)]"
										aria-label="Notes tagged {tag}, {count} notes"
									>
										#{tag}<span class="ml-1 text-[var(--color-text-faint)]" aria-hidden="true">{count}</span>
									</a>
								{/each}
								{#if allTags.length > 16}
									<a href="/tags" onclick={handleNoteClick} class="rounded-md px-1.5 py-0.5 text-xs text-[var(--color-text-faint)] hover:bg-[var(--color-hover)] hover:text-[var(--color-text)]">
										All tags →
									</a>
								{/if}
							</div>
						{/if}
					</div>
				{/if}

				<!-- Saved searches -->
				{#if $savedSearches.length > 0}
					<div class="px-2 pt-3">
						<div class="section-label">Saved searches</div>
						{#each $savedSearches as saved (saved.id)}
							<a
								href="/?q={encodeURIComponent(saved.query)}"
								onclick={handleNoteClick}
								class="nav-row"
							>
								{#if saved.icon}
									<span class="nav-icon flex items-center justify-center text-sm leading-none">{saved.icon}</span>
								{:else}
									<Search class="nav-icon" />
								{/if}
								<span class="truncate">{saved.name}</span>
							</a>
						{/each}
					</div>
				{/if}

				<!-- Notes tree -->
				<nav class="flex-1 px-2 pb-2 pt-3" aria-label="Notes list">
					<FolderTree
						onNoteClick={handleNoteClick}
						onNewNoteInFolder={handleNewNoteInFolder}
					/>
				</nav>
			</div>

			<!-- Footer -->
			<div class="flex items-center justify-between gap-0.5 border-t border-[var(--color-border)] px-2 py-1.5 safe-bottom">
				{#each footerNav as item (item.label)}
					<a
						href={item.href}
						onclick={handleNoteClick}
						class="k-icon-btn relative"
						class:footer-active={isActive(item.href)}
						title={item.label}
						aria-label={item.label}
					>
						<item.icon class="h-4 w-4" />
						{#if item.label === 'Trash' && $trashCount > 0}
							<span class="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-[var(--color-accent)]"></span>
						{/if}
					</a>
				{/each}
				<button
					onclick={() => (showAgentPane = !showAgentPane)}
					class="k-icon-btn"
					class:footer-active={showAgentPane}
					title={'Kurumi Agent (' + modKey + '`)'}
					aria-label="Kurumi Agent"
					aria-pressed={showAgentPane}
				>
					<Bot class="h-4 w-4" />
				</button>
				<button
					onclick={cycleTheme}
					class="k-icon-btn"
					title="Theme: {theme} (click to change)"
					aria-label="Change theme, currently {theme}"
				>
					{#if theme === 'light'}
						<Sun class="h-4 w-4" />
					{:else if theme === 'dark'}
						<Moon class="h-4 w-4" />
					{:else}
						<Monitor class="h-4 w-4" />
					{/if}
				</button>
			</div>
		</aside>

		<!-- Resize handle (desktop only) -->
		{#if !isMobile && !sidebarCollapsed && !$focusMode}
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="group relative z-10 -ml-1.5 flex w-1.5 shrink-0 cursor-col-resize justify-center"
				onmousedown={startResize}
				ondblclick={() => { sidebarWidth = DEFAULT_SIDEBAR_WIDTH; localStorage.setItem('kurumi-sidebar-width', String(sidebarWidth)); }}
				title="Drag to resize · double-click to reset"
			>
				<div
					class="h-full w-px transition-colors delay-100 group-hover:bg-[var(--color-accent)]"
					class:bg-[var(--color-accent)]={isResizing}
				></div>
			</div>
		{/if}

		<!-- Main Content -->
		<main class="relative flex min-w-0 flex-1 flex-col" class:overflow-hidden={!isReadMode} aria-label="Main content">
			<!-- Tab bar (recently-opened memories) -->
			{#if !$focusMode && !isMobile && ($openTabs.length > 0 || sidebarCollapsed)}
				<div class="tab-bar">
					{#if sidebarCollapsed}
						<button
							onclick={toggleSidebar}
							class="k-icon-btn my-auto mr-1"
							title={'Expand sidebar (' + modKey + '\\)'}
							aria-label="Expand sidebar"
						>
							<PanelLeftOpen class="h-4 w-4" />
						</button>
					{/if}
					{#each $openTabs as tab, i (tab.id)}
						<a
							href="/memory/{tab.id}"
							class="tab-item"
							class:tab-active={currentPath === `/memory/${tab.id}`}
							draggable="true"
							ondragstart={(e) => { e.dataTransfer?.setData('text/plain', String(i)); e.dataTransfer!.effectAllowed = 'move'; }}
							ondragover={(e) => e.preventDefault()}
							ondrop={(e) => { e.preventDefault(); const from = parseInt(e.dataTransfer?.getData('text/plain') ?? '-1', 10); if (from >= 0) moveTab(from, i); }}
							onauxclick={(e) => { if (e.button === 1) { e.preventDefault(); closeTab(tab.id); } }}
						>
							<span class="truncate">{tab.title || 'Untitled'}</span>
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
				class="flex items-center justify-between gap-1 border-b border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1.5 safe-top md:hidden"
			>
				<div class="flex min-w-0 flex-1 items-center gap-1">
					<button
						onclick={toggleSidebar}
						class="shrink-0 rounded-lg p-2 text-[var(--color-text-muted)] hover:bg-[var(--color-hover)]"
						aria-label="Open sidebar"
					>
						<Menu class="h-5 w-5" />
					</button>
					{#if breadcrumb && breadcrumb.length > 0}
						<div class="flex min-w-0 items-center gap-1 text-sm text-[var(--color-text-muted)]">
							{#each breadcrumb as segment, i}
								{#if i > 0}
									<span class="shrink-0 text-[var(--color-text-faint)]">/</span>
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
					class="rounded-lg p-2 text-[var(--color-text-muted)] hover:bg-[var(--color-hover)]"
					aria-label="Search"
					title="Search"
				>
					<Search class="h-5 w-5" />
				</button>
				<button
					type="button"
					onclick={handleNewNote}
					class="rounded-lg p-2 text-[var(--color-text-muted)] hover:bg-[var(--color-hover)]"
					aria-label="New note"
					title="New note"
				>
					<SquarePen class="h-5 w-5" />
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
	/* Boot screen: only reveal after a beat so fast boots don't flash */
	.boot-screen {
		animation: fadeIn 300ms var(--ease-out) 150ms both;
	}

	.boot-bar {
		animation: boot-slide 1.1s var(--ease-in-out) infinite;
	}

	@keyframes boot-slide {
		from { transform: translateX(-100%); }
		to { transform: translateX(300%); }
	}

	/* Sidebar navigation rows */
	.nav-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-height: 1.875rem;
		padding: 0 0.5rem;
		border-radius: var(--radius-sm);
		font-size: 0.8125rem;
		color: var(--color-text-muted);
		text-decoration: none;
	}

	.nav-row:hover {
		background: var(--color-hover);
		color: var(--color-text);
	}

	.nav-row-active {
		background: var(--color-active);
		color: var(--color-text);
		font-weight: 500;
	}

	.nav-row :global(.nav-icon) {
		width: 1rem;
		height: 1rem;
		flex-shrink: 0;
		opacity: 0.85;
	}

	.nav-count {
		min-width: 1.25rem;
		padding: 0 0.3125rem;
		border-radius: 999px;
		background: var(--color-accent-soft);
		color: var(--color-accent);
		font-size: 0.6875rem;
		font-weight: 600;
		line-height: 1.125rem;
		text-align: center;
		font-variant-numeric: tabular-nums;
	}

	.nav-count-warn {
		background: color-mix(in srgb, #df8e1d 18%, transparent);
		color: #df8e1d;
	}

	.section-label {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.25rem 0.5rem;
		border-radius: var(--radius-sm);
		font-size: 0.6875rem;
		font-weight: 600;
		letter-spacing: 0.02em;
		color: var(--color-text-faint);
	}

	button.section-label:hover {
		background: var(--color-hover);
		color: var(--color-text-muted);
	}

	.footer-active {
		background: var(--color-active);
		color: var(--color-text);
	}

	/* Mobile: larger touch rows */
	@media (hover: none) and (pointer: coarse) {
		.nav-row {
			min-height: 2.5rem;
			font-size: 0.9375rem;
		}
	}

	/* Tab bar */
	.tab-bar {
		display: flex;
		align-items: stretch;
		gap: 0.125rem;
		height: 2.375rem;
		flex-shrink: 0;
		overflow-x: auto;
		border-bottom: 1px solid var(--color-border);
		background: var(--color-bg-secondary);
		padding: 0.3125rem 0.5rem 0;
		scrollbar-width: none;
	}

	.tab-bar::-webkit-scrollbar {
		display: none;
	}

	.tab-item {
		position: relative;
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		max-width: 200px;
		min-width: 0;
		padding: 0 0.375rem 0 0.75rem;
		font-size: 0.75rem;
		color: var(--color-text-muted);
		text-decoration: none;
		white-space: nowrap;
		border: 1px solid transparent;
		border-bottom: none;
		border-radius: var(--radius-md) var(--radius-md) 0 0;
		user-select: none;
	}

	.tab-item:hover {
		background: var(--color-hover);
		color: var(--color-text);
	}

	.tab-item.tab-active {
		color: var(--color-text);
		background: var(--color-bg);
		border-color: var(--color-border);
		margin-bottom: -1px;
	}

	.tab-close {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.125rem;
		height: 1.125rem;
		border-radius: 0.25rem;
		color: var(--color-text-muted);
		cursor: pointer;
		opacity: 0;
		flex-shrink: 0;
		min-width: 0;
		min-height: 0;
	}

	.tab-item:hover .tab-close,
	.tab-item.tab-active .tab-close {
		opacity: 1;
	}

	.tab-close:hover {
		background: var(--color-active);
		color: var(--color-text);
	}
</style>
