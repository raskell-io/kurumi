<script lang="ts">
	import '../../app.css';
	import { pwaInfo } from 'virtual:pwa-info';
	import { onMount } from 'svelte';
	import { initDB } from '$lib/db';
	import { initSearch, rebuildIndex } from '$lib/search';
	import { notes } from '$lib/db';

	let { children } = $props();

	let initialized = $state(false);

	onMount(() => {
		// Load theme from localStorage
		const savedTheme = localStorage.getItem('kurumi-theme') as 'light' | 'dark' | 'system' | null;
		if (savedTheme && savedTheme !== 'system') {
			document.documentElement.classList.add(savedTheme);
		}

		// Initialize async stuff
		initDB().then(() => {
			initSearch();
			initialized = true;
		});
	});

	// Rebuild search index when notes change
	$effect(() => {
		const noteCount = $notes.length;
		if (initialized && noteCount >= 0) {
			rebuildIndex();
		}
	});
</script>

<svelte:head>
	<title>Kurumi - Read</title>
	<meta name="description" content="Kurumi - Your personal knowledge base" />
	<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
	<link rel="icon" href="/favicon.ico" type="image/x-icon" />
	{#if pwaInfo}
		<link rel="manifest" href={pwaInfo.webManifest.href} />
	{/if}
</svelte:head>

{#if !initialized}
	<div class="loading">
		<div class="spinner"></div>
		<p>Loading...</p>
	</div>
{:else}
	<div class="read-layout">
		{@render children()}
	</div>
{/if}

<style>
	.loading {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		min-height: 100dvh;
		background: var(--color-bg);
		gap: 1rem;
	}

	.spinner {
		width: 2.5rem;
		height: 2.5rem;
		border: 3px solid var(--color-border);
		border-top-color: var(--color-accent);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.loading p {
		color: var(--color-text-muted);
		font-size: 0.875rem;
	}

	.read-layout {
		min-height: 100dvh;
		background: var(--color-bg);
	}
</style>
