<script lang="ts">
	import {
		RealtimeSession,
		realtimeStatus,
		realtimeTurns,
		realtimeError
	} from '$lib/realtime';
	import { Mic, MicOff, AlertCircle, X, Loader2 } from 'lucide-svelte';
	import { onDestroy } from 'svelte';

	interface Props {
		onClose: () => void;
	}
	let { onClose }: Props = $props();

	let session: RealtimeSession | null = null;
	let starting = $state(false);

	async function handleStart() {
		if (starting || $realtimeStatus === 'connected') return;
		starting = true;
		session = new RealtimeSession();
		try {
			await session.start();
		} catch {
			// RealtimeSession already writes the error to the store
		} finally {
			starting = false;
		}
	}

	function handleStop() {
		if (session) {
			session.stop();
			session = null;
		}
	}

	function handleClose() {
		handleStop();
		onClose();
	}

	onDestroy(() => {
		handleStop();
	});

	const statusBadge: Record<string, string> = {
		connecting: 'k-badge-warn',
		connected: 'k-badge-success',
		error: 'k-badge-danger'
	};

	// Focus Start on open so Enter begins the session
	let startButton: HTMLButtonElement | undefined = $state();
	$effect(() => {
		startButton?.focus();
	});

	// Follow the conversation as turns stream in
	let transcriptRef: HTMLDivElement | undefined = $state();
	$effect(() => {
		const last = $realtimeTurns[$realtimeTurns.length - 1];
		void last?.text;
		if (transcriptRef) transcriptRef.scrollTop = transcriptRef.scrollHeight;
	});

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			handleClose();
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
	class="k-dialog-backdrop realtime-backdrop"
	onclick={handleClose}
	role="dialog"
	aria-modal="true"
	aria-labelledby="realtime-title"
	tabindex="-1"
>
	<div class="k-dialog panel" onclick={(e) => e.stopPropagation()} role="document">
		<div class="header">
			<div class="title">
				<h2 id="realtime-title">Voice session</h2>
				<span class="k-badge capitalize {statusBadge[$realtimeStatus] ?? ''}">{$realtimeStatus}</span>
			</div>
			<button type="button" class="k-icon-btn" onclick={handleClose} aria-label="Close">
				<X class="h-4 w-4" />
			</button>
		</div>

		{#if $realtimeError}
			<div class="error" role="alert">
				<AlertCircle class="h-4 w-4 shrink-0" />
				<span>{$realtimeError}</span>
			</div>
		{/if}

		<div class="transcript" bind:this={transcriptRef} aria-live="polite">
			{#if $realtimeTurns.length === 0 && $realtimeStatus !== 'connecting'}
				<div class="empty">
					{#if $realtimeStatus === 'connected'}
						<p>Listening… ask about your memories.</p>
						<p class="muted">
							Kurumi searches your vault before answering and can cite memories by title.
						</p>
					{:else}
						<p>Talk to Kurumi in real time.</p>
						<p class="muted">
							Streams audio to OpenAI's Realtime API over WebRTC. Your microphone stays on
							while the session runs.
						</p>
					{/if}
				</div>
			{/if}

			{#each $realtimeTurns as turn (turn.id)}
				<div class="turn turn-{turn.role}" class:partial={turn.partial}>
					{turn.text || (turn.partial ? '…' : '')}
				</div>
			{/each}
		</div>

		<div class="controls">
			{#if $realtimeStatus === 'connected'}
				<button type="button" class="k-btn k-btn-danger" onclick={handleStop}>
					<MicOff class="h-3.5 w-3.5" />
					End session
				</button>
			{:else if $realtimeStatus === 'connecting' || starting}
				<button type="button" class="k-btn" disabled>
					<Loader2 class="h-3.5 w-3.5 animate-spin" />
					Connecting…
				</button>
			{:else}
				<button type="button" class="k-btn k-btn-primary" bind:this={startButton} onclick={handleStart}>
					<Mic class="h-3.5 w-3.5" />
					Start session
				</button>
			{/if}
		</div>
	</div>
</div>

<style>
	.realtime-backdrop {
		z-index: 200;
	}

	.panel {
		display: flex;
		flex-direction: column;
		max-width: 36rem;
		max-height: 85vh;
		overflow: hidden;
	}

	.header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.625rem 0.625rem 0.625rem 1rem;
		border-bottom: 1px solid var(--color-border);
	}

	.title {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.title h2 {
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--color-text);
	}

	.error {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin: 0.75rem 1rem 0;
		padding: 0.5rem 0.75rem;
		border-radius: var(--radius-md);
		background: color-mix(in srgb, var(--color-danger) 10%, transparent);
		color: var(--color-danger);
		font-size: 0.8125rem;
	}

	.transcript {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		min-height: 16rem;
		padding: 1rem;
		overflow-y: auto;
		overscroll-behavior: contain;
	}

	.empty {
		margin: auto 0;
		text-align: center;
		font-size: 0.875rem;
		color: var(--color-text);
	}

	.empty p {
		margin: 0 0 0.375rem;
	}

	.empty .muted {
		max-width: 26rem;
		margin-inline: auto;
		font-size: 0.8125rem;
		color: var(--color-text-muted);
	}

	/* User turns as a quiet block, assistant turns as plain text */
	.turn {
		font-size: 0.875rem;
		line-height: 1.6;
		color: var(--color-text);
		white-space: pre-wrap;
		word-wrap: break-word;
	}

	.turn-user {
		align-self: flex-end;
		max-width: 85%;
		padding: 0.375rem 0.75rem;
		border-radius: var(--radius-md);
		background: var(--color-hover);
	}

	.turn.partial {
		color: var(--color-text-muted);
	}

	.controls {
		display: flex;
		justify-content: center;
		padding: 0.75rem 1rem;
		border-top: 1px solid var(--color-border);
	}
</style>
