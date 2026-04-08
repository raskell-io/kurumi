<script lang="ts">
	import {
		memoryObjects,
		addMemoryObject,
		actionItems,
		reminderProposals,
		updateActionItemStatus,
		todayIso
	} from '$lib/db';
	import { askKurumi, isAskKurumiResult, type AskKurumiResult } from '$lib/ask';
	import { isAIConfigured } from '$lib/ai';
	import { inferenceRouter } from '$lib/inference';
	import { startPushToTalk, speak, stopSpeaking, type RecorderHandle } from '$lib/voice';
	import type { MemoryObject } from '$lib/db/types';
	import MarkdownRenderer from '$lib/components/MarkdownRenderer.svelte';
	import { goto } from '$app/navigation';
	import { onDestroy } from 'svelte';
	import {
		Plus,
		FileText,
		Clock,
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
		Bell
	} from 'lucide-svelte';
	import { showNewNoteSnackbar, triggerVoiceAssistant } from '$lib/stores/snackbar';

	type Turn = {
		question: string;
		result: AskKurumiResult;
	};

	function handleNewNote() {
		const memory = addMemoryObject();
		goto(`/memory/${memory.id}`);
		showNewNoteSnackbar.set(true);
	}

	// Get 5 most recently edited memories
	let recentMemories = $derived(
		[...$memoryObjects].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 5)
	);

	// Action items due on or before today, still open — the Phase 9
	// "actually show me what's next" surface. Done / cancelled items
	// are excluded so the list stays actionable.
	let dueToday = $derived.by(() => {
		const today = todayIso();
		return $actionItems.filter(
			(a) =>
				(a.status === 'open' || a.status === 'in_progress') &&
				a.dueDate !== null &&
				a.dueDate <= today
		);
	});

	let pendingProposalsCount = $derived(
		$reminderProposals.filter((p) => p.status === 'pending').length
	);

	// Ask Kurumi state
	let aiAvailable = $state(false);
	$effect(() => {
		// Read at mount; isAIConfigured reads localStorage which isn't reactive,
		// so we just check once. The user re-checking after configuring is a
		// reload anyway since localStorage changes don't propagate.
		aiAvailable = isAIConfigured();
	});

	let question = $state('');
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

	const tips = [
		{ icon: '[[', text: 'Use [[Note Title]] to link notes together' },
		{ icon: '#', text: 'Add #tags to organize your thoughts' },
		{ icon: '/', text: 'Press Cmd+K to search and navigate quickly' }
	];
</script>

