<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import {
		getMemoryObject,
		getFolder,
		getFolderPath,
		findBacklinks,
		extractTags,
		extractWikilinks,
		findMemoryObjectByTitle,
		memoryObjects
	} from '$lib/db';
	import ReadNav from '$lib/components/ReadNav.svelte';
	import MarkdownRenderer from '$lib/components/MarkdownRenderer.svelte';
	import RefPopup from '$lib/components/RefPopup.svelte';
	import { findSemanticBacklinks } from '$lib/digest';
	import { Folder, Link2, ArrowUp, ArrowLeft, ArrowRight, Sparkles, FileQuestion, CornerDownRight } from 'lucide-svelte';
	import type { MemoryObject } from '$lib/db/types';

	// Scroll state for "back to top" button. Read mode scrolls inside
	// the layout's content pane, not the window, so find that element.
	let showBackToTop = $state(false);
	let readerEl: HTMLElement | undefined = $state();
	let scroller: HTMLElement | null = null;

	function findScrollParent(el: HTMLElement): HTMLElement | null {
		let node = el.parentElement;
		while (node) {
			const overflowY = getComputedStyle(node).overflowY;
			if (overflowY === 'auto' || overflowY === 'scroll') return node;
			node = node.parentElement;
		}
		return null;
	}

	function scrollTop(): number {
		return scroller ? scroller.scrollTop : window.scrollY;
	}

	function handleScroll() {
		showBackToTop = scrollTop() > 300;
	}

	$effect(() => {
		if (!readerEl) return;
		scroller = findScrollParent(readerEl);
		const target: HTMLElement | Window = scroller ?? window;
		target.addEventListener('scroll', handleScroll, { passive: true });
		return () => target.removeEventListener('scroll', handleScroll);
	});

	function scrollToTop() {
		(scroller ?? window).scrollTo({ top: 0, behavior: 'smooth' });
	}

	// Client-side navigation (prev/next, backlinks) reuses the same scroll
	// pane, so start each note at the top.
	$effect(() => {
		void $page.params.id;
		(scroller ?? window).scrollTo({ top: 0 });
		showBackToTop = false;
	});

	function formatDate(timestamp: number): string {
		const date = new Date(timestamp);
		return date.toLocaleDateString('en-US', {
			month: 'long',
			day: 'numeric',
			year: 'numeric'
		});
	}

	function excerpt(text: string): string {
		return text.replace(/^---[\s\S]*?---\n?/, '').replace(/\s+/g, ' ').trim().slice(0, 140);
	}

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

	// Get current memory
	let memory = $derived(getMemoryObject($page.params.id ?? ''));

	// Get folder info
	let folder = $derived(memory?.folderId ? getFolder(memory.folderId) : null);
	let folderPath = $derived(memory?.folderId ? getFolderPath(memory.folderId) : []);

	// Get backlinks
	let backlinks = $derived(memory ? findBacklinks(memory.id) : []);

	// Semantic backlinks — loaded lazily when the page mounts for a
	// memory that has embeddings.
	let semanticLinks = $state<Array<{ memory: MemoryObject; score: number }>>([]);
	$effect(() => {
		const id = memory?.id;
		if (!id) {
			semanticLinks = [];
			return;
		}
		findSemanticBacklinks(id, 5).then((results) => {
			semanticLinks = results;
		});
	});

	// Get tags
	let tags = $derived(memory ? extractTags(memory.bodyMarkdown) : []);

	// Outgoing links (wikilinks to other memories)
	let outgoingLinks = $derived.by(() => {
		if (!memory) return [];
		const titles = extractWikilinks(memory.bodyMarkdown);
		return titles
			.map((title) => {
				const target = findMemoryObjectByTitle(title);
				return target ? { title, id: target.id } : null;
			})
			.filter((l): l is { title: string; id: string } => l !== null);
	});

	// Build breadcrumbs
	let breadcrumbs = $derived.by(() => {
		const crumbs: { label: string; href: string }[] = [];
		for (const f of folderPath) {
			crumbs.push({ label: f.name, href: `/read/folder/${f.id}` });
		}
		return crumbs;
	});

	// Get previous and next memories
	let prevNext = $derived.by(() => {
		if (!memory) return { prev: null, next: null };
		const sorted = [...$memoryObjects].sort((a, b) => b.updatedAt - a.updatedAt);
		const currentIndex = sorted.findIndex((m) => m.id === memory.id);
		return {
			prev: currentIndex > 0 ? sorted[currentIndex - 1] : null,
			next: currentIndex < sorted.length - 1 ? sorted[currentIndex + 1] : null
		};
	});

</script>

<svelte:head>
	<title>{memory?.title || 'Note'} - Kurumi</title>
</svelte:head>

