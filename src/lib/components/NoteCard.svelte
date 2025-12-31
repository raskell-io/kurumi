<script lang="ts">
	import { getFolder, extractTags } from '$lib/db';
	import type { Note } from '$lib/db';

	interface Props {
		note: Note;
		showFolder?: boolean;
	}

	let { note, showFolder = true }: Props = $props();

	// Get folder name if note is in a folder
	let folderName = $derived.by(() => {
		if (!note.folderId) return null;
		const folder = getFolder(note.folderId);
		return folder?.name || null;
	});

	// Extract tags from content
	let tags = $derived(extractTags(note.content));

	// Get preview text (strip markdown syntax)
	function getPreview(content: string, maxLength: number = 200): string {
		// Remove markdown syntax
		let text = content
			.replace(/#{1,6}\s/g, '') // headers
			.replace(/\*\*([^*]+)\*\*/g, '$1') // bold
			.replace(/\*([^*]+)\*/g, '$1') // italic
			.replace(/`([^`]+)`/g, '$1') // inline code
			.replace(/```[\s\S]*?```/g, '') // code blocks
			.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // links
			.replace(/\[\[([^\]]+)\]\]/g, '$1') // wikilinks
			.replace(/!\[([^\]]*)\]\([^)]+\)/g, '') // images
			.replace(/^>\s/gm, '') // blockquotes
			.replace(/^[-*+]\s/gm, '') // list items
			.replace(/^\d+\.\s/gm, '') // numbered lists
			.replace(/@([A-Z][a-zA-Z]+(?: [A-Z][a-zA-Z]+)*)/g, '$1') // people
			.replace(/\/\/\d{4}-\d{2}-\d{2}/g, '') // dates
			.replace(/#[a-zA-Z][a-zA-Z0-9_-]*/g, '') // tags
			.replace(/\n+/g, ' ') // newlines to spaces
			.replace(/\s+/g, ' ') // multiple spaces
			.trim();

		if (text.length <= maxLength) return text;
		return text.slice(0, maxLength).trim() + '...';
	}

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

<a href="/read/{note.id}" class="note-card">
	<div class="card-content">
		<h3 class="note-title">{note.title || 'Untitled'}</h3>

		<p class="note-preview">{getPreview(note.content)}</p>

		<div class="note-meta">
			<span class="note-date">{formatDate(note.modified)}</span>

			{#if showFolder && folderName}
				<a href="/read/folder/{note.folderId}" class="note-folder" onclick={(e) => e.stopPropagation()}>
					<svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
						<path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
					</svg>
					{folderName}
				</a>
			{/if}

			{#if tags.length > 0}
				<div class="note-tags">
					{#each tags.slice(0, 3) as tag}
						<a href="/read/tag/{tag}" class="tag" onclick={(e) => e.stopPropagation()}>#{tag}</a>
					{/each}
					{#if tags.length > 3}
						<span class="more-tags">+{tags.length - 3}</span>
					{/if}
				</div>
			{/if}
		</div>
	</div>
</a>

<style>
	.note-card {
		display: block;
		padding: 1.25rem;
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 0.75rem;
		text-decoration: none;
		transition: all 0.2s ease;
	}

	.note-card:hover {
		border-color: var(--color-accent);
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
		transform: translateY(-2px);
	}

	.card-content {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.note-title {
		font-size: 1.125rem;
		font-weight: 600;
		color: var(--color-text);
		margin: 0;
		line-height: 1.4;
	}

	.note-preview {
		font-size: 0.875rem;
		color: var(--color-text-muted);
		line-height: 1.6;
		margin: 0;
	}

	.note-meta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.75rem;
		margin-top: 0.5rem;
		font-size: 0.75rem;
	}

	.note-date {
		color: var(--color-text-muted);
	}

	.note-folder {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		color: var(--color-text-muted);
		text-decoration: none;
		padding: 0.125rem 0.375rem;
		border-radius: 0.25rem;
		background: var(--color-bg-secondary);
		transition: all 0.15s;
	}

	.note-folder:hover {
		color: var(--color-accent);
		background: color-mix(in srgb, var(--color-accent) 15%, transparent);
	}

	.note-tags {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
	}

	.tag {
		color: #f59e0b;
		text-decoration: none;
		padding: 0.125rem 0.375rem;
		border-radius: 0.25rem;
		background: rgba(245, 158, 11, 0.15);
		transition: all 0.15s;
	}

	.tag:hover {
		background: rgba(245, 158, 11, 0.25);
	}

	.more-tags {
		color: var(--color-text-muted);
		font-size: 0.75rem;
	}
</style>