<div class="mx-auto max-w-3xl p-6 md:p-10">
	{#if $memoryObjects.length === 0}
		<!-- Empty-vault welcome state -->
		<div class="flex flex-col items-center text-center">
			<img
				src="/icon-512.avif"
				alt="Kurumi"
				class="mx-auto mb-5 h-24 w-24 rounded-2xl shadow-lg md:mb-8 md:h-28 md:w-28"
			/>
			<h1 class="mb-3 text-3xl font-bold text-[var(--color-text)] md:text-4xl">Welcome to Kurumi</h1>
			<p class="mb-8 text-lg text-[var(--color-text-muted)] md:mb-10 md:text-xl">
				Your local-first second brain
			</p>

			<button
				type="button"
				onclick={handleNewNote}
				class="group relative inline-flex items-center gap-2 overflow-hidden rounded-xl px-6 py-3.5 text-lg font-medium text-[#1e1e2e] shadow-lg transition-all duration-300 hover:scale-105 hover:shadow-xl active:scale-[0.98] md:px-8 md:text-xl"
				style="background: linear-gradient(135deg, #89b4fa, #cba6f7, #f5c2e7); box-shadow: 0 10px 40px -10px rgba(203, 166, 247, 0.5);"
			>
				<span
					class="absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
					style="background: linear-gradient(135deg, #74c7ec, #b4befe, #f5c2e7);"
				></span>
				<Plus class="relative h-6 w-6 md:h-7 md:w-7" />
				<span class="relative">Create your first note</span>
			</button>

			<div class="mx-auto mt-10 max-w-md space-y-4 text-left">
				<p class="text-center text-sm font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
					Quick tips
				</p>
				{#each tips as tip}
					<div class="flex items-center gap-4 rounded-xl bg-[var(--color-bg-secondary)] px-5 py-4">
						<span
							class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--color-accent)] text-base font-mono text-white"
						>
							{tip.icon}
						</span>
						<span class="text-base text-[var(--color-text-muted)]">{tip.text}</span>
					</div>
				{/each}
			</div>
		</div>
	{:else}
		<!-- Due today + pending proposals strip -->
		{#if dueToday.length > 0 || pendingProposalsCount > 0}
			<div class="mb-6 space-y-3">
				{#if dueToday.length > 0}
					<div class="rounded-xl border border-[var(--color-accent)]/30 bg-[var(--color-accent)]/5 p-4">
						<div class="mb-2 flex items-center justify-between">
							<div class="flex items-center gap-2 text-sm font-semibold text-[var(--color-text)]">
								<CheckSquare class="h-4 w-4 text-[var(--color-accent)]" />
								Due today or earlier
								<span class="rounded-full bg-[var(--color-bg-secondary)] px-2 text-xs text-[var(--color-text-muted)]">
									{dueToday.length}
								</span>
							</div>
							<a href="/actions" class="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-accent)]">
								View all →
							</a>
						</div>
						<ul class="space-y-1">
							{#each dueToday.slice(0, 5) as item (item.id)}
								<li class="flex items-center gap-2 text-sm">
									<button
										class="flex h-5 w-5 shrink-0 items-center justify-center text-[var(--color-text-muted)] hover:text-[var(--color-accent)]"
										onclick={() => updateActionItemStatus(item.id, 'done')}
										aria-label="Mark done"
									>
										<Square class="h-4 w-4" />
									</button>
									<span class="flex-1 truncate text-[var(--color-text)]">{item.text}</span>
									{#if item.dueDate}
										<span class="shrink-0 text-xs text-[var(--color-text-muted)]">{item.dueDate}</span>
									{/if}
								</li>
							{/each}
						</ul>
					</div>
				{/if}
				{#if pendingProposalsCount > 0}
					<a
						href="/proposals"
						class="flex items-center gap-3 rounded-xl border border-yellow-500/30 bg-yellow-500/5 p-3 text-sm text-[var(--color-text)] transition-colors hover:border-yellow-500/50"
					>
						<Bell class="h-4 w-4 text-yellow-500" />
						<span class="flex-1">
							{pendingProposalsCount} reminder proposal{pendingProposalsCount === 1 ? '' : 's'}
							waiting for your review
						</span>
						<span class="text-xs text-[var(--color-text-muted)]">Review →</span>
					</a>
				{/if}
			</div>
		{/if}

		<!-- Ask Kurumi (or fallback if no AI key) + recent activity -->
		<div class="mb-8">
			<div class="mb-3 flex items-center justify-between gap-2">
				<div class="flex items-center gap-2">
					<Sparkles class="h-5 w-5 text-[var(--color-accent)]" />
					<h1 class="text-xl font-semibold text-[var(--color-text)]">Ask Kurumi</h1>
				</div>
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
							: 'Ask anything about your memories…'}
						disabled={asking || recording || transcribing}
						class="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-4 py-4 pr-24 text-base text-[var(--color-text)] placeholder-[var(--color-text-muted)] outline-none transition-colors focus:border-[var(--color-accent)] disabled:opacity-50"
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
								class="flex h-10 w-10 items-center justify-center rounded-lg transition-all disabled:opacity-50"
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
							class="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--color-accent)] text-white transition-all hover:bg-[var(--color-accent-hover)] disabled:opacity-50 disabled:hover:bg-[var(--color-accent)]"
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
								class="inline-flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-1.5 text-xs text-[var(--color-text-muted)] hover:bg-[var(--color-border)] hover:text-[var(--color-text)]"
							>
								<RotateCcw class="h-3 w-3" />
								Clear conversation
							</button>
						</div>
					</div>
				{/if}
			{:else}
				<div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4 text-sm text-[var(--color-text-muted)]">
					<p>
						Configure an OpenAI API key to ask natural-language questions across your memories.
					</p>
					<a
						href="/settings"
						class="mt-3 inline-flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-xs text-[var(--color-text)] hover:bg-[var(--color-border)]"
					>
						<Settings class="h-3.5 w-3.5" />
						Open settings
					</a>
				</div>
			{/if}
		</div>

		<!-- Recent captures -->
		{#if recentMemories.length > 0}
			<div>
				<p class="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
					Recent
				</p>
				<div class="space-y-2">
					{#each recentMemories as memory}
						<a
							href="/memory/{memory.id}"
							class="flex items-center gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-4 py-3 transition-all hover:border-[var(--color-accent)]"
						>
							<FileText class="h-5 w-5 shrink-0 text-[var(--color-accent)]" />
							<div class="min-w-0 flex-1">
								<p class="truncate font-medium text-[var(--color-text)]">
									{memory.title || 'Untitled'}
								</p>
							</div>
							<div class="flex shrink-0 items-center gap-1 text-xs text-[var(--color-text-muted)]">
								<Clock class="h-3 w-3" />
								{formatRelativeTime(memory.updatedAt)}
							</div>
						</a>
					{/each}
				</div>
			</div>
		{/if}

		<div class="mt-6">
			<button
				type="button"
				onclick={handleNewNote}
				class="inline-flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-4 py-2 text-sm text-[var(--color-text)] hover:bg-[var(--color-border)]"
			>
				<Plus class="h-4 w-4" />
				New note
			</button>
		</div>
	{/if}
</div>

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

	.voice-toggle {
		border-color: var(--color-border);
		color: var(--color-text-muted);
	}

	.voice-toggle-on {
		border-color: var(--color-accent);
		color: var(--color-accent);
		background: color-mix(in srgb, var(--color-accent) 10%, transparent);
	}
</style>
