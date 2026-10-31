<script lang="ts">
	import { notice } from '$lib/stores/notice';
	import { X } from 'lucide-svelte';

	// Shows the latest notice for a few seconds.
	$effect(() => {
		const current = $notice;
		if (!current) return;
		const timer = setTimeout(() => notice.update((n) => (n?.id === current.id ? null : n)), 5000);
		return () => clearTimeout(timer);
	});
</script>

{#if $notice}
	<div class="notice-toast" role="status" aria-live="polite">
		<span class="label">{$notice.text}</span>
		<button class="close-btn" onclick={() => notice.set(null)} aria-label="Dismiss">
			<X class="h-3.5 w-3.5" />
		</button>
	</div>
{/if}

<style>
	/* Same inverted toast as UndoToast, above it and the update prompt */
	.notice-toast {
		position: fixed;
		bottom: calc(6.75rem + env(safe-area-inset-bottom, 0px));
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
	}

	.label {
		font-size: 0.8125rem;
	}

	.close-btn {
		display: flex;
		align-items: center;
		flex-shrink: 0;
		padding: 0.25rem;
		border: none;
		border-radius: var(--radius-sm);
		background: none;
		color: inherit;
		opacity: 0.6;
		cursor: pointer;
	}

	.close-btn:hover {
		opacity: 1;
		background: color-mix(in srgb, var(--color-bg) 14%, transparent);
	}
</style>
