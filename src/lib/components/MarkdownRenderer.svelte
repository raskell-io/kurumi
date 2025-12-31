<script lang="ts">
	import { marked } from 'marked';
	import { findNoteByTitle } from '$lib/db';

	interface Props {
		content: string;
	}

	let { content }: Props = $props();

	// Custom renderer to handle special syntax
	function renderMarkdown(markdown: string): string {
		// First, process our custom syntax before marked parses it

		// Process wikilinks [[Title]] -> links to /read/[id] or show as broken link
		let processed = markdown.replace(/\[\[([^\]]+)\]\]/g, (_, title) => {
			const note = findNoteByTitle(title);
			if (note) {
				return `<a href="/read/${note.id}" class="wikilink">${title}</a>`;
			}
			return `<span class="wikilink wikilink-broken">${title}</span>`;
		});

		// Process dates //YYYY-MM-DD
		processed = processed.replace(/\/\/(\d{4}-\d{2}-\d{2})/g, (_, date) => {
			return `<a href="/read/date/${date}" class="date-reference">${date}</a>`;
		});

		// Process people @Full Name
		processed = processed.replace(/@([A-Z][a-zA-Z]+(?: [A-Z][a-zA-Z]+)*)/g, (_, name) => {
			return `<a href="/read/person/${encodeURIComponent(name)}" class="person-reference">@${name}</a>`;
		});

		// Process tags #tag-name (but not after @)
		processed = processed.replace(/(?<![a-zA-Z@])#([a-zA-Z][a-zA-Z0-9_-]*)/g, (_, tag) => {
			return `<a href="/read/tag/${tag}" class="tag-reference">#${tag}</a>`;
		});

		// Process URLs - mark them for special styling
		processed = processed.replace(
			/(https?:\/\/[^\s<>")\]]+)/g,
			'<a href="$1" class="url-reference" target="_blank" rel="noopener noreferrer">$1</a>'
		);

		// Configure marked
		marked.setOptions({
			gfm: true,
			breaks: true
		});

		// Parse with marked
		return marked.parse(processed) as string;
	}

	let html = $derived(renderMarkdown(content));
</script>

<div class="markdown-content">
	{@html html}
</div>

<style>
	.markdown-content {
		line-height: 1.8;
		font-size: 1.0625rem;
	}

	/* Headings */
	.markdown-content :global(h1) {
		font-size: 2em;
		font-weight: 700;
		margin-top: 1.5em;
		margin-bottom: 0.5em;
		color: var(--color-text);
		border-bottom: 1px solid var(--color-border);
		padding-bottom: 0.3em;
	}

	.markdown-content :global(h2) {
		font-size: 1.5em;
		font-weight: 600;
		margin-top: 1.25em;
		margin-bottom: 0.4em;
		color: var(--color-text);
	}

	.markdown-content :global(h3) {
		font-size: 1.25em;
		font-weight: 600;
		margin-top: 1em;
		margin-bottom: 0.3em;
		color: var(--color-text);
	}

	.markdown-content :global(h4),
	.markdown-content :global(h5),
	.markdown-content :global(h6) {
		font-size: 1.1em;
		font-weight: 600;
		margin-top: 1em;
		margin-bottom: 0.3em;
		color: var(--color-text);
	}

	/* Paragraphs */
	.markdown-content :global(p) {
		margin-bottom: 1em;
	}

	/* Links */
	.markdown-content :global(a) {
		color: var(--color-accent);
		text-decoration: none;
	}

	.markdown-content :global(a:hover) {
		text-decoration: underline;
	}

	/* Wikilinks */
	.markdown-content :global(.wikilink) {
		background: linear-gradient(
			135deg,
			color-mix(in srgb, var(--color-accent) 15%, transparent),
			color-mix(in srgb, var(--color-accent) 25%, transparent)
		);
		color: var(--color-accent);
		padding: 0.1em 0.4em;
		border-radius: 4px;
		font-weight: 500;
		transition: all 0.15s ease;
	}

	.markdown-content :global(.wikilink:hover) {
		background: linear-gradient(
			135deg,
			color-mix(in srgb, var(--color-accent) 25%, transparent),
			color-mix(in srgb, var(--color-accent) 35%, transparent)
		);
		text-decoration: none;
	}

	.markdown-content :global(.wikilink-broken) {
		opacity: 0.6;
		text-decoration: line-through;
	}

	/* Date references */
	.markdown-content :global(.date-reference) {
		display: inline-flex;
		align-items: center;
		gap: 0.25em;
		background: linear-gradient(135deg, rgba(59, 130, 246, 0.15), rgba(59, 130, 246, 0.25));
		color: #3b82f6;
		padding: 0.1em 0.4em;
		border-radius: 4px;
		font-weight: 500;
		transition: all 0.15s ease;
	}

	.markdown-content :global(.date-reference:hover) {
		background: linear-gradient(135deg, rgba(59, 130, 246, 0.25), rgba(59, 130, 246, 0.35));
		text-decoration: none;
	}

	/* Person references */
	.markdown-content :global(.person-reference) {
		display: inline-flex;
		align-items: center;
		gap: 0.25em;
		background: linear-gradient(135deg, rgba(34, 197, 94, 0.15), rgba(34, 197, 94, 0.25));
		color: #22c55e;
		padding: 0.1em 0.4em;
		border-radius: 1em;
		font-weight: 500;
		transition: all 0.15s ease;
	}

	.markdown-content :global(.person-reference:hover) {
		background: linear-gradient(135deg, rgba(34, 197, 94, 0.25), rgba(34, 197, 94, 0.35));
		text-decoration: none;
	}

	/* Tag references */
	.markdown-content :global(.tag-reference) {
		display: inline-flex;
		align-items: center;
		gap: 0.25em;
		background: linear-gradient(135deg, rgba(245, 158, 11, 0.15), rgba(245, 158, 11, 0.25));
		color: #f59e0b;
		padding: 0.1em 0.4em;
		border-radius: 4px;
		font-weight: 500;
		transition: all 0.15s ease;
	}

	.markdown-content :global(.tag-reference:hover) {
		background: linear-gradient(135deg, rgba(245, 158, 11, 0.25), rgba(245, 158, 11, 0.35));
		text-decoration: none;
	}

	/* URL references */
	.markdown-content :global(.url-reference) {
		display: inline-flex;
		align-items: center;
		gap: 0.25em;
		background: linear-gradient(135deg, rgba(139, 92, 246, 0.15), rgba(139, 92, 246, 0.25));
		color: #8b5cf6;
		padding: 0.1em 0.4em;
		border-radius: 4px;
		font-weight: 500;
		word-break: break-all;
		transition: all 0.15s ease;
	}

	.markdown-content :global(.url-reference:hover) {
		background: linear-gradient(135deg, rgba(139, 92, 246, 0.25), rgba(139, 92, 246, 0.35));
		text-decoration: none;
	}

	/* Code */
	.markdown-content :global(code) {
		background: var(--color-bg-secondary);
		padding: 0.2em 0.4em;
		border-radius: 4px;
		font-family: 'SF Mono', 'Fira Code', monospace;
		font-size: 0.9em;
	}

	.markdown-content :global(pre) {
		background: var(--color-bg-secondary);
		padding: 1em;
		border-radius: 8px;
		overflow-x: auto;
		margin: 1.5em 0;
	}

	.markdown-content :global(pre code) {
		background: none;
		padding: 0;
	}

	/* Blockquotes */
	.markdown-content :global(blockquote) {
		border-left: 4px solid var(--color-accent);
		padding-left: 1em;
		margin-left: 0;
		margin-right: 0;
		color: var(--color-text-muted);
		font-style: italic;
	}

	/* Lists */
	.markdown-content :global(ul),
	.markdown-content :global(ol) {
		padding-left: 1.5em;
		margin-bottom: 1em;
	}

	.markdown-content :global(li) {
		margin-bottom: 0.25em;
	}

	.markdown-content :global(ul) {
		list-style-type: disc;
	}

	.markdown-content :global(ol) {
		list-style-type: decimal;
	}

	/* Task lists */
	.markdown-content :global(ul.contains-task-list) {
		list-style: none;
		padding-left: 0;
	}

	.markdown-content :global(li.task-list-item) {
		display: flex;
		align-items: flex-start;
		gap: 0.5em;
	}

	.markdown-content :global(input[type='checkbox']) {
		margin-top: 0.35em;
		accent-color: var(--color-accent);
	}

	/* Tables */
	.markdown-content :global(table) {
		border-collapse: collapse;
		width: 100%;
		margin: 1.5em 0;
	}

	.markdown-content :global(th),
	.markdown-content :global(td) {
		border: 1px solid var(--color-border);
		padding: 0.5em 1em;
		text-align: left;
	}

	.markdown-content :global(th) {
		background: var(--color-bg-secondary);
		font-weight: 600;
	}

	/* Horizontal rule */
	.markdown-content :global(hr) {
		border: none;
		border-top: 2px solid var(--color-border);
		margin: 2em 0;
	}

	/* Images */
	.markdown-content :global(img) {
		max-width: 100%;
		border-radius: 8px;
		margin: 1em 0;
	}

	/* Strong and emphasis */
	.markdown-content :global(strong) {
		font-weight: 600;
	}

	.markdown-content :global(em) {
		font-style: italic;
	}

	/* Strikethrough */
	.markdown-content :global(del) {
		text-decoration: line-through;
		color: var(--color-text-muted);
	}
</style>
