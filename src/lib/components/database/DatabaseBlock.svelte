<script lang="ts">
	// A ```database block's content: the database, or why it can't be shown.
	import { databaseViews } from '$lib/db';
	import DatabaseView from './DatabaseView.svelte';
	import { Database } from 'lucide-svelte';

	let { viewId, onEditSource }: { viewId: string; onEditSource?: () => void } = $props();
	let exists = $derived($databaseViews.some((v) => v.id === viewId));
</script>

{#if exists}
	<DatabaseView {viewId} embedded />
{:else}
	<div class="db-missing">
		<Database class="h-4 w-4 shrink-0" />
		<span>{viewId ? 'This database isn’t in this vault.' : 'No database chosen.'}</span>
		{#if onEditSource}<button type="button" class="k-btn k-btn-ghost" onclick={onEditSource}>Edit block</button>{/if}
	</div>
{/if}

<style>
	.db-missing {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin: 0.75rem 0;
		padding: 0.75rem 1rem;
		border: 1px dashed var(--color-border);
		border-radius: var(--radius-lg);
		font-family: var(--font-sans);
		font-size: 0.8125rem;
		color: var(--color-text-muted);
	}
</style>
