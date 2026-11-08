<script lang="ts">
	/**
	 * Shown on a living note ($lib/living-notes): what it follows, when it was
	 * last rewritten and from how many notes; edit the topic, update now, stop.
	 */
	import { setLivingNote, type MemoryObject } from '$lib/db';
	import { rewriteLivingNote, canRewrite, sourcesOf } from '$lib/living-notes';
	import { Sprout, RefreshCw, X } from 'lucide-svelte';

	let { memory, onrewritten }: { memory: MemoryObject; onrewritten?: () => void } = $props();

	let editing = $state(false);
	let query = $state('');
	let busy = $state(false);
	let message = $state<string | null>(null);

	let living = $derived(memory.living!);
	let sourceCount = $derived(sourcesOf(memory).length);
	let ago = $derived.by(() => {
		if (!living.updatedAt) return 'not written yet';
		const minutes = Math.round((Date.now() - living.updatedAt) / 60000);
		if (minutes < 1) return 'updated just now';
		if (minutes < 60) return `updated ${minutes} min ago`;
		const hours = Math.round(minutes / 60);
		if (hours < 48) return `updated ${hours} h ago`;
		return `updated ${new Date(living.updatedAt).toLocaleDateString()}`;
	});

	function startEdit() {
		query = living.query;
		editing = true;
	}

	function saveQuery() {
		const next = query.trim();
		if (next && next !== living.query) setLivingNote(memory.id, { query: next });
		editing = false;
	}

	async function update() {
		if (busy) return;
		busy = true;
		message = null;
		const result = await rewriteLivingNote(memory.id);
		busy = false;
		if (!result.ok) message = result.error;
		else {
			message = result.changed ? `Rewritten from ${result.sources} note${result.sources === 1 ? '' : 's'}. Version history has the previous text.` : 'Nothing to change.';
			if (result.changed) onrewritten?.();
		}
	}
</script>

<div class="living-bar" role="region" aria-label="Living note">
	<Sprout class="h-4 w-4 shrink-0 text-[var(--color-accent)]" />
	<div class="min-w-0 flex-1">
		{#if editing}
			<form class="flex gap-1.5" onsubmit={(e) => { e.preventDefault(); saveQuery(); }}>
				<input class="k-input !h-7 text-xs" bind:value={query} aria-label="Topic to follow" placeholder="tag:falcon, person:&quot;Ana Ruiz&quot;, or words" />
				<button class="k-btn k-btn-primary k-btn-sm">Save</button>
				<button type="button" class="k-btn k-btn-ghost k-btn-sm" onclick={() => (editing = false)}>Cancel</button>
			</form>
		{:else}
			<p>
				Living note · follows
				<button type="button" class="query" onclick={startEdit} title="Change what it follows"><code>{living.query}</code></button>
				· {sourceCount} matching note{sourceCount === 1 ? '' : 's'} · {ago}
			</p>
		{/if}
		{#if message}<p class="message">{message}</p>{/if}
		{#if !canRewrite()}<p class="message">Needs an AI provider (Settings → AI assistant) to rewrite itself.</p>{/if}
	</div>
	{#if !editing}
		<button type="button" class="k-btn k-btn-ghost k-btn-sm" onclick={update} disabled={busy || !canRewrite()} data-testid="living-update">
			<RefreshCw class="h-3.5 w-3.5 {busy ? 'animate-spin' : ''}" /> {busy ? 'Updating…' : 'Update now'}
		</button>
		<button type="button" class="k-icon-btn" onclick={() => setLivingNote(memory.id, null)} title="Stop: keep it as an ordinary note" aria-label="Stop living note">
			<X class="h-3.5 w-3.5" />
		</button>
	{/if}
</div>

<style>
	.living-bar {
		display: flex;
		align-items: flex-start;
		gap: 0.5rem;
		margin: 0 0 1rem;
		padding: 0.5rem 0.5rem 0.5rem 0.75rem;
		border: 1px solid color-mix(in srgb, var(--color-accent) 30%, var(--color-border));
		border-radius: var(--radius-md);
		background: color-mix(in srgb, var(--color-accent) 6%, var(--color-bg));
		font-size: 0.8125rem;
		color: var(--color-text-muted);
	}

	.living-bar :global(svg:first-child) {
		margin-top: 0.15rem;
	}

	.query code {
		padding: 0 0.3em;
		border-radius: 4px;
		background: var(--color-bg-secondary);
		color: var(--color-text);
		font-size: 0.75rem;
	}

	.query:hover code {
		outline: 1px solid var(--color-accent);
	}

	.message {
		margin-top: 0.25rem;
		font-size: 0.75rem;
		color: var(--color-text-faint);
	}
</style>
