<script lang="ts">
	import '../app.css';
	import { pwaInfo } from 'virtual:pwa-info';
	import { onMount, tick } from 'svelte';
	import { afterNavigate } from '$app/navigation';
	import { flip } from 'svelte/animate';
	import { fitTabs } from '$lib/tab-strip';
	import { armMotion, collapse, flipParams, pageEnter, panelSlide, popOut, tabIn } from '$lib/motion';
	import {
		initDB,
		memoryObjects,
		addMemoryObject,
		getAllTags,
		folders,
		trashCount,
		actionItems,
		reminderProposals,
		rolloverRecurringActionItems,
		savedSearches,
		favoriteMemoryObjects,
		questions,
		vaultNeedsNewerApp,
		todayIso,
		currentVaultCaps,
		canCreateNotes
	} from '$lib/db';
	import { isTauri } from '$lib/desktop';
	import { openLinkedVault } from '$lib/linked/backend';
	import { getActiveLinkedVaultId, getLinkedVault } from '$lib/linked/config';
	import { showNotice } from '$lib/stores/notice';
	import LinkedVaultNotice from '$lib/components/LinkedVaultNotice.svelte';
	import { myNames, isWaitingFor } from '$lib/work';
	import { importRecording } from '$lib/incoming';
	import { bootPwa } from '$lib/pwa-boot';
	import { restoreStashedEdits } from '$lib/unsaved';
	import { initHashRouter, updateHashFromPath, currentRoutePath } from '$lib/hash-router';
	import { generateDailyDigest } from '$lib/digest';
	import { maybeAutoWeeklyReview } from '$lib/weekly-review';
	import { maybeUpdateLivingNotes } from '$lib/living-notes';
	import { runDueWorkflows } from '$lib/workflows';
	import { startPlugins } from '$lib/plugins/host';
	import { initSearch, syncIndex } from '$lib/search';
	import { setupVisibilitySync, teardownVisibilitySync, setupAutoSync, teardownAutoSync, isSyncConfigured } from '$lib/sync';
	import SyncFab from '$lib/components/SyncFab.svelte';
	import { gitSyncState } from '$lib/git/status';
	import GitConflictModal from '$lib/components/GitConflictModal.svelte';
	import UndoToast from '$lib/components/UndoToast.svelte';
	import UpdateToast from '$lib/components/UpdateToast.svelte';
	import NoticeToast from '$lib/components/NoticeToast.svelte';
	import FocusTimer from '$lib/components/FocusTimer.svelte';
	import LockScreen from '$lib/components/LockScreen.svelte';
	import { lockEnabled, isLocked, lock, autoLockMinutes, hasPinSet } from '$lib/stores/lock';
	import { undoLast } from '$lib/stores/undo';
	import {
		focusMode,
		toggleFocusMode,
		openTabs,
		pinTab,
		unpinTab,
		togglePinTab,
		moveTabTo,
		noteBarSlot,
		touchTab,
		touchRecent,
		closeTab,
		splitNoteId,
		closeSplit
	} from '$lib/stores/workspace';
	import ImageViewer from '$lib/components/ImageViewer.svelte';
	import PdfViewer from '$lib/components/PdfViewer.svelte';
	import { labsEnabled, LAB_PAGES } from '$lib/stores/labs';
	import { matchShortcut, type ShortcutId } from '$lib/shortcuts';
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
	// Loaded on demand (fetched once the app is idle, so ⌘K still opens at once):
	// they're big and most page views never open them.
	const loadCommandPalette = () => import('$lib/components/CommandPalette.svelte');
	const loadAgentPane = () => import('$lib/components/AgentPane.svelte');
	import FolderTree from '$lib/components/FolderTree.svelte';
	import VaultSelector from '$lib/components/VaultSelector.svelte';
	import NoteIcon from '$lib/components/NoteIcon.svelte';
	import TemplatePicker from '$lib/components/TemplatePicker.svelte';
	import VoiceCaptureModal from '$lib/components/VoiceCaptureModal.svelte';
	import {
		X,
		Search,
		ChevronRight,
		MoreHorizontal,
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
		FlaskConical,
		FolderKanban,
		CalendarClock,
		Gavel,
		HelpCircle,
		Sun,
		Moon,
		Monitor,
		Pin,
		Layers
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
		if (!file || !canCreateNotes('capture')) return;

		uploadingFile = true;
		try {
			await goto(`/memory/${await importRecording(file)}`);
		} catch (err) {
			console.error('Upload failed:', err);
		} finally {
			uploadingFile = false;
			input.value = '';
		}
	}
	let showTags = $state(false);
	let showFavorites = $state(true);
	let showLabs = $state(false);
	let theme = $state<'light' | 'dark' | 'system'>('system');
	let sidebarCollapsed = $state(false);
	let showConflictModal = $state(false);
	let showAgentPane = $state(false);
	let livingTimer: ReturnType<typeof setInterval> | undefined;
	let workflowTimer: ReturnType<typeof setInterval> | undefined;
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
				showVoiceCapture = canCreateNotes('capture');
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
				showVoiceCapture = canCreateNotes('capture');
				triggerMeetingCapture.set(false);
			}
		});
		return unsubscribe;
	});

	// Subscribe to upload-recording trigger — open the hidden file picker
	$effect(() => {
		const unsubscribe = triggerUploadRecording.subscribe((value) => {
			if (value) {
				if (canCreateNotes('capture')) uploadFileInput?.click();
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

	// Split view sits next to a note. Opening the split's note in the main
	// pane closes the split, so one note is never edited in two places.
	// The top bar: tabs, and on a note its controls. There whenever it has
	// something to hold, so its height never comes and goes between a note
	// and another page while tabs are open.
	let showTabBar = $derived(!$focusMode && !isMobile && ($openTabs.length > 0 || sidebarCollapsed || !!editNoteId));

	// Tabs that fit, and the ones stacked behind the "N more" control.
	let tabArea: HTMLElement | undefined = $state();
	let tabAreaWidth = $state(0);
	$effect(() => {
		const el = tabArea;
		if (!el) return;
		// Sidebar, split note, assistant, window, or the controls beside the tabs changing width.
		const observer = new ResizeObserver(() => (tabAreaWidth = el.clientWidth));
		observer.observe(el);
		tabAreaWidth = el.clientWidth;
		return () => observer.disconnect();
	});
	let fitted = $derived(fitTabs($openTabs, editNoteId, tabAreaWidth));

	function folderNames(folderId: string | null): string[] {
		const names: string[] = [];
		let id = folderId;
		for (let depth = 0; id && depth < 32; depth++) {
			const folder = $folders.find((f) => f.id === id);
			if (!folder) break;
			names.unshift(folder.name);
			id = folder.parentId;
		}
		return names;
	}
	/** "Folder / Sub" of a tab's note, for the stack list. */
	const tabFolder = (tab: { folderId: string | null }) => folderNames(tab.folderId).join(' / ');
	/** A tab's tooltip: where the note is, then its title. */
	const tabPath = (tab: { title: string; folderId: string | null }) => [...folderNames(tab.folderId), tab.title || 'Untitled'].join(' / ');

	// The note's controls give way on a narrow bar: folder first, then the word count, then "Edited …".
	let barWidth = $state(0);

	let showTabStack = $state(false);
	let stackButton: HTMLButtonElement | undefined = $state();
	let stackMenu: HTMLElement | undefined = $state();
	const stackItems = () => [...(stackMenu?.querySelectorAll<HTMLElement>('.tab-stack-item') ?? [])];
	function openTabStack() {
		showTabStack = true;
		// Focus goes in at once, not after the menu has arrived.
		tick().then(() => stackItems()[0]?.focus());
	}
	function closeTabStack(refocus = true) {
		showTabStack = false;
		if (refocus) stackButton?.focus();
	}
	function closeStackedTab(id: string) {
		const items = stackItems();
		const at = items.findIndex((el) => el.dataset.tabId === id);
		closeTab(id);
		tick().then(() => {
			const left = stackItems();
			if (left.length === 0) closeTabStack();
			else left[Math.min(at, left.length - 1)]?.focus();
		});
	}
	function stackKeydown(e: KeyboardEvent) {
		const items = stackItems();
		const at = items.indexOf(document.activeElement as HTMLElement);
		if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
			e.preventDefault();
			const next = e.key === 'ArrowDown' ? (at + 1) % items.length : (at - 1 + items.length) % items.length;
			items[next]?.focus();
		} else if (e.key === 'Home' || e.key === 'End') {
			e.preventDefault();
			items[e.key === 'Home' ? 0 : items.length - 1]?.focus();
		} else if ((e.key === 'Delete' || e.key === 'Backspace') && at >= 0) {
			e.preventDefault();
			closeStackedTab(items[at].dataset.tabId!);
		} else if (e.key === 'Escape') {
			e.preventDefault();
			e.stopPropagation();
			closeTabStack();
		} else if (e.key === 'Tab') {
			closeTabStack(false);
		}
	}
	$effect(() => {
		if (fitted.stacked.length === 0 && showTabStack) showTabStack = false;
	});

	// Where the open note's controls go (see noteBarSlot in stores/workspace.ts).
	let noteBarEl: HTMLElement | undefined = $state();
	$effect(() => {
		noteBarSlot.set(noteBarEl ?? null);
		return () => noteBarSlot.set(null);
	});
	let showSplit = $derived(!!$splitNoteId && !!editNoteId && !isMobile && !$focusMode);
	$effect(() => {
		if ($splitNoteId && $splitNoteId === editNoteId) closeSplit();
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

	// Your own open to-dos; ones you're waiting on from others are separate.
	let openActionCount = $derived($actionItems.filter((i) => i.status === 'open' && !isWaitingFor(i, $myNames)).length);
	let openQuestionCount = $derived($questions.filter((q) => q.status === 'open').length);
	let showWork = $state(true);
	let pendingProposalCount = $derived($reminderProposals.filter((p) => p.status === 'pending').length);

	const primaryNav: NavItem[] = [
		{ href: '/', label: 'Ask Kurumi', icon: Sparkles },
		{ href: '/daily', label: 'Today', icon: CalendarDays, hint: `Today's daily note (${modKey}D)` },
		{ href: '/inbox', label: 'Inbox', icon: Inbox, hint: `Inbox (${modKey}⇧I)` },
		{ href: '/calendar', label: 'Calendar', icon: Calendar, hint: `Calendar (${modKey}⇧C)` },
		{ href: '/actions', label: 'To-dos', icon: CheckSquare, hint: `To-dos (${modKey}⇧A)`, count: () => openActionCount },
		{ href: '/proposals', label: 'Proposals', icon: Bell, hint: 'Reminder proposals', count: () => pendingProposalCount, warn: true },
		{ href: '/drafts', label: 'Drafts', icon: Pencil, hint: 'Email & calendar drafts' }
	];

	// Shown under "More" until opened (remembered per device): reachable, not in the way.
	const MORE_NAV = new Set(['/calendar', '/proposals', '/drafts']);
	let showMoreNav = $state(false);
	let mainNav = $derived(primaryNav.filter((item) => !MORE_NAV.has(item.href)));
	let moreNav = $derived(primaryNav.filter((item) => MORE_NAV.has(item.href)));
	// What "More" hides that wants attention.
	let moreCount = $derived(moreNav.reduce((sum, item) => sum + (item.count?.() ?? 0), 0));
	function toggleMoreNav() {
		showMoreNav = !showMoreNav;
		try {
			localStorage.setItem('kurumi-nav-more', showMoreNav ? '1' : '0');
		} catch {
			// Not remembered, that's all.
		}
	}
	// The footer's menu: the places that were icons without names.
	let showFooterMenu = $state(false);
	// "Graph (⌘G)": the name, and the shortcut.
	const placeName = (label: string) => label.replace(/\s*\(.*\)$/, '');
	const placeKey = (label: string) => /\((.*)\)$/.exec(label)?.[1] ?? '';

	const workNav: NavItem[] = [
		{ href: '/projects', label: 'Projects', icon: FolderKanban },
		{ href: '/meetings', label: 'Meetings', icon: CalendarClock, hint: 'Recurring meetings and their agendas' },
		{ href: '/decisions', label: 'Decisions', icon: Gavel, hint: 'Decision log' },
		{ href: '/questions', label: 'Questions', icon: HelpCircle, hint: 'Open questions', count: () => openQuestionCount }
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

	// Pages about what a linked folder doesn't have ($lib/linked): records of
	// the document, generated notes, and tools that rewrite many notes. In a
	// linked folder they show one shared notice instead (LinkedVaultNotice).
	const RECORD_PAGES = [
		'/actions', '/proposals', '/drafts', '/inbox', '/calendar', '/daily', '/review',
		'/projects', '/meetings', '/decisions', '/questions', '/people', '/templates', '/trash',
		'/tags', '/topics', '/habits', '/flashcards', '/workflows', '/database', '/canvas', '/smart-folders'
	];
	const isRecordPage = (path: string) => RECORD_PAGES.some((page) => path === page || path.startsWith(`${page}/`));

	function isActive(href: string): boolean {
		const path = currentPath;
		if (href === '/') return path === '/';
		return path === href || path.startsWith(href + '/');
	}

	// The selected row's mark: one short accent bar at the sidebar's left
	// edge, a thing of its own and not part of the row's shape. It sits
	// beside whichever row is the current page (`aria-current="page"`), at
	// any depth of the tree, slides there when the page changes, and follows
	// scrolling and opening groups without sliding.
	let asideEl: HTMLElement | undefined = $state();
	let navScroller: HTMLElement | undefined = $state();
	let navContent: HTMLElement | undefined = $state();
	let indicator = $state({ y: 0, on: false, slide: false });
	let indicatorSlideUntil = 0;
	function placeIndicator(pageChanged = false) {
		if (!asideEl) return;
		const row = [...asideEl.querySelectorAll<HTMLElement>('[aria-current="page"]')].find((el) => el.getClientRects().length > 0);
		if (!row) {
			if (indicator.on) indicator = { ...indicator, on: false, slide: false };
			return;
		}
		const aside = asideEl.getBoundingClientRect();
		const rect = row.getBoundingClientRect();
		const middle = rect.top + rect.height / 2;
		// Scrolled out of the list: no bar floating over the header or footer.
		const list = navScroller?.contains(row) ? navScroller.getBoundingClientRect() : null;
		const on = !list || (middle > list.top + 6 && middle < list.bottom - 6);
		if (pageChanged) indicatorSlideUntil = performance.now() + 200;
		const y = Math.round(middle - aside.top);
		const slide = indicator.on && on && performance.now() < indicatorSlideUntil;
		if (y !== indicator.y || on !== indicator.on || slide !== indicator.slide) indicator = { y, on, slide };
	}
	$effect(() => {
		// Whatever can change which row is current, or bring it into being.
		void [currentPath, initialized, sidebarCollapsed, isMobile, sidebarOpen, $focusMode, $currentVaultCaps];
		tick().then(() => placeIndicator(true));
	});
	$effect(() => {
		if (!navScroller || !navContent) return;
		const follow = () => placeIndicator();
		navScroller.addEventListener('scroll', follow, { passive: true });
		// Groups and folders opening, rows arriving, the window resizing.
		const observer = new ResizeObserver(follow);
		observer.observe(navContent);
		observer.observe(navScroller);
		return () => {
			navScroller?.removeEventListener('scroll', follow);
			observer.disconnect();
		};
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

	// Keyboard shortcuts handler. Bindings come from $lib/shortcuts, where
	// users can change them (Settings → Keyboard shortcuts).
	function handleKeydown(e: KeyboardEvent) {
		const target = e.target as HTMLElement;
		const typing = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
		const shortcut = matchShortcut(e);

		if (shortcut && (!typing || shortcut.inInputs) && runShortcut(shortcut.id)) {
			e.preventDefault();
			return;
		}

		// Handled already (vim mode's Escape back to Normal, a popup closing)
		if (e.key === 'Escape' && !e.defaultPrevented) {
			if (typing) {
				// Allow Escape in inputs
				target.blur();
			} else if (showSearch) {
				showSearch = false;
			} else if (sidebarOpen && isMobile) {
				sidebarOpen = false;
			}
		}
	}

	function go(path: string) {
		goto(path);
		if (isMobile) sidebarOpen = false;
	}

	// Returns false for shortcuts handled elsewhere (find lives in the editor).
	function runShortcut(id: ShortcutId): boolean {
		switch (id) {
			case 'toggleSidebar':
				toggleSidebar();
				return true;
			case 'search':
				showSearch = !showSearch;
				return true;
			case 'quickSwitcher':
				// Opens the palette, which lists recently opened notes first.
				showSearch = true;
				return true;
			case 'newNote':
				handleNewNote();
				return true;
			case 'undo':
				undoLast();
				return true;
			case 'agentPane':
				showAgentPane = !showAgentPane;
				return true;
			case 'readMode':
				go('/read');
				return true;
			case 'actions':
				go('/actions');
				return true;
			case 'inbox':
				go('/inbox');
				return true;
			case 'calendar':
				go('/calendar');
				return true;
			case 'focusMode':
				toggleFocusMode();
				return true;
			case 'voice':
				// Global push-to-talk toggle: hop to home and flip the voice
				// assistant signal. The home page's Ask Kurumi view picks it
				// up via a $effect and runs start / stop-and-submit alternately.
				if (currentPath !== '/') goto('/');
				triggerVoiceAssistant.update((n) => n + 1);
				if (isMobile) sidebarOpen = false;
				return true;
			case 'dailyNote':
				go('/daily');
				return true;
			case 'graph':
				go('/graph');
				return true;
			case 'references':
				go('/references');
				return true;
			case 'settings':
				go('/settings');
				return true;
			default:
				return false;
		}
	}

	// Initialize hash router and sync on navigation
	let cleanupHashRouter: (() => void) | null = null;
	let cleanupPwa: (() => void) | null = null;

	// Motion ($lib/motion.ts) starts once the app stands as it was left: the
	// database is open and the page from the address is shown. Until then
	// nothing animates (restored tabs, split note, sidebar groups).
	let pageEl: HTMLElement | undefined = $state();
	let armTimer: ReturnType<typeof setTimeout> | undefined;
	function armMotionWhenSettled() {
		if (!initialized) return;
		const wanted = location.hash.replace(/^#/, '').split('?')[0];
		if (wanted && wanted !== '/' && !wanted.startsWith('/clip/') && wanted !== location.pathname) return; // the boot navigation is still on its way
		clearTimeout(armTimer);
		armTimer = setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(armMotion)), 120);
	}

	afterNavigate(({ from, to }) => {
		armMotionWhenSettled();
		// A page or note arriving: its inside fades in (not the chrome).
		if (from?.url && to?.url && from.url.pathname !== to.url.pathname) pageEnter(pageEl);
		if (to?.url?.pathname) {
			updateHashFromPath(to.url.pathname);
			// Track recently-opened memories for the tab bar.
			const memoryMatch = to.url.pathname.match(/^\/memory\/([a-zA-Z0-9]+)/);
			if (memoryMatch) {
				touchTab(memoryMatch[1]);
				touchRecent(memoryMatch[1]);
			}
		}
	});

	onMount(() => {
		// Keep the user's CSS snippet after the app's own styles (dev adds them late).
		const customCss = document.getElementById('kurumi-custom-css');
		if (customCss) document.head.appendChild(customCss);

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

		showMoreNav = localStorage.getItem('kurumi-nav-more') === '1';
		// Load sidebar width from localStorage
		const savedWidth = localStorage.getItem('kurumi-sidebar-width');
		if (savedWidth) {
			const width = parseInt(savedWidth, 10);
			if (width >= MIN_SIDEBAR_WIDTH && width <= MAX_SIDEBAR_WIDTH) {
				sidebarWidth = width;
			}
		}

		// Initialize async stuff
		initDB().then(async () => {
			// Edits a reload cut off (see $lib/unsaved), before anything renders
			restoreStashedEdits();
			// The linked folder that was current on this device (desktop app):
			// scan it before the first render. If it isn't there (moved, disk
			// unplugged) the document's own vault stays current and the vault
			// menu says "Folder not found"; nothing is forgotten.
			const linked = isTauri() ? getLinkedVault(getActiveLinkedVaultId() ?? '') : undefined;
			if (linked) {
				// (Edits stashed for its notes are restored as it opens: $lib/unsaved.)
				await openLinkedVault(linked).catch((err) => {
					const missing = err instanceof DOMException && err.name === 'NotFoundError';
					showNotice(missing ? `The folder of "${linked.name}" wasn't found. Showing your Kurumi vault instead.` : `Couldn't open "${linked.name}". Showing your Kurumi vault instead.`);
				});
			}
			initSearch();
			setupVisibilitySync();
			setupAutoSync();
			initialized = true;
			armMotionWhenSettled();
			// Persistent storage, icon badge, notification actions, opened files
			cleanupPwa = bootPwa();
			// Start the notification loop if the user previously opted in.
			// No-op if disabled or permission not granted.
			bootNotifications();

			// Auto-generate yesterday's daily digest on first open each day.
			// Fire-and-forget so it doesn't block boot. Idempotent: checks
			// localStorage for the last generated date to avoid duplicates.
			// Days with nothing to report get no note.
			const DIGEST_DATE_KEY = 'kurumi-last-auto-digest';
			const today = todayIso();
			if (localStorage.getItem(DIGEST_DATE_KEY) !== today) {
				setTimeout(() => {
					generateDailyDigest(undefined, { skipIfEmpty: true }).then(() => {
						localStorage.setItem(DIGEST_DATE_KEY, today);
					}).catch(() => {
						// Silently fail — no inference provider configured, etc.
					});
				}, 5000); // delay to not compete with initial render
			}
			// Fetch the command palette while idle, so the first ⌘K is instant.
			const idle = window.requestIdleCallback ?? ((fn: () => void) => setTimeout(fn, 2000));
			idle(() => void loadCommandPalette());
			// Living notes whose topic's notes changed: soon after start, then every half hour.
			setTimeout(() => void maybeUpdateLivingNotes().catch(() => {}), 20_000);
			livingTimer = setInterval(() => void maybeUpdateLivingNotes().catch(() => {}), 30 * 60_000);
			// Plugins installed on this device, each in its sandbox ($lib/plugins).
			void startPlugins().catch(() => {});
			// Scheduled workflows: check every minute (and once soon after start, for missed runs).
			setTimeout(() => void runDueWorkflows().catch(() => {}), 15_000);
			workflowTimer = setInterval(() => void runDueWorkflows().catch(() => {}), 60_000);
			// Last week's review, on the first start of a new week (quiet weeks get none).
			setTimeout(() => void maybeAutoWeeklyReview().catch(() => {}), 8000);
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
			showVoiceCapture = canCreateNotes('capture');
			captureMode = 'voice-memo';
		};
		const handleMeetingEvent = () => {
			showVoiceCapture = canCreateNotes('capture');
			captureMode = 'meeting';
		};
		window.addEventListener('kurumi-voice-memo', handleVoiceMemoEvent);
		// Pages with their own mobile top bar (the note page) ask for the sidebar.
		const handleOpenSidebar = () => (sidebarOpen = true);
		window.addEventListener('kurumi-open-sidebar', handleOpenSidebar);
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
			window.removeEventListener('kurumi-open-sidebar', handleOpenSidebar);
			window.removeEventListener('kurumi-meeting', handleMeetingEvent);
			document.removeEventListener('visibilitychange', handleVisibility);
			window.clearInterval(rolloverInterval);
			clearInterval(livingTimer);
			clearInterval(workflowTimer);
			teardownVisibilitySync();
			teardownAutoSync();
			cleanupHashRouter?.();
			cleanupPwa?.();
			stopNotificationLoop();
			stopDueCacheSync();
		};
	});

	// Keep the search index in step with the notes (only changed notes are
	// re-indexed; runs on every edit and on vault switches).
	$effect(() => {
		void $memoryObjects;
		if (initialized) syncIndex();
	});

	async function handleNewNote() {
		if (!canCreateNotes()) return;
		const memory = addMemoryObject();
		if (isMobile) sidebarOpen = false;
		await goto(`/memory/${memory.id}`);
	}

	async function handleNewNoteInFolder(folderId: string | null) {
		if (!canCreateNotes()) return;
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
	<!-- Static SEO metadata, Open Graph and JSON-LD live in src/app.html so they are in the served HTML. -->
	<title>Kurumi - Your Second Brain</title>

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
	<div class="app-shell flex h-[100dvh]" class:shell-no-sidebar={($focusMode || sidebarCollapsed) && !isMobile}>
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
			class="sidebar fixed inset-y-0 left-0 z-50 flex w-[85vw] max-w-[340px] flex-col md:relative md:z-auto md:max-w-none {sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}"
			class:sidebar-away={($focusMode || sidebarCollapsed) && !isMobile}
			class:shadow-2xl={isMobile && sidebarOpen}
			inert={($focusMode || sidebarCollapsed) && !isMobile}
			style="width: {isMobile ? undefined : `${sidebarWidth}px`}; --sidebar-width: {sidebarWidth}px;"
			role="navigation"
			aria-label="Main navigation"
			bind:this={asideEl}
		>
			<span
				class="nav-indicator"
				class:nav-indicator-on={indicator.on}
				class:nav-indicator-slide={indicator.slide}
				style="transform: translateY({indicator.y}px)"
				aria-hidden="true"
			></span>
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
					class:hidden={!$currentVaultCaps.createNotes}
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

			<div bind:this={navScroller} class="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
				<div bind:this={navContent} class="flex min-h-full flex-col">
				<!-- Primary navigation -->
				<div class="space-y-px px-2 py-1">
					<button onclick={openSearch} class="nav-row w-full">
						<Search class="nav-icon" />
						<span class="flex-1 truncate text-left">Search</span>
						<span class="k-kbd hidden md:inline-flex">{modKey}K</span>
					</button>
					{#each mainNav.filter((item) => $currentVaultCaps.records || item.href === '/') as item (item.href)}
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
					{#if $currentVaultCaps.records}
						{@const moreOpen = showMoreNav || moreNav.some((item) => isActive(item.href))}
						<button onclick={toggleMoreNav} class="nav-row w-full" aria-expanded={moreOpen} aria-controls="more-nav">
							<ChevronRight class="nav-icon k-chevron {moreOpen ? 'rotate-90' : ''}" aria-hidden="true" />
							<span class="flex-1 truncate text-left">More</span>
							{#if !moreOpen && moreCount > 0}
								<span class="nav-count nav-count-warn" title="Waiting in Proposals">{moreCount > 99 ? '99+' : moreCount}</span>
							{/if}
						</button>
						{#if moreOpen}
							<div class="k-collapse" transition:collapse>
							<div id="more-nav" class="space-y-px">
							{#each moreNav as item (item.href)}
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
							</div>
						{/if}
					{/if}
				</div>

				<!-- Work: projects, meetings, decisions, questions -->
				<div class="px-2 pt-3" class:hidden={!$currentVaultCaps.records}>
					<button
						onclick={() => (showWork = !showWork)}
						class="section-label w-full"
						aria-expanded={showWork}
						aria-controls="work-nav"
					>
						<ChevronRight class="h-3 w-3 k-chevron {showWork ? 'rotate-90' : ''}" aria-hidden="true" />
						Work
					</button>
					{#if showWork}
						<div class="k-collapse" transition:collapse>
						<div id="work-nav">
							{#each workNav as item (item.href)}
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
									{#if count > 0}<span class="nav-count">{count > 99 ? '99+' : count}</span>{/if}
								</a>
							{/each}
						</div>
						</div>
					{/if}
				</div>

				<!-- Favorites -->
				{#if $favoriteMemoryObjects.length > 0}
					<div class="px-2 pt-3">
						<button
							onclick={() => (showFavorites = !showFavorites)}
							class="section-label w-full"
							aria-expanded={showFavorites}
							aria-controls="favorites-list"
						>
							<ChevronRight class="h-3 w-3 k-chevron {showFavorites ? 'rotate-90' : ''}" aria-hidden="true" />
							Favorites
						</button>
						{#if showFavorites}
							<div class="k-collapse" transition:collapse>
							<div id="favorites-list">
								{#each $favoriteMemoryObjects as fav (fav.id)}
									<a
										href="/memory/{fav.id}"
										onclick={handleNoteClick}
										class="nav-row"
										class:nav-row-active={currentPath === `/memory/${fav.id}`}
										aria-current={currentPath === `/memory/${fav.id}` ? 'page' : undefined}
									>
										<NoteIcon icon={fav.icon} class="nav-icon" />
										<span class="truncate">{fav.title || 'Untitled'}</span>
									</a>
								{/each}
							</div>
							</div>
						{/if}
					</div>
				{/if}

				<!-- Labs (Settings → Labs) -->
				{#if $labsEnabled && $currentVaultCaps.records}
					<div class="px-2 pt-3">
						<button
							onclick={() => (showLabs = !showLabs)}
							class="section-label w-full"
							aria-expanded={showLabs}
							aria-controls="labs-list"
						>
							<ChevronRight class="h-3 w-3 k-chevron {showLabs ? 'rotate-90' : ''}" aria-hidden="true" />
							Labs
						</button>
						{#if showLabs}
							<div class="k-collapse" transition:collapse>
							<div id="labs-list">
								{#each LAB_PAGES as lab (lab.href)}
									<a
										href={lab.href}
										onclick={handleNoteClick}
										class="nav-row"
										class:nav-row-active={isActive(lab.href)}
										aria-current={isActive(lab.href) ? 'page' : undefined}
										title={lab.description}
									>
										<FlaskConical class="nav-icon" />
										<span class="truncate">{lab.label}</span>
									</a>
								{/each}
							</div>
							</div>
						{/if}
					</div>
				{/if}

				<!-- Tags -->
				{#if allTags.length > 0}
					<div class="px-2 pt-3">
						<button
							onclick={() => (showTags = !showTags)}
							class="section-label w-full"
							aria-expanded={showTags}
							aria-controls="tags-list"
						>
							<ChevronRight class="h-3 w-3 k-chevron {showTags ? 'rotate-90' : ''}" aria-hidden="true" />
							Tags
						</button>
						{#if showTags}
							<div class="k-collapse" transition:collapse>
							<div id="tags-list" class="flex flex-wrap gap-1 px-1.5 pb-1 pt-1">
								{#each allTags.slice(0, 16) as { tag, count }}
									<a
										href="/read/tag/{encodeURIComponent(tag)}"
										onclick={handleNoteClick}
										class="tag-row rounded-md px-1.5 py-0.5 text-xs text-[var(--color-text-muted)] hover:bg-[var(--color-hover)] hover:text-[var(--color-text)]"
										aria-current={currentPath === `/read/tag/${encodeURIComponent(tag)}` || currentPath === `/read/tag/${tag}` ? 'page' : undefined}
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
			</div>

			<!-- Footer: Settings by name, the theme, the assistant, and a menu
			     with names for the rest. Bottom padding: a real gap on desktop
			     (the plain safe-bottom utility resolves to 0 there and overrode
			     py-*), more on phones with a home indicator. -->
			<div class="sidebar-footer relative flex items-center gap-0.5 px-2 pt-1.5" style="padding-bottom: max(0.5rem, env(safe-area-inset-bottom, 0px));">
				<a
					href="/settings"
					onclick={handleNoteClick}
					class="nav-row min-w-0 flex-1"
					class:nav-row-active={isActive('/settings')}
					aria-current={isActive('/settings') ? 'page' : undefined}
					title={`Settings (${modKey},)`}
				>
					<Settings class="nav-icon" />
					<span class="truncate">Settings</span>
				</a>
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
				<button
					onclick={() => (showFooterMenu = !showFooterMenu)}
					class="k-icon-btn relative"
					class:footer-active={showFooterMenu}
					title="Graph, Read mode, References, Trash"
					aria-label="More places"
					aria-haspopup="menu"
					aria-expanded={showFooterMenu}
				>
					<MoreHorizontal class="h-4 w-4" />
					{#if $trashCount > 0 && $currentVaultCaps.records}
						<span class="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-[var(--color-accent)]"></span>
					{/if}
				</button>
				{#if showFooterMenu}
					<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
					<div class="fixed inset-0 z-40" onclick={() => (showFooterMenu = false)}></div>
					<div class="k-menu absolute bottom-full right-2 z-50 mb-1 w-56" style="--pop-origin: bottom right" role="menu" out:popOut>
						{#each footerNav.filter((item) => item.href !== '/settings' && ($currentVaultCaps.records || item.href !== '/trash')) as item (item.label)}
							<a
								href={item.href}
								onclick={() => { showFooterMenu = false; handleNoteClick(); }}
								class="k-menu-item no-underline"
								class:footer-active={isActive(item.href)}
								role="menuitem"
								aria-label={item.label}
							>
								<item.icon class="h-4 w-4 text-[var(--color-text-muted)]" />
								<span class="flex-1 truncate">{placeName(item.label)}</span>
								{#if item.label === 'Trash' && $trashCount > 0}
									<span class="nav-count">{$trashCount > 99 ? '99+' : $trashCount}</span>
								{:else if placeKey(item.label)}
									<span class="k-kbd !text-[0.625rem]">{placeKey(item.label)}</span>
								{/if}
							</a>
						{/each}
					</div>
				{/if}
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

		<!-- The stage: the tab strip on the chrome, and under it the content as
		     raised panels (the page; beside it the split note and the assistant). -->
		<div class="shell-stage flex min-w-0 flex-1">
		<div class="shell-panels flex min-h-0 min-w-0 flex-1">
		<!-- The main column: the top bar (tabs, and the open note's controls) and the page under it.
		     The split note and the assistant stand beside this column at full height, so what is
		     in the top bar visibly belongs to the page below it and to nothing else. -->
		<div class="shell-main flex min-w-0 flex-1 flex-col" class:shell-no-tabs={!showTabBar}>
			{#if showTabBar}
				<!-- The strip has a fixed height, which a grid row can't shrink below: hence the plain div between. -->
				<div class="k-collapse shrink-0" transition:collapse>
				<div>
				<div class="tab-bar" class:bar-no-path={barWidth > 0 && barWidth < 980} class:bar-no-words={barWidth > 0 && barWidth < 860} class:bar-no-edited={barWidth > 0 && barWidth < 720} bind:clientWidth={barWidth}>
					{#if sidebarCollapsed}
						<button
							onclick={toggleSidebar}
							class="k-icon-btn my-auto mr-1 shrink-0"
							title={'Expand sidebar (' + modKey + '\\)'}
							aria-label="Expand sidebar"
						>
							<PanelLeftOpen class="h-4 w-4" />
						</button>
					{/if}
					<!-- The tabs get the width the controls leave. They shrink evenly to a minimum; what
					     still doesn't fit is stacked behind one control ($lib/tab-strip.ts). -->
					<div class="tab-area" bind:this={tabArea}>
					<div class="tab-strip" class:tab-strip-tight={fitted.tight}>
					{#each fitted.visible as tab, i (tab.id)}
						<a
							href="/memory/{tab.id}"
							class="tab-item"
							class:tab-active={currentPath === `/memory/${tab.id}`}
							class:tab-pinned={tab.pinned}
							class:tab-group-end={tab.pinned && !fitted.visible[i + 1]?.pinned && i < fitted.visible.length - 1}
							draggable="true"
							animate:flip={flipParams()}
							in:tabIn
							title={tabPath(tab) + (tab.pinned ? ' (pinned; right-click to unpin)' : '')}
							ondragstart={(e) => { e.dataTransfer?.setData('text/plain', tab.id); e.dataTransfer!.effectAllowed = 'move'; }}
							ondragover={(e) => e.preventDefault()}
							ondrop={(e) => { e.preventDefault(); const from = e.dataTransfer?.getData('text/plain'); if (from) moveTabTo(from, tab.id); }}
							onauxclick={(e) => { if (e.button === 1) { e.preventDefault(); closeTab(tab.id); } }}
							oncontextmenu={(e) => { e.preventDefault(); togglePinTab(tab.id); }}
						>
							{#if tab.icon}
								<NoteIcon icon={tab.icon} class="h-3.5 w-3.5 shrink-0" />
							{/if}
							<span class="truncate">{tab.title || 'Untitled'}</span>
							{#if tab.pinned}
								<button
									class="tab-close tab-pin is-pinned"
									onclick={(e) => { e.preventDefault(); e.stopPropagation(); unpinTab(tab.id); }}
									aria-label="Unpin tab"
									title="Unpin"
								>
									<Pin class="h-3 w-3" />
								</button>
							{:else}
								<button
									class="tab-close tab-pin"
									onclick={(e) => { e.preventDefault(); e.stopPropagation(); pinTab(tab.id); }}
									aria-label="Pin tab"
									title="Pin: keep this tab, across restarts"
								>
									<Pin class="h-3 w-3" />
								</button>
								<button
									class="tab-close"
									onclick={(e) => { e.preventDefault(); e.stopPropagation(); closeTab(tab.id); }}
									aria-label="Close tab"
								>
									<X class="h-3 w-3" />
								</button>
							{/if}
						</a>
					{/each}
					</div>
					{#if fitted.stacked.length > 0}
						<div class="relative shrink-0">
							<button
								bind:this={stackButton}
								class="tab-stack"
								class:tab-stack-open={showTabStack}
								onclick={() => (showTabStack ? closeTabStack() : openTabStack())}
								onkeydown={(e) => { if (e.key === 'ArrowDown') { e.preventDefault(); openTabStack(); } }}
								aria-haspopup="menu"
								aria-expanded={showTabStack}
								aria-label="{fitted.stacked.length} more {fitted.stacked.length === 1 ? 'tab' : 'tabs'}"
								title="{fitted.stacked.length} more {fitted.stacked.length === 1 ? 'tab' : 'tabs'}"
							>
								<Layers class="h-3.5 w-3.5" aria-hidden="true" />
								<span class="tabular-nums">{fitted.stacked.length}</span>
							</button>
							{#if showTabStack}
								<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
								<div class="fixed inset-0 z-40" onclick={() => closeTabStack(false)}></div>
								<div
									bind:this={stackMenu}
									tabindex="-1"
									class="k-menu tab-stack-menu absolute right-0 top-full z-50 mt-1"
									style="--pop-origin: top right"
									role="menu"
									aria-label="More tabs"
									onkeydown={stackKeydown}
									out:popOut
								>
									<div class="k-menu-label">More tabs</div>
									{#each fitted.stacked as tab (tab.id)}
										<div class="tab-stack-row">
											<a
												href="/memory/{tab.id}"
												class="k-menu-item tab-stack-item no-underline"
												role="menuitem"
												data-tab-id={tab.id}
												onclick={() => closeTabStack(false)}
											>
												{#if tab.icon}<NoteIcon icon={tab.icon} class="h-3.5 w-3.5 shrink-0" />{:else if tab.pinned}<Pin class="h-3.5 w-3.5 shrink-0 text-[var(--color-accent)]" />{/if}
												<span class="min-w-0 flex-1">
													<span class="block truncate">{tab.title || 'Untitled'}</span>
													{#if tabFolder(tab)}<span class="block truncate text-xs text-[var(--color-text-faint)]">{tabFolder(tab)}</span>{/if}
												</span>
											</a>
											<button
												class="k-icon-btn tab-stack-close"
												tabindex="-1"
												onclick={() => closeStackedTab(tab.id)}
												aria-label="Close {tab.title || 'Untitled'}"
												title="Close tab"
											>
												<X class="h-3.5 w-3.5" />
											</button>
										</div>
									{/each}
									<div class="k-menu-sep"></div>
									<div class="px-2 pb-1 pt-0.5 text-xs text-[var(--color-text-faint)]">↑↓ to move · Enter to open · Delete to close</div>
								</div>
							{/if}
						</div>
					{/if}
					</div>
					<!-- The open note's controls: the note page moves them in here ($lib/actions/dock). -->
					<div class="note-bar-slot" bind:this={noteBarEl}></div>
				</div>
				</div>
				</div>
			{/if}

		<!-- Main Content -->
		<main class="shell-panel relative flex min-w-0 flex-1 flex-col" class:overflow-hidden={!isReadMode} aria-label="Main content">
			<!-- Mobile header (hidden in read mode, on notes — which have their
			     own top bar — and on desktop) -->
			{#if !isReadMode && !editNoteId}
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
					class:hidden={!$currentVaultCaps.createNotes}
					aria-label="New note"
					title="New note"
				>
					<SquarePen class="h-5 w-5" />
				</button>
			</header>
			{/if}

			<FocusTimer />
			<!-- Pages that manage their own scrolling (notes, graph, canvas) are
			     h-full and never overflow this; everything else scrolls here. -->
			<div bind:this={pageEl} class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
				{#if !$currentVaultCaps.records && isRecordPage(currentPath)}
					<LinkedVaultNotice />
				{:else}
					{@render children()}
				{/if}
			</div>
		</main>
		</div>

		{#if showSplit && $splitNoteId}
			<!-- Loaded when first opened: it carries the editor, which most pages don't need -->
			{#await import('$lib/components/SplitPane.svelte') then { default: SplitPane }}
				<div class="shell-panel shell-panel-side flex min-w-0 flex-1" transition:panelSlide|global>
					<SplitPane noteId={$splitNoteId} />
				</div>
			{/await}
		{/if}

		{#if showAgentPane}
			{#await loadAgentPane() then { default: AgentPane }}
				<div class="shell-panel shell-panel-side shell-panel-agent flex" transition:panelSlide|global>
					<AgentPane onClose={() => (showAgentPane = false)} />
				</div>
			{/await}
		{/if}
		</div>
		</div>
	</div>

	<!-- Command Palette -->
	{#if showSearch}
		{#await loadCommandPalette() then { default: CommandPalette }}
			<CommandPalette onClose={closeSearch} onShowTemplatePicker={() => (showTemplatePicker = true)} />
		{/await}
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
	<UpdateToast />
	<NoticeToast />
	{#if $vaultNeedsNewerApp}
		<div class="newer-vault" role="alert">
			This vault was saved by a newer version of Kurumi.
			<button class="k-btn k-btn-sm k-btn-primary" onclick={() => location.reload()}>Reload to update</button>
		</div>
	{/if}
	<LockScreen />

	<!-- Floating sync sign + force-sync button (bottom-right) -->
	{#if !$isLocked}
		<SyncFab visible={showSyncStatus} onConflict={() => (showConflictModal = true)} />
	{/if}
{/if}

<!-- Full-screen image viewer (opened from images in notes) -->
<ImageViewer />
<PdfViewer />

<style>
	/* Boot screen: only reveal after a beat so fast boots don't flash */
	.boot-screen {
		animation: fadeIn var(--motion-base) var(--ease-enter) var(--motion-base) both;
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

	.tag-row[aria-current='page'] {
		background: var(--color-active);
		color: var(--color-text);
	}

	/* The mark beside the selected row (placeIndicator): 3px, straight, round
	   ends, at the sidebar's very edge; never part of the row. */
	.nav-indicator {
		position: absolute;
		top: -0.5rem;
		left: 0;
		z-index: 2;
		width: 3px;
		height: 1rem;
		border-radius: 999px;
		background: var(--color-accent);
		opacity: 0;
		pointer-events: none;
		transition: opacity var(--motion-fast) var(--ease-enter);
	}

	.nav-indicator-on {
		opacity: 1;
	}

	.nav-indicator-slide {
		transition:
			opacity var(--motion-fast) var(--ease-enter),
			transform var(--motion-fast) var(--ease-enter);
	}

	.nav-row-active :global(.nav-icon) {
		color: var(--color-accent);
		opacity: 1;
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
	/* The shell: one background (the "chrome") behind the sidebar and the tab
	   strip, and the content on it as raised panels. Colours, radius and
	   gutter are tokens in app.css (--shell-*), so themes and CSS snippets
	   can set them. Below the md breakpoint the panel is the whole screen. */
	.app-shell {
		background: var(--shell-chrome);
	}

	.sidebar {
		background: var(--shell-chrome);
	}

	.shell-panel {
		background: var(--shell-panel);
	}

	@media (min-width: 768px) {
		.shell-panels {
			gap: var(--shell-gutter);
			padding: 0 var(--shell-gutter) var(--shell-gutter) 0;
		}

		/* No top bar above (no tabs, not a note): the panel keeps its distance from the top too. */
		.shell-main.shell-no-tabs {
			padding-top: var(--shell-gutter);
		}

		/* The split note and the assistant stand beside the main column at full height. */
		.shell-panel-side {
			margin-top: var(--shell-gutter);
		}

		/* Sidebar collapsed or focus mode: the panel has the window to its left. */
		.shell-no-sidebar .shell-panels {
			padding-left: var(--shell-gutter);
		}

		.shell-panel {
			overflow: hidden;
			border: 1px solid var(--shell-panel-border);
			border-radius: var(--shell-radius);
			box-shadow: var(--shell-panel-shadow);
		}

		/* The split note and the assistant are panels of their own, not strips of the page. */
		.shell-panel-side :global(.split-pane),
		.shell-panel-side :global(.agent-pane) {
			border-left: 0;
		}

		.shell-panel-agent {
			flex: none;
		}
	}

	/* A side panel sliding in or out passes the right edge; that must not scroll. */
	.shell-panels {
		overflow: hidden;
		transition: padding var(--motion-base) var(--ease-enter);
	}

	/* The sidebar. Phones: it slides over the page. Wider: collapsing moves it
	   out to the left by its own width (a margin, so its inside never
	   reflows) while the stage takes the room and the panel's left gutter
	   grows, all on the same clock. Hidden for real once it is out. */
	.sidebar {
		flex-shrink: 0;
		transition: transform var(--motion-base) var(--ease-enter);
	}

	@media (min-width: 768px) {
		.sidebar {
			transition:
				margin-left var(--motion-base) var(--ease-enter),
				visibility 0s;
		}

		.sidebar.sidebar-away {
			margin-left: calc(-1 * var(--sidebar-width));
			visibility: hidden;
			transition:
				margin-left var(--motion-base) var(--ease-exit),
				visibility 0s linear var(--motion-base);
		}
	}

	.shell-main {
		transition: padding var(--motion-base) var(--ease-enter);
	}

	/* The top bar: [expand sidebar] [tabs … stack] [the note's controls]. One
	   fixed height whatever it holds. Nothing here scrolls or clips except
	   the strip of tabs itself, so menus can hang out of it. */
	.tab-bar {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		height: 2.5rem;
		flex-shrink: 0;
		padding: 0 0.125rem;
	}

	.tab-area {
		display: flex;
		flex: 1 1 0;
		align-items: center;
		gap: 0.125rem;
		min-width: 0;
		height: 100%;
	}

	.tab-strip {
		display: flex;
		flex: 0 1 auto;
		align-items: center;
		gap: 2px; /* TAB_GAP */
		min-width: 0;
		height: 100%;
		overflow: hidden;
	}

	.note-bar-slot {
		display: flex;
		flex: none;
		align-items: center;
		min-width: 0;
	}

	/* The stack: tabs that don't fit, behind one control that says how many. */
	.tab-stack {
		display: inline-flex;
		flex: none;
		align-items: center;
		gap: 0.25rem;
		height: 1.75rem;
		min-width: 0;
		min-height: 0;
		padding: 0 0.5rem;
		border: 1px solid transparent;
		border-radius: var(--radius-md);
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}

	.tab-stack:hover,
	.tab-stack-open {
		background: var(--color-hover);
		color: var(--color-text);
	}

	.tab-stack-menu {
		width: 18rem;
		max-width: calc(100vw - 2rem);
		max-height: min(28rem, calc(100vh - 5rem));
		overflow-y: auto;
	}

	.tab-stack-row {
		position: relative;
		display: flex;
		align-items: center;
	}

	.tab-stack-item {
		min-width: 0;
		flex: 1;
		padding-right: 2rem;
	}

	.tab-stack-close {
		position: absolute;
		right: 0.25rem;
		opacity: 0;
	}

	.tab-stack-row:hover .tab-stack-close,
	.tab-stack-row:focus-within .tab-stack-close {
		opacity: 1;
	}

	.tab-item {
		position: relative;
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		flex: 0 1 auto;
		max-width: 200px;
		min-width: 5.5rem; /* TAB_MIN: an icon and a few characters */
		padding: 0 0.375rem 0 0.75rem;
		font-size: 0.75rem;
		color: var(--color-text-muted);
		text-decoration: none;
		white-space: nowrap;
		height: 1.75rem;
		border: 1px solid transparent;
		border-radius: var(--radius-md);
		user-select: none;
	}

	.tab-item:hover {
		background: var(--color-hover);
		color: var(--color-text);
	}

	/* Pinned tabs ("sticky notes"): shorter, with a pin, and a gap after the group */
	.tab-item.tab-pinned {
		max-width: 150px;
		padding-left: 0.625rem;
	}

	.tab-item.tab-group-end {
		margin-right: 0.5rem;
	}

	.tab-pin.is-pinned {
		opacity: 1;
		color: var(--color-accent);
	}

	/* The open note's tab: a piece of the panel's surface on the chrome. It
	   keeps more of its title than the others when they are squeezed. */
	.tab-item.tab-active {
		min-width: 8rem;
		color: var(--color-text);
		background: var(--shell-panel);
		border-color: var(--shell-panel-border);
		box-shadow: var(--shell-panel-shadow);
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

	/* Tabs narrower than they'd like: the pin button comes on hover only, so the title keeps the room. */
	.tab-strip-tight .tab-pin:not(.is-pinned) {
		display: none;
	}

	.tab-strip-tight .tab-item:hover .tab-pin {
		display: flex;
	}

	/* A newer Kurumi saved this vault: ask for the update (store.ts canReadDocument) */
	.newer-vault {
		position: fixed;
		top: calc(0.75rem + env(safe-area-inset-top, 0px));
		left: 50%;
		transform: translateX(-50%);
		z-index: 300;
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.5rem 0.5rem 0.5rem 1rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-bg);
		box-shadow: var(--shadow-lg);
		font-size: 0.875rem;
	}
</style>
