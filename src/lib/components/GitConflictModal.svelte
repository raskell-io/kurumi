<script lang="ts">
	import { gitSyncState, clearGitConflicts, type MemoryConflict } from '$lib/git';
	import { updateMemoryObject } from '$lib/db';
	import { sync } from '$lib/sync';
	import { X, Check, ChevronLeft, ChevronRight } from 'lucide-svelte';

	interface Props {
		onClose?: () => void;
	}
	let { onClose }: Props = $props();

	let conflicts = $derived($gitSyncState.conflicts);
	let currentIndex = $state(0);
	let current = $derived<MemoryConflict | null>(conflicts[currentIndex] ?? null);
	let remaining = $derived(conflicts.length);

	function formatTime(ts: number): string {
		return new Date(ts).toLocaleString();
	}

	function acceptLocal() {
		if (!current) return;
		// updateMemoryObject bumps updatedAt internally, which makes this
		// the definitive winner for the next sync push.
		updateMemoryObject(current.memoryId, { bodyMarkdown: current.localBody });
		advance();
	}

	function acceptRemote() {
		if (!current) return;
		updateMemoryObject(current.memoryId, { bodyMarkdown: current.remoteBody });
		advance();
	}

	function advance() {
		if (currentIndex < conflicts.length - 1) {
			currentIndex++;
		} else {
			// All resolved. Clear conflict list and trigger a fresh sync so
			// the chosen versions get pushed.
			clearGitConflicts();
			void sync();
			onClose?.();
		}
	}

	function skip() {
		// Let the user come back later: close without resolving.
		onClose?.();
	}

	// Move focus into the dialog on open (no default choice: picking a side
	// overwrites the other, so Enter shouldn't do it by accident).
	let panelRef: HTMLDivElement | undefined = $state();
	$effect(() => {
		panelRef?.focus();
	});

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape' && current) {
			e.preventDefault();
			skip();
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

{#if current}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div
		class="k-dialog-backdrop conflict-backdrop"
		onclick={skip}
		role="dialog"
		aria-modal="true"
		aria-labelledby="git-conflict-title"
		tabindex="-1"
	>
		<div
			class="k-dialog modal"
			bind:this={panelRef}
			onclick={(e) => e.stopPropagation()}
			role="document"
			tabindex="-1"
		>
			<div class="header">
				<div class="min-w-0">
					<h2 id="git-conflict-title">
						Sync conflict
						{#if remaining > 1}<span class="count">{currentIndex + 1} of {remaining}</span>{/if}
					</h2>
					<p class="intro">
						<strong>{current.title}</strong> changed on this device and on the remote since the
						last sync. Keep one version — the other is overwritten.
					</p>
				</div>
				<button type="button" class="k-icon-btn" onclick={skip} aria-label="Close">
					<X class="h-4 w-4" />
				</button>
			</div>

			<div class="diff">
				<div class="side">
					<div class="side-header">
						<span class="label">This device</span>
						<span class="time">{formatTime(current.localUpdatedAt)}</span>
					</div>
					<pre class="body">{current.localBody || '(empty)'}</pre>
					<button type="button" class="k-btn" onclick={acceptLocal}>
						<Check class="h-3.5 w-3.5" />
						Keep local
					</button>
				</div>
				<div class="side">
					<div class="side-header">
						<span class="label">Remote</span>
						<span class="time">{formatTime(current.remoteUpdatedAt)}</span>
					</div>
					<pre class="body">{current.remoteBody || '(empty)'}</pre>
					<button type="button" class="k-btn" onclick={acceptRemote}>
						<Check class="h-3.5 w-3.5" />
						Keep remote
					</button>
				</div>
			</div>

			<div class="footer">
				{#if conflicts.length > 1}
					<div class="flex items-center gap-1">
						<button
							type="button"
							class="k-icon-btn"
							disabled={currentIndex === 0}
							onclick={() => currentIndex--}
							aria-label="Previous conflict"
						>
							<ChevronLeft class="h-4 w-4" />
						</button>
						<span class="progress">{currentIndex + 1} / {conflicts.length}</span>
						<button
							type="button"
							class="k-icon-btn"
							disabled={currentIndex === conflicts.length - 1}
							onclick={() => currentIndex++}
							aria-label="Next conflict"
						>
							<ChevronRight class="h-4 w-4" />
						</button>
					</div>
				{:else}
					<span></span>
				{/if}
				<button type="button" class="k-btn k-btn-ghost" onclick={skip}>Decide later</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.conflict-backdrop {
		z-index: 200;
	}

	@media (min-width: 768px) {
		.conflict-backdrop {
			align-items: center;
			padding-top: 1rem;
		}
	}

	.modal {
		display: flex;
		flex-direction: column;
		max-width: 60rem;
		max-height: 90vh;
		overflow: hidden;
	}

	.modal:focus {
		outline: none;
	}

	.header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 0.75rem;
		padding: 0.875rem 0.75rem 0.875rem 1rem;
		border-bottom: 1px solid var(--color-border);
	}

	.header h2 {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--color-text);
	}

	.count {
		font-size: 0.75rem;
		font-weight: 400;
		color: var(--color-text-faint);
	}

	.intro {
		margin-top: 0.25rem;
		font-size: 0.8125rem;
		line-height: 1.5;
		color: var(--color-text-muted);
	}

	.intro strong {
		font-weight: 500;
		color: var(--color-text);
	}

	.diff {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1rem;
		padding: 1rem;
		overflow: auto;
	}

	@media (max-width: 640px) {
		.diff {
			grid-template-columns: 1fr;
		}
	}

	.side {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		min-width: 0;
	}

	.side-header {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 0.5rem;
		padding: 0 0.125rem;
	}

	.label {
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--color-text);
	}

	.time {
		font-size: 0.75rem;
		color: var(--color-text-faint);
	}

	.body {
		flex: 1;
		min-height: 12rem;
		max-height: 24rem;
		margin: 0;
		overflow: auto;
		padding: 0.75rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-bg-secondary);
		color: var(--color-text);
		font-family: var(--font-mono, ui-monospace, monospace);
		font-size: 0.8125rem;
		line-height: 1.5;
		white-space: pre-wrap;
		word-wrap: break-word;
	}

	.footer {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.75rem;
		padding: 0.625rem 0.75rem;
		border-top: 1px solid var(--color-border);
	}

	.progress {
		min-width: 2.5rem;
		text-align: center;
		font-size: 0.75rem;
		color: var(--color-text-faint);
		font-variant-numeric: tabular-nums;
	}
</style>
