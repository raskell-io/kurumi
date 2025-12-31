<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { getNote, getFolder, getFolderPath, findBacklinks, extractTags, notes } from '$lib/db';
	import ReadNav from '$lib/components/ReadNav.svelte';
	import MarkdownRenderer from '$lib/components/MarkdownRenderer.svelte';
	import RefPopup from '$lib/components/RefPopup.svelte';
	import type { Note } from '$lib/db';
	import { Clock, Folder, Link2 } from 'lucide-svelte';

	// Ref popup state
	let showRefPopup = $state(false);
	let refPopupType = $state<'person' | 'date' | 'tag'>('person');
	let refPopupValue = $state('');
	let refPopupPosition = $state({ x: 0, y: 0 });

	function handleRefClick(type: 'person' | 'date' | 'tag', value: string, position: { x: number; y: number }) {
		refPopupType = type;
		refPopupValue = value;
		refPopupPosition = position;
		showRefPopup = true;
	}

	function handleRefPopupClose() {
		showRefPopup = false;
	}

	function handleRefNavigate(href: string) {
		goto(href);
	}

	// Get current note
	let note = $derived(getNote($page.params.id));

	// Get folder info
	let folder = $derived(note?.folderId ? getFolder(note.folderId) : null);
	let folderPath = $derived(note?.folderId ? getFolderPath(note.folderId) : []);

	// Get backlinks
	let backlinks = $derived(note ? findBacklinks(note.id) : []);

	// Get tags
	let tags = $derived(note ? extractTags(note.content) : []);

	// Build breadcrumbs
	let breadcrumbs = $derived.by(() => {
		const crumbs: { label: string; href: string }[] = [];
		for (const f of folderPath) {
			crumbs.push({ label: f.name, href: `/read/folder/${f.id}` });
		}
		return crumbs;
	});

	// Get previous and next notes
	let prevNext = $derived.by(() => {
		if (!note) return { prev: null, next: null };
		const sortedNotes = [...$notes].sort((a, b) => b.modified - a.modified);
		const currentIndex = sortedNotes.findIndex((n) => n.id === note.id);
		return {
			prev: currentIndex > 0 ? sortedNotes[currentIndex - 1] : null,
			next: currentIndex < sortedNotes.length - 1 ? sortedNotes[currentIndex + 1] : null
		};
	});

	// Format date
	function formatDate(timestamp: number): string {
		return new Date(timestamp).toLocaleDateString('en-US', {
			weekday: 'long',
			year: 'numeric',
			month: 'long',
			day: 'numeric'
		});
	}

	// Format relative time
	function formatRelative(timestamp: number): string {
		const now = Date.now();
		const diffMs = now - timestamp;
		const diffMins = Math.floor(diffMs / (1000 * 60));
		const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
		const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

		if (diffMins < 1) return 'Just now';
		if (diffMins < 60) return `${diffMins} minute${diffMins === 1 ? '' : 's'} ago`;
		if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
		if (diffDays < 7) return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
		return formatDate(timestamp);
	}
</script>

<svelte:head>
	<title>{note?.title || 'Note'} - Kurumi</title>
</svelte:head>

<ReadNav noteId={note?.id} {breadcrumbs} />

