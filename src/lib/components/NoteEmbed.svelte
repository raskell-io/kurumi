<script lang="ts">
	import { memoryObjects } from '$lib/db';
	import { parseWikilink, markdownSection, markdownBlock, stripBlockIds, editablePart, replacePart } from '$lib/wikilinks';
	import { updateMemoryObject } from '$lib/db';
	import { Pencil, Check } from 'lucide-svelte';
	import { setPendingAnchor } from '$lib/stores/anchor';
	import { goto } from '$app/navigation';
	import MarkdownRenderer from './MarkdownRenderer.svelte';
	import NoteIcon from './NoteIcon.svelte';
	import { ArrowUpRight } from 'lucide-svelte';

	// Live, read-only render of another note for `![[Title]]` in the editor,
	// or of one part of it: `![[Title#Heading]]` (the section) or
	// `![[Title#^id]]` (the block). Reads the store, so edits to the embedded
	// note show up immediately.
	let { title: inner }: { title: string } = $props();

	let link = $derived(parseWikilink(inner));
	let title = $derived(link.target);
	let target = $derived($memoryObjects.find((m) => (m.title || '').toLowerCase() === title.toLowerCase()));
	// Drop the embedded note's own frontmatter.
	let whole = $derived((target?.bodyMarkdown ?? '').replace(/^---\n[\s\S]*?\n---\n/, ''));
	let part = $derived(
		link.heading ? markdownSection(whole, link.heading) : link.block ? markdownBlock(whole, link.block) : stripBlockIds(whole)
	);
	let body = $derived(part ?? '');

	// Synced: edit the embedded part here; it's saved into the note it comes from.
	let editing = $state(false);
	let draft = $state('');
	function startEdit() {
		if (!target) return;
		const raw = editablePart(target.bodyMarkdown, { heading: link.heading, block: link.block });
		if (raw === null) return;
		draft = raw;
		editing = true;
	}
	function save() {
		if (!target) return;
		const next = replacePart(target.bodyMarkdown, { heading: link.heading, block: link.block }, draft);
		if (next !== target.bodyMarkdown) updateMemoryObject(target.id, { bodyMarkdown: next });
		editing = false;
	}
	const grow = (el: HTMLTextAreaElement) => {
		const fit = () => {
			el.style.height = 'auto';
			el.style.height = `${el.scrollHeight + 2}px`;
		};
		requestAnimationFrame(() => {
			fit();
			el.focus();
		});
		el.addEventListener('input', fit);
		return { destroy: () => el.removeEventListener('input', fit) };
	};

	function open() {
		if (!target) return;
		setPendingAnchor(target.id, { heading: link.heading, block: link.block });
		goto(`/memory/${target.id}`);
	}
</script>

<div class="note-embed" contenteditable="false">
	{#if target}
		<div class="note-embed-bar">
		<button class="note-embed-title" onclick={open} title="Open note">
			<NoteIcon icon={target.icon} class="h-4 w-4" />
			<span class="truncate">{target.title || 'Untitled'}{link.heading ? ` › ${link.heading}` : ''}</span>
			<ArrowUpRight class="h-3.5 w-3.5 opacity-60" />
		</button>
		{#if part !== null}
			{#if editing}
				<button class="note-embed-edit" onclick={save} title="Save to {target.title || 'Untitled'}"><Check class="h-3.5 w-3.5" />Done</button>
			{:else}
				<button class="note-embed-edit" onclick={startEdit} title="Edit here: changes go to {target.title || 'Untitled'} and everywhere it's embedded"><Pencil class="h-3.5 w-3.5" />Edit</button>
			{/if}
		{/if}
		</div>
		{#if editing}
			<textarea
				class="note-embed-editor"
				bind:value={draft}
				onblur={save}
				onkeydown={(e) => {
					if (e.key === 'Escape') {
						e.preventDefault();
						editing = false;
					} else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
						e.preventDefault();
						save();
					}
				}}
				aria-label="Edit {target.title || 'Untitled'} here"
				use:grow
			></textarea>
			<p class="note-embed-hint">Synced: saving changes “{target.title || 'Untitled'}” and every note embedding it. Esc cancels.</p>
		{:else if part === null}
			<p class="note-embed-empty">{link.heading ? `No heading “${link.heading}” in this note.` : 'That block isn’t in this note any more.'}</p>
		{:else if body.trim()}
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

	.note-embed-bar {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.note-embed-edit {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		margin-left: auto;
		padding: 0.125rem 0.375rem;
		border-radius: var(--radius-sm, 5px);
		font-size: 0.75rem;
		color: var(--color-text-faint);
	}

	.note-embed-edit:hover {
		background: var(--color-hover);
		color: var(--color-text);
	}

	.note-embed-editor {
		width: 100%;
		min-height: 4rem;
		padding: 0.5rem;
		border: 1px solid var(--color-accent);
		border-radius: var(--radius-md, 8px);
		background: var(--color-bg);
		font-family: var(--font-mono);
		font-size: 0.8125rem;
		line-height: 1.5;
		color: var(--color-text);
		resize: vertical;
		outline: none;
	}

	.note-embed-hint {
		margin-top: 0.25rem;
		font-size: 0.75rem;
		color: var(--color-text-faint);
	}
</style>