<ReadNav
	noteId={memory?.id}
	{breadcrumbs}
	title={memory ? memory.title || 'Untitled' : undefined}
	showSearch={false}
/>

{#if memory}
	<article class="reader" bind:this={readerEl}>
		<header class="reader-header">
			<h1 class="reader-title">{memory.title || 'Untitled'}</h1>

			<div class="reader-meta">
				<time datetime={new Date(memory.updatedAt).toISOString()}>{formatDate(memory.updatedAt)}</time>
				{#if folder}
					<span class="meta-sep" aria-hidden="true">·</span>
					<a href="/read/folder/{folder.id}" class="meta-link">
						<Folder class="h-3.5 w-3.5" />
						{folder.name}
					</a>
				{/if}
				{#if tags.length > 0}
					<span class="meta-sep" aria-hidden="true">·</span>
					{#each tags as tag (tag)}
						<a href="/read/tag/{tag}" class="meta-tag">#{tag}</a>
					{/each}
				{/if}
			</div>
		</header>

		<!-- Content: the editor's typography, scaled up from the renderer's compact default -->
		<div class="reader-body">
			<MarkdownRenderer content={memory.bodyMarkdown} onRefClick={handleRefClick} />
		</div>

		{#if outgoingLinks.length > 0 || backlinks.length > 0 || semanticLinks.length > 0}
			<footer class="reader-links">
				{#if outgoingLinks.length > 0}
					<section>
						<h2 class="k-section-title">
							<CornerDownRight class="h-3.5 w-3.5" />
							Links to {outgoingLinks.length} note{outgoingLinks.length === 1 ? '' : 's'}
						</h2>
						<ul class="link-list">
							{#each outgoingLinks as link (link.id)}
								<li>
									<a href="/read/{link.id}" class="k-row link-row">
										<span class="link-title">{link.title}</span>
									</a>
								</li>
							{/each}
						</ul>
					</section>
				{/if}

				{#if backlinks.length > 0}
					<section>
						<h2 class="k-section-title">
							<Link2 class="h-3.5 w-3.5" />
							{backlinks.length} backlink{backlinks.length === 1 ? '' : 's'}
						</h2>
						<ul class="link-list">
							{#each backlinks as backlink (backlink.id)}
								<li>
									<a href="/read/{backlink.id}" class="k-row link-row">
										<span class="link-title">{backlink.title || 'Untitled'}</span>
										<span class="link-preview">{excerpt(backlink.bodyMarkdown)}</span>
									</a>
								</li>
							{/each}
						</ul>
					</section>
				{/if}

				<!-- Semantic backlinks (AI-inferred) -->
				{#if semanticLinks.length > 0}
					<section>
						<h2 class="k-section-title">
							<Sparkles class="h-3.5 w-3.5" />
							Related memories
						</h2>
						<ul class="link-list">
							{#each semanticLinks as { memory: related } (related.id)}
								<li>
									<a href="/read/{related.id}" class="k-row link-row">
										<span class="link-title">{related.title || 'Untitled'}</span>
										<span class="link-preview">{excerpt(related.summaryShort || related.bodyMarkdown || '')}</span>
									</a>
								</li>
							{/each}
						</ul>
					</section>
				{/if}
			</footer>
		{/if}

		<!-- Previous / next -->
		<nav class="pager" aria-label="More notes">
			{#if prevNext.prev}
				<a href="/read/{prevNext.prev.id}" class="pager-link">
					<span class="pager-label"><ArrowLeft class="h-3 w-3" /> Previous</span>
					<span class="pager-title">{prevNext.prev.title || 'Untitled'}</span>
				</a>
			{:else}
				<span></span>
			{/if}

			{#if prevNext.next}
				<a href="/read/{prevNext.next.id}" class="pager-link next">
					<span class="pager-label">Next <ArrowRight class="h-3 w-3" /></span>
					<span class="pager-title">{prevNext.next.title || 'Untitled'}</span>
				</a>
			{/if}
		</nav>

		<div class="all-notes">
			<a href="/read" class="k-btn k-btn-ghost k-btn-sm">All notes</a>
		</div>
	</article>

	{#if showBackToTop}
		<button class="back-to-top" onclick={scrollToTop} aria-label="Back to top" title="Back to top">
			<ArrowUp class="h-4 w-4" />
		</button>
	{/if}
{:else}
	<div class="k-page">
		<div class="k-empty">
			<FileQuestion />
			<p class="k-empty-title">Note not found</p>
			<p>This note doesn't exist or has been deleted.</p>
			<a href="/read" class="k-btn mt-2">Back to all notes</a>
		</div>
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
	/* Same 46rem text column and rhythm as the editor on /memory/[id] */
	.reader {
		max-width: calc(46rem + 2.5rem);
		margin: 0 auto;
		padding: 1.5rem 1.25rem 5rem;
	}

	@media (min-width: 768px) {
		.reader {
			max-width: calc(46rem + 6rem);
			padding: 3rem 3rem 6rem;
		}
	}

	.reader-header {
		margin-bottom: 1.75rem;
	}

	.reader-title {
		font-family: var(--font-editor);
		font-size: 2rem;
		font-weight: 700;
		line-height: 1.2;
		letter-spacing: -0.015em;
		color: var(--color-text);
		overflow-wrap: anywhere;
	}

	@media (min-width: 768px) {
		.reader-title {
			font-size: 2.375rem;
		}
	}

	.reader-meta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.25rem 0.5rem;
		margin-top: 0.75rem;
		font-size: 0.75rem;
		color: var(--color-text-faint);
	}

	.meta-link {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		color: var(--color-text-muted);
		text-decoration: none;
	}

	.meta-link:hover {
		color: var(--color-text);
	}

	.meta-tag {
		padding: 0 0.375rem;
		border-radius: 4px;
		background: color-mix(in srgb, var(--color-ref-tag) 12%, transparent);
		color: var(--color-ref-tag);
		font-weight: 500;
		line-height: 1.5;
		text-decoration: none;
	}

	.meta-tag:hover {
		background: color-mix(in srgb, var(--color-ref-tag) 22%, transparent);
	}

	/* Article typography: match the Milkdown editor exactly */
	.reader-body :global(.markdown-content) {
		font-family: var(--font-editor);
		font-size: var(--font-size-editor);
		line-height: 1.75;
		color: var(--color-text);
	}

	.reader-body :global(.markdown-content p) {
		line-height: 1.7;
	}

	@media (max-width: 768px) {
		.reader-body :global(.markdown-content) {
			font-size: 1.125rem;
		}

		.reader-body :global(.markdown-content h1) {
			font-size: 1.55em;
		}

		.reader-body :global(.markdown-content h2) {
			font-size: 1.3em;
		}

		.reader-body :global(.markdown-content h3) {
			font-size: 1.12em;
		}

		.reader-body :global(.markdown-content p) {
			margin-bottom: 0.75em;
		}
	}

	/* Links, backlinks, related */
	.reader-links {
		margin-top: 3.5rem;
		padding-top: 0.5rem;
		border-top: 1px solid var(--color-border);
	}

	.reader-links .k-section-title {
		margin-top: 1.5rem;
	}

	.link-list {
		margin: 0 -0.375rem;
		padding: 0;
		list-style: none;
	}

	.link-row {
		gap: 0.75rem;
		padding-left: 0.625rem;
		padding-right: 0.625rem;
	}

	.link-title {
		flex-shrink: 0;
		max-width: 60%;
		overflow: hidden;
		font-weight: 500;
		white-space: nowrap;
		text-overflow: ellipsis;
	}

	.link-preview {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		font-size: 0.8125rem;
		color: var(--color-text-faint);
		white-space: nowrap;
		text-overflow: ellipsis;
	}

	/* Previous / next */
	.pager {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.5rem;
		margin-top: 3rem;
		padding-top: 1.25rem;
		border-top: 1px solid var(--color-border);
	}

	.pager-link {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		min-width: 0;
		padding: 0.625rem 0.75rem;
		border-radius: var(--radius-md);
		text-decoration: none;
	}

	.pager-link:hover {
		background: var(--color-hover);
	}

	.pager-link.next {
		grid-column: 2;
		align-items: flex-end;
		text-align: right;
	}

	.pager-label {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		font-size: 0.75rem;
		color: var(--color-text-faint);
	}

	.pager-title {
		max-width: 100%;
		overflow: hidden;
		font-size: 0.9375rem;
		font-weight: 500;
		color: var(--color-text);
		white-space: nowrap;
		text-overflow: ellipsis;
	}

	.all-notes {
		display: flex;
		justify-content: center;
		margin-top: 1.5rem;
	}

	.all-notes a {
		text-decoration: none;
	}

	/* Back to top */
	.back-to-top {
		position: fixed;
		right: 1.5rem;
		bottom: 1.5rem;
		z-index: 30;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2.25rem;
		height: 2.25rem;
		border: 1px solid var(--color-border);
		border-radius: 999px;
		background: var(--color-bg);
		color: var(--color-text-muted);
		box-shadow: var(--shadow-md);
		cursor: pointer;
		animation: fadeIn 150ms var(--ease-out);
	}

	.back-to-top:hover {
		background: var(--color-bg-secondary);
		color: var(--color-text);
	}

	@media (max-width: 640px) {
		.back-to-top {
			right: 1rem;
			bottom: calc(1rem + env(safe-area-inset-bottom, 0px));
		}
	}
</style>
