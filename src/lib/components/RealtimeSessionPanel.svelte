<script lang="ts">
	import {
		RealtimeSession,
		realtimeStatus,
		realtimeTurns,
		realtimeError
	} from '$lib/realtime';
	import { Mic, MicOff, Radio, AlertCircle, X, User, Bot } from 'lucide-svelte';
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
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div class="backdrop" onclick={handleClose} role="dialog" aria-modal="true" tabindex="-1">
	<div class="panel" onclick={(e) => e.stopPropagation()} role="document">
		<div class="header">
			<div class="title">
				<Radio class="h-5 w-5 text-[var(--color-accent)]" />
				<h3>Realtime voice session</h3>
				<span class="status status-{$realtimeStatus}">{$realtimeStatus}</span>
			</div>
			<button class="close" onclick={handleClose} aria-label="Close">
				<X class="h-4 w-4" />
			</button>
		</div>

		{#if $realtimeError}
			<div class="error">
				<AlertCircle class="h-4 w-4 shrink-0" />
				<span>{$realtimeError}</span>
			</div>
		{/if}

		<div class="transcript">
			{#if $realtimeTurns.length === 0 && $realtimeStatus !== 'connecting'}
				<div class="empty">
					{#if $realtimeStatus === 'connected'}
						<p>Listening… speak to ask about your memories.</p>
						<p class="muted">
							Kurumi will search your vault before answering, and can cite
							specific memories by title.
						</p>
					{:else}
						<p>Click Start to begin a voice session with Kurumi.</p>
						<p class="muted">
							Uses WebRTC to stream audio to OpenAI's Realtime API. Your
							microphone will be active while the session is running.
						</p>
					{/if}
				</div>
			{/if}

			{#each $realtimeTurns as turn (turn.id)}
				<div class="turn turn-{turn.role}">
					<div class="avatar">
						{#if turn.role === 'user'}
							<User class="h-3.5 w-3.5" />
						{:else}
							<Bot class="h-3.5 w-3.5" />
						{/if}
					</div>
					<div class="bubble" class:partial={turn.partial}>
						{turn.text || (turn.partial ? '…' : '')}
					</div>
				</div>
			{/each}
		</div>

		<div class="controls">
			{#if $realtimeStatus === 'connected'}
				<button class="btn btn-stop" onclick={handleStop}>
					<MicOff class="h-4 w-4" />
					Stop session
				</button>
			{:else if $realtimeStatus === 'connecting' || starting}
				<button class="btn" disabled>
					<div class="spinner"></div>
					Connecting…
				</button>
			{:else}
				<button class="btn btn-start" onclick={handleStart}>
					<Mic class="h-4 w-4" />
					Start session
				</button>
			{/if}
		</div>
	</div>
</div>

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

	.panel {
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 0.75rem;
		max-width: 640px;
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

	.status {
		font-size: 0.6875rem;
		font-weight: 500;
		padding: 0.125rem 0.5rem;
		border-radius: 999px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.status-idle,
	.status-stopped {
		background: var(--color-bg-secondary);
		color: var(--color-text-muted);
	}

	.status-connecting {
		background: rgba(234, 179, 8, 0.15);
		color: #eab308;
	}

	.status-connected {
		background: rgba(34, 197, 94, 0.15);
		color: #22c55e;
	}

	.status-error {
		background: rgba(239, 68, 68, 0.15);
		color: #ef4444;
	}

	.close {
		background: none;
		border: none;
		padding: 0.375rem;
		border-radius: 0.375rem;
		cursor: pointer;
		color: var(--color-text-muted);
	}

	.close:hover {
		background: var(--color-bg-secondary);
		color: var(--color-text);
	}

	.error {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin: 1rem 1.25rem 0;
		padding: 0.625rem 0.875rem;
		background: rgba(239, 68, 68, 0.1);
		border: 1px solid rgba(239, 68, 68, 0.3);
		border-radius: 0.5rem;
		color: #ef4444;
		font-size: 0.8125rem;
	}

	.transcript {
		flex: 1;
		overflow-y: auto;
		padding: 1.25rem;
		min-height: 18rem;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.empty {
		text-align: center;
		color: var(--color-text);
		margin: auto 0;
	}

	.empty p {
		margin: 0 0 0.5rem 0;
	}

	.empty .muted {
		color: var(--color-text-muted);
		font-size: 0.8125rem;
		max-width: 28rem;
		margin-left: auto;
		margin-right: auto;
	}

	.turn {
		display: flex;
		align-items: flex-start;
		gap: 0.625rem;
	}

	.turn-user {
		justify-content: flex-end;
	}

	.turn-user .bubble {
		background: var(--color-accent);
		color: white;
		max-width: 75%;
	}

	.turn-user .avatar {
		order: 2;
		background: var(--color-accent);
		color: white;
	}

	.turn-assistant .bubble {
		background: var(--color-bg-secondary);
		color: var(--color-text);
		max-width: 85%;
	}

	.turn-assistant .avatar {
		background: var(--color-bg-secondary);
		color: var(--color-accent);
	}

	.avatar {
		flex-shrink: 0;
		width: 1.75rem;
		height: 1.75rem;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.bubble {
		padding: 0.5rem 0.875rem;
		border-radius: 1rem;
		font-size: 0.875rem;
		line-height: 1.5;
		white-space: pre-wrap;
		word-wrap: break-word;
	}

	.bubble.partial {
		opacity: 0.85;
	}

	.controls {
		display: flex;
		justify-content: center;
		padding: 1rem 1.25rem;
		border-top: 1px solid var(--color-border);
	}

	.btn {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.625rem 1.25rem;
		background: var(--color-bg-secondary);
		color: var(--color-text);
		border: 1px solid var(--color-border);
		border-radius: 0.5rem;
		font-size: 0.875rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.15s;
	}

	.btn:disabled {
		opacity: 0.7;
		cursor: not-allowed;
	}

	.btn-start {
		background: var(--color-accent);
		border-color: var(--color-accent);
		color: white;
	}

	.btn-start:hover {
		background: var(--color-accent-hover);
	}

	.btn-stop {
		background: #ef4444;
		border-color: #ef4444;
		color: white;
	}

	.btn-stop:hover {
		background: #dc2626;
	}

	.spinner {
		width: 1rem;
		height: 1rem;
		border: 2px solid currentColor;
		border-top-color: transparent;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
