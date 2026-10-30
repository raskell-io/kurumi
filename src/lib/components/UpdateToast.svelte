<script lang="ts">
	import { onMount } from 'svelte';
	import { RefreshCw, X } from 'lucide-svelte';

	// Registers the service worker (production builds only: in dev it
	// would cache modules the dev server is still changing) so Kurumi
	// starts and runs offline. A new version waits until the user
	// reloads, so a deploy never reloads the page mid-edit.
	let needRefresh = $state(false);
	let offlineReady = $state(false);
	let update: ((reload?: boolean) => Promise<void>) | null = null;

	onMount(() => {
		if (import.meta.env.DEV || !('serviceWorker' in navigator)) return;
		let timer: ReturnType<typeof setTimeout>;
		import('virtual:pwa-register').then(({ registerSW }) => {
			update = registerSW({
				immediate: true,
				onNeedRefresh: () => (needRefresh = true),
				onOfflineReady: () => {
					offlineReady = true;
					timer = setTimeout(() => (offlineReady = false), 5000);
				},
				// Look for a new version every hour while the app stays open.
				onRegisteredSW: (_url, registration) => {
					if (registration) setInterval(() => registration.update().catch(() => {}), 60 * 60 * 1000);
				}
			});
		});
		return () => clearTimeout(timer);
	});
</script>

{#if needRefresh || offlineReady}
	<div class="update-toast" role="status" aria-live="polite">
		<span class="label">{needRefresh ? 'A new version of Kurumi is ready' : 'Kurumi now works offline'}</span>
		{#if needRefresh}
			<button class="reload-btn" onclick={() => update?.(true)}>
				<RefreshCw class="h-3.5 w-3.5" />
				Reload
			</button>
		{/if}
		<button class="close-btn" onclick={() => (needRefresh = offlineReady = false)} aria-label="Dismiss">
			<X class="h-3.5 w-3.5" />
		</button>
	</div>
{/if}

<style>
	/* Same inverted toast as UndoToast, one step higher so both fit */
	.update-toast {
		position: fixed;
		bottom: calc(4rem + env(safe-area-inset-bottom, 0px));
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
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.reload-btn {
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

	.reload-btn:hover {
		background: color-mix(in srgb, var(--color-bg) 24%, transparent);
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
