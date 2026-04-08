<script lang="ts">
	import { undoHead, undoLast, dismissUndo } from '$lib/stores/undo';
	import { Undo2, X } from 'lucide-svelte';

	// Each time a new undo head appears we start an auto-dismiss timer.
	// The toast shows for AUTO_DISMISS_MS unless the user clicks undo
	// or manually dismisses first.
	const AUTO_DISMISS_MS = 6_000;
	let visibleId = $state<string | null>(null);
	let timer: ReturnType<typeof setTimeout> | null = null;

	$effect(() => {
		const head = $undoHead;
		if (!head) {
			visibleId = null;
			return;
		}
		if (head.id === visibleId) return;
		visibleId = head.id;
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => {
			if (visibleId === head.id) {
				visibleId = null;
			}
		}, AUTO_DISMISS_MS);
	});

	function handleUndo() {
		undoLast();
		visibleId = null;
	}

	function handleDismiss() {
		if ($undoHead) dismissUndo($undoHead.id);
		visibleId = null;
	}
</script>

{#if $undoHead && visibleId === $undoHead.id}
	<div class="undo-toast" role="status" aria-live="polite">
		<span class="label">{$undoHead.label}</span>
		<button class="undo-btn" onclick={handleUndo}>
			<Undo2 class="h-3.5 w-3.5" />
			Undo
		</button>
		<button class="close-btn" onclick={handleDismiss} aria-label="Dismiss">
			<X class="h-3.5 w-3.5" />
		</button>
	</div>
{/if}

<style>
	.undo-toast {
		position: fixed;
		bottom: 1.5rem;
		left: 50%;
		transform: translateX(-50%);
		z-index: 200;
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.625rem 0.875rem 0.625rem 1rem;
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 0.625rem;
		box-shadow: 0 6px 20px rgba(0, 0, 0, 0.2);
		max-width: calc(100vw - 2rem);
		animation: slide-up 0.18s ease-out;
	}

	.label {
		font-size: 0.8125rem;
		color: var(--color-text);
	}

	.undo-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.3125rem 0.625rem;
		background: var(--color-accent);
		color: white;
		border: none;
		border-radius: 0.375rem;
		font-size: 0.75rem;
		font-weight: 500;
		cursor: pointer;
		transition: background 0.15s;
	}

	.undo-btn:hover {
		background: var(--color-accent-hover);
	}

	.close-btn {
		background: none;
		border: none;
		padding: 0.25rem;
		border-radius: 0.25rem;
		cursor: pointer;
		color: var(--color-text-muted);
		display: flex;
		align-items: center;
	}

	.close-btn:hover {
		background: var(--color-bg-secondary);
		color: var(--color-text);
	}

	@keyframes slide-up {
		from {
			opacity: 0;
			transform: translate(-50%, 1rem);
		}
		to {
			opacity: 1;
			transform: translate(-50%, 0);
		}
	}
</style>
