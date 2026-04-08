<script lang="ts">
	import { memoryObjects, addMemoryObject } from '$lib/db';
	import { askKurumi, isAskKurumiResult, type AskKurumiResult } from '$lib/ask';
	import { isAIConfigured } from '$lib/ai';
	import MarkdownRenderer from '$lib/components/MarkdownRenderer.svelte';
	import { goto } from '$app/navigation';
	import { Plus, FileText, Clock, Sparkles, Send, AlertCircle, Settings } from 'lucide-svelte';
	import { showNewNoteSnackbar } from '$lib/stores/snackbar';

	function handleNewNote() {
		const memory = addMemoryObject();
		goto(`/memory/${memory.id}`);
		showNewNoteSnackbar.set(true);
	}

	// Get 5 most recently edited memories
	let recentMemories = $derived(
		[...$memoryObjects].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 5)
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
	let answer = $state<AskKurumiResult | null>(null);
	let askError = $state<string | null>(null);

	async function handleAsk() {
		const trimmed = question.trim();
		if (!trimmed || asking) return;
		asking = true;
		askError = null;
		answer = null;
		try {
			const result = await askKurumi(trimmed);
			if (isAskKurumiResult(result)) {
				answer = result;
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

	function clearAnswer() {
		answer = null;
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
		<!-- Ask Kurumi (or fallback if no AI key) + recent activity -->
		<div class="mb-8">
			<div class="mb-3 flex items-center gap-2">
				<Sparkles class="h-5 w-5 text-[var(--color-accent)]" />
				<h1 class="text-xl font-semibold text-[var(--color-text)]">Ask Kurumi</h1>
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
						placeholder="Ask anything about your memories…"
						disabled={asking}
						class="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-4 py-4 pr-14 text-base text-[var(--color-text)] placeholder-[var(--color-text-muted)] outline-none transition-colors focus:border-[var(--color-accent)] disabled:opacity-50"
					/>
					<button
						type="submit"
						disabled={!question.trim() || asking}
						class="absolute right-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-lg bg-[var(--color-accent)] text-white transition-all hover:bg-[var(--color-accent-hover)] disabled:opacity-50 disabled:hover:bg-[var(--color-accent)]"
						aria-label="Ask"
					>
						{#if asking}
							<div class="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"></div>
						{:else}
							<Send class="h-4 w-4" />
						{/if}
					</button>
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

				{#if answer}
					<div class="mt-4 space-y-4">
						<div class="rounded-xl border border-[var(--color-accent)]/30 bg-[var(--color-accent)]/5 p-4">
							<div class="markdown-content text-sm text-[var(--color-text)]">
								<MarkdownRenderer content={answer.answer} />
							</div>
							<div class="mt-3 flex items-center justify-between text-xs text-[var(--color-text-muted)]">
								<span>{answer.candidates.length} memories searched · {answer.citations.length} cited</span>
								<button
									type="button"
									onclick={clearAnswer}
									class="rounded px-2 py-0.5 hover:bg-[var(--color-bg-secondary)]"
								>
									Clear
								</button>
							</div>
						</div>

						{#if answer.citations.length > 0}
							<div>
								<p class="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
									Sources
								</p>
								<div class="space-y-2">
									{#each answer.citations as memory (memory.id)}
										<a
											href="/memory/{memory.id}"
											class="block rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3 transition-colors hover:border-[var(--color-accent)]"
										>
											<div class="font-medium text-[var(--color-text)]">
												{memory.title || 'Untitled'}
											</div>
											<div class="mt-1 truncate text-sm text-[var(--color-text-muted)]">
												{memoryPreview(memory.summaryShort ?? memory.transcript ?? memory.bodyMarkdown)}
											</div>
										</a>
									{/each}
								</div>
							</div>
						{/if}
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
