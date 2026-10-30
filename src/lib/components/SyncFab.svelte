<script lang="ts">
	/**
	 * Floating sync indicator + force-sync button, pinned to the bottom-right.
	 *
	 * Shows the current sync state for whichever backend is configured (the
	 * `syncIndicator` store unifies git and the object-storage backends) and
	 * lets the user force a sync on demand. On a conflict it defers to the
	 * caller to open the resolution modal.
	 */
	import { RefreshCw, CheckCircle, AlertCircle, Cloud, CloudOff } from 'lucide-svelte';
	import { syncIndicator, sync, syncNeedsNetwork } from '$lib/sync';
	import { online } from '$lib/pwa';

	let {
		visible = false,
		onConflict
	}: { visible?: boolean; onConflict?: () => void } = $props();

	// Offline (for methods that need the network) wins over the last result.
	let offline = $derived(!$online && syncNeedsNetwork());
	let status = $derived(offline ? 'offline' : $syncIndicator.status);
	let syncing = $derived(status === 'syncing');

	function handleClick() {
		if (status === 'conflict') {
			onConflict?.();
			return;
		}
		if (!syncing && !offline) {
			sync().catch((err) => console.error('Force sync failed:', err));
		}
	}

	function label(): string {
		switch (status) {
			case 'offline':
				return 'Offline · syncs when back online';
			case 'syncing':
				return 'Syncing…';
			case 'success':
				return 'Synced';
			case 'error':
				return $syncIndicator.error || 'Sync failed';
			case 'conflict':
				return `${$syncIndicator.conflictCount} conflict${
					$syncIndicator.conflictCount === 1 ? '' : 's'
				}`;
			default:
				return 'Sync now';
		}
	}

	function tooltip(): string {
		if (offline) return 'Offline. Changes are saved here and sync when you are back online';
		if (status === 'conflict') return 'Resolve sync conflicts';
		if (status === 'error') return `${$syncIndicator.error || 'Sync failed'} — click to retry`;
		return 'Force sync now';
	}
</script>

{#if visible}
	<!-- Idle/synced: a tiny status dot that grows into a labelled pill on
	     hover or focus. Syncing / error / conflict: the pill stays open. -->
	<button
		type="button"
		onclick={handleClick}
		disabled={syncing || offline}
		title={tooltip()}
		aria-label={tooltip()}
		class="sync-fab"
		class:expanded={syncing || offline || status === 'error' || status === 'conflict'}
		class:is-error={status === 'error'}
		class:is-conflict={status === 'conflict'}
	>
		{#if status === 'syncing'}
			<RefreshCw class="h-3.5 w-3.5 shrink-0 animate-spin text-[var(--color-accent)]" />
		{:else if status === 'error' || offline}
			<CloudOff class="h-3.5 w-3.5 shrink-0" />
		{:else if status === 'conflict'}
			<AlertCircle class="h-3.5 w-3.5 shrink-0" />
		{:else}
			<span class="dot" class:ok={status === 'success'} aria-hidden="true"></span>
			<span class="idle-icon" aria-hidden="true">
				{#if status === 'success'}
					<CheckCircle class="h-3.5 w-3.5" />
				{:else}
					<Cloud class="h-3.5 w-3.5" />
				{/if}
			</span>
		{/if}
		<span class="label">{label()}</span>
	</button>
{/if}

<style>
	.sync-fab {
		position: fixed;
		right: 0.75rem;
		bottom: calc(0.75rem + env(safe-area-inset-bottom, 0px));
		z-index: 40;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.375rem;
		min-width: 1.5rem;
		height: 1.5rem;
		padding: 0 0.375rem;
		border: 1px solid transparent;
		border-radius: 999px;
		font-size: 0.75rem;
		color: var(--color-text-muted);
		cursor: pointer;
		transition:
			background-color 120ms var(--ease-out),
			border-color 120ms var(--ease-out);
	}

	/* The agent pane's composer (and send button) owns the bottom-right
	   corner while it's open; lift the indicator clear of it. */
	:global(body:has(.agent-pane-wrapper)) .sync-fab {
		bottom: calc(7rem + env(safe-area-inset-bottom, 0px));
	}

	.sync-fab:disabled {
		cursor: default;
	}

	.sync-fab .label,
	.sync-fab .idle-icon {
		display: none;
		max-width: 12rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.dot {
		width: 0.4375rem;
		height: 0.4375rem;
		border-radius: 999px;
		background: var(--color-text-faint);
		opacity: 0.6;
	}

	.dot.ok {
		background: #40a02b;
	}

	/* Open pill: hover/focus on the idle dot, or any active state */
	.sync-fab:hover,
	.sync-fab:focus-visible,
	.sync-fab.expanded {
		height: 1.75rem;
		padding: 0 0.625rem;
		border-color: var(--color-border);
		background: var(--color-bg);
		box-shadow: var(--shadow-sm);
	}

	.sync-fab:hover .label,
	.sync-fab:focus-visible .label,
	.sync-fab.expanded .label {
		display: inline;
	}

	.sync-fab:hover .idle-icon,
	.sync-fab:focus-visible .idle-icon {
		display: inline-flex;
	}

	.sync-fab:hover .dot,
	.sync-fab:focus-visible .dot {
		display: none;
	}

	.sync-fab:hover {
		color: var(--color-text);
	}

	.sync-fab.is-error {
		color: var(--color-danger);
	}

	.sync-fab.is-conflict {
		color: #df8e1d;
	}
</style>
