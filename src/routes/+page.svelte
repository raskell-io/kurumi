<script lang="ts">
	import {
		memoryObjects,
		addMemoryObject,
		actionItems,
		reminderProposals,
		updateActionItemStatus,
		updateMemoryObject,
		completeRecurring,
		todayIso,
		type ActionItem
	} from '$lib/db';
	import { pushUndo } from '$lib/stores/undo';
	import { dueInfo } from '$lib/utils/due';
	import { openNoteTasks, checkTaskInBody, sortOpenActionItems, type NoteTask } from '$lib/todos';
	import { askKurumi, isAskKurumiResult, type AskKurumiResult } from '$lib/ask';
	import { parseVoiceCommand } from '$lib/voice-commands';
	import { parseSearchQuery, hasAnyFilter } from '$lib/search';
	import { isAIConfigured } from '$lib/ai';
	import { generateDailyDigest, detectPatterns, type DetectedPattern } from '$lib/digest';
	import { inferenceRouter } from '$lib/inference';
	import { startPushToTalk, speak, stopSpeaking, type RecorderHandle } from '$lib/voice';
	import type { MemoryObject } from '$lib/db/types';
	import MarkdownRenderer from '$lib/components/MarkdownRenderer.svelte';
	import RealtimeSessionPanel from '$lib/components/RealtimeSessionPanel.svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { onMount, onDestroy } from 'svelte';
	import {
		Plus,
		FileText,
		Sparkles,
		Send,
		AlertCircle,
		Settings,
		RotateCcw,
		Mic,
		Volume2,
		VolumeX,
		CheckSquare,
		Square,
		Bell,
		Radio,
		Users,
		CalendarDays,
		ArrowRight,
		ListTodo,
		NotebookText
	} from 'lucide-svelte';
	import {
		showNewNoteSnackbar,
		triggerVoiceAssistant,
		triggerVoiceCapture,
		triggerMeetingCapture
	} from '$lib/stores/snackbar';

	type Turn = {
		question: string;
		result: AskKurumiResult;
	};

	function handleNewNote() {
		const memory = addMemoryObject();
		goto(`/memory/${memory.id}`);
		showNewNoteSnackbar.set(true);
	}

	// Handle Web Share Target: when the PWA receives shared content
	// from another app, the share_target manifest sends it as query
	// params (share_title, share_text, share_url). We pick those up
	// on mount and create a new memory.
	onMount(() => {
		const shareTitle = $page.url.searchParams.get('share_title');
		const shareText = $page.url.searchParams.get('share_text');
		const shareUrl = $page.url.searchParams.get('share_url');
		if (shareTitle || shareText || shareUrl) {
			const title = shareTitle || 'Shared content';
			const lines: string[] = [];
			lines.push(`# ${title}`);
			lines.push('');
			if (shareUrl) {
				lines.push(`Source: [${shareUrl}](${shareUrl})`);
				lines.push('');
			}
			if (shareText) {
				lines.push(shareText);
				lines.push('');
			}
			const memory = addMemoryObject(title, lines.join('\n'), null);
			goto(`/memory/${memory.id}`, { replaceState: true });
		}
	});

	// Get 5 most recently edited memories
	let recentMemories = $derived(
		[...$memoryObjects].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 5)
	);

	// --- Quick capture ----------------------------------------------------
	// Type a thought and press Enter to save it as a note without leaving
	// the page; ⌘/Ctrl+Enter saves and opens it.
	let captureText = $state('');
	let captured = $state<{ id: string; title: string } | null>(null);
	let capturedTimer: ReturnType<typeof setTimeout> | undefined;

	function saveCapture(open: boolean) {
		const text = captureText.trim();
		if (!text) {
			if (open) handleNewNote();
			return;
		}
		// Title: the first line, cut at a word near 80 characters. The full
		// text goes in the body when it's longer than that.
		const firstLine = text.split('\n')[0];
		const title = firstLine.length <= 80 ? firstLine : firstLine.slice(0, 80).replace(/\s+\S*$/, '') + '…';
		const memory = addMemoryObject(title, text === title ? '' : text, null);
		captureText = '';
		if (open) {
			goto(`/memory/${memory.id}`);
			return;
		}
		captured = { id: memory.id, title };
		clearTimeout(capturedTimer);
		capturedTimer = setTimeout(() => (captured = null), 6000);
	}

	// --- To do ----------------------------------------------------------------
	// Open action items in the order they need attention, plus unchecked
	// `- [ ]` items written in notes.
	const today = todayIso();
	let openItems = $derived(sortOpenActionItems($actionItems, today));
	let overdueCount = $derived(openItems.filter((a) => a.dueDate && a.dueDate < today).length);
	let dueTodayCount = $derived(openItems.filter((a) => a.dueDate === today).length);
	let inProgressCount = $derived(openItems.filter((a) => a.status === 'in_progress').length);
	let noteTasks = $derived(openNoteTasks($memoryObjects));
	// Show up to 5 action items and fill the card to 7 rows with note tasks.
	let shownItems = $derived(openItems.slice(0, 5));
	let shownNoteTasks = $derived(noteTasks.slice(0, Math.max(0, 7 - shownItems.length)));
	let moreItems = $derived(openItems.length - shownItems.length);
	let moreTasks = $derived(noteTasks.length - shownNoteTasks.length);
	let todoSummary = $derived(
		[
			overdueCount && `${overdueCount} overdue`,
			dueTodayCount && `${dueTodayCount} due today`,
			inProgressCount && `${inProgressCount} in progress`
		]
			.filter(Boolean)
			.join(' · ')
	);

	// Same completion as the Actions page: recurring items roll over to
	// their next occurrence. Undoable.
	function completeItem(item: ActionItem) {
		const previous = item.status;
		if (item.recurrence !== 'none') completeRecurring(item.id);
		else updateActionItemStatus(item.id, 'done');
		pushUndo({ label: `Completed “${item.text}”`, undo: () => updateActionItemStatus(item.id, previous) });
	}

	function completeNoteTask(task: NoteTask) {
		const memory = $memoryObjects.find((m) => m.id === task.memoryId);
		if (!memory) return;
		const before = memory.bodyMarkdown;
		const after = checkTaskInBody(before, task.line, task.text);
		if (after === null) return;
		updateMemoryObject(memory.id, { bodyMarkdown: after });
		pushUndo({
			label: `Checked “${task.text}”`,
			undo: () => updateMemoryObject(memory.id, { bodyMarkdown: before })
		});
	}

	let pendingProposalsCount = $derived(
		$reminderProposals.filter((p) => p.status === 'pending').length
	);

	// Daily digest + pattern detection
	let generatingDigest = $state(false);
	let patterns = $derived.by(() => {
		void $memoryObjects;
		return detectPatterns();
	});

	async function handleGenerateDigest() {
		if (generatingDigest) return;
		generatingDigest = true;
		try {
			const id = await generateDailyDigest();
			goto(`/memory/${id}`);
		} catch (err) {
			askError = err instanceof Error ? err.message : 'Digest generation failed';
		} finally {
			generatingDigest = false;
		}
	}

	// Ask Kurumi state
	let aiAvailable = $state(false);
	$effect(() => {
		// Read at mount; isAIConfigured reads localStorage which isn't reactive,
		// so we just check once. The user re-checking after configuring is a
		// reload anyway since localStorage changes don't propagate.
		aiAvailable = isAIConfigured();
	});

	let question = $state('');
	// Parse the in-flight question so we can render filter chips under
	// the input as the user types. Gives immediate feedback that
	// `tag:work` etc. is being recognized.
	let parsedQuestion = $derived(parseSearchQuery(question));
	let hasActiveFilters = $derived(hasAnyFilter(parsedQuestion.filters));
	let asking = $state(false);
	let askError = $state<string | null>(null);
	// Conversation history for the current Ask thread. Each turn keeps the
	// raw question and the full result (so we can re-render citations).
	let turns = $state<Turn[]>([]);

	// Voice assistant mode
	// - voiceMode on: TTS plays answers automatically, and the question
	//   input shows a push-to-talk mic button
	// - voiceMode off: text-only (existing behavior)
	let voiceMode = $state(false);
	let recording = $state(false);
	let transcribing = $state(false);
	let speaking = $state(false);
	let recorderHandle: RecorderHandle | null = null;

	// Realtime voice session (OpenAI Realtime API via WebRTC).
	// Separate from voiceMode — that's push-to-talk → transcribe →
	// answer → TTS; Realtime is a continuous two-way voice session
	// with the model calling search_memory as a tool.
	let showRealtimePanel = $state(false);

	let ttsAvailable = $derived(
		inferenceRouter.findProvider((c) => c.supportsTts) !== null
	);
	let transcribeAvailable = $derived(
		inferenceRouter.findProvider((c) => c.supportsTranscribe) !== null
	);

	async function handleVoiceToggle() {
		if (!voiceMode) {
			voiceMode = true;
		} else {
			voiceMode = false;
			stopSpeaking();
			speaking = false;
		}
	}

	async function handleStartRecording() {
		if (recording || asking || transcribing) return;
		askError = null;
		try {
			recorderHandle = await startPushToTalk();
			recording = true;
		} catch (err) {
			askError = err instanceof Error ? err.message : 'Microphone unavailable';
		}
	}

	async function handleStopRecording() {
		if (!recorderHandle || !recording) return;
		recording = false;
		transcribing = true;
		try {
			const blob = await recorderHandle.stop();
			recorderHandle = null;
			const provider = inferenceRouter.findProvider((c) => c.supportsTranscribe);
			if (!provider) throw new Error('No transcription provider configured');
			const result = await provider.transcribe({
				audio: blob,
				mimeType: blob.type || 'audio/webm'
			});
			if (!result.ok || !result.value) {
				throw new Error(result.error || 'Transcription failed');
			}
			question = result.value.text.trim();
			transcribing = false;
			if (question) {
				await handleAsk();
			}
		} catch (err) {
			askError = err instanceof Error ? err.message : 'Voice capture failed';
			transcribing = false;
			recorderHandle = null;
		}
	}

	/** Remove inline [n] citation markers before speaking the answer aloud. */
	function stripCitations(text: string): string {
		return text.replace(/\[\d+\]/g, '').replace(/\s+/g, ' ').trim();
	}

	async function handleSpeak(text: string) {
		if (!ttsAvailable || speaking) return;
		speaking = true;
		try {
			await speak(stripCitations(text));
		} catch (err) {
			askError = err instanceof Error ? err.message : 'TTS playback failed';
		} finally {
			speaking = false;
		}
	}

	function handleStopSpeaking() {
		stopSpeaking();
		speaking = false;
	}

	onDestroy(() => {
		stopSpeaking();
		if (recorderHandle) {
			void recorderHandle.stop();
		}
	});

	// Cmd+Shift+V global hotkey: alternate start / stop-and-submit. The
	// layout increments the counter; we react to the change (skipping the
	// initial value of 0) and flip recording state accordingly. Auto-
	// enables voice mode on first use so the user hears the answer.
	let lastVoiceSignal = $state(0);
	$effect(() => {
		const signal = $triggerVoiceAssistant;
		if (signal === 0 || signal === lastVoiceSignal) return;
		lastVoiceSignal = signal;
		if (!aiAvailable || !transcribeAvailable) return;
		if (!voiceMode) voiceMode = true;
		if (recording) {
			void handleStopRecording();
		} else if (!asking && !transcribing) {
			void handleStartRecording();
		}
	});

	async function handleAsk() {
		const trimmed = question.trim();
		if (!trimmed || asking) return;

		// Try voice commands first (only meaningful in voice mode,
		// but also works for typed commands).
		const voiceCmd = parseVoiceCommand(trimmed);
		if (voiceCmd) {
			question = '';
			if (voiceMode && ttsAvailable) {
				void handleSpeak(voiceCmd.response);
			}
			if (voiceCmd.navigateTo) {
				goto(voiceCmd.navigateTo);
			}
			return;
		}

		asking = true;
		askError = null;
		try {
			// Pass prior turns so the model can resolve follow-up references.
			const priorTurns = turns.map((t) => ({
				question: t.question,
				answer: t.result.answer
			}));
			const result = await askKurumi(trimmed, priorTurns);
			if (isAskKurumiResult(result)) {
				turns = [...turns, { question: trimmed, result }];
				question = '';
				// In voice mode, auto-play the answer so the user can keep
				// their hands off the keyboard.
				if (voiceMode && ttsAvailable) {
					void handleSpeak(result.answer);
				}
			} else {
				askError = result.error;
			}
		} catch (err) {
			askError = err instanceof Error ? err.message : 'Failed to ask Kurumi';
		} finally {
			asking = false;
		}
	}

	function handleAskKeydown(e: KeyboardEvent) {
		// Cmd/Ctrl+Enter submits even from a textarea-like flow
		if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
			e.preventDefault();
			handleAsk();
		}
	}

	function clearConversation() {
		turns = [];
		askError = null;
		question = '';
	}

	function formatRelativeTime(timestamp: number): string {
		const now = Date.now();
		const diff = now - timestamp;
		const minutes = Math.floor(diff / 60000);
		const hours = Math.floor(diff / 3600000);
		const days = Math.floor(diff / 86400000);

		if (minutes < 1) return 'Just now';
		if (minutes < 60) return `${minutes}m ago`;
		if (hours < 24) return `${hours}h ago`;
		if (days < 7) return `${days}d ago`;
		return new Date(timestamp).toLocaleDateString();
	}

	function memoryPreview(text: string | null, max = 120): string {
		if (!text) return '';
		const cleaned = text.replace(/\s+/g, ' ').trim();
		return cleaned.length > max ? cleaned.slice(0, max) + '…' : cleaned;
	}

	function escapeAttr(s: string): string {
		return s.replace(
			/[&<>"']/g,
			(c) =>
				({
					'&': '&amp;',
					'<': '&lt;',
					'>': '&gt;',
					'"': '&quot;',
					"'": '&#39;'
				})[c] ?? c
		);
	}

	/**
	 * Replace inline [n] markers in the LLM answer with clickable HTML
	 * superscripts that link to the matching candidate memory. Marked
	 * passes inline HTML through, so the resulting markdown still renders
	 * normally.
	 */
	function renderInlineCitations(answerText: string, candidates: MemoryObject[]): string {
		return answerText.replace(/\[(\d+)\]/g, (match, numStr) => {
			const n = parseInt(numStr, 10);
			const memory = candidates[n - 1];
			if (!memory) return match;
			const title = escapeAttr(memory.title || 'Untitled');
			return `<sup><a href="/memory/${memory.id}" class="ask-citation" title="${title}">[${n}]</a></sup>`;
		});
	}

	const modKey = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';

	const tips = [
		{ icon: '[[', text: 'Link notes by typing [[ and a title' },
		{ icon: '#', text: 'Add #tags and @people as you write' },
		{ icon: '/', text: 'Type / in a note for blocks and commands' },
		{ icon: `${modKey}K`, text: 'Search and jump anywhere' }
	];

	const greeting = (() => {
		const hour = new Date().getHours();
		if (hour < 5) return 'Good evening';
		if (hour < 12) return 'Good morning';
		if (hour < 18) return 'Good afternoon';
		return 'Good evening';
	})();
	const todayLabel = new Date().toLocaleDateString(undefined, {
		weekday: 'long',
		month: 'long',
		day: 'numeric'
	});
</script>

<div class="mx-auto max-w-2xl px-5 py-8 md:px-8 md:py-16">
	{#if $memoryObjects.length === 0}
		<!-- Empty-vault welcome state -->
		<div class="flex flex-col items-center pt-[8vh] text-center">
			<img src="/icon-512.avif" alt="" class="mb-6 h-16 w-16 rounded-2xl" />
			<h1 class="mb-2 text-2xl font-semibold tracking-tight text-[var(--color-text)] md:text-3xl">Welcome to Kurumi</h1>
			<p class="mb-8 text-[var(--color-text-muted)]">A quiet place to offload a thought — and find it again.</p>

			<button
				type="button"
				onclick={handleNewNote}
				class="inline-flex items-center gap-2 rounded-lg bg-[var(--color-accent)] px-4 py-2.5 text-sm font-medium text-white shadow-[var(--shadow-sm)] hover:bg-[var(--color-accent-hover)] dark:text-[#1e1e2e]"
			>
				<Plus class="h-4 w-4" />
				Create your first note
				<span class="ml-1 text-xs opacity-70">{modKey}N</span>
			</button>

			<ul class="mx-auto mt-12 w-full max-w-sm divide-y divide-[var(--color-border)] rounded-xl border border-[var(--color-border)] text-left">
				{#each tips as tip}
					<li class="flex items-center gap-3 px-4 py-3">
						<span class="k-kbd min-w-8 justify-center !text-xs !text-[var(--color-text-muted)]">{tip.icon}</span>
						<span class="text-sm text-[var(--color-text-muted)]">{tip.text}</span>
					</li>
				{/each}
			</ul>
		</div>
	{:else}
		<header class="mb-8">
			<p class="text-sm text-[var(--color-text-faint)]">{todayLabel}</p>
			<h1 class="mt-1 text-2xl font-semibold tracking-tight text-[var(--color-text)] md:text-[1.75rem]">{greeting}</h1>
		</header>

		<!-- Capture: quick thought, new note, voice, meeting, today -->
		<section class="capture mb-6" aria-label="Capture">
			<div class="capture-box">
				<input
					bind:value={captureText}
					onkeydown={(e) => {
						if (e.key === 'Enter') {
							e.preventDefault();
							saveCapture(e.metaKey || e.ctrlKey);
						}
					}}
					type="text"
					class="capture-input"
					placeholder="Capture a thought…"
					aria-label="Capture a thought"
				/>
				{#if captureText.trim()}
					<span class="hidden shrink-0 text-xs text-[var(--color-text-faint)] sm:inline">↵ save · {modKey}↵ open</span>
				{/if}
			</div>
			{#if captured}
				<p class="mt-2 flex items-center gap-2 text-xs text-[var(--color-text-muted)]" role="status">
					<span class="k-badge k-badge-success">Saved</span>
					<span class="truncate">{captured.title}</span>
					<a href="/memory/{captured.id}" class="shrink-0 text-[var(--color-accent)]">Open</a>
				</p>
			{/if}
			<div class="capture-actions">
				<button type="button" onclick={handleNewNote} class="capture-primary text-white dark:text-[#1e1e2e]">
					<Plus class="h-5 w-5" />
					<span class="flex-1 text-left">New note</span>
					<span class="text-xs opacity-70">{modKey}N</span>
				</button>
				<button type="button" onclick={() => triggerVoiceCapture.set(true)} class="capture-secondary">
					<Mic class="h-4 w-4" /> Voice memo
				</button>
				<button type="button" onclick={() => triggerMeetingCapture.set(true)} class="capture-secondary">
					<Users class="h-4 w-4" /> Meeting
				</button>
				<a href="/daily" class="capture-secondary">
					<CalendarDays class="h-4 w-4" /> Today's note
				</a>
			</div>
		</section>

		<!-- To do: open action items and unchecked tasks in notes -->
		{#if openItems.length > 0 || noteTasks.length > 0}
			<section class="todo mb-6" aria-labelledby="todo-title">
				<div class="mb-1 flex items-center justify-between gap-3">
					<h2 id="todo-title" class="!m-0 flex items-center gap-2 text-sm font-semibold text-[var(--color-text)]">
						<ListTodo class="h-4 w-4 text-[var(--color-accent)]" />
						To do
						<span class="rounded-full bg-[var(--color-bg)] px-2 text-xs font-normal tabular-nums text-[var(--color-text-muted)]">
							{openItems.length + noteTasks.length}
						</span>
					</h2>
					<a href="/actions" class="inline-flex shrink-0 items-center text-xs text-[var(--color-text-muted)] hover:text-[var(--color-accent)]">
						All actions →
					</a>
				</div>
				{#if todoSummary}
					<p class="mb-2 text-xs" class:text-[var(--color-danger)]={overdueCount > 0} class:text-[var(--color-text-muted)]={overdueCount === 0}>
						{todoSummary}
					</p>
				{/if}
				<ul class="space-y-0.5">
					{#each shownItems as item (item.id)}
						{@const due = item.dueDate ? dueInfo(item.dueDate, true, today) : null}
						<li class="todo-row">
							<button class="todo-check" onclick={() => completeItem(item)} aria-label="Mark “{item.text}” done">
								<Square class="h-4 w-4" />
							</button>
							<span class="min-w-0 flex-1 truncate text-[var(--color-text)]">{item.text}</span>
							{#if item.status === 'in_progress'}
								<span class="shrink-0 text-xs text-[var(--color-accent)]">In progress</span>
							{/if}
							{#if due}
								<span class="shrink-0 text-xs" class:text-[var(--color-danger)]={due.tone === 'danger'} class:todo-warn={due.tone === 'warn'} class:text-[var(--color-text-faint)]={!due.tone}>
									{due.label}
								</span>
							{/if}
						</li>
					{/each}
					{#each shownNoteTasks as task (task.memoryId + ':' + task.line)}
						<li class="todo-row">
							<button class="todo-check" onclick={() => completeNoteTask(task)} aria-label="Check “{task.text}”">
								<Square class="h-4 w-4" />
							</button>
							<span class="min-w-0 flex-1 truncate text-[var(--color-text)]">{task.text}</span>
							<a href="/memory/{task.memoryId}" class="todo-source" title="Open “{task.noteTitle}”">
								<NotebookText class="h-3 w-3" /><span class="truncate">{task.noteTitle}</span>
							</a>
						</li>
					{/each}
				</ul>
				{#if moreItems > 0 || moreTasks > 0}
					<p class="mt-2 text-xs text-[var(--color-text-faint)]">
						{#if moreItems > 0}<a href="/actions" class="hover:text-[var(--color-accent)]">{moreItems} more action {moreItems === 1 ? 'item' : 'items'}</a>{/if}
						{#if moreItems > 0 && moreTasks > 0} · {/if}
						{#if moreTasks > 0}{moreTasks} more in your notes{/if}
					</p>
				{/if}
			</section>
		{/if}

		{#if pendingProposalsCount > 0}
			<a
				href="/proposals"
				class="mb-6 flex items-center gap-3 rounded-xl border border-yellow-500/30 bg-yellow-500/5 p-3 text-sm text-[var(--color-text)] transition-colors hover:border-yellow-500/50"
			>
				<Bell class="h-4 w-4 text-yellow-500" />
				<span class="flex-1">
					{pendingProposalsCount} reminder proposal{pendingProposalsCount === 1 ? '' : 's'}
					waiting for your review
				</span>
				<span class="text-xs text-[var(--color-text-muted)]">Review →</span>
			</a>
		{/if}

		<!-- Patterns + daily digest -->
		{#if patterns.length > 0 || aiAvailable}
			<div class="mb-6 space-y-2">
				{#if patterns.length > 0}
					{#each patterns.slice(0, 3) as pattern}
						<a
							href={pattern.actionHref}
							class="flex items-center gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3 text-sm text-[var(--color-text)] transition-colors hover:border-[var(--color-accent)]"
						>
							<Sparkles class="h-4 w-4 text-[var(--color-accent)] shrink-0" />
							<span class="flex-1">{pattern.message}</span>
							<span class="text-xs text-[var(--color-text-muted)]">{pattern.actionLabel} →</span>
						</a>
					{/each}
				{/if}
				{#if aiAvailable}
					<button
						onclick={handleGenerateDigest}
						disabled={generatingDigest}
						class="flex w-full items-center gap-3 rounded-xl border border-dashed border-[var(--color-border)] p-3 text-sm text-[var(--color-text-muted)] transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-text)] disabled:opacity-50"
					>
						{#if generatingDigest}
							<div class="h-4 w-4 animate-spin rounded-full border-2 border-[var(--color-accent)] border-t-transparent"></div>
							Generating daily digest...
						{:else}
							<Sparkles class="h-4 w-4" />
							Generate daily digest
						{/if}
					</button>
				{/if}
			</div>
		{/if}

		<!-- Ask Kurumi (or fallback if no AI key) + recent activity -->
		<div class="mb-8">
			<div class="mb-3 flex items-center justify-between gap-2">
				<div class="flex items-center gap-2">
					<Sparkles class="h-4 w-4 text-[var(--color-accent)]" />
					<h2 class="text-sm font-semibold text-[var(--color-text)]">Ask Kurumi</h2>
				</div>
				<div class="flex items-center gap-1.5">
					{#if aiAvailable}
						<button
							type="button"
							onclick={() => (showRealtimePanel = true)}
							class="voice-toggle flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-2.5 py-1 text-xs text-[var(--color-text-muted)] transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
							title="Open realtime voice session"
						>
							<Radio class="h-3.5 w-3.5" />
							Realtime
						</button>
					{/if}
					{#if aiAvailable && (ttsAvailable || transcribeAvailable)}
						<button
							type="button"
							onclick={handleVoiceToggle}
							class="voice-toggle flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs transition-colors"
							class:voice-toggle-on={voiceMode}
							title={voiceMode ? 'Disable voice mode' : 'Enable voice mode (push-to-talk + spoken answers)'}
						>
							<Mic class="h-3.5 w-3.5" />
							Voice {voiceMode ? 'on' : 'off'}
						</button>
					{/if}
				</div>
			</div>

			{#if aiAvailable}
				<form
					onsubmit={(e) => {
						e.preventDefault();
						handleAsk();
					}}
					class="relative"
				>
					<input
						type="text"
						bind:value={question}
						onkeydown={handleAskKeydown}
						placeholder={recording
							? 'Listening…'
							: transcribing
							? 'Transcribing…'
							: turns.length > 0
							? 'Follow up on this conversation…'
							: 'Ask anything · try tag:work or person:alice'}
						disabled={asking || recording || transcribing}
						class="ask-input w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-4 py-3.5 pr-24 text-[0.9375rem] text-[var(--color-text)] placeholder-[var(--color-text-faint)] shadow-[var(--shadow-sm)] outline-none disabled:opacity-50"
					/>
					<div class="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
						{#if voiceMode && transcribeAvailable}
							<!-- Push-to-talk: press and hold -->
							<button
								type="button"
								disabled={asking || transcribing}
								onpointerdown={handleStartRecording}
								onpointerup={handleStopRecording}
								onpointerleave={() => recording && handleStopRecording()}
								class="flex h-9 w-9 items-center justify-center rounded-lg transition-all disabled:opacity-50"
								class:bg-red-500={recording}
								class:text-white={recording}
								class:animate-pulse={recording}
								class:bg-[var(--color-border)]={!recording}
								class:text-[var(--color-text)]={!recording}
								aria-label={recording ? 'Release to send' : 'Hold to talk'}
								title="Hold to talk"
							>
								<Mic class="h-4 w-4" />
							</button>
						{/if}
						<button
							type="submit"
							disabled={!question.trim() || asking || recording || transcribing}
							class="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--color-accent)] text-white transition-all hover:bg-[var(--color-accent-hover)] disabled:bg-transparent disabled:text-[var(--color-text-faint)] dark:text-[#1e1e2e]"
							aria-label="Ask"
						>
							{#if asking}
								<div class="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"></div>
							{:else}
								<Send class="h-4 w-4" />
							{/if}
						</button>
					</div>
				</form>

				{#if hasActiveFilters}
					<div class="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
						<span class="text-[var(--color-text-muted)]">Filters:</span>
						{#each parsedQuestion.filters.tag as tag}
							<span class="filter-chip">#{tag}</span>
						{/each}
						{#each parsedQuestion.filters.person as person}
							<span class="filter-chip">@{person}</span>
						{/each}
						{#each parsedQuestion.filters.folder as folder}
							<span class="filter-chip">folder: {folder}</span>
						{/each}
						{#each parsedQuestion.filters.type as type}
							<span class="filter-chip">type: {type}</span>
						{/each}
						{#each parsedQuestion.filters.has as cap}
							<span class="filter-chip">has: {cap}</span>
						{/each}
						{#if parsedQuestion.filters.after}
							<span class="filter-chip">after {parsedQuestion.filters.after}</span>
						{/if}
						{#if parsedQuestion.filters.before}
							<span class="filter-chip">before {parsedQuestion.filters.before}</span>
						{/if}
					</div>
				{/if}

				{#if asking}
					<div class="mt-4 flex items-center gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4 text-sm text-[var(--color-text-muted)]">
						<div class="h-4 w-4 animate-spin rounded-full border-2 border-[var(--color-accent)] border-t-transparent"></div>
						Searching your memories and thinking…
					</div>
				{/if}

				{#if askError}
					<div class="mt-4 flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-500">
						<AlertCircle class="mt-0.5 h-4 w-4 shrink-0" />
						<div>{askError}</div>
					</div>
				{/if}

				{#if turns.length > 0}
					<div class="mt-4 space-y-6">
						{#each turns as turn, idx (idx)}
							<div class="space-y-3">
								<!-- Question bubble -->
								<div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-4 py-3 text-sm text-[var(--color-text)]">
									<div class="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
										You asked
									</div>
									{turn.question}
								</div>

								<!-- Answer card -->
								<div class="rounded-xl border border-[var(--color-accent)]/30 bg-[var(--color-accent)]/5 p-4">
									<div class="markdown-content text-sm text-[var(--color-text)]">
										<MarkdownRenderer
											content={renderInlineCitations(turn.result.answer, turn.result.candidates)}
										/>
									</div>
									<div class="mt-3 flex items-center justify-between gap-2 text-xs text-[var(--color-text-muted)]">
										<span>
											{turn.result.candidates.length} memories searched · {turn.result.citations.length} cited
										</span>
										{#if ttsAvailable}
											{#if speaking && idx === turns.length - 1}
												<button
													type="button"
													onclick={handleStopSpeaking}
													class="flex items-center gap-1 rounded-md border border-[var(--color-border)] px-2 py-1 hover:bg-[var(--color-bg-secondary)]"
													title="Stop playback"
												>
													<VolumeX class="h-3 w-3" />
													Stop
												</button>
											{:else}
												<button
													type="button"
													onclick={() => handleSpeak(turn.result.answer)}
													disabled={speaking}
													class="flex items-center gap-1 rounded-md border border-[var(--color-border)] px-2 py-1 hover:bg-[var(--color-bg-secondary)] disabled:opacity-50"
													title="Speak answer"
												>
													<Volume2 class="h-3 w-3" />
													Speak
												</button>
											{/if}
										{/if}
									</div>
								</div>

								<!-- Source cards (collapsible-ish) -->
								{#if turn.result.citations.length > 0}
									<div>
										<p class="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
											Sources
										</p>
										<div class="space-y-2">
											{#each turn.result.citations as memory (memory.id)}
												<a
													href="/memory/{memory.id}"
													class="block rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3 transition-colors hover:border-[var(--color-accent)]"
												>
													<div class="font-medium text-[var(--color-text)]">
														{memory.title || 'Untitled'}
													</div>
													<div class="mt-1 truncate text-sm text-[var(--color-text-muted)]">
														{memoryPreview(
															memory.summaryShort ?? memory.transcript ?? memory.bodyMarkdown
														)}
													</div>
												</a>
											{/each}
										</div>
									</div>
								{/if}
							</div>
						{/each}

						<div class="flex justify-end">
							<button
								type="button"
								onclick={clearConversation}
								class="inline-flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-1.5 text-xs text-[var(--color-text-muted)] hover:bg-[var(--color-hover)] hover:text-[var(--color-text)]"
							>
								<RotateCcw class="h-3 w-3" />
								Clear conversation
							</button>
						</div>
					</div>
				{/if}
			{:else}
				<div class="flex flex-col gap-3 rounded-xl border border-dashed border-[var(--color-border)] p-4 text-sm text-[var(--color-text-muted)] sm:flex-row sm:items-center">
					<p class="flex-1">
						Add an OpenAI API key to ask questions across your memories, with citations.
					</p>
					<a
						href="/settings/ai"
						class="inline-flex shrink-0 items-center gap-2 self-start rounded-md border border-[var(--color-border)] px-2.5 py-1.5 text-xs text-[var(--color-text)] hover:bg-[var(--color-hover)] sm:self-auto"
					>
						<Settings class="h-3.5 w-3.5" />
						Set up
					</a>
				</div>
			{/if}
		</div>

		<!-- Recent captures -->
		{#if recentMemories.length > 0}
			<section>
				<div class="mb-1 flex items-center justify-between px-2">
					<h2 class="text-xs font-semibold text-[var(--color-text-faint)]">Recent</h2>
				</div>
				<ul>
					{#each recentMemories as memory (memory.id)}
						<li>
							<a
								href="/memory/{memory.id}"
								class="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-[var(--color-hover)]"
							>
								<FileText class="h-4 w-4 shrink-0 text-[var(--color-text-faint)]" />
								<span class="min-w-0 flex-1 truncate text-sm text-[var(--color-text)]">
									{memory.title || 'Untitled'}
								</span>
								<span class="flex shrink-0 items-center gap-1 text-xs tabular-nums text-[var(--color-text-faint)]">
									{formatRelativeTime(memory.updatedAt)}
								</span>
							</a>
						</li>
					{/each}
				</ul>
			</section>
		{/if}
	{/if}
</div>

{#if showRealtimePanel}
	<RealtimeSessionPanel onClose={() => (showRealtimePanel = false)} />
{/if}

<style>
	:global(.markdown-content sup .ask-citation) {
		display: inline-block;
		min-width: 1.25em;
		padding: 0 0.25em;
		margin: 0 0.05em;
		border-radius: 4px;
		background: color-mix(in srgb, var(--color-accent) 18%, transparent);
		color: var(--color-accent);
		font-size: 0.75em;
		font-weight: 600;
		text-align: center;
		text-decoration: none;
		transition: background 0.15s;
	}
	:global(.markdown-content sup .ask-citation:hover) {
		background: color-mix(in srgb, var(--color-accent) 35%, transparent);
		text-decoration: none;
	}

	/* Capture card */
	.capture {
		padding: 0.875rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg, 12px);
		background: var(--color-bg-secondary);
	}

	.capture-box {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0 0.75rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md, 8px);
		background: var(--color-bg);
	}

	.capture-box:focus-within {
		border-color: color-mix(in srgb, var(--color-accent) 60%, var(--color-border));
		box-shadow: 0 0 0 3px var(--color-accent-soft);
	}

	.capture-input,
	.capture-input:focus,
	.capture-input:focus-visible {
		min-width: 0;
		flex: 1;
		height: 2.75rem;
		border: none !important;
		background: transparent;
		color: var(--color-text);
		font-size: 0.9375rem;
		outline: none !important;
		box-shadow: none !important;
	}

	.capture-input::placeholder {
		color: var(--color-text-faint);
	}

	/* Phone: New note full width, the three others in one row below.
	   Wider: one row, New note taking the slack. */
	.capture-actions {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 0.5rem;
		margin-top: 0.75rem;
	}

	@media (min-width: 640px) {
		.capture-actions {
			display: flex;
		}
	}

	.capture-primary {
		display: flex;
		grid-column: 1 / -1;
		align-items: center;
		gap: 0.5rem;
		min-height: 2.75rem;
		padding: 0 1rem;
		border-radius: var(--radius-md, 8px);
		background: var(--color-accent);
		font-size: 0.9375rem;
		font-weight: 600;
		box-shadow: var(--shadow-sm, none);
	}

	.capture-primary:hover {
		background: var(--color-accent-hover, var(--color-accent));
	}

	@media (min-width: 640px) {
		.capture-primary {
			flex: 1 1 auto;
		}
	}

	.capture-secondary {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.25rem;
		min-height: 3.5rem;
		padding: 0.375rem 0.5rem;
		white-space: nowrap;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md, 8px);
		background: var(--color-bg);
		color: var(--color-text-muted);
		font-size: 0.8125rem;
		text-decoration: none;
	}

	@media (min-width: 640px) {
		.capture-secondary {
			flex: 0 0 auto;
			flex-direction: row;
			gap: 0.375rem;
			min-height: 2.75rem;
			padding: 0 0.875rem;
		}
	}

	.capture-secondary:hover {
		background: var(--color-hover);
		color: var(--color-text);
	}

	/* To do card */
	.todo {
		padding: 0.875rem 1rem;
		border: 1px solid color-mix(in srgb, var(--color-accent) 30%, var(--color-border));
		border-radius: var(--radius-lg, 12px);
		background: color-mix(in srgb, var(--color-accent) 5%, transparent);
	}

	.todo-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-height: 2rem;
		font-size: 0.875rem;
	}

	.todo-check {
		display: flex;
		width: 1.5rem;
		height: 1.5rem;
		flex-shrink: 0;
		align-items: center;
		justify-content: center;
		border-radius: 4px;
		color: var(--color-text-muted);
	}

	.todo-check:hover {
		color: var(--color-accent);
	}

	.todo-source {
		display: inline-flex;
		max-width: 10rem;
		flex-shrink: 0;
		align-items: center;
		gap: 0.25rem;
		font-size: 0.75rem;
		color: var(--color-text-faint);
		text-decoration: none;
	}

	.todo-source:hover {
		color: var(--color-accent);
	}

	.todo-warn {
		color: #df8e1d;
	}

	.ask-input:focus {
		border-color: color-mix(in srgb, var(--color-accent) 60%, var(--color-border));
		box-shadow: 0 0 0 3px var(--color-accent-soft);
	}

	.voice-toggle {
		border-color: var(--color-border);
		color: var(--color-text-muted);
	}

	.voice-toggle-on {
		border-color: var(--color-accent);
		color: var(--color-accent);
		background: color-mix(in srgb, var(--color-accent) 10%, transparent);
	}

	.filter-chip {
		display: inline-flex;
		align-items: center;
		padding: 0.125rem 0.5rem;
		background: color-mix(in srgb, var(--color-accent) 12%, transparent);
		color: var(--color-accent);
		border-radius: 999px;
		font-family: ui-monospace, monospace;
		font-size: 0.6875rem;
	}
</style>
