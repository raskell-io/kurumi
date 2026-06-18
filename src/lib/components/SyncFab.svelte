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
	import { syncIndicator, sync } from '$lib/sync';

	let {
		visible = false,
		onConflict
	}: { visible?: boolean; onConflict?: () => void } = $props();

	let status = $derived($syncIndicator.status);
	let syncing = $derived(status === 'syncing');

	function handleClick() {
		if (status === 'conflict') {
			onConflict?.();
			return;
		}
		if (!syncing) {
			sync().catch((err) => console.error('Force sync failed:', err));
		}
	}

	function label(): string {
		switch (status) {
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
		if (status === 'conflict') return 'Resolve sync conflicts';
		if (status === 'error') return `${$syncIndicator.error || 'Sync failed'} — click to retry`;
		return 'Force sync now';
	}
</script>

{#if visible}
	<button
		type="button"
		onclick={handleClick}
		disabled={syncing}
		title={tooltip()}
		aria-label={tooltip()}
		class="sync-fab fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 shadow-lg transition-colors hover:bg-[var(--color-border)] disabled:cursor-default disabled:opacity-80"
	>
		{#if status === 'syncing'}
			<RefreshCw class="h-4 w-4 animate-spin text-[var(--color-accent)]" />
		{:else if status === 'success'}
			<CheckCircle class="h-4 w-4 text-green-500" />
		{:else if status === 'error'}
			<CloudOff class="h-4 w-4 text-red-500" />
		{:else if status === 'conflict'}
			<AlertCircle class="h-4 w-4 text-yellow-500" />
		{:else}
			<Cloud class="h-4 w-4 text-[var(--color-text-muted)]" />
		{/if}
		<span
			class="max-w-[12rem] truncate text-xs"
			class:text-red-500={status === 'error'}
			class:text-yellow-500={status === 'conflict'}
			class:text-[var(--color-text-muted)]={status !== 'error' && status !== 'conflict'}
		>
			{label()}
		</span>
	</button>
{/if}

<style>
	/* Keep clear of the mobile home indicator. */
	.sync-fab {
		margin-bottom: env(safe-area-inset-bottom, 0);
	}
</style>
