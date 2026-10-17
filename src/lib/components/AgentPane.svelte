<script lang="ts">
	import { autofocus } from '$lib/actions/autofocus';
	import { onMount, tick } from 'svelte';
	import {
		createAgentSession,
		sendAgentMessage,
		generateConversationTitle,
		AVAILABLE_MODELS,
		getAgentModel,
		setAgentModel,
		type AgentSession,
		type AgentMessage,
		type ToolCall,
		type SendOptions
	} from '$lib/agent';
	import { addMemoryObject, memoryObjects, getAllPeople, getAllTags } from '$lib/db';
	import { goto } from '$app/navigation';
	import { startPushToTalk, type RecorderHandle } from '$lib/voice';
	import { inferenceRouter } from '$lib/inference';
	import MarkdownRenderer from './MarkdownRenderer.svelte';
	import {
		Sparkles,
		ArrowUp,
		X,
		Wrench,
		Search,
		FileText,
		FilePlus,
		CheckSquare,
		Bell,
		SquarePen,
		MoreHorizontal,
		Loader2,
		Copy,
		Check,
		ExternalLink,
		ArrowDown,
		ChevronDown,
		ChevronRight,
		Mic,
		Download,
		Pencil,
		History,
		Trash2,
		Volume2,
		VolumeX
	} from 'lucide-svelte';

	// --- Props ----------------------------------------------------------------

	interface Props {
		onClose: () => void;
	}
	let { onClose }: Props = $props();

	// --- Conversation history --------------------------------------------------

	interface ConversationMeta {
		id: string;
		title: string;
		createdAt: number;
		updatedAt: number;
		messageCount: number;
	}

	const HISTORY_INDEX_KEY = 'kurumi-agent-history';
	const SESSION_PREFIX = 'kurumi-agent-session-';
	const MAX_CONVERSATIONS = 20;

	function loadHistoryIndex(): ConversationMeta[] {
		if (typeof localStorage === 'undefined') return [];
		try {
			return JSON.parse(localStorage.getItem(HISTORY_INDEX_KEY) || '[]');
		} catch { return []; }
	}

	function saveHistoryIndex(index: ConversationMeta[]) {
		if (typeof localStorage === 'undefined') return;
		localStorage.setItem(HISTORY_INDEX_KEY, JSON.stringify(index));
	}

	function loadConversation(id: string): AgentSession {
		if (typeof sessionStorage === 'undefined' && typeof localStorage === 'undefined') return createAgentSession();
		try {
			// Try sessionStorage first (current session), then localStorage (history)
			const raw = sessionStorage?.getItem(SESSION_PREFIX + id) ?? localStorage?.getItem(SESSION_PREFIX + id);
			if (raw) {
				const parsed = JSON.parse(raw) as AgentSession;
				// Reset transient flags (may be missing on old sessions)
				parsed.thinking = false;
				parsed.thinkingStatus = null;
				parsed.streamStats = null;
				parsed.error = null;
				return parsed;
			}
		} catch { /* ignore */ }
		return createAgentSession();
	}

	function persistConversation(id: string, s: AgentSession) {
		try {
			const data = JSON.stringify(s);
			sessionStorage?.setItem(SESSION_PREFIX + id, data);
			localStorage?.setItem(SESSION_PREFIX + id, data);
		} catch { /* quota exceeded */ }
	}

	function deleteConversation(id: string) {
		try {
			sessionStorage?.removeItem(SESSION_PREFIX + id);
			localStorage?.removeItem(SESSION_PREFIX + id);
		} catch { /* ignore */ }
	}

	function generateId(): string {
		return Math.random().toString(36).slice(2, 10);
	}

	function deriveTitle(session: AgentSession): string {
		const firstUser = session.messages.find((m) => m.role === 'user');
		if (firstUser) return firstUser.content.slice(0, 50) + (firstUser.content.length > 50 ? '...' : '');
		return 'New conversation';
	}

	// Migrate from old single-session format
	function migrateOldSession(): string | null {
		if (typeof sessionStorage === 'undefined') return null;
		const oldKey = 'kurumi-agent-session';
		const raw = sessionStorage.getItem(oldKey);
		if (!raw) return null;
		try {
			const parsed = JSON.parse(raw) as AgentSession;
			if (parsed.messages.length === 0) {
				sessionStorage.removeItem(oldKey);
				return null;
			}
			const id = generateId();
			persistConversation(id, parsed);
			sessionStorage.removeItem(oldKey);
			return id;
		} catch {
			sessionStorage.removeItem(oldKey);
			return null;
		}
	}

	// --- State ----------------------------------------------------------------

	let historyIndex = $state<ConversationMeta[]>(loadHistoryIndex());
	let activeConversationId = $state<string>(generateId());
	let session = $state<AgentSession>(createAgentSession());
	let input = $state('');
	let messagesEnd: HTMLDivElement | undefined = $state();
	let messagesContainer: HTMLDivElement | undefined = $state();
	let textareaEl: HTMLTextAreaElement | undefined = $state();
	let paneEl: HTMLDivElement | undefined = $state();
	let distilling = $state(false);
	let confirmingReset = $state(false);
	let copiedMsgId: string | null = $state(null);
	let savedNote: { id: string; title: string } | null = $state(null);
	let savedNoteTimer: ReturnType<typeof setTimeout> | null = $state(null);
	let showScrollBtn = $state(false);
	let expandedTools = $state<Set<string>>(new Set());
	let hasSentMessage = $state(false);
	let isAtBottom = $state(true);
	let showHistory = $state(false);
	let editingMsgId: string | null = $state(null);
	let editText = $state('');

	// Pending images (paste/drop)
	let pendingImages = $state<string[]>([]);

	// Voice input
	let voiceRecording = $state(false);
	let voiceTranscribing = $state(false);
	let recorderHandle: RecorderHandle | null = null;

	// Resize
	const MIN_PANE_WIDTH = 280;
	const MAX_PANE_WIDTH = 640;
	const DEFAULT_PANE_WIDTH = 360;
	const PANE_WIDTH_KEY = 'kurumi-agent-pane-width';
	let paneWidth = $state(DEFAULT_PANE_WIDTH);
	let isResizing = $state(false);

	// Swipe-to-close
	let touchStartX = $state(0);
	let touchDeltaX = $state(0);
	let isSwiping = $state(false);

	// Mobile detection
	let isMobile = $state(false);

	// Model selector
	let selectedModel = $state(getAgentModel());
	let showModelPicker = $state(false);
	let showMoreMenu = $state(false);
	let modelLabel = $derived(
		(AVAILABLE_MODELS.find((m) => m.id === selectedModel)?.label ?? selectedModel).replace(/\s*\(.*\)$/, '')
	);

	function closeMenus() {
		showModelPicker = false;
		showMoreMenu = false;
		showHistory = false;
	}

	function toggleSearch() {
		showSearch = !showSearch;
		if (showSearch) tick().then(() => searchInputEl?.focus());
		else searchQuery = '';
	}

	// Sound notification
	const SOUND_KEY = 'kurumi-agent-sound';
	let soundEnabled = $state(typeof localStorage !== 'undefined' && localStorage.getItem(SOUND_KEY) !== 'false');

	// Input draft persistence
	const DRAFT_KEY = 'kurumi-agent-draft';

	// Conversation search
	let showSearch = $state(false);
	let searchQuery = $state('');
	let searchInputEl: HTMLInputElement | undefined = $state();

	// Title editing
	let editingTitleId: string | null = $state(null);
	let editingTitleText = $state('');

	// Textarea autocomplete for references
	type AutocompleteKind = 'wikilink' | 'person' | 'tag' | 'date';
	interface AutocompleteState {
		kind: AutocompleteKind;
		query: string;
		triggerStart: number; // cursor position where trigger begins (including the trigger chars)
		triggerLen: number;   // length of trigger chars (2 for [[, 1 for @ #, 2 for //)
	}
	let ac = $state<AutocompleteState | null>(null);
	let acIndex = $state(0);

	let acItems = $derived.by((): Array<{ label: string; detail?: string }> => {
		if (!ac) return [];
		const q = ac.query.toLowerCase();
		switch (ac.kind) {
			case 'wikilink':
				return $memoryObjects
					.filter((m) => !q || (m.title || '').toLowerCase().includes(q))
					.slice(0, 8)
					.map((m) => ({ label: m.title || 'Untitled' }));
			case 'person':
				return getAllPeople()
					.filter((p) => !q || p.name.toLowerCase().includes(q))
					.slice(0, 8)
					.map((p) => ({ label: p.name, detail: `${p.count} mention${p.count === 1 ? '' : 's'}` }));
			case 'tag':
				return getAllTags()
					.filter((t) => !q || t.tag.toLowerCase().includes(q))
					.slice(0, 8)
					.map((t) => ({ label: t.tag, detail: `${t.count}` }));
			case 'date': {
				const today = new Date();
				const dates = [
					{ label: new Date().toISOString().slice(0, 10), detail: 'Today' },
					{ label: new Date(today.getTime() + 86400000).toISOString().slice(0, 10), detail: 'Tomorrow' },
				];
				if (q) {
					return dates.filter((d) => d.label.includes(q) || (d.detail?.toLowerCase().includes(q)));
				}
				return dates;
			}
			default:
				return [];
		}
	});

	// Token budget (rough estimate: ~4 chars per token, gpt-4o-mini = 128k)
	const MODEL_CONTEXT_TOKENS = 128_000;
	let estimatedTokens = $derived.by(() => {
		let chars = 0;
		for (const msg of session.messages) {
			chars += msg.content.length;
			if (msg.toolCalls) {
				for (const tc of msg.toolCalls) {
					chars += JSON.stringify(tc.args).length;
					if (tc.result) chars += JSON.stringify(tc.result).length;
				}
			}
		}
		return Math.ceil(chars / 4);
	});

	let tokenPercent = $derived(Math.min(100, Math.round((estimatedTokens / MODEL_CONTEXT_TOKENS) * 100)));

	// --- Effects --------------------------------------------------------------

	// Persist session whenever it changes
	$effect(() => {
		persistConversation(activeConversationId, session);
	});

	// Update history index when message count changes (not on every session mutation)
	let sessionMsgCount = $derived(session.messages.length);
	$effect(() => {
		// Read the derived count to subscribe, but avoid reading historyIndex
		// inside this effect to prevent a reactive loop.
		const count = sessionMsgCount;
		if (count > 0) {
			// Use untrack-style: read historyIndex via the load function
			// so we don't create a dependency on it.
			const currentIndex = loadHistoryIndex();
			const existing = currentIndex.findIndex((c) => c.id === activeConversationId);
			const meta: ConversationMeta = {
				id: activeConversationId,
				title: deriveTitle(session),
				createdAt: existing >= 0 ? currentIndex[existing].createdAt : Date.now(),
				updatedAt: Date.now(),
				messageCount: session.messages.filter((m) => m.role === 'user').length
			};
			let next = currentIndex.filter((c) => c.id !== activeConversationId);
			next = [meta, ...next].slice(0, MAX_CONVERSATIONS);
			historyIndex = next;
			saveHistoryIndex(next);
		}
	});

	// Resize global listeners
	$effect(() => {
		if (isResizing) {
			const onMove = (e: MouseEvent) => {
				paneWidth = Math.min(MAX_PANE_WIDTH, Math.max(MIN_PANE_WIDTH, window.innerWidth - e.clientX));
			};
			const onUp = () => {
				isResizing = false;
				document.body.style.cursor = '';
				document.body.style.userSelect = '';
				localStorage.setItem(PANE_WIDTH_KEY, String(paneWidth));
			};
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

	// Escape key + Cmd+F search shortcut
	$effect(() => {
		function handleGlobalKeydown(e: KeyboardEvent) {
			if (e.key === 'Escape') {
				if (showSearch) {
					showSearch = false;
					searchQuery = '';
				} else if (showHistory) {
					showHistory = false;
				} else if (showModelPicker || showMoreMenu) {
					showModelPicker = false;
					showMoreMenu = false;
				} else if (confirmingReset) {
					confirmingReset = false;
				} else {
					onClose();
				}
				return;
			}
			// Cmd+F within pane → open conversation search
			if ((e.metaKey || e.ctrlKey) && e.key === 'f' && paneEl?.contains(document.activeElement)) {
				e.preventDefault();
				toggleSearch();
			}
		}
		window.addEventListener('keydown', handleGlobalKeydown);
		return () => window.removeEventListener('keydown', handleGlobalKeydown);
	});

	// Draft persistence
	$effect(() => {
		if (input) {
			sessionStorage?.setItem(DRAFT_KEY, input);
		} else {
			sessionStorage?.removeItem(DRAFT_KEY);
		}
	});

	// Focus trap on mobile
	$effect(() => {
		if (!isMobile || !paneEl) return;
		function handleFocusTrap(e: KeyboardEvent) {
			if (e.key !== 'Tab' || !paneEl) return;
			const focusable = paneEl.querySelectorAll<HTMLElement>(
				'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
			);
			if (focusable.length === 0) return;
			const first = focusable[0];
			const last = focusable[focusable.length - 1];
			if (e.shiftKey && document.activeElement === first) {
				e.preventDefault();
				last.focus();
			} else if (!e.shiftKey && document.activeElement === last) {
				e.preventDefault();
				first.focus();
			}
		}
		window.addEventListener('keydown', handleFocusTrap);
		return () => window.removeEventListener('keydown', handleFocusTrap);
	});

	// Auto-focus + load saved width + draft on mount
	onMount(() => {
		textareaEl?.focus();
		isMobile = window.innerWidth <= 768;

		// Restore draft
		const draft = sessionStorage?.getItem(DRAFT_KEY);
		if (draft) {
			input = draft;
			requestAnimationFrame(autoGrow);
		}

		const savedWidth = localStorage.getItem(PANE_WIDTH_KEY);
		if (savedWidth) {
			const w = parseInt(savedWidth, 10);
			if (w >= MIN_PANE_WIDTH && w <= MAX_PANE_WIDTH) paneWidth = w;
		}

		// Migrate old single-session format
		const migratedId = migrateOldSession();
		if (migratedId) {
			activeConversationId = migratedId;
			session = loadConversation(migratedId);
		} else if (historyIndex.length > 0) {
			// Resume most recent conversation
			activeConversationId = historyIndex[0].id;
			session = loadConversation(historyIndex[0].id);
		}

		if (session.messages.length > 0) hasSentMessage = true;

		const handleResize = () => { isMobile = window.innerWidth <= 768; };
		window.addEventListener('resize', handleResize);
		return () => window.removeEventListener('resize', handleResize);
	});

	// --- Derived --------------------------------------------------------------

	let hasAssistantMessages = $derived(
		session.messages.some((m) => m.role === 'assistant' && m.content)
	);

	let hasMessages = $derived(session.messages.length > 0);

	// --- Scroll tracking ------------------------------------------------------

	function handleScroll() {
		if (!messagesContainer) return;
		const { scrollTop, scrollHeight, clientHeight } = messagesContainer;
		const distFromBottom = scrollHeight - scrollTop - clientHeight;
		showScrollBtn = distFromBottom > 80;
		isAtBottom = distFromBottom < 40;
	}

	function scrollToBottom() {
		requestAnimationFrame(() => {
			messagesEnd?.scrollIntoView({ behavior: 'smooth' });
		});
	}

	function smartScroll() {
		if (isAtBottom) scrollToBottom();
	}

	// --- Textarea autocomplete ------------------------------------------------

	function detectAutocomplete() {
		if (!textareaEl) { ac = null; return; }
		const pos = textareaEl.selectionStart;
		const text = input.slice(0, pos);

		// Check for [[ wikilink trigger
		const wlMatch = text.match(/\[\[([^\]]*?)$/);
		if (wlMatch) {
			ac = { kind: 'wikilink', query: wlMatch[1], triggerStart: pos - wlMatch[0].length, triggerLen: 2 };
			acIndex = 0;
			return;
		}
		// Check for @ person trigger (after whitespace or start)
		const atMatch = text.match(/(?:^|\s)@([A-Za-z ]*)$/);
		if (atMatch) {
			const fullMatch = atMatch[0];
			const offset = fullMatch.startsWith(' ') || fullMatch.startsWith('\n') ? 1 : 0;
			ac = { kind: 'person', query: atMatch[1].trim(), triggerStart: pos - fullMatch.length + offset, triggerLen: 1 };
			acIndex = 0;
			return;
		}
		// Check for # tag trigger (after whitespace or start)
		const tagMatch = text.match(/(?:^|\s)#([a-zA-Z0-9_-]*)$/);
		if (tagMatch) {
			const fullMatch = tagMatch[0];
			const offset = fullMatch.startsWith(' ') || fullMatch.startsWith('\n') ? 1 : 0;
			ac = { kind: 'tag', query: tagMatch[1], triggerStart: pos - fullMatch.length + offset, triggerLen: 1 };
			acIndex = 0;
			return;
		}
		// Check for // date trigger (after whitespace or start, not inside URL)
		const dateMatch = text.match(/(?:^|\s)\/\/([^\s]*)$/);
		if (dateMatch && !text.match(/https?:\/\/[^\s]*$/)) {
			const fullMatch = dateMatch[0];
			const offset = fullMatch.startsWith(' ') || fullMatch.startsWith('\n') ? 1 : 0;
			ac = { kind: 'date', query: dateMatch[1], triggerStart: pos - fullMatch.length + offset, triggerLen: 2 };
			acIndex = 0;
			return;
		}

		ac = null;
	}

	function acceptAutocomplete(label: string) {
		if (!ac || !textareaEl) return;
		const before = input.slice(0, ac.triggerStart);
		const after = input.slice(textareaEl.selectionStart);

		let insertion: string;
		switch (ac.kind) {
			case 'wikilink': insertion = `[[${label}]]`; break;
			case 'person':   insertion = `@${label} `; break;
			case 'tag':      insertion = `#${label} `; break;
			case 'date':     insertion = `//${label} `; break;
			default:         insertion = label;
		}

		input = before + insertion + after;
		ac = null;

		// Restore cursor position after insertion
		const newPos = before.length + insertion.length;
		requestAnimationFrame(() => {
			if (textareaEl) {
				textareaEl.selectionStart = textareaEl.selectionEnd = newPos;
				textareaEl.focus();
			}
			autoGrow();
		});
	}

	function handleAcKeydown(e: KeyboardEvent): boolean {
		if (!ac || acItems.length === 0) return false;
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			acIndex = Math.min(acIndex + 1, acItems.length - 1);
			return true;
		}
		if (e.key === 'ArrowUp') {
			e.preventDefault();
			acIndex = Math.max(acIndex - 1, 0);
			return true;
		}
		if (e.key === 'Enter' || e.key === 'Tab') {
			e.preventDefault();
			acceptAutocomplete(acItems[acIndex].label);
			return true;
		}
		if (e.key === 'Escape') {
			e.preventDefault();
			ac = null;
			return true;
		}
		return false;
	}

	// --- Textarea auto-grow ---------------------------------------------------

	function autoGrow() {
		if (!textareaEl) return;
		textareaEl.style.height = 'auto';
		textareaEl.style.height = Math.min(textareaEl.scrollHeight, 120) + 'px';
		detectAutocomplete();
	}

	// --- Relative timestamps --------------------------------------------------

	function relativeTime(ts: number): string {
		const diff = Math.floor((Date.now() - ts) / 1000);
		if (diff < 10) return 'just now';
		if (diff < 60) return `${diff}s ago`;
		const mins = Math.floor(diff / 60);
		if (mins < 60) return `${mins}m ago`;
		const hours = Math.floor(mins / 60);
		if (hours < 24) return `${hours}h ago`;
		return `${Math.floor(hours / 24)}d ago`;
	}

	// --- Search highlighting --------------------------------------------------

	function escapeRegex(s: string): string {
		return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	}

	function highlightMatches(text: string, query: string): string {
		if (!query || query.length < 2) return '';
		const regex = new RegExp(`(${escapeRegex(query)})`, 'gi');
		return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
			.replace(regex, '<mark class="search-highlight">$1</mark>');
	}

	let searchMatchCount = $derived.by(() => {
		if (!searchQuery || searchQuery.length < 2) return 0;
		const regex = new RegExp(escapeRegex(searchQuery), 'gi');
		let count = 0;
		for (const msg of session.messages) {
			if (msg.content) {
				const matches = msg.content.match(regex);
				if (matches) count += matches.length;
			}
		}
		return count;
	});

	// --- Auto-title -----------------------------------------------------------

	async function maybeAutoTitle() {
		// Only auto-title on the first exchange
		const userMsgs = session.messages.filter((m) => m.role === 'user');
		const assistantMsgs = session.messages.filter((m) => m.role === 'assistant' && m.content && !m.toolCalls?.length);
		if (userMsgs.length !== 1 || assistantMsgs.length === 0) return;

		// Check if already manually titled
		const existing = historyIndex.find((c) => c.id === activeConversationId);
		if (existing && existing.title !== userMsgs[0].content.slice(0, 50) + (userMsgs[0].content.length > 50 ? '...' : '')) return;

		const title = await generateConversationTitle(
			userMsgs[0].content,
			assistantMsgs[0].content
		);
		if (title) {
			historyIndex = historyIndex.map((c) =>
				c.id === activeConversationId ? { ...c, title } : c
			);
			saveHistoryIndex(historyIndex);
		}
	}

	// --- Resize ---------------------------------------------------------------

	function startResize(e: MouseEvent) {
		e.preventDefault();
		isResizing = true;
		document.body.style.cursor = 'col-resize';
		document.body.style.userSelect = 'none';
	}

	// --- Tool expand/collapse -------------------------------------------------

	function toggleToolExpand(id: string) {
		const next = new Set(expandedTools);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		expandedTools = next;
	}

	// --- Render tool result with clickable memory links -----------------------

	function renderToolResult(tc: ToolCall): string {
		if (tc.result == null) return 'No result';
		try {
			return JSON.stringify(tc.result, null, 2);
		} catch {
			return String(tc.result);
		}
	}

	function extractMemoryLinks(tc: ToolCall): Array<{ id: string; title: string }> {
		if (!tc.result || typeof tc.result !== 'object') return [];
		const result = tc.result as Record<string, unknown>;

		// create_memory / add_action_item / generate_daily_digest → single memoryId
		if (result.memoryId && typeof result.memoryId === 'string') {
			return [{ id: result.memoryId, title: String(result.title || 'Open note') }];
		}
		// search_memory → results array with memoryId + title
		if (Array.isArray(result.results)) {
			return result.results
				.filter((r: Record<string, unknown>) => r && typeof r.memoryId === 'string')
				.map((r: Record<string, unknown>) => ({ id: String(r.memoryId), title: String(r.title || 'Untitled') }));
		}
		return [];
	}

	// --- Swipe to close (mobile) ----------------------------------------------

	function handleTouchStart(e: TouchEvent) {
		if (!isMobile) return;
		touchStartX = e.touches[0].clientX;
		touchDeltaX = 0;
		isSwiping = false;
	}

	function handleTouchMove(e: TouchEvent) {
		if (!isMobile) return;
		const dx = e.touches[0].clientX - touchStartX;
		if (dx > 20) isSwiping = true; // only track right swipes
		if (isSwiping) touchDeltaX = Math.max(0, dx);
	}

	function handleTouchEnd() {
		if (!isMobile || !isSwiping) {
			touchDeltaX = 0;
			isSwiping = false;
			return;
		}
		if (touchDeltaX > 120) {
			onClose();
		}
		touchDeltaX = 0;
		isSwiping = false;
	}

	// --- Handlers -------------------------------------------------------------

	function playNotificationSound() {
		if (!soundEnabled) return;
		try {
			const ctx = new AudioContext();
			const osc = ctx.createOscillator();
			const gain = ctx.createGain();
			osc.connect(gain);
			gain.connect(ctx.destination);
			osc.frequency.value = 660;
			osc.type = 'sine';
			gain.gain.setValueAtTime(0.08, ctx.currentTime);
			gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
			osc.start(ctx.currentTime);
			osc.stop(ctx.currentTime + 0.3);
		} catch { /* audio not available */ }
	}

	function toggleSound() {
		soundEnabled = !soundEnabled;
		localStorage?.setItem(SOUND_KEY, String(soundEnabled));
	}

	function handleModelChange(modelId: string) {
		selectedModel = modelId;
		setAgentModel(modelId);
		showModelPicker = false;
	}

	async function handleSend() {
		const trimmed = input.trim();
		if (!trimmed || session.thinking) return;
		const imagesToSend = pendingImages.length > 0 ? [...pendingImages] : undefined;
		input = '';
		pendingImages = [];
		hasSentMessage = true;
		sessionStorage?.removeItem(DRAFT_KEY);
		if (textareaEl) textareaEl.style.height = 'auto';
		session = await sendAgentMessage(session, trimmed, {
			images: imagesToSend,
			model: selectedModel,
			onUpdate: (s) => { session = s; smartScroll(); }
		});
		playNotificationSound();
		smartScroll();
		// The textarea was disabled while thinking; hand focus back (not on
		// mobile, where that would pop the keyboard over the reply)
		if (!isMobile) tick().then(() => textareaEl?.focus());
		// Fire-and-forget auto-title after first exchange
		maybeAutoTitle();
	}

	function handleKeydown(e: KeyboardEvent) {
		// Autocomplete takes priority when open
		if (ac && handleAcKeydown(e)) return;

		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			handleSend();
		}
		if (e.key === 'Escape') {
			e.stopPropagation();
			textareaEl?.blur();
		}
	}

	function handleReset() {
		if (hasMessages && !confirmingReset) {
			confirmingReset = true;
			return;
		}
		// Start a fresh conversation
		activeConversationId = generateId();
		session = createAgentSession();
		confirmingReset = false;
		hasSentMessage = false;
		expandedTools = new Set();
		editingMsgId = null;
		pendingImages = [];
	}

	function cancelReset() {
		confirmingReset = false;
	}

	function showSavedNotification(id: string, title: string) {
		if (savedNoteTimer) clearTimeout(savedNoteTimer);
		savedNote = { id, title };
		savedNoteTimer = setTimeout(() => {
			savedNote = null;
			savedNoteTimer = null;
		}, 6000);
	}

	function saveMessageAsNote(content: string) {
		const firstLine = content.split('\n')[0].replace(/^#+\s*/, '').slice(0, 80);
		const title = firstLine || 'Chat note';
		const memory = addMemoryObject(title, content, null);
		showSavedNotification(memory.id, memory.title ?? title);
	}

	async function handleDistillAndSave() {
		if (distilling || session.thinking) return;
		const assistantMessages = session.messages.filter(
			(m) => m.role === 'assistant' && m.content
		);
		if (assistantMessages.length === 0) return;

		distilling = true;
		try {
			session = await sendAgentMessage(
				session,
				'Please distill our entire conversation into a single, clean markdown note. ' +
				'Start with a # heading as the title, then the body content. ' +
				'Write clean prose, not a transcript of our chat. No JSON, no code fences wrapping the whole note.',
				{
					model: selectedModel,
					onUpdate: (s) => { session = s; smartScroll(); }
				}
			);
			smartScroll();

			// Find the last assistant message with actual text content
			const lastTextMsg = [...session.messages].reverse().find(
				(m) => m.role === 'assistant' && m.content && !m.toolCalls?.length
			);
			if (lastTextMsg?.content) {
				const content = lastTextMsg.content.trim();
				// Extract title from first # heading if present
				let title = 'Chat note';
				const headingMatch = content.match(/^#\s+(.+)/m);
				if (headingMatch) {
					title = headingMatch[1].trim();
				}
				// Keep full content as body (including heading — editor handles it)
				const memory = addMemoryObject(title, content, null);
				showSavedNotification(memory.id, memory.title ?? title);
			}
		} finally {
			distilling = false;
		}
	}

	function goToNote(id: string) {
		savedNote = null;
		onClose();
		goto(`/memory/${id}`);
	}

	async function copyMessage(msgId: string, content: string) {
		try {
			await navigator.clipboard.writeText(content);
			copiedMsgId = msgId;
			setTimeout(() => {
				if (copiedMsgId === msgId) copiedMsgId = null;
			}, 2000);
		} catch { /* clipboard denied */ }
	}

	function useStarter(text: string) {
		input = text;
		textareaEl?.focus();
		requestAnimationFrame(autoGrow);
	}

	// --- Edit & re-send -------------------------------------------------------

	function startEditMessage(msg: AgentMessage) {
		editingMsgId = msg.id;
		editText = msg.content;
	}

	function cancelEdit() {
		editingMsgId = null;
		editText = '';
	}

	async function submitEdit(msgId: string) {
		const trimmed = editText.trim();
		if (!trimmed) return;

		// Truncate conversation from this message onward
		const idx = session.messages.findIndex((m) => m.id === msgId);
		if (idx < 0) return;

		session.messages = session.messages.slice(0, idx);
		editingMsgId = null;
		editText = '';
		hasSentMessage = true;

		session = await sendAgentMessage(session, trimmed, {
			model: selectedModel,
			onUpdate: (s) => { session = s; smartScroll(); }
		});
		playNotificationSound();
		smartScroll();
	}

	function handleEditKeydown(e: KeyboardEvent, msgId: string) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			submitEdit(msgId);
		}
		if (e.key === 'Escape') {
			e.stopPropagation();
			cancelEdit();
		}
	}

	// --- Voice input ----------------------------------------------------------

	async function handleVoiceStart() {
		if (voiceRecording || voiceTranscribing || session.thinking) return;
		try {
			recorderHandle = await startPushToTalk();
			voiceRecording = true;
		} catch { /* mic unavailable */ }
	}

	async function handleVoiceStop() {
		if (!recorderHandle || !voiceRecording) return;
		voiceRecording = false;
		voiceTranscribing = true;
		try {
			const blob = await recorderHandle.stop();
			recorderHandle = null;
			const provider = inferenceRouter.findProvider((c: { supportsTranscribe?: boolean }) => !!c.supportsTranscribe);
			if (!provider) throw new Error('No transcription provider');
			const result = await provider.transcribe({
				audio: blob,
				mimeType: blob.type || 'audio/webm'
			});
			if (result.ok && result.value) {
				const text = result.value.text.trim();
				if (text) {
					input = input ? input + ' ' + text : text;
					textareaEl?.focus();
					requestAnimationFrame(autoGrow);
				}
			}
		} catch { /* transcription failed */ }
		finally {
			voiceTranscribing = false;
			recorderHandle = null;
		}
	}

	// --- Paste/drop images ----------------------------------------------------

	function handlePaste(e: ClipboardEvent) {
		const items = e.clipboardData?.items;
		if (!items) return;
		for (const item of items) {
			if (item.type.startsWith('image/')) {
				e.preventDefault();
				const file = item.getAsFile();
				if (file) addImageFile(file);
				return;
			}
		}
	}

	function handleDrop(e: DragEvent) {
		e.preventDefault();
		const files = e.dataTransfer?.files;
		if (!files) return;
		for (const file of files) {
			if (file.type.startsWith('image/')) {
				addImageFile(file);
			}
		}
	}

	function handleDragOver(e: DragEvent) {
		e.preventDefault();
	}

	function addImageFile(file: File) {
		const reader = new FileReader();
		reader.onload = () => {
			if (typeof reader.result === 'string') {
				pendingImages = [...pendingImages, reader.result];
			}
		};
		reader.readAsDataURL(file);
	}

	function removePendingImage(index: number) {
		pendingImages = pendingImages.filter((_, i) => i !== index);
	}

	// --- Export conversation ---------------------------------------------------

	function exportConversation() {
		if (!hasMessages) return;
		let md = '# Kurumi Agent Conversation\n\n';
		md += `_Exported ${new Date().toLocaleString()}_\n\n---\n\n`;
		for (const msg of session.messages) {
			if (msg.role === 'user') {
				md += `**You:**\n\n${msg.content}\n\n`;
			} else if (msg.role === 'assistant') {
				if (msg.toolCalls && msg.toolCalls.length > 0) {
					for (const tc of msg.toolCalls) {
						md += `> _Tool: ${toolLabel(tc)}_ (${tc.status})\n\n`;
					}
				}
				if (msg.content) {
					md += `**Kurumi:**\n\n${msg.content}\n\n`;
				}
			}
			md += '---\n\n';
		}
		const blob = new Blob([md], { type: 'text/markdown' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `kurumi-chat-${new Date().toISOString().slice(0, 10)}.md`;
		a.click();
		URL.revokeObjectURL(url);
	}

	// --- Conversation history -------------------------------------------------

	function switchConversation(id: string) {
		activeConversationId = id;
		session = loadConversation(id);
		hasSentMessage = session.messages.length > 0;
		expandedTools = new Set();
		editingMsgId = null;
		pendingImages = [];
		showHistory = false;
		tick().then(() => scrollToBottom());
	}

	function deleteFromHistory(id: string) {
		deleteConversation(id);
		historyIndex = historyIndex.filter((c) => c.id !== id);
		saveHistoryIndex(historyIndex);
		if (id === activeConversationId) {
			activeConversationId = generateId();
			session = createAgentSession();
			hasSentMessage = false;
		}
	}

	// --- Title editing --------------------------------------------------------

	function startEditTitle(id: string, currentTitle: string) {
		editingTitleId = id;
		editingTitleText = currentTitle;
	}

	function saveTitle() {
		if (!editingTitleId) return;
		const trimmed = editingTitleText.trim();
		if (trimmed) {
			historyIndex = historyIndex.map((c) =>
				c.id === editingTitleId ? { ...c, title: trimmed } : c
			);
			saveHistoryIndex(historyIndex);
		}
		editingTitleId = null;
		editingTitleText = '';
	}

	function handleTitleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			saveTitle();
		}
		if (e.key === 'Escape') {
			e.stopPropagation();
			editingTitleId = null;
			editingTitleText = '';
		}
	}

	// --- Tool helpers ---------------------------------------------------------

	function toolIcon(name: string) {
		switch (name) {
			case 'search_memory': return Search;
			case 'search_people': return Search;
			case 'search_topics': return Search;
			case 'create_memory': return FileText;
			case 'update_memory': return Pencil;
			case 'add_action_item': return CheckSquare;
			case 'list_action_items': return CheckSquare;
			case 'add_reminder': return Bell;
			default: return Wrench;
		}
	}

	function toolLabel(tc: ToolCall): string {
		switch (tc.name) {
			case 'search_memory': return `Searched: "${tc.args.query ?? ''}"`;
			case 'create_memory': return `Created note: "${tc.args.title ?? ''}"`;
			case 'update_memory': return `Updated note: "${tc.args.title || tc.args.memoryId || ''}"`;
			case 'add_action_item': return `Added action: "${tc.args.text ?? ''}"`;
			case 'list_action_items': return `Listed action items${tc.args.status ? ` (${tc.args.status})` : ''}`;
			case 'add_reminder': return `Proposed reminder: "${tc.args.text ?? ''}"`;
			case 'generate_daily_digest': return 'Generated daily digest';
			case 'search_people': return `Searched people: "${tc.args.query ?? 'all'}"`;
			case 'search_topics': return `Searched topics: "${tc.args.query ?? 'all'}"`;
			default: return tc.name;
		}
	}

	const STARTERS = [
		'Draft a meeting summary',
		'Brainstorm ideas about...',
		'Help me outline a plan for...',
		'Summarize what I know about...'
	];
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="agent-pane-wrapper"
	style="width: {isMobile ? '100%' : paneWidth + 'px'}; {isSwiping ? `transform: translateX(${touchDeltaX}px); opacity: ${1 - touchDeltaX / 300}` : ''}"
	bind:this={paneEl}
	ontouchstart={handleTouchStart}
	ontouchmove={handleTouchMove}
	ontouchend={handleTouchEnd}
	role="dialog"
	aria-modal={isMobile ? 'true' : undefined}
	aria-label="Kurumi Agent chat"
>
	<!-- Resize handle (left edge, desktop only) -->
	{#if !isMobile}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="resize-handle" onmousedown={startResize}>
			<div class="resize-bar" class:active={isResizing}></div>
		</div>
	{/if}

	<aside class="agent-pane">
		<!-- Header -->
		<div class="pane-header">
			<div class="pane-title">
				<span class="pane-name">Agent</span>
				<button
					type="button"
					class="model-chip"
					class:open={showModelPicker}
					onclick={() => { const next = !showModelPicker; closeMenus(); showModelPicker = next; }}
					title="Change model"
					aria-haspopup="menu"
					aria-expanded={showModelPicker}
				>
					{modelLabel}
					<ChevronDown class="h-3 w-3" />
				</button>
			</div>
			<div class="pane-actions">
				{#if confirmingReset}
					<div class="confirm-reset">
						<span class="confirm-label">Start a new chat?</span>
						<button type="button" class="k-btn k-btn-sm k-btn-ghost" onclick={cancelReset}>Cancel</button>
						<button type="button" class="k-btn k-btn-sm k-btn-primary" onclick={handleReset}>New chat</button>
					</div>
				{:else}
					<button
						type="button"
						class="k-icon-btn"
						class:active={showHistory}
						onclick={() => { const next = !showHistory; closeMenus(); showHistory = next; }}
						title="Conversation history"
						aria-label="Conversation history"
						aria-expanded={showHistory}
					>
						<History class="h-4 w-4" />
					</button>
					<button type="button" class="k-icon-btn" onclick={handleReset} title="New conversation" aria-label="New conversation">
						<SquarePen class="h-4 w-4" />
					</button>
					<button
						type="button"
						class="k-icon-btn"
						class:active={showMoreMenu}
						onclick={() => { const next = !showMoreMenu; closeMenus(); showMoreMenu = next; }}
						title="More"
						aria-label="More options"
						aria-haspopup="menu"
						aria-expanded={showMoreMenu}
					>
						<MoreHorizontal class="h-4 w-4" />
					</button>
				{/if}
				<button type="button" class="k-icon-btn" onclick={onClose} title="Close (Esc)" aria-label="Close agent pane">
					<X class="h-4 w-4" />
				</button>
			</div>

			<!-- Token budget: hairline along the header's bottom edge -->
			{#if hasMessages}
				<div class="token-bar" title="~{estimatedTokens} tokens used ({tokenPercent}% of context)">
					<div
						class="token-fill"
						class:warn={tokenPercent > 60}
						class:danger={tokenPercent > 85}
						style="width: {tokenPercent}%"
					></div>
				</div>
			{/if}
		</div>

		<!-- Click-away layer for the header menus -->
		{#if showModelPicker || showMoreMenu || showHistory}
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div class="menu-scrim" onclick={closeMenus}></div>
		{/if}

		<!-- Model picker -->
		{#if showModelPicker}
			<div class="k-menu header-menu left" role="menu" aria-label="Model">
				<div class="k-menu-label">Model</div>
				{#each AVAILABLE_MODELS as m (m.id)}
					<button
						type="button"
						role="menuitemradio"
						aria-checked={m.id === selectedModel}
						class="k-menu-item"
						onclick={() => handleModelChange(m.id)}
					>
						<span class="flex-1">{m.label}</span>
						{#if m.id === selectedModel}
							<Check class="h-3.5 w-3.5 text-[var(--color-accent)]" />
						{/if}
					</button>
				{/each}
			</div>
		{/if}

		<!-- More menu -->
		{#if showMoreMenu}
			<div class="k-menu header-menu" role="menu" aria-label="More options">
				<button
					type="button"
					role="menuitem"
					class="k-menu-item"
					disabled={!hasMessages}
					onclick={() => { showMoreMenu = false; toggleSearch(); }}
				>
					<Search class="menu-icon h-4 w-4" />
					<span class="flex-1">Search conversation</span>
					<span class="k-kbd">⌘F</span>
				</button>
				<button
					type="button"
					role="menuitem"
					class="k-menu-item"
					disabled={!hasMessages}
					onclick={() => { showMoreMenu = false; exportConversation(); }}
				>
					<Download class="menu-icon h-4 w-4" />
					<span class="flex-1">Export as markdown</span>
				</button>
				<button
					type="button"
					role="menuitem"
					class="k-menu-item"
					disabled={!hasAssistantMessages || session.thinking || distilling}
					onclick={() => { showMoreMenu = false; handleDistillAndSave(); }}
				>
					<FilePlus class="menu-icon h-4 w-4" />
					<span class="flex-1">Save conversation as note</span>
				</button>
				<div class="k-menu-sep"></div>
				<button type="button" role="menuitemcheckbox" aria-checked={soundEnabled} class="k-menu-item" onclick={toggleSound}>
					{#if soundEnabled}
						<Volume2 class="menu-icon h-4 w-4" />
					{:else}
						<VolumeX class="menu-icon h-4 w-4" />
					{/if}
					<span class="flex-1">Reply sound</span>
					{#if soundEnabled}
						<Check class="h-3.5 w-3.5 text-[var(--color-accent)]" />
					{/if}
				</button>
			</div>
		{/if}

		<!-- Conversation history -->
		{#if showHistory}
			<div class="k-menu header-menu history-menu" role="menu" aria-label="Recent conversations">
				<div class="k-menu-label">Recent conversations</div>
				{#if historyIndex.length === 0}
					<div class="history-empty">No conversations yet</div>
				{:else}
					<div class="history-list">
						{#each historyIndex as conv (conv.id)}
							<div class="history-item" class:active={conv.id === activeConversationId}>
								{#if editingTitleId === conv.id}
									<input
										class="k-input title-edit-input"
										bind:value={editingTitleText}
										onkeydown={handleTitleKeydown}
										onblur={saveTitle}
										aria-label="Conversation title"
										use:autofocus
									/>
								{:else}
									<button type="button" class="history-item-btn" onclick={() => switchConversation(conv.id)}>
										<span class="history-item-title">{conv.title}</span>
										<span class="history-item-meta">{conv.messageCount} msg{conv.messageCount === 1 ? '' : 's'} · {relativeTime(conv.updatedAt)}</span>
									</button>
									<button
										type="button"
										class="history-item-action"
										onclick={(e) => { e.stopPropagation(); startEditTitle(conv.id, conv.title); }}
										title="Rename conversation"
										aria-label="Rename conversation"
									>
										<Pencil class="h-3.5 w-3.5" />
									</button>
								{/if}
								<button
									type="button"
									class="history-item-action danger"
									onclick={(e) => { e.stopPropagation(); deleteFromHistory(conv.id); }}
									title="Delete conversation"
									aria-label="Delete conversation"
								>
									<Trash2 class="h-3.5 w-3.5" />
								</button>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		{/if}

		<!-- Search bar -->
		{#if showSearch}
			<div class="search-bar">
				<Search class="h-3.5 w-3.5 shrink-0 text-[var(--color-text-faint)]" />
				<input
					bind:this={searchInputEl}
					bind:value={searchQuery}
					type="text"
					placeholder="Search conversation…"
					aria-label="Search conversation"
					class="search-input"
					onkeydown={(e) => { if (e.key === 'Escape') { showSearch = false; searchQuery = ''; } }}
				/>
				{#if searchQuery && searchQuery.length >= 2}
					<span class="search-count">{searchMatchCount} match{searchMatchCount === 1 ? '' : 'es'}</span>
				{/if}
				<button
					type="button"
					class="k-icon-btn !h-6 !w-6"
					onclick={() => { if (searchQuery) { searchQuery = ''; searchInputEl?.focus(); } else { showSearch = false; } }}
					aria-label={searchQuery ? 'Clear search' : 'Close search'}
				>
					<X class="h-3.5 w-3.5" />
				</button>
			</div>
		{/if}

		<!-- Saved note notification -->
		{#if savedNote}
			<div class="saved-bar" role="status">
				<Check class="h-3.5 w-3.5 shrink-0 text-[var(--color-accent)]" />
				<span class="saved-text">Saved as note</span>
				<button type="button" class="k-btn k-btn-ghost k-btn-sm" onclick={() => goToNote(savedNote!.id)}>
					Open <ExternalLink class="h-3 w-3" />
				</button>
				<button type="button" class="k-icon-btn !h-6 !w-6" onclick={() => (savedNote = null)} aria-label="Dismiss">
					<X class="h-3.5 w-3.5" />
				</button>
			</div>
		{/if}

		<!-- Messages -->
		<div class="messages-wrap">
			<div class="messages" bind:this={messagesContainer} onscroll={handleScroll}>
				{#if session.messages.length === 0 && !session.thinking}
					<div class="empty">
						<Sparkles class="h-5 w-5 text-[var(--color-text-faint)]" />
						<p class="empty-title">Ask anything, or tell me what to do</p>
						<p class="hint">
							I can search your vault, create notes, add action items, and propose reminders.
						</p>
						<div class="starters">
							{#each STARTERS as starter}
								<button type="button" class="starter" onclick={() => useStarter(starter)}>
									{starter}
								</button>
							{/each}
						</div>
					</div>
				{/if}

				{#each session.messages as msg (msg.id)}
					{#if msg.role === 'user'}
						<div class="msg msg-user">
							{#if editingMsgId === msg.id}
								<div class="edit-box">
									<textarea
										class="k-input edit-textarea"
										bind:value={editText}
										onkeydown={(e) => handleEditKeydown(e, msg.id)}
										rows="2"
										aria-label="Edit message"
										use:autofocus
									></textarea>
									<div class="edit-actions">
										<button type="button" class="k-btn k-btn-sm k-btn-ghost" onclick={cancelEdit}>Cancel</button>
										<button type="button" class="k-btn k-btn-sm k-btn-primary" onclick={() => submitEdit(msg.id)}>Re-send</button>
									</div>
								</div>
							{:else}
								<div class="user-block">
									{#if searchQuery && searchQuery.length >= 2}
										{@html highlightMatches(msg.content, searchQuery)}
									{:else}
										<MarkdownRenderer content={msg.content} />
									{/if}
									{#if msg.images?.length}
										<div class="msg-images">
											{#each msg.images as src}
												<img {src} alt="Attached" class="msg-image-thumb" />
											{/each}
										</div>
									{/if}
								</div>
								<div class="msg-footer user">
									<span class="msg-time">{relativeTime(msg.createdAt)}</span>
									<div class="msg-actions">
										<button
											type="button"
											class="msg-action-btn"
											onclick={() => startEditMessage(msg)}
											title="Edit & re-send"
											aria-label="Edit and re-send"
										>
											<Pencil class="h-3 w-3" />
										</button>
									</div>
								</div>
							{/if}
						</div>
					{:else if msg.role === 'assistant'}
						{#if msg.toolCalls && msg.toolCalls.length > 0}
							<div class="msg-tool">
								{#each msg.toolCalls as tc (tc.id)}
									{@const Icon = toolIcon(tc.name)}
									{@const isExpanded = expandedTools.has(tc.id)}
									{@const memLinks = extractMemoryLinks(tc)}
									<div class="tool-line" class:error={tc.status === 'error'}>
										<button
											type="button"
											class="tool-header"
											onclick={() => toggleToolExpand(tc.id)}
											aria-expanded={isExpanded}
										>
											{#if tc.status === 'running'}
												<Loader2 class="h-3 w-3 shrink-0 animate-spin" />
											{:else}
												<Icon class="h-3 w-3 shrink-0" />
											{/if}
											<span class="tool-label">{toolLabel(tc)}</span>
											{#if tc.status === 'error'}
												<span class="tool-status">failed</span>
											{/if}
											{#if isExpanded}
												<ChevronDown class="tool-chevron h-3 w-3 shrink-0" />
											{:else}
												<ChevronRight class="tool-chevron h-3 w-3 shrink-0" />
											{/if}
										</button>
										{#if isExpanded && tc.result != null}
											<div class="tool-detail">
												{#if memLinks.length > 0}
													<div class="tool-links">
														{#each memLinks as link}
															<a href="/memory/{link.id}" class="tool-mem-link" onclick={(e) => { e.preventDefault(); onClose(); goto(`/memory/${link.id}`); }}>
																{link.title}
																<ExternalLink class="h-2.5 w-2.5" />
															</a>
														{/each}
													</div>
												{/if}
												<pre class="tool-result">{renderToolResult(tc)}</pre>
											</div>
										{/if}
									</div>
								{/each}
							</div>
						{/if}
						{#if msg.content}
							<div class="msg msg-assistant">
								<div class="assistant-body">
									{#if searchQuery && searchQuery.length >= 2}
										{@html highlightMatches(msg.content, searchQuery)}
									{:else}
										<MarkdownRenderer content={msg.content} />
									{/if}
								</div>
								<div class="msg-footer">
									<span class="msg-time">
										{relativeTime(msg.createdAt)}
										{#if session.thinking && session.streamStats && msg.id === session.messages[session.messages.length - 1]?.id}
											<span class="stream-speed">· {session.streamStats.tokensPerSec} tok/s</span>
										{/if}
									</span>
									<div class="msg-actions">
										<button type="button" class="msg-action-btn" onclick={() => copyMessage(msg.id, msg.content)} title="Copy" aria-label="Copy message">
											{#if copiedMsgId === msg.id}
												<Check class="h-3 w-3" />
											{:else}
												<Copy class="h-3 w-3" />
											{/if}
										</button>
										<button type="button" class="msg-action-btn" onclick={() => saveMessageAsNote(msg.content)} title="Save as note" aria-label="Save as note">
											<FilePlus class="h-3 w-3" />
										</button>
									</div>
								</div>
							</div>
						{/if}
					{/if}
				{/each}

				{#if session.thinking && session.thinkingStatus}
					<div class="thinking" role="status">
						<Loader2 class="h-3 w-3 animate-spin" />
						<span>{session.thinkingStatus}</span>
					</div>
				{/if}

				{#if session.error}
					<div class="error-bar" role="alert">{session.error}</div>
				{/if}

				<div bind:this={messagesEnd}></div>
			</div>

			<!-- Scroll to bottom -->
			{#if showScrollBtn}
				<button type="button" class="scroll-btn" onclick={scrollToBottom} title="Scroll to bottom" aria-label="Scroll to bottom">
					<ArrowDown class="h-3.5 w-3.5" />
				</button>
			{/if}
		</div>

		<!-- Composer -->
		<div class="composer-area">
			<!-- Autocomplete popup -->
			{#if ac && acItems.length > 0}
				<div class="k-menu ac-popup" role="listbox">
					<div class="k-menu-label">
						{#if ac.kind === 'wikilink'}Notes{:else if ac.kind === 'person'}People{:else if ac.kind === 'tag'}Tags{:else}Dates{/if}
					</div>
					{#each acItems as item, i}
						<button
							type="button"
							role="option"
							aria-selected={i === acIndex}
							class="k-menu-item ac-item"
							class:selected={i === acIndex}
							onmousedown={(e) => { e.preventDefault(); acceptAutocomplete(item.label); }}
							onmouseenter={() => (acIndex = i)}
						>
							<span class="ac-label">{ac.kind === 'tag' ? '#' : ac.kind === 'person' ? '@' : ac.kind === 'date' ? '//' : ''}{item.label}</span>
							{#if item.detail}
								<span class="ac-detail">{item.detail}</span>
							{/if}
						</button>
					{/each}
				</div>
			{/if}

			<div class="composer" class:disabled={session.thinking || distilling}>
				<!-- Pending image previews -->
				{#if pendingImages.length > 0}
					<div class="pending-images">
						{#each pendingImages as src, i}
							<div class="pending-img-wrap">
								<img {src} alt="Pending" class="pending-img" />
								<button type="button" class="pending-img-remove" onclick={() => removePendingImage(i)} aria-label="Remove image">
									<X class="h-2.5 w-2.5" />
								</button>
							</div>
						{/each}
					</div>
				{/if}
				<textarea
					bind:this={textareaEl}
					bind:value={input}
					oninput={autoGrow}
					onkeydown={handleKeydown}
					onpaste={handlePaste}
					ondrop={handleDrop}
					ondragover={handleDragOver}
					placeholder={pendingImages.length > 0 ? 'Ask about the image…' : 'Ask or instruct…'}
					aria-label="Message the agent"
					disabled={session.thinking || distilling}
					class="chat-input"
					rows="1"
				></textarea>
				<div class="composer-toolbar">
					<button
						type="button"
						class="k-icon-btn voice-btn"
						class:recording={voiceRecording}
						disabled={session.thinking || distilling || voiceTranscribing}
						onpointerdown={handleVoiceStart}
						onpointerup={handleVoiceStop}
						onpointerleave={() => voiceRecording && handleVoiceStop()}
						title={voiceRecording ? 'Release to transcribe' : voiceTranscribing ? 'Transcribing…' : 'Hold to dictate'}
						aria-label={voiceRecording ? 'Release to transcribe' : 'Hold to dictate'}
					>
						{#if voiceTranscribing}
							<Loader2 class="h-4 w-4 animate-spin" />
						{:else}
							<Mic class="h-4 w-4" />
						{/if}
					</button>
					<span class="composer-hint">
						{#if distilling}
							<Loader2 class="h-3 w-3 animate-spin" /> Saving conversation as note…
						{:else if voiceRecording}
							Listening — release to transcribe
						{:else if !hasSentMessage}
							<span class="k-kbd">↵</span> send · <span class="k-kbd">⇧↵</span> newline
						{/if}
					</span>
					<button
						type="button"
						class="send-btn"
						disabled={!input.trim() || session.thinking || distilling}
						onclick={handleSend}
						title="Send (Enter)"
						aria-label="Send message"
					>
						{#if session.thinking}
							<Loader2 class="h-3.5 w-3.5 animate-spin" />
						{:else}
							<ArrowUp class="h-4 w-4" />
						{/if}
					</button>
				</div>
			</div>
		</div>
	</aside>
</div>

<style>
	/* --- Wrapper --- */
	.agent-pane-wrapper {
		position: relative;
		display: flex;
		height: 100%;
		flex-shrink: 0;
		transition: opacity 0.1s;
	}

	/* Invisible grab strip straddling the border; accent line on hover/drag */
	.resize-handle {
		position: absolute;
		top: 0;
		bottom: 0;
		left: -3px;
		z-index: 31;
		width: 6px;
		display: flex;
		justify-content: center;
		cursor: col-resize;
	}

	.resize-bar {
		width: 2px;
		height: 100%;
		background: transparent;
		transition: background-color 0.15s;
	}

	.resize-handle:hover .resize-bar,
	.resize-bar.active {
		background: var(--color-accent);
	}

	/* --- Pane --- */
	.agent-pane {
		position: relative;
		z-index: 30;
		display: flex;
		flex: 1;
		flex-direction: column;
		min-width: 0;
		height: 100%;
		border-left: 1px solid var(--color-border);
		background: var(--color-bg);
		animation: paneIn 160ms var(--ease-out);
	}

	@keyframes paneIn {
		from { transform: translateX(12px); opacity: 0; }
		to { transform: translateX(0); opacity: 1; }
	}

	/* --- Header --- */
	.pane-header {
		position: relative;
		display: flex;
		flex-shrink: 0;
		justify-content: space-between;
		align-items: center;
		gap: 0.5rem;
		height: 2.75rem;
		padding: 0 0.5rem 0 0.875rem;
		border-bottom: 1px solid var(--color-border);
	}

	.pane-title {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		min-width: 0;
	}

	.pane-name {
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--color-text);
	}

	.model-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.1875rem;
		min-width: 0;
		height: 1.5rem;
		padding: 0 0.375rem;
		border-radius: var(--radius-sm);
		font-size: 0.75rem;
		color: var(--color-text-faint);
		white-space: nowrap;
	}

	.model-chip:hover,
	.model-chip.open {
		background: var(--color-hover);
		color: var(--color-text-muted);
	}

	.pane-actions {
		display: flex;
		align-items: center;
		gap: 0.125rem;
	}

	.pane-actions .k-icon-btn.active {
		background: var(--color-hover);
		color: var(--color-text);
	}

	.confirm-reset {
		display: flex;
		align-items: center;
		gap: 0.25rem;
	}

	.confirm-label {
		margin-right: 0.25rem;
		font-size: 0.75rem;
		color: var(--color-text-muted);
		white-space: nowrap;
	}

	/* --- Token budget hairline --- */
	.token-bar {
		position: absolute;
		left: 0;
		right: 0;
		bottom: -1px;
		height: 1px;
		pointer-events: auto;
	}

	.token-fill {
		height: 100%;
		background: var(--color-accent);
		opacity: 0.6;
		transition: width 0.3s;
	}

	.token-fill.warn {
		background: #df8e1d;
		opacity: 0.8;
	}

	.token-fill.danger {
		background: var(--color-danger);
		opacity: 1;
	}

	/* --- Header menus --- */
	.menu-scrim {
		position: absolute;
		inset: 0;
		z-index: 39;
	}

	.header-menu {
		position: absolute;
		top: 2.625rem;
		right: 0.5rem;
		z-index: 40;
		width: 15rem;
		max-width: calc(100% - 1rem);
	}

	.header-menu.left {
		left: 0.5rem;
		right: auto;
	}

	.header-menu :global(.menu-icon) {
		flex-shrink: 0;
		color: var(--color-text-faint);
	}

	.header-menu .k-menu-item:disabled {
		opacity: 0.45;
		pointer-events: none;
	}

	.history-menu {
		width: 20rem;
	}

	.history-empty {
		padding: 0.75rem 0.5rem;
		font-size: 0.8125rem;
		color: var(--color-text-muted);
	}

	.history-list {
		max-height: 18rem;
		overflow-y: auto;
		overscroll-behavior: contain;
	}

	.history-item {
		display: flex;
		align-items: center;
		gap: 0.125rem;
		padding-right: 0.25rem;
		border-radius: var(--radius-sm);
	}

	.history-item:hover {
		background: var(--color-hover);
	}

	.history-item.active {
		background: var(--color-active, var(--color-hover));
	}

	.history-item-btn {
		display: flex;
		flex: 1;
		flex-direction: column;
		min-width: 0;
		padding: 0.3125rem 0.5rem;
		text-align: left;
	}

	.history-item-title {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 0.8125rem;
		color: var(--color-text);
	}

	.history-item-meta {
		font-size: 0.6875rem;
		color: var(--color-text-faint);
	}

	.history-item-action {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.5rem;
		height: 1.5rem;
		flex-shrink: 0;
		border-radius: var(--radius-sm);
		color: var(--color-text-faint);
		opacity: 0;
	}

	.history-item:hover .history-item-action,
	.history-item-action:focus-visible {
		opacity: 1;
	}

	.history-item-action:hover {
		background: var(--color-hover);
		color: var(--color-text);
	}

	.history-item-action.danger:hover {
		color: var(--color-danger);
	}

	.title-edit-input {
		flex: 1;
		height: 1.875rem;
		margin: 0.125rem 0;
		font-size: 0.8125rem;
	}

	/* --- Search bar --- */
	.search-bar {
		display: flex;
		flex-shrink: 0;
		align-items: center;
		gap: 0.375rem;
		height: 2.25rem;
		padding: 0 0.5rem 0 0.875rem;
		border-bottom: 1px solid var(--color-border);
	}

	.search-input {
		flex: 1;
		min-width: 0;
		border: none;
		background: none;
		font-size: 0.8125rem;
		color: var(--color-text);
		outline: none;
	}

	.search-input::placeholder {
		color: var(--color-text-faint);
	}

	.search-count {
		font-size: 0.6875rem;
		color: var(--color-text-faint);
		white-space: nowrap;
	}

	/* --- Search highlighting --- */
	:global(.search-highlight) {
		padding: 0 0.125rem;
		border-radius: 0.125rem;
		background: color-mix(in srgb, #df8e1d 30%, transparent);
		color: inherit;
	}

	/* --- Saved note bar --- */
	.saved-bar {
		display: flex;
		flex-shrink: 0;
		align-items: center;
		gap: 0.375rem;
		margin: 0.5rem 0.75rem 0;
		padding: 0.1875rem 0.25rem 0.1875rem 0.625rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-bg);
		box-shadow: var(--shadow-sm);
		font-size: 0.8125rem;
		color: var(--color-text);
		animation: slideDownFadeIn 150ms var(--ease-out);
	}

	.saved-text {
		flex: 1;
		min-width: 0;
	}

	/* --- Messages --- */
	.messages-wrap {
		position: relative;
		display: flex;
		flex: 1;
		min-height: 0;
	}

	.messages {
		display: flex;
		flex: 1;
		flex-direction: column;
		gap: 1rem;
		padding: 1rem 1rem 1.5rem;
		overflow-y: auto;
		overscroll-behavior: contain;
	}

	/* --- Empty state --- */
	.empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.375rem;
		margin: auto;
		padding: 2rem 0.5rem;
		text-align: center;
		font-size: 0.8125rem;
		color: var(--color-text-muted);
	}

	.empty-title {
		margin-top: 0.25rem;
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--color-text);
	}

	.empty .hint {
		max-width: 17rem;
		font-size: 0.75rem;
		color: var(--color-text-faint);
	}

	.starters {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		width: 100%;
		max-width: 17rem;
		margin-top: 0.75rem;
	}

	.starter {
		padding: 0.375rem 0.625rem;
		border-radius: var(--radius-md);
		font-size: 0.8125rem;
		color: var(--color-text-muted);
		text-align: left;
	}

	.starter:hover,
	.starter:focus-visible {
		background: var(--color-hover);
		color: var(--color-text);
		outline: none;
	}

	/* --- Messages: user = quiet block, assistant = plain text --- */
	.msg {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		min-width: 0;
	}

	.user-block {
		padding: 0.5rem 0.75rem;
		border-radius: var(--radius-md);
		background: var(--color-hover);
		font-size: 0.875rem;
		line-height: 1.55;
		color: var(--color-text);
		overflow-wrap: anywhere;
	}

	.assistant-body {
		font-size: 0.875rem;
		line-height: 1.6;
		color: var(--color-text);
		overflow-wrap: anywhere;
	}

	.user-block :global(.markdown-content),
	.assistant-body :global(.markdown-content) {
		font-size: inherit;
		line-height: inherit;
	}

	.user-block :global(.markdown-content p:last-child),
	.assistant-body :global(.markdown-content p:last-child) {
		margin-bottom: 0;
	}

	.msg-images {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
		margin-top: 0.375rem;
	}

	.msg-image-thumb {
		width: 3rem;
		height: 3rem;
		object-fit: cover;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
	}

	/* --- Timestamps & hover actions --- */
	.msg-footer {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		min-height: 1.375rem;
	}

	.msg-footer.user {
		flex-direction: row-reverse;
		justify-content: flex-start;
		padding: 0 0.25rem;
	}

	.msg-time {
		font-size: 0.6875rem;
		color: var(--color-text-faint);
		opacity: 0;
		transition: opacity 0.12s;
	}

	.stream-speed {
		font-variant-numeric: tabular-nums;
	}

	.msg-actions {
		display: flex;
		gap: 0.125rem;
		opacity: 0;
		transition: opacity 0.12s;
	}

	.msg:hover .msg-actions,
	.msg:hover .msg-time,
	.msg-actions:focus-within {
		opacity: 1;
	}

	/* Touch screens have no hover: keep the actions reachable */
	@media (hover: none) {
		.msg-actions,
		.msg-time {
			opacity: 1;
		}
	}

	.msg-action-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.375rem;
		height: 1.375rem;
		border-radius: var(--radius-sm);
		color: var(--color-text-faint);
	}

	.msg-action-btn:hover {
		background: var(--color-hover);
		color: var(--color-text);
	}

	/* --- Edit box --- */
	.edit-box {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}

	.edit-textarea {
		min-height: 3.5rem;
		font-size: 0.875rem;
		resize: none;
	}

	.edit-actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.25rem;
	}

	/* --- Tool calls: compact faint status lines --- */
	.msg-tool {
		display: flex;
		flex-direction: column;
		gap: 0.0625rem;
		margin: -0.375rem 0;
	}

	.tool-header {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		max-width: 100%;
		padding: 0.125rem 0.25rem;
		margin-left: -0.25rem;
		border-radius: var(--radius-sm);
		font-size: 0.75rem;
		color: var(--color-text-faint);
		text-align: left;
	}

	.tool-header:hover {
		color: var(--color-text-muted);
		background: var(--color-hover);
	}

	.tool-header :global(.tool-chevron) {
		opacity: 0;
	}

	.tool-header:hover :global(.tool-chevron),
	.tool-header[aria-expanded='true'] :global(.tool-chevron) {
		opacity: 1;
	}

	.tool-label {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.tool-line.error .tool-header {
		color: var(--color-danger);
	}

	.tool-status {
		flex-shrink: 0;
		font-size: 0.6875rem;
	}

	.tool-detail {
		margin: 0.125rem 0 0.375rem 1.125rem;
		padding-left: 0.625rem;
		border-left: 1px solid var(--color-border);
	}

	.tool-links {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
		margin-bottom: 0.375rem;
	}

	.tool-mem-link {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.0625rem 0.375rem;
		border-radius: var(--radius-sm);
		background: var(--color-hover);
		font-size: 0.75rem;
		color: var(--color-text);
		text-decoration: none;
	}

	.tool-mem-link:hover {
		background: var(--color-active, var(--color-hover));
		color: var(--color-accent);
	}

	.tool-result {
		max-height: 200px;
		margin: 0;
		overflow-y: auto;
		font-family: var(--font-mono, ui-monospace, monospace);
		font-size: 0.6875rem;
		line-height: 1.5;
		color: var(--color-text-muted);
		white-space: pre-wrap;
		word-break: break-word;
	}

	/* --- Thinking --- */
	.thinking {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		font-size: 0.75rem;
		color: var(--color-text-faint);
	}

	/* --- Error --- */
	.error-bar {
		padding: 0.5rem 0.75rem;
		border-radius: var(--radius-md);
		background: color-mix(in srgb, var(--color-danger) 10%, transparent);
		font-size: 0.8125rem;
		color: var(--color-danger);
	}

	/* --- Scroll to bottom --- */
	.scroll-btn {
		position: absolute;
		bottom: 0.75rem;
		left: 50%;
		z-index: 5;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.75rem;
		height: 1.75rem;
		border: 1px solid var(--color-border);
		border-radius: 999px;
		background: var(--color-bg);
		color: var(--color-text-muted);
		box-shadow: var(--shadow-md);
		transform: translateX(-50%);
	}

	.scroll-btn:hover {
		color: var(--color-text);
		background: var(--color-hover);
	}

	/* --- Composer --- */
	.composer-area {
		position: relative;
		flex-shrink: 0;
		padding: 0 0.75rem 0.75rem;
		padding-bottom: calc(0.75rem + env(safe-area-inset-bottom, 0px));
	}

	.composer {
		display: flex;
		flex-direction: column;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		background: var(--color-bg);
		box-shadow: var(--shadow-sm);
		transition:
			border-color 120ms var(--ease-out),
			box-shadow 120ms var(--ease-out);
	}

	.composer:focus-within {
		border-color: color-mix(in srgb, var(--color-accent) 60%, var(--color-border));
		box-shadow: 0 0 0 3px var(--color-accent-soft);
	}

	.composer.disabled {
		background: var(--color-bg-secondary);
	}

	.chat-input {
		width: 100%;
		max-height: 120px;
		padding: 0.625rem 0.75rem 0.25rem;
		border: none;
		background: transparent;
		font-family: inherit;
		font-size: 0.875rem;
		line-height: 1.5;
		color: var(--color-text);
		outline: none;
		resize: none;
		overflow-y: auto;
	}

	.chat-input::placeholder {
		color: var(--color-text-faint);
	}

	.chat-input:disabled {
		cursor: not-allowed;
	}

	.composer-toolbar {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.25rem 0.375rem 0.375rem;
	}

	.composer-hint {
		display: flex;
		flex: 1;
		align-items: center;
		gap: 0.25rem;
		min-width: 0;
		overflow: hidden;
		white-space: nowrap;
		font-size: 0.6875rem;
		color: var(--color-text-faint);
	}

	@media (hover: none) {
		.composer-hint .k-kbd {
			display: none;
		}
	}

	.voice-btn {
		touch-action: none;
	}

	.voice-btn.recording {
		background: var(--color-danger);
		color: #fff;
		animation: pulse 1.5s infinite;
	}

	@keyframes pulse {
		0%, 100% { opacity: 1; }
		50% { opacity: 0.7; }
	}

	.send-btn {
		display: flex;
		flex-shrink: 0;
		align-items: center;
		justify-content: center;
		width: 1.75rem;
		height: 1.75rem;
		border-radius: var(--radius-md);
		background: var(--color-accent);
		color: #fff;
		transition: background-color 120ms var(--ease-out);
	}

	:global(:root.dark) .send-btn {
		color: #1e1e2e;
	}

	@media (prefers-color-scheme: dark) {
		:global(:root:not(.light)) .send-btn {
			color: #1e1e2e;
		}
	}

	.send-btn:hover:not(:disabled) {
		background: var(--color-accent-hover);
	}

	.send-btn:disabled {
		background: var(--color-hover);
		color: var(--color-text-faint);
		cursor: not-allowed;
	}

	/* --- Pending images --- */
	.pending-images {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
		padding: 0.5rem 0.75rem 0;
	}

	.pending-img-wrap {
		position: relative;
	}

	.pending-img {
		width: 3rem;
		height: 3rem;
		object-fit: cover;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
	}

	.pending-img-remove {
		position: absolute;
		top: -5px;
		right: -5px;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1rem;
		height: 1rem;
		border: 1px solid var(--color-border);
		border-radius: 50%;
		background: var(--color-bg);
		color: var(--color-text-muted);
		box-shadow: var(--shadow-sm);
	}

	.pending-img-remove:hover {
		color: var(--color-danger);
	}

	/* --- Autocomplete popup (floats above the composer) --- */
	.ac-popup {
		position: absolute;
		left: 0.75rem;
		right: 0.75rem;
		bottom: calc(100% - 0.25rem);
		z-index: 20;
		max-height: 220px;
		overflow-y: auto;
	}

	.ac-item {
		justify-content: space-between;
	}

	.ac-item.selected {
		background: var(--color-hover);
	}

	.ac-label {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.ac-detail {
		flex-shrink: 0;
		margin-left: 0.5rem;
		font-size: 0.6875rem;
		color: var(--color-text-faint);
	}

	/* --- Mobile: full-screen sheet --- */
	@media (max-width: 768px) {
		.agent-pane-wrapper {
			position: fixed;
			inset: 0;
			z-index: 50;
			width: 100% !important;
		}

		.agent-pane {
			border-left: none;
		}

		.pane-header {
			height: calc(2.75rem + env(safe-area-inset-top, 0px));
			padding-top: env(safe-area-inset-top, 0px);
		}

		.header-menu {
			top: calc(2.625rem + env(safe-area-inset-top, 0px));
		}
	}
</style>
