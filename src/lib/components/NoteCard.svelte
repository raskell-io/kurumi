<script lang="ts">
	import { goto } from '$app/navigation';
	import { getFolder, extractTags } from '$lib/db';
	import type { MemoryObject } from '$lib/db';
	import { Folder } from 'lucide-svelte';

	interface Props {
		memory: MemoryObject;
		showFolder?: boolean;
	}

	let { memory, showFolder = true }: Props = $props();

	// Get folder name if memory is in a folder
	let folderName = $derived.by(() => {
		if (!memory.folderId) return null;
		const folder = getFolder(memory.folderId);
		return folder?.name || null;
	});

	// Extract tags from content
	let tags = $derived(extractTags(memory.bodyMarkdown));

	// Get preview text (strip markdown syntax)
	function getPreview(content: string, maxLength: number = 200): string {
		// Remove markdown syntax
		let text = content
			.replace(/^---[\s\S]*?---\n?/, '') // frontmatter
			.replace(/\\([\\`*_{}[\]()#+\-.!:<>])/g, '$1') // markdown escapes
			.replace(/#{1,6}\s/g, '') // headers
			.replace(/\*\*([^*]+)\*\*/g, '$1') // bold
			.replace(/\*([^*]+)\*/g, '$1') // italic
			.replace(/`([^`]+)`/g, '$1') // inline code
			.replace(/```[\s\S]*?```/g, '') // code blocks
			.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // links
			.replace(/\[\[([^\]|]+)(\|[^\]]+)?\]\]/g, '$1') // wikilinks
			.replace(/<((?:https?|mailto):[^>\s]+)>/g, '$1') // autolinks
			.replace(/!\[([^\]]*)\]\([^)]+\)/g, '') // images
			.replace(/^>\s/gm, '') // blockquotes
			.replace(/^[-*+]\s/gm, '') // list items
			.replace(/^\d+\.\s/gm, '') // numbered lists
			.replace(/@([A-Z][a-zA-Z]+(?: [A-Z][a-zA-Z]+)*)/g, '$1') // people
			.replace(/\/\/(\d{4}-\d{2}-\d{2})/g, '$1') // dates
			.replace(/#[a-zA-Z][a-zA-Z0-9_-]*/g, '') // tags
			.replace(/\n+/g, ' ') // newlines to spaces
			.replace(/\s+/g, ' ') // multiple spaces
			.trim();

		if (text.length <= maxLength) return text;
		return text.slice(0, maxLength).trim() + '...';
	}

	let preview = $derived(getPreview(memory.bodyMarkdown) || memory.summaryShort || '');

	// Format date
	function formatDate(timestamp: number): string {
		const date = new Date(timestamp);
		const now = new Date();
		const diffMs = now.getTime() - date.getTime();
		const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

		if (diffDays === 0) return 'Today';
		if (diffDays === 1) return 'Yesterday';
		if (diffDays < 7) return `${diffDays} days ago`;

		return date.toLocaleDateString('en-US', {
			month: 'short',
			day: 'numeric',
			year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
		});
	}
</script>

<a href="/read/{memory.id}" class="note-entry">
	<h3 class="note-title">{memory.title || 'Untitled'}</h3>

	{#if preview}
		<p class="note-preview">{preview}</p>
	{/if}

	<div class="note-meta">
		<span>{formatDate(memory.updatedAt)}</span>

		{#if showFolder && folderName}
			<span class="meta-sep" aria-hidden="true">·</span>
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<span
				class="meta-link"
				onclick={(e) => {
					e.preventDefault();
					e.stopPropagation();
					goto(`/read/folder/${memory.folderId}`);
				}}
			>
				<Folder class="h-3 w-3" />
				{folderName}
			</span>
		{/if}

		{#if tags.length > 0}
			<span class="meta-sep" aria-hidden="true">·</span>
			{#each tags.slice(0, 3) as tag (tag)}
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<span
					class="meta-link meta-tag"
					onclick={(e) => {
						e.preventDefault();
						e.stopPropagation();
						goto(`/read/tag/${tag}`);
					}}>#{tag}</span
				>
			{/each}
			{#if tags.length > 3}
				<span>+{tags.length - 3}</span>
			{/if}
		{/if}
	</div>
</a>

<style>
	/* One entry in a read-mode list: title, excerpt, quiet meta line */
	.note-entry {
		display: block;
		padding: 0.75rem;
		border-radius: var(--radius-md);
		color: var(--color-text);
		text-decoration: none;
	}

	.note-entry:hover {
		background: var(--color-hover);
	}

	.note-title {
		margin: 0;
		font-family: var(--font-editor);
		font-size: 1.0625rem;
		font-weight: 700;
		line-height: 1.35;
		letter-spacing: -0.01em;
		color: var(--color-text);
	}

	.note-preview {
		display: -webkit-box;
		margin: 0.25rem 0 0;
		overflow: hidden;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		font-size: 0.875rem;
		line-height: 1.55;
		color: var(--color-text-muted);
	}

	.note-meta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.125rem 0.375rem;
		margin-top: 0.375rem;
		font-size: 0.75rem;
		color: var(--color-text-faint);
	}

	.meta-link {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		cursor: pointer;
	}

	.meta-link:hover {
		color: var(--color-text);
	}

	.meta-tag:hover {
		color: var(--color-ref-tag);
	}
</style>
