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
		<button class="undo-btn" onclick={handleUndo} title="Undo (⌘Z)">
			<Undo2 class="h-3.5 w-3.5" />
			Undo
		</button>
		<button class="close-btn" onclick={handleDismiss} aria-label="Dismiss">
			<X class="h-3.5 w-3.5" />
		</button>
	</div>
{/if}

<style>
	/* Inverted toast: reads clearly over any content in both themes */
	.undo-toast {
		position: fixed;
		bottom: calc(1.25rem + env(safe-area-inset-bottom, 0px));
		left: 50%;
		transform: translateX(-50%);
		z-index: 200;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.375rem 0.375rem 0.375rem 0.875rem;
		background: var(--color-text);
		color: var(--color-bg);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-lg);
		max-width: calc(100vw - 2rem);
		animation: slide-up 0.18s var(--ease-out);
	}

	.label {
		font-size: 0.8125rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.undo-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.25rem 0.5rem;
		background: color-mix(in srgb, var(--color-bg) 14%, transparent);
		color: inherit;
		border: none;
		border-radius: var(--radius-sm);
		font-size: 0.75rem;
		font-weight: 600;
		cursor: pointer;
		flex-shrink: 0;
	}

	.undo-btn:hover {
		background: color-mix(in srgb, var(--color-bg) 24%, transparent);
	}

	.close-btn {
		background: none;
		border: none;
		padding: 0.25rem;
		border-radius: var(--radius-sm);
		cursor: pointer;
		color: inherit;
		opacity: 0.6;
		display: flex;
		align-items: center;
		flex-shrink: 0;
	}

	.close-btn:hover {
		opacity: 1;
		background: color-mix(in srgb, var(--color-bg) 14%, transparent);
	}

	@keyframes slide-up {
		from {
			opacity: 0;
			transform: translate(-50%, 0.5rem);
		}
		to {
			opacity: 1;
			transform: translate(-50%, 0);
		}
	}
</style>
