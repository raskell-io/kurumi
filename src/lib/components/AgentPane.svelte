<script lang="ts">
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
	import { addMemoryObject } from '$lib/db';
	import { goto } from '$app/navigation';
	import { startPushToTalk, type RecorderHandle } from '$lib/voice';
	import { inferenceRouter } from '$lib/inference';
	import MarkdownRenderer from './MarkdownRenderer.svelte';
	import {
		Bot,
		User,
		Send,
		X,
		Wrench,
		Search,
		FileText,
		FilePlus,
		CheckSquare,
		Bell,
		RotateCcw,
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
		VolumeX,
		Settings2
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
				} else if (showModelPicker) {
					showModelPicker = false;
				} else {
					onClose();
				}
				return;
			}
			// Cmd+F within pane → open conversation search
			if ((e.metaKey || e.ctrlKey) && e.key === 'f' && paneEl?.contains(document.activeElement)) {
				e.preventDefault();
				showSearch = !showSearch;
				if (showSearch) {
					tick().then(() => searchInputEl?.focus());
				} else {
					searchQuery = '';
				}
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

	// --- Textarea auto-grow ---------------------------------------------------

	function autoGrow() {
		if (!textareaEl) return;
		textareaEl.style.height = 'auto';
		textareaEl.style.height = Math.min(textareaEl.scrollHeight, 120) + 'px';
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
		// Fire-and-forget auto-title after first exchange
		maybeAutoTitle();
	}

	function handleKeydown(e: KeyboardEvent) {
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
			case 'create_memory': return FileText;
			case 'add_action_item': return CheckSquare;
			case 'add_reminder': return Bell;
			default: return Wrench;
		}
	}

	function toolLabel(tc: ToolCall): string {
		switch (tc.name) {
			case 'search_memory': return `Searched: "${tc.args.query ?? ''}"`;
			case 'create_memory': return `Created note: "${tc.args.title ?? ''}"`;
			case 'add_action_item': return `Added action: "${tc.args.text ?? ''}"`;
			case 'add_reminder': return `Proposed reminder: "${tc.args.text ?? ''}"`;
			case 'generate_daily_digest': return 'Generated daily digest';
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
				<Bot class="h-4 w-4 text-[var(--color-accent)]" />
				<span>Kurumi Agent</span>
			</div>
			<div class="pane-actions">
				{#if confirmingReset}
					<div class="confirm-reset">
						<span class="confirm-label">New chat?</span>
						<button class="confirm-btn yes" onclick={handleReset}>Yes</button>
						<button class="confirm-btn no" onclick={cancelReset}>No</button>
					</div>
				{:else}
					<button class="pane-btn" onclick={() => (showModelPicker = !showModelPicker)} title="Model: {selectedModel}">
						<Settings2 class="h-3.5 w-3.5" />
					</button>
					<button class="pane-btn" onclick={toggleSound} title={soundEnabled ? 'Mute notifications' : 'Enable notifications'}>
						{#if soundEnabled}
							<Volume2 class="h-3.5 w-3.5" />
						{:else}
							<VolumeX class="h-3.5 w-3.5" />
						{/if}
					</button>
					<button class="pane-btn" onclick={() => (showHistory = !showHistory)} title="Conversation history">
						<History class="h-3.5 w-3.5" />
					</button>
					{#if hasMessages}
						<button class="pane-btn" onclick={() => { showSearch = !showSearch; if (showSearch) tick().then(() => searchInputEl?.focus()); else searchQuery = ''; }} title="Search conversation">
							<Search class="h-3.5 w-3.5" />
						</button>
						<button class="pane-btn" onclick={exportConversation} title="Export as markdown">
							<Download class="h-3.5 w-3.5" />
						</button>
					{/if}
					<button class="pane-btn" onclick={handleReset} title="New conversation">
						<RotateCcw class="h-3.5 w-3.5" />
					</button>
				{/if}
				<button class="pane-btn" onclick={onClose} title="Close (Esc)">
					<X class="h-3.5 w-3.5" />
				</button>
			</div>
		</div>

		<!-- Token budget bar -->
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

		<!-- Model picker dropdown -->
		{#if showModelPicker}
			<div class="model-picker">
				{#each AVAILABLE_MODELS as m (m.id)}
					<button
						class="model-option"
						class:active={m.id === selectedModel}
						onclick={() => handleModelChange(m.id)}
					>
						{m.label}
						{#if m.id === selectedModel}
							<Check class="h-3 w-3" />
						{/if}
					</button>
				{/each}
			</div>
		{/if}

		<!-- Search bar -->
		{#if showSearch}
			<div class="search-bar">
				<Search class="h-3.5 w-3.5 shrink-0 text-[var(--color-text-muted)]" />
				<input
					bind:this={searchInputEl}
					bind:value={searchQuery}
					type="text"
					placeholder="Search conversation..."
					class="search-input"
					onkeydown={(e) => { if (e.key === 'Escape') { showSearch = false; searchQuery = ''; } }}
				/>
				{#if searchQuery && searchQuery.length >= 2}
					<span class="search-count">{searchMatchCount} match{searchMatchCount === 1 ? '' : 'es'}</span>
				{/if}
				{#if searchQuery}
					<button class="search-clear" onclick={() => { searchQuery = ''; searchInputEl?.focus(); }}>
						<X class="h-3 w-3" />
					</button>
				{/if}
			</div>
		{/if}

		<!-- Conversation history dropdown -->
		{#if showHistory}
			<div class="history-dropdown">
				<div class="history-header">
					<span>Recent conversations</span>
					<button class="pane-btn" onclick={() => (showHistory = false)}>
						<X class="h-3 w-3" />
					</button>
				</div>
				{#if historyIndex.length === 0}
					<div class="history-empty">No conversations yet</div>
				{:else}
					<div class="history-list">
						{#each historyIndex as conv (conv.id)}
							<div class="history-item" class:active={conv.id === activeConversationId}>
								{#if editingTitleId === conv.id}
									<input
										class="title-edit-input"
										bind:value={editingTitleText}
										onkeydown={handleTitleKeydown}
										onblur={saveTitle}
									/>
								{:else}
									<button class="history-item-btn" onclick={() => switchConversation(conv.id)}>
										<span class="history-item-title">{conv.title}</span>
										<span class="history-item-meta">{conv.messageCount} msg{conv.messageCount === 1 ? '' : 's'} &middot; {relativeTime(conv.updatedAt)}</span>
									</button>
									<button
										class="history-edit-btn"
										onclick={(e) => { e.stopPropagation(); startEditTitle(conv.id, conv.title); }}
										title="Rename conversation"
									>
										<Pencil class="h-3 w-3" />
									</button>
								{/if}
								<button
									class="history-delete-btn"
									onclick={(e) => { e.stopPropagation(); deleteFromHistory(conv.id); }}
									title="Delete conversation"
								>
									<Trash2 class="h-3 w-3" />
								</button>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		{/if}

		<!-- Saved note notification -->
		{#if savedNote}
			<div class="saved-bar">
				<Check class="h-3.5 w-3.5" />
				<span class="saved-text">Note created</span>
				<button class="saved-link" onclick={() => goToNote(savedNote!.id)}>
					Open <ExternalLink class="h-3 w-3" />
				</button>
				<button class="saved-dismiss" onclick={() => (savedNote = null)}>
					<X class="h-3 w-3" />
				</button>
			</div>
		{/if}

		<!-- Messages -->
		<div class="messages" bind:this={messagesContainer} onscroll={handleScroll}>
			{#if session.messages.length === 0 && !session.thinking}
				<div class="empty">
					<Bot class="h-8 w-8 opacity-30" />
					<p>Ask me anything or tell me what to do.</p>
					<p class="hint">
						I can search your vault, create notes, add action items,
						and propose reminders.
					</p>
					<div class="starters">
						{#each STARTERS as starter}
							<button class="starter-chip" onclick={() => useStarter(starter)}>
								{starter}
							</button>
						{/each}
					</div>
				</div>
			{/if}

			{#each session.messages as msg (msg.id)}
				{#if msg.role === 'user'}
					<div class="msg msg-user">
						<div class="msg-avatar"><User class="h-3.5 w-3.5" /></div>
						{#if editingMsgId === msg.id}
							<div class="edit-bubble">
								<textarea
									class="edit-textarea"
									bind:value={editText}
									onkeydown={(e) => handleEditKeydown(e, msg.id)}
									rows="2"
								></textarea>
								<div class="edit-actions">
									<button class="edit-btn cancel" onclick={cancelEdit}>Cancel</button>
									<button class="edit-btn submit" onclick={() => submitEdit(msg.id)}>Re-send</button>
								</div>
							</div>
						{:else}
							<div class="msg-body msg-body-user-md">
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
								<div class="msg-time msg-time-user">
									<button
										class="edit-msg-btn"
										onclick={() => startEditMessage(msg)}
										title="Edit & re-send"
									>
										<Pencil class="h-2.5 w-2.5" />
									</button>
									{relativeTime(msg.createdAt)}
								</div>
							</div>
						{/if}
					</div>
				{:else if msg.role === 'assistant'}
					{#if msg.toolCalls && msg.toolCalls.length > 0}
						<div class="msg msg-tool">
							{#each msg.toolCalls as tc (tc.id)}
								{@const Icon = toolIcon(tc.name)}
								{@const isExpanded = expandedTools.has(tc.id)}
								{@const memLinks = extractMemoryLinks(tc)}
								<button class="tool-card" class:error={tc.status === 'error'} onclick={() => toggleToolExpand(tc.id)}>
									<div class="tool-header">
										{#if isExpanded}
											<ChevronDown class="h-3 w-3 shrink-0" />
										{:else}
											<ChevronRight class="h-3 w-3 shrink-0" />
										{/if}
										<Icon class="h-3 w-3 shrink-0" />
										<span class="tool-label">{toolLabel(tc)}</span>
										<span class="tool-status">{tc.status}</span>
									</div>
									{#if isExpanded && tc.result != null}
										{#if memLinks.length > 0}
											<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
											<div class="tool-links" onclick={(e) => e.stopPropagation()}>
												{#each memLinks as link}
													<a href="/memory/{link.id}" class="tool-mem-link" onclick={(e) => { e.stopPropagation(); onClose(); goto(`/memory/${link.id}`); }}>
														{link.title}
														<ExternalLink class="h-2.5 w-2.5" />
													</a>
												{/each}
											</div>
										{/if}
										<pre class="tool-result">{renderToolResult(tc)}</pre>
									{/if}
								</button>
							{/each}
						</div>
					{/if}
					{#if msg.content}
						<div class="msg msg-assistant">
							<div class="msg-avatar assistant"><Bot class="h-3.5 w-3.5" /></div>
							<div class="msg-body">
								{#if searchQuery && searchQuery.length >= 2}
									{@html highlightMatches(msg.content, searchQuery)}
								{:else}
									<MarkdownRenderer content={msg.content} />
								{/if}
								<div class="msg-footer">
									<span class="msg-time">
										{relativeTime(msg.createdAt)}
										{#if session.thinking && session.streamStats && msg.id === session.messages[session.messages.length - 1]?.id}
											<span class="stream-speed">&middot; {session.streamStats.tokensPerSec} tok/s</span>
										{/if}
									</span>
									<div class="msg-actions">
										<button class="msg-action-btn" onclick={() => copyMessage(msg.id, msg.content)} title="Copy">
											{#if copiedMsgId === msg.id}
												<Check class="h-3 w-3" />
											{:else}
												<Copy class="h-3 w-3" />
											{/if}
										</button>
										<button class="msg-action-btn" onclick={() => saveMessageAsNote(msg.content)} title="Save as note">
											<FilePlus class="h-3 w-3" />
										</button>
									</div>
								</div>
							</div>
						</div>
					{/if}
				{/if}
			{/each}

			{#if session.thinking && session.thinkingStatus}
				<div class="msg msg-assistant">
					<div class="msg-avatar assistant"><Bot class="h-3.5 w-3.5" /></div>
					<div class="msg-body thinking">
						<Loader2 class="h-3.5 w-3.5 animate-spin" />
						<span class="thinking-label">{session.thinkingStatus}</span>
					</div>
				</div>
			{/if}

			{#if session.error}
				<div class="error-bar">{session.error}</div>
			{/if}

			<div bind:this={messagesEnd}></div>
		</div>

		<!-- Scroll to bottom fab -->
		{#if showScrollBtn}
			<button class="scroll-btn" onclick={scrollToBottom} title="Scroll to bottom">
				<ArrowDown class="h-4 w-4" />
			</button>
		{/if}

		<!-- Input area -->
		<div class="input-area">
			<!-- Pending image previews -->
			{#if pendingImages.length > 0}
				<div class="pending-images">
					{#each pendingImages as src, i}
						<div class="pending-img-wrap">
							<img {src} alt="Pending" class="pending-img" />
							<button class="pending-img-remove" onclick={() => removePendingImage(i)}>
								<X class="h-2.5 w-2.5" />
							</button>
						</div>
					{/each}
				</div>
			{/if}
			<div class="input-row">
				<button
					class="voice-btn"
					class:recording={voiceRecording}
					class:transcribing={voiceTranscribing}
					disabled={session.thinking || distilling || voiceTranscribing}
					onpointerdown={handleVoiceStart}
					onpointerup={handleVoiceStop}
					onpointerleave={() => voiceRecording && handleVoiceStop()}
					title={voiceRecording ? 'Release to transcribe' : voiceTranscribing ? 'Transcribing...' : 'Hold to dictate'}
				>
					{#if voiceTranscribing}
						<Loader2 class="h-4 w-4 animate-spin" />
					{:else}
						<Mic class="h-4 w-4" />
					{/if}
				</button>
				<textarea
					bind:this={textareaEl}
					bind:value={input}
					oninput={autoGrow}
					onkeydown={handleKeydown}
					onpaste={handlePaste}
					ondrop={handleDrop}
					ondragover={handleDragOver}
					placeholder="Ask or instruct..."
					disabled={session.thinking || distilling}
					class="chat-input"
					rows="1"
				></textarea>
				<button
					class="send-btn"
					disabled={(!input.trim() && pendingImages.length === 0) || session.thinking || distilling}
					onclick={handleSend}
				>
					<Send class="h-4 w-4" />
				</button>
			</div>
			{#if !hasSentMessage}
				<div class="kbd-hint">Enter to send, Shift+Enter for newline</div>
			{/if}
			{#if hasAssistantMessages}
				<button
					class="distill-btn"
					disabled={session.thinking || distilling}
					onclick={handleDistillAndSave}
				>
					{#if distilling}
						<Loader2 class="h-3.5 w-3.5 animate-spin" />
						<span>Distilling...</span>
					{:else}
						<FilePlus class="h-3.5 w-3.5" />
						<span>Save conversation as note</span>
					{/if}
				</button>
			{/if}
		</div>
	</aside>
</div>

<style>
	/* --- Wrapper --- */
	.agent-pane-wrapper {
		display: flex;
		height: 100%;
		flex-shrink: 0;
		transition: opacity 0.1s;
	}

	.resize-handle {
		width: 6px;
		cursor: col-resize;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
	}

	.resize-bar {
		width: 2px;
		height: 100%;
		border-radius: 999px;
		transition: background-color 0.15s;
		background: transparent;
	}

	.resize-handle:hover .resize-bar,
	.resize-bar.active {
		background: var(--color-accent);
	}

	/* --- Pane --- */
	.agent-pane {
		flex: 1;
		min-width: 0;
		height: 100%;
		display: flex;
		flex-direction: column;
		background: var(--color-bg);
		border-left: 1px solid var(--color-border);
		z-index: 30;
		animation: slideIn 0.2s ease-out;
		position: relative;
	}

	@keyframes slideIn {
		from { transform: translateX(100%); opacity: 0; }
		to { transform: translateX(0); opacity: 1; }
	}

	/* --- Header --- */
	.pane-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.625rem 0.875rem;
		border-bottom: 1px solid var(--color-border);
		background: var(--color-bg-secondary);
	}

	.pane-title {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--color-text);
	}

	.pane-actions {
		display: flex;
		align-items: center;
		gap: 0.25rem;
	}

	.pane-btn {
		background: none;
		border: none;
		padding: 0.375rem;
		border-radius: 0.375rem;
		cursor: pointer;
		color: var(--color-text-muted);
	}

	.pane-btn:hover {
		background: var(--color-border);
		color: var(--color-text);
	}

	/* --- Token budget bar --- */
	.token-bar {
		height: 2px;
		background: var(--color-border);
		flex-shrink: 0;
	}

	.token-fill {
		height: 100%;
		background: var(--color-accent);
		transition: width 0.3s;
	}

	.token-fill.warn {
		background: #f59e0b;
	}

	.token-fill.danger {
		background: #ef4444;
	}

	/* --- Confirm reset --- */
	.confirm-reset {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		font-size: 0.6875rem;
	}

	.confirm-label { color: var(--color-text-muted); }

	.confirm-btn {
		padding: 0.125rem 0.5rem;
		border-radius: 0.25rem;
		border: 1px solid var(--color-border);
		font-size: 0.6875rem;
		cursor: pointer;
		background: var(--color-bg);
		color: var(--color-text-muted);
	}

	.confirm-btn.yes { border-color: var(--color-accent); color: var(--color-accent); }
	.confirm-btn.yes:hover { background: var(--color-accent); color: white; }
	.confirm-btn.no:hover { background: var(--color-border); color: var(--color-text); }

	/* --- History dropdown --- */
	.history-dropdown {
		border-bottom: 1px solid var(--color-border);
		background: var(--color-bg-secondary);
		max-height: 300px;
		display: flex;
		flex-direction: column;
		animation: slideDown 0.15s ease-out;
	}

	@keyframes slideDown {
		from { opacity: 0; transform: translateY(-8px); }
		to { opacity: 1; transform: translateY(0); }
	}

	.history-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.5rem 0.75rem;
		font-size: 0.6875rem;
		font-weight: 600;
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}

	.history-empty {
		padding: 1rem;
		text-align: center;
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}

	.history-list {
		overflow-y: auto;
		padding-bottom: 0.25rem;
	}

	.history-item {
		display: flex;
		align-items: center;
		padding: 0 0.375rem;
	}

	.history-item.active {
		background: color-mix(in srgb, var(--color-accent) 8%, transparent);
	}

	.history-item-btn {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		padding: 0.375rem;
		border: none;
		background: none;
		cursor: pointer;
		text-align: left;
		border-radius: 0.25rem;
	}

	.history-item-btn:hover {
		background: var(--color-border);
	}

	.history-item-title {
		font-size: 0.75rem;
		color: var(--color-text);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.history-item-meta {
		font-size: 0.625rem;
		color: var(--color-text-muted);
	}

	.history-delete-btn {
		padding: 0.25rem;
		border: none;
		background: none;
		border-radius: 0.25rem;
		cursor: pointer;
		color: var(--color-text-muted);
		opacity: 0;
		transition: opacity 0.1s;
	}

	.history-item:hover .history-delete-btn {
		opacity: 1;
	}

	.history-delete-btn:hover {
		color: #ef4444;
	}

	.history-edit-btn {
		padding: 0.25rem;
		border: none;
		background: none;
		border-radius: 0.25rem;
		cursor: pointer;
		color: var(--color-text-muted);
		opacity: 0;
		transition: opacity 0.1s;
	}

	.history-item:hover .history-edit-btn {
		opacity: 1;
	}

	.history-edit-btn:hover {
		color: var(--color-accent);
	}

	.title-edit-input {
		flex: 1;
		padding: 0.375rem 0.5rem;
		border: 1px solid var(--color-accent);
		border-radius: 0.25rem;
		background: var(--color-bg);
		color: var(--color-text);
		font-size: 0.75rem;
		outline: none;
		margin: 0.125rem 0.375rem;
	}

	/* --- Model picker --- */
	.model-picker {
		border-bottom: 1px solid var(--color-border);
		background: var(--color-bg-secondary);
		padding: 0.25rem;
		animation: slideDown 0.15s ease-out;
	}

	.model-option {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		padding: 0.375rem 0.625rem;
		border: none;
		background: none;
		border-radius: 0.25rem;
		font-size: 0.75rem;
		color: var(--color-text-muted);
		cursor: pointer;
		text-align: left;
	}

	.model-option:hover {
		background: var(--color-border);
		color: var(--color-text);
	}

	.model-option.active {
		color: var(--color-accent);
		font-weight: 500;
	}

	/* --- Search bar --- */
	.search-bar {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.375rem 0.75rem;
		border-bottom: 1px solid var(--color-border);
		background: var(--color-bg-secondary);
		animation: slideDown 0.15s ease-out;
	}

	.search-input {
		flex: 1;
		padding: 0.25rem 0;
		border: none;
		background: none;
		color: var(--color-text);
		font-size: 0.75rem;
		outline: none;
	}

	.search-clear {
		padding: 0.125rem;
		border: none;
		background: none;
		border-radius: 0.25rem;
		cursor: pointer;
		color: var(--color-text-muted);
	}

	.search-clear:hover {
		color: var(--color-text);
	}

	.search-count {
		font-size: 0.625rem;
		color: var(--color-text-muted);
		white-space: nowrap;
	}

	/* --- Search highlighting --- */
	:global(.search-highlight) {
		background: rgba(250, 204, 21, 0.4);
		color: inherit;
		padding: 0.0625rem 0.125rem;
		border-radius: 0.125rem;
	}

	/* --- Stream speed --- */
	.stream-speed {
		color: var(--color-accent);
		font-weight: 500;
	}

	/* --- User message markdown --- */
	.msg-body-user-md :global(.markdown-content) {
		color: white;
		font-size: 0.8125rem;
		line-height: 1.5;
	}

	.msg-body-user-md :global(.markdown-content p) {
		margin-bottom: 0.25em;
	}

	.msg-body-user-md :global(.markdown-content p:last-child) {
		margin-bottom: 0;
	}

	.msg-body-user-md :global(.markdown-content a) {
		color: rgba(255, 255, 255, 0.85);
		text-decoration: underline;
	}

	.msg-body-user-md :global(.markdown-content code) {
		background: rgba(255, 255, 255, 0.15);
		color: white;
	}

	.msg-body-user-md :global(.markdown-content pre) {
		background: rgba(0, 0, 0, 0.2);
	}

	.msg-body-user-md :global(.markdown-content pre code) {
		background: none;
	}

	/* --- Saved note bar --- */
	.saved-bar {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.375rem 0.75rem;
		background: color-mix(in srgb, var(--color-accent) 10%, transparent);
		border-bottom: 1px solid color-mix(in srgb, var(--color-accent) 25%, transparent);
		color: var(--color-accent);
		font-size: 0.75rem;
		animation: slideDown 0.2s ease-out;
	}

	.saved-text { flex: 1; font-weight: 500; }

	.saved-link {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.125rem 0.375rem;
		border-radius: 0.25rem;
		border: none;
		background: none;
		color: var(--color-accent);
		font-size: 0.6875rem;
		font-weight: 600;
		cursor: pointer;
	}

	.saved-link:hover {
		background: color-mix(in srgb, var(--color-accent) 15%, transparent);
	}

	.saved-dismiss {
		background: none;
		border: none;
		padding: 0.125rem;
		border-radius: 0.25rem;
		cursor: pointer;
		color: var(--color-accent);
		opacity: 0.6;
	}

	.saved-dismiss:hover { opacity: 1; }

	/* --- Messages --- */
	.messages {
		flex: 1;
		overflow-y: auto;
		padding: 0.75rem;
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
	}

	/* --- Empty state --- */
	.empty {
		margin: auto;
		text-align: center;
		color: var(--color-text-muted);
		font-size: 0.8125rem;
		padding: 2rem 1rem;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
	}

	.empty .hint {
		font-size: 0.75rem;
		opacity: 0.75;
		max-width: 18rem;
	}

	.starters {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 0.375rem;
		margin-top: 0.5rem;
		max-width: 20rem;
	}

	.starter-chip {
		padding: 0.25rem 0.625rem;
		border: 1px solid var(--color-border);
		border-radius: 999px;
		background: var(--color-bg);
		color: var(--color-text-muted);
		font-size: 0.6875rem;
		cursor: pointer;
		transition: border-color 0.15s, color 0.15s;
	}

	.starter-chip:hover {
		border-color: var(--color-accent);
		color: var(--color-accent);
	}

	/* --- Message bubbles --- */
	.msg {
		display: flex;
		gap: 0.5rem;
		align-items: flex-start;
	}

	.msg-user { flex-direction: row-reverse; }

	.msg-avatar {
		width: 1.5rem;
		height: 1.5rem;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		background: var(--color-bg-secondary);
		color: var(--color-text-muted);
	}

	.msg-avatar.assistant {
		background: color-mix(in srgb, var(--color-accent) 15%, transparent);
		color: var(--color-accent);
	}

	.msg-user .msg-avatar {
		background: var(--color-accent);
		color: white;
	}

	.msg-body {
		max-width: 85%;
		padding: 0.5rem 0.75rem;
		border-radius: 0.75rem;
		font-size: 0.8125rem;
		line-height: 1.5;
	}

	.msg-user .msg-body {
		background: var(--color-accent);
		color: white;
		border-bottom-right-radius: 0.25rem;
		white-space: pre-wrap;
	}

	.msg-assistant .msg-body {
		background: var(--color-bg-secondary);
		color: var(--color-text);
		border-bottom-left-radius: 0.25rem;
	}

	/* --- User message images --- */
	.msg-images {
		display: flex;
		gap: 0.25rem;
		margin-top: 0.375rem;
		flex-wrap: wrap;
	}

	.msg-image-thumb {
		width: 3rem;
		height: 3rem;
		object-fit: cover;
		border-radius: 0.375rem;
		border: 1px solid rgba(255, 255, 255, 0.3);
	}

	/* --- Timestamps & actions --- */
	.msg-time {
		font-size: 0.5625rem;
		color: var(--color-text-muted);
		opacity: 0.6;
	}

	.msg-time-user {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		justify-content: flex-end;
		margin-top: 0.25rem;
		color: rgba(255, 255, 255, 0.6);
	}

	.edit-msg-btn {
		background: none;
		border: none;
		padding: 0.125rem;
		border-radius: 0.125rem;
		cursor: pointer;
		color: rgba(255, 255, 255, 0.4);
		opacity: 0;
		transition: opacity 0.15s;
	}

	.msg-body:hover .edit-msg-btn {
		opacity: 1;
	}

	.edit-msg-btn:hover {
		color: white;
	}

	.msg-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-top: 0.375rem;
	}

	.msg-actions {
		display: flex;
		gap: 0.25rem;
		opacity: 0;
		transition: opacity 0.15s;
	}

	.msg-body:hover .msg-actions { opacity: 1; }

	.msg-action-btn {
		display: flex;
		align-items: center;
		padding: 0.125rem 0.25rem;
		border: none;
		border-radius: 0.25rem;
		background: none;
		color: var(--color-text-muted);
		cursor: pointer;
		transition: color 0.15s;
	}

	.msg-action-btn:hover { color: var(--color-accent); }

	/* --- Edit bubble --- */
	.edit-bubble {
		max-width: 85%;
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}

	.edit-textarea {
		padding: 0.5rem 0.75rem;
		border: 1px solid var(--color-accent);
		border-radius: 0.5rem;
		background: var(--color-bg);
		color: var(--color-text);
		font-size: 0.8125rem;
		font-family: inherit;
		resize: none;
		outline: none;
		line-height: 1.5;
	}

	.edit-actions {
		display: flex;
		gap: 0.375rem;
		justify-content: flex-end;
	}

	.edit-btn {
		padding: 0.25rem 0.625rem;
		border-radius: 0.375rem;
		font-size: 0.6875rem;
		cursor: pointer;
		border: 1px solid var(--color-border);
		background: var(--color-bg);
		color: var(--color-text-muted);
	}

	.edit-btn.submit {
		border-color: var(--color-accent);
		background: var(--color-accent);
		color: white;
	}

	.edit-btn.cancel:hover { background: var(--color-border); }
	.edit-btn.submit:hover { opacity: 0.9; }

	/* --- Tool cards --- */
	.msg-tool {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		padding-left: 2rem;
	}

	.tool-card {
		border: 1px solid var(--color-border);
		border-radius: 0.375rem;
		padding: 0.375rem 0.625rem;
		font-size: 0.6875rem;
		background: var(--color-bg-secondary);
		cursor: pointer;
		text-align: left;
		width: 100%;
		transition: border-color 0.15s;
	}

	.tool-card:hover { border-color: var(--color-accent); }

	.tool-card.error {
		border-color: rgba(239, 68, 68, 0.3);
		background: rgba(239, 68, 68, 0.05);
	}

	.tool-header {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		color: var(--color-text-muted);
	}

	.tool-label {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.tool-status {
		font-size: 0.5625rem;
		text-transform: uppercase;
		padding: 0.0625rem 0.25rem;
		border-radius: 999px;
		background: color-mix(in srgb, var(--color-accent) 12%, transparent);
		color: var(--color-accent);
	}

	.tool-links {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
		margin-top: 0.375rem;
	}

	.tool-mem-link {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.125rem 0.375rem;
		border-radius: 0.25rem;
		background: color-mix(in srgb, var(--color-accent) 10%, transparent);
		color: var(--color-accent);
		font-size: 0.625rem;
		text-decoration: none;
		cursor: pointer;
	}

	.tool-mem-link:hover {
		background: color-mix(in srgb, var(--color-accent) 20%, transparent);
	}

	.tool-result {
		margin-top: 0.375rem;
		padding: 0.375rem 0.5rem;
		border-radius: 0.25rem;
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		font-size: 0.625rem;
		font-family: monospace;
		white-space: pre-wrap;
		word-break: break-word;
		max-height: 200px;
		overflow-y: auto;
		color: var(--color-text-muted);
	}

	/* --- Thinking --- */
	.thinking {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.625rem 0.875rem !important;
		color: var(--color-text-muted);
	}

	.thinking-label {
		font-size: 0.6875rem;
		font-style: italic;
	}

	@keyframes bounce {
		0%, 80%, 100% { transform: translateY(0); }
		40% { transform: translateY(-6px); }
	}

	/* --- Error --- */
	.error-bar {
		padding: 0.5rem 0.75rem;
		background: rgba(239, 68, 68, 0.1);
		border: 1px solid rgba(239, 68, 68, 0.3);
		border-radius: 0.375rem;
		color: #ef4444;
		font-size: 0.75rem;
	}

	/* --- Scroll to bottom --- */
	.scroll-btn {
		position: absolute;
		bottom: 5.5rem;
		left: 50%;
		transform: translateX(-50%);
		width: 2rem;
		height: 2rem;
		border-radius: 50%;
		border: 1px solid var(--color-border);
		background: var(--color-bg-secondary);
		color: var(--color-text-muted);
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
		transition: color 0.15s, border-color 0.15s;
		z-index: 5;
	}

	.scroll-btn:hover {
		border-color: var(--color-accent);
		color: var(--color-accent);
	}

	/* --- Pending images --- */
	.pending-images {
		display: flex;
		gap: 0.375rem;
		flex-wrap: wrap;
	}

	.pending-img-wrap {
		position: relative;
	}

	.pending-img {
		width: 3.5rem;
		height: 3.5rem;
		object-fit: cover;
		border-radius: 0.375rem;
		border: 1px solid var(--color-border);
	}

	.pending-img-remove {
		position: absolute;
		top: -4px;
		right: -4px;
		width: 1rem;
		height: 1rem;
		border-radius: 50%;
		border: none;
		background: #ef4444;
		color: white;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		font-size: 0;
	}

	/* --- Input area --- */
	.input-area {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		padding: 0.625rem;
		border-top: 1px solid var(--color-border);
		background: var(--color-bg-secondary);
	}

	.input-row {
		display: flex;
		gap: 0.375rem;
		align-items: flex-end;
	}

	.chat-input {
		flex: 1;
		padding: 0.5rem 0.75rem;
		border: 1px solid var(--color-border);
		border-radius: 0.5rem;
		background: var(--color-bg);
		color: var(--color-text);
		font-size: 0.8125rem;
		font-family: inherit;
		outline: none;
		resize: none;
		line-height: 1.5;
		max-height: 120px;
		overflow-y: auto;
	}

	.chat-input:focus { border-color: var(--color-accent); }

	.send-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2.25rem;
		height: 2.25rem;
		border-radius: 0.5rem;
		background: var(--color-accent);
		color: white;
		border: none;
		cursor: pointer;
		flex-shrink: 0;
		transition: background 0.15s;
	}

	.send-btn:hover:not(:disabled) { background: var(--color-accent-hover); }
	.send-btn:disabled { opacity: 0.4; cursor: not-allowed; }

	/* --- Voice button --- */
	.voice-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2.25rem;
		height: 2.25rem;
		border-radius: 0.5rem;
		border: 1px solid var(--color-border);
		background: var(--color-bg);
		color: var(--color-text-muted);
		cursor: pointer;
		flex-shrink: 0;
		transition: all 0.15s;
	}

	.voice-btn:hover:not(:disabled) { border-color: var(--color-accent); color: var(--color-accent); }
	.voice-btn.recording { background: #ef4444; border-color: #ef4444; color: white; animation: pulse 1.5s infinite; }
	.voice-btn.transcribing { border-color: var(--color-accent); color: var(--color-accent); }
	.voice-btn:disabled { opacity: 0.4; cursor: not-allowed; }

	@keyframes pulse {
		0%, 100% { opacity: 1; }
		50% { opacity: 0.7; }
	}

	/* --- Kbd hint --- */
	.kbd-hint {
		text-align: center;
		font-size: 0.625rem;
		color: var(--color-text-muted);
		opacity: 0.5;
	}

	/* --- Distill button --- */
	.distill-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.375rem;
		padding: 0.375rem 0.75rem;
		border: 1px solid var(--color-border);
		border-radius: 0.5rem;
		background: var(--color-bg);
		color: var(--color-text-muted);
		font-size: 0.75rem;
		cursor: pointer;
		transition: border-color 0.15s, color 0.15s;
	}

	.distill-btn:hover:not(:disabled) { border-color: var(--color-accent); color: var(--color-accent); }
	.distill-btn:disabled { opacity: 0.4; cursor: not-allowed; }

	/* --- Mobile --- */
	@media (max-width: 768px) {
		.agent-pane-wrapper {
			width: 100% !important;
			position: fixed;
			inset: 0;
			z-index: 50;
		}
	}
</style>
