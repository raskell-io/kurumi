<script lang="ts">
	import { memoryObjects } from '$lib/db';
	import { goto } from '$app/navigation';
	import MarkdownRenderer from './MarkdownRenderer.svelte';
	import NoteIcon from './NoteIcon.svelte';
	import { ArrowUpRight } from 'lucide-svelte';

	// Live, read-only render of another note for `![[Title]]` in the editor.
	// Reads the store, so edits to the embedded note show up immediately.
	let { title }: { title: string } = $props();

	let target = $derived($memoryObjects.find((m) => (m.title || '').toLowerCase() === title.toLowerCase()));
	// Drop the embedded note's own frontmatter.
	let body = $derived((target?.bodyMarkdown ?? '').replace(/^---\n[\s\S]*?\n---\n/, ''));
</script>

<div class="note-embed" contenteditable="false">
	{#if target}
		<button class="note-embed-title" onclick={() => goto(`/memory/${target!.id}`)} title="Open note">
			<NoteIcon icon={target.icon} class="h-4 w-4" />
			<span class="truncate">{target.title || 'Untitled'}</span>
			<ArrowUpRight class="h-3.5 w-3.5 opacity-60" />
		</button>
		{#if body.trim()}
			<div class="note-embed-body">
				<MarkdownRenderer content={body} />
			</div>
		{:else}
			<p class="note-embed-empty">Empty note</p>
		{/if}
	{:else}
		<p class="note-embed-empty">No note called “{title}” yet.</p>
	{/if}
</div>

<style>
	.note-embed {
		margin: 0.25rem 0 0.75rem;
		padding: 0.625rem 0.875rem;
		border-left: 3px solid var(--color-accent-soft, var(--color-border));
		border-radius: 0 var(--radius-md, 8px) var(--radius-md, 8px) 0;
		background: var(--color-bg-secondary);
		max-height: 24rem;
		overflow-y: auto;
		user-select: text;
	}

	.note-embed-title {
		display: flex;
		max-width: 100%;
		align-items: center;
		gap: 0.375rem;
		margin-bottom: 0.25rem;
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--color-text-muted);
	}

	.note-embed-title:hover {
		color: var(--color-text);
	}

	.note-embed-body {
		font-size: 0.9375em;
	}

	.note-embed-empty {
		margin: 0;
		font-size: 0.8125rem;
		font-style: italic;
		color: var(--color-text-faint);
	}
</style>
