<script lang="ts">
	import { gitSyncState, clearGitConflicts, type MemoryConflict } from '$lib/git';
	import { updateMemoryObject } from '$lib/db';
	import { sync } from '$lib/sync';
	import { AlertTriangle, X, Check, ArrowLeft, ArrowRight } from 'lucide-svelte';

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
</script>

{#if current}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div class="backdrop" onclick={skip} role="dialog" aria-modal="true" tabindex="-1">
		<div class="modal" onclick={(e) => e.stopPropagation()} role="document">
			<div class="header">
				<div class="title">
					<AlertTriangle class="h-5 w-5 text-yellow-500" />
					<h3>Sync conflict {currentIndex + 1} of {remaining}</h3>
				</div>
				<button class="close" onclick={skip} aria-label="Close">
					<X class="h-4 w-4" />
				</button>
			</div>

			<div class="intro">
				<p>
					<strong>{current.title}</strong> was edited on both this device and
					another since the last sync. Pick which version to keep — the other
					will be overwritten.
				</p>
			</div>

			<div class="diff">
				<div class="side">
					<div class="side-header">
						<span class="label">Local</span>
						<span class="time">{formatTime(current.localUpdatedAt)}</span>
					</div>
					<pre class="body">{current.localBody || '(empty)'}</pre>
					<button class="accept-btn" onclick={acceptLocal}>
						<Check class="h-4 w-4" />
						Keep local
					</button>
				</div>
				<div class="side">
					<div class="side-header">
						<span class="label">Remote</span>
						<span class="time">{formatTime(current.remoteUpdatedAt)}</span>
					</div>
					<pre class="body">{current.remoteBody || '(empty)'}</pre>
					<button class="accept-btn" onclick={acceptRemote}>
						<Check class="h-4 w-4" />
						Keep remote
					</button>
				</div>
			</div>

			{#if conflicts.length > 1}
				<div class="nav">
					<button
						class="nav-btn"
						disabled={currentIndex === 0}
						onclick={() => currentIndex--}
					>
						<ArrowLeft class="h-4 w-4" />
						Previous
					</button>
					<span class="progress">{currentIndex + 1} / {conflicts.length}</span>
					<button
						class="nav-btn"
						disabled={currentIndex === conflicts.length - 1}
						onclick={() => currentIndex++}
					>
						Next
						<ArrowRight class="h-4 w-4" />
					</button>
				</div>
			{/if}
		</div>
	</div>
{/if}

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.6);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 200;
		padding: 1rem;
	}

	.modal {
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 0.75rem;
		max-width: 960px;
		width: 100%;
		max-height: 90vh;
		display: flex;
		flex-direction: column;
		box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
	}

	.header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 1rem 1.25rem;
		border-bottom: 1px solid var(--color-border);
	}

	.title {
		display: flex;
		align-items: center;
		gap: 0.625rem;
	}

	.title h3 {
		font-size: 1.125rem;
		font-weight: 600;
		color: var(--color-text);
	}

	.close {
		background: none;
		border: none;
		padding: 0.25rem;
		cursor: pointer;
		color: var(--color-text-muted);
	}

	.intro {
		padding: 0.875rem 1.25rem;
		border-bottom: 1px solid var(--color-border);
		color: var(--color-text);
		font-size: 0.875rem;
		line-height: 1.5;
	}

	.diff {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1rem;
		padding: 1.25rem;
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
		gap: 0.625rem;
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border);
		border-radius: 0.5rem;
		padding: 0.875rem;
	}

	.side-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.5rem;
	}

	.label {
		font-size: 0.75rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--color-accent);
	}

	.time {
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}

	.body {
		flex: 1;
		min-height: 12rem;
		max-height: 24rem;
		overflow: auto;
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 0.375rem;
		padding: 0.75rem;
		color: var(--color-text);
		font-family: ui-monospace, monospace;
		font-size: 0.8125rem;
		line-height: 1.5;
		white-space: pre-wrap;
		word-wrap: break-word;
		margin: 0;
	}

	.accept-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.375rem;
		padding: 0.5rem 1rem;
		background: var(--color-accent);
		color: white;
		border: none;
		border-radius: 0.375rem;
		font-size: 0.875rem;
		font-weight: 500;
		cursor: pointer;
		transition: background 0.15s;
	}

	.accept-btn:hover {
		background: var(--color-accent-hover);
	}

	.nav {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.75rem;
		padding: 0.875rem 1.25rem;
		border-top: 1px solid var(--color-border);
	}

	.nav-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.4375rem 0.875rem;
		background: transparent;
		border: 1px solid var(--color-border);
		border-radius: 0.375rem;
		color: var(--color-text);
		font-size: 0.8125rem;
		cursor: pointer;
		transition: background 0.15s;
	}

	.nav-btn:hover:not(:disabled) {
		background: var(--color-bg-secondary);
	}

	.nav-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.progress {
		color: var(--color-text-muted);
		font-size: 0.75rem;
	}
</style>