{#if note}
	<article class="note-reader">
		<!-- Header -->
		<header class="note-header">
			<h1 class="note-title">{note.title || 'Untitled'}</h1>

			<div class="note-meta">
				<span class="meta-item" title={formatDate(note.modified)}>
					<Clock class="meta-icon" />
					{formatRelative(note.modified)}
				</span>

				{#if folder}
					<a href="/read/folder/{folder.id}" class="meta-item meta-link">
						<Folder class="meta-icon" />
						{folder.name}
					</a>
				{/if}

				{#if tags.length > 0}
					<div class="meta-tags">
						{#each tags as tag}
							<a href="/read/tag/{tag}" class="meta-tag">#{tag}</a>
						{/each}
					</div>
				{/if}
			</div>
		</header>

		<!-- Content -->
		<div class="note-content">
			<MarkdownRenderer content={note.content} onRefClick={handleRefClick} />
		</div>

		<!-- Backlinks -->
		{#if backlinks.length > 0}
			<aside class="backlinks">
				<h2 class="backlinks-title">
					<Link2 class="backlinks-icon" />
					{backlinks.length} Backlink{backlinks.length === 1 ? '' : 's'}
				</h2>
				<ul class="backlinks-list">
					{#each backlinks as backlink (backlink.id)}
						<li>
							<a href="/read/{backlink.id}" class="backlink-item">
								<span class="backlink-title">{backlink.title || 'Untitled'}</span>
								<span class="backlink-preview">
									{backlink.content.slice(0, 100)}...
								</span>
							</a>
						</li>
					{/each}
				</ul>
			</aside>
		{/if}

		<!-- Navigation -->
		<nav class="note-nav">
			{#if prevNext.prev}
				<a href="/read/{prevNext.prev.id}" class="nav-link prev">
					<span class="nav-label">Previous</span>
					<span class="nav-title">{prevNext.prev.title || 'Untitled'}</span>
				</a>
			{:else}
				<div></div>
			{/if}

			{#if prevNext.next}
				<a href="/read/{prevNext.next.id}" class="nav-link next">
					<span class="nav-label">Next</span>
					<span class="nav-title">{prevNext.next.title || 'Untitled'}</span>
				</a>
			{/if}
		</nav>
	</article>
{:else}
	<div class="not-found">
		<h1>Note not found</h1>
		<p>This note doesn't exist or has been deleted.</p>
		<a href="/read" class="back-link">Back to all notes</a>
	</div>
{/if}

{#if showRefPopup}
	<RefPopup
		type={refPopupType}
		value={refPopupValue}
		position={refPopupPosition}
		onClose={handleRefPopupClose}
		onNavigate={handleRefNavigate}
	/>
{/if}

<style>
	.note-reader {
		max-width: 720px;
		margin: 0 auto;
		padding: 2rem 1.5rem 4rem;
	}

	/* Header */
	.note-header {
		margin-bottom: 2rem;
		padding-bottom: 1.5rem;
		border-bottom: 1px solid var(--color-border);
	}

	.note-title {
		font-size: 2.25rem;
		font-weight: 700;
		color: var(--color-text);
		line-height: 1.3;
		margin-bottom: 1rem;
	}

	.note-meta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 1rem;
		font-size: 0.875rem;
		color: var(--color-text-muted);
	}

	.meta-item {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
	}

	.meta-link {
		color: var(--color-text-muted);
		text-decoration: none;
		padding: 0.25rem 0.5rem;
		background: var(--color-bg-secondary);
		border-radius: 0.25rem;
		transition: all 0.15s;
	}

	.meta-link:hover {
		color: var(--color-accent);
		background: color-mix(in srgb, var(--color-accent) 15%, transparent);
	}

	.meta-icon {
		width: 1rem;
		height: 1rem;
		flex-shrink: 0;
	}

	.meta-tags {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
	}

	.meta-tag {
		color: #f59e0b;
		text-decoration: none;
		padding: 0.25rem 0.5rem;
		background: rgba(245, 158, 11, 0.15);
		border-radius: 0.25rem;
		transition: all 0.15s;
	}

	.meta-tag:hover {
		background: rgba(245, 158, 11, 0.25);
	}

	/* Content */
	.note-content {
		margin-bottom: 3rem;
	}

	/* Backlinks */
	.backlinks {
		padding: 1.5rem;
		background: var(--color-bg-secondary);
		border-radius: 0.75rem;
		margin-bottom: 2rem;
	}

	.backlinks-title {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 1rem;
		font-weight: 600;
		color: var(--color-text);
		margin-bottom: 1rem;
	}

	.backlinks-icon {
		width: 1.25rem;
		height: 1.25rem;
		color: var(--color-accent);
	}

	.backlinks-list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.backlink-item {
		display: block;
		padding: 0.75rem 1rem;
		background: var(--color-bg);
		border-radius: 0.5rem;
		text-decoration: none;
		transition: all 0.15s;
	}

	.backlink-item:hover {
		background: var(--color-border);
	}

	.backlink-title {
		display: block;
		font-weight: 500;
		color: var(--color-text);
		margin-bottom: 0.25rem;
	}

	.backlink-preview {
		display: block;
		font-size: 0.875rem;
		color: var(--color-text-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* Navigation */
	.note-nav {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		padding-top: 2rem;
		border-top: 1px solid var(--color-border);
	}

	.nav-link {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		padding: 1rem;
		background: var(--color-bg-secondary);
		border-radius: 0.5rem;
		text-decoration: none;
		transition: all 0.15s;
		max-width: 45%;
	}

	.nav-link:hover {
		background: var(--color-border);
	}

	.nav-link.next {
		text-align: right;
		margin-left: auto;
	}

	.nav-label {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.nav-title {
		font-weight: 500;
		color: var(--color-text);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* Not Found */
	.not-found {
		text-align: center;
		padding: 4rem 2rem;
	}

	.not-found h1 {
		font-size: 1.5rem;
		font-weight: 600;
		color: var(--color-text);
		margin-bottom: 0.5rem;
	}

	.not-found p {
		color: var(--color-text-muted);
		margin-bottom: 1.5rem;
	}

	.back-link {
		display: inline-block;
		padding: 0.75rem 1.5rem;
		background: var(--color-accent);
		color: white;
		text-decoration: none;
		border-radius: 0.5rem;
		font-weight: 500;
	}

	.back-link:hover {
		background: var(--color-accent-hover);
	}

	@media (max-width: 640px) {
		.note-reader {
			padding: 1rem;
		}

		.note-title {
			font-size: 1.75rem;
		}

		.note-nav {
			flex-direction: column;
		}

		.nav-link {
			max-width: 100%;
		}

		.nav-link.next {
			text-align: left;
		}
	}
</style>
