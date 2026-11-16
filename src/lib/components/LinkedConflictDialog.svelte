<script lang="ts">
	import { fadeOut } from '$lib/motion';
	/**
	 * A linked note changed in its folder on the same lines as in Kurumi
	 * ($lib/linked/backend, `linkedSaveIssues`): show both, and write what
	 * the user picks. Nothing is written before that. Laid out like the git
	 * conflict dialog (GitConflictModal).
	 */
	import { portal } from '$lib/actions/portal';
	import { resolveLinkedIssue } from '$lib/linked/backend';
	import type { LinkedSaveIssue } from '$lib/linked/types';
	import { untrack } from 'svelte';

	interface Props {
		noteId: string;
		title: string;
		issue: LinkedSaveIssue;
		onclose: () => void;
	}
	let { noteId, title, issue, onclose }: Props = $props();

	// Combining starts from Kurumi's text; the file's stays visible beside it.
	let combining = $state(false);
	let combined = $state(untrack(() => issue.mine.body));

	function settle(choice: 'mine' | 'theirs' | { body: string }) {
		resolveLinkedIssue(noteId, choice);
		onclose();
	}
</script>

<div
	use:portal
	class="k-dialog-backdrop" out:fadeOut|global
	onclick={onclose}
	onkeydown={(e) => e.key === 'Escape' && onclose()}
	role="dialog"
	aria-modal="true"
	aria-labelledby="linked-conflict-title"
	tabindex="-1"
	data-testid="linked-conflict-dialog"
>
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div class="k-dialog conflict p-5" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()} role="document">
		<h2 id="linked-conflict-title" class="mb-1 text-base font-semibold text-[var(--color-text)]">“{title}” changed in two places</h2>
		<p class="mb-4 text-sm text-[var(--color-text-muted)]">
			The file was changed outside Kurumi on the same lines you edited here. Nothing has been written. Choose what the file should contain.
		</p>
		<div class="grid gap-3 md:grid-cols-2">
			<div class="min-w-0">
				<div class="k-label">{combining ? 'Combined (edit here)' : 'Yours, in Kurumi'}</div>
				{#if combining}
					<textarea class="pane k-input" bind:value={combined} spellcheck="false" aria-label="Combined text"></textarea>
				{:else}
					<pre class="pane" data-testid="conflict-mine">{issue.mine.body}</pre>
				{/if}
			</div>
			<div class="min-w-0">
				<div class="k-label">The file now</div>
				<pre class="pane" data-testid="conflict-theirs">{issue.theirs ?? ''}</pre>
			</div>
		</div>
		<div class="mt-5 flex flex-wrap justify-end gap-2">
			<button class="k-btn k-btn-ghost" onclick={onclose}>Decide later</button>
			{#if combining}
				<button class="k-btn k-btn-primary" onclick={() => settle({ body: combined })}>Save combined</button>
			{:else}
				<button class="k-btn k-btn-ghost" onclick={() => (combining = true)}>Combine…</button>
				<button class="k-btn k-btn-ghost" onclick={() => settle('theirs')}>Take the file's version</button>
				<button class="k-btn k-btn-primary" onclick={() => settle('mine')}>Keep mine</button>
			{/if}
		</div>
	</div>
</div>

<style>
	.conflict {
		width: min(64rem, calc(100vw - 2rem));
		max-width: none;
	}
	.pane {
		height: min(50vh, 28rem);
		margin: 0;
		overflow: auto;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-bg-secondary);
		padding: 0.625rem 0.75rem;
		font-family: var(--font-mono, ui-monospace, monospace);
		font-size: 0.75rem;
		line-height: 1.5;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		color: var(--color-text);
	}
	textarea.pane {
		width: 100%;
		resize: none;
	}
</style>
