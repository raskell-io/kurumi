<script lang="ts">
	import { marked } from 'marked';
	import { findMemoryObjectByTitle } from '$lib/db';
	import { resolveBlobUrl, isBlobRef } from '$lib/utils/image';
	import DataviewBlock from './DataviewBlock.svelte';
	import { onMount } from 'svelte';

	interface Props {
		content: string;
		onRefClick?: (type: 'person' | 'date' | 'tag', value: string, position: { x: number; y: number }) => void;
	}

	let { content, onRefClick }: Props = $props();

	// Extract ```kurumi code blocks before marked processes them so
	// they render as live query widgets instead of <pre><code>.
	interface DataviewEntry {
		id: string;
		source: string;
	}

	function extractDataviewBlocks(md: string): { cleaned: string; blocks: DataviewEntry[] } {
		const blocks: DataviewEntry[] = [];
		let idx = 0;
		const cleaned = md.replace(/```kurumi\n([\s\S]*?)```/g, (_, body) => {
			const id = `dv-${idx++}`;
			blocks.push({ id, source: body });
			return `<div data-dataview-id="${id}"></div>`;
		});
		return { cleaned, blocks };
	}

	/**
	 * Pre-process markdown before marked sees it. Handles custom syntax
	 * that maps to HTML structures marked doesn't understand natively.
	 */
	function preProcessMarkdown(md: string): string {
		// --- Bare checkboxes: [ ] and [x] without list prefix ---
		// Notion and Obsidian both auto-convert these. GFM requires the
		// `- ` prefix, so we add it when the line starts with [ ] or [x].
		md = md.replace(/^(\s*)\[ \]/gm, '$1- [ ]');
		md = md.replace(/^(\s*)\[x\]/gm, '$1- [x]');
		md = md.replace(/^(\s*)\[X\]/gm, '$1- [x]');

		// --- Highlight: ==text== → <mark>text</mark> ---
		// Obsidian-style highlight. Must run before marked since marked
		// doesn't know about == syntax.
		md = md.replace(/==((?:[^=]|=[^=])+)==/g, '<mark>$1</mark>');

		// --- Callouts: > [!type] title ---
		// Obsidian-style callouts. Convert to HTML divs with classes so
		// CSS can style them. Must run before marked wraps the > as a
		// blockquote.
		md = md.replace(
			/^> \[!(info|warning|tip|note|success|danger|quote)\](.*?)$\n((?:^> .*$\n?)*)/gm,
			(_, type, title, body) => {
				const cleanBody = body.replace(/^> ?/gm, '').trim();
				const titleHtml = title.trim()
					? `<div class="callout-title">${title.trim()}</div>`
					: '';
				return `<div class="callout callout-${type}">${titleHtml}<div class="callout-body">${cleanBody}</div></div>\n`;
			}
		);

		// --- Toggles: <details> already supported by GFM ---
		// No preprocessing needed; marked handles <details>/<summary>
		// natively when using GFM. We just style them.

		// --- Memory embeds: ![[Title]] ---
		// Inline-render another memory's content. For the rendered view,
		// we show a linked card with a preview; the full embed would
		// create recursive rendering issues.
		md = md.replace(/!\[\[([^\]]+)\]\]/g, (_, title) => {
			const memory = findMemoryObjectByTitle(title);
			if (memory) {
				const preview = (memory.summaryShort || memory.bodyMarkdown || '')
					.replace(/\s+/g, ' ')
					.trim()
					.slice(0, 150);
				return `<div class="memory-embed"><a href="/memory/${memory.id}" class="embed-link"><strong>${title}</strong><span class="embed-preview">${preview}${preview.length >= 150 ? '...' : ''}</span></a></div>`;
			}
			return `<div class="memory-embed memory-embed-broken"><span>![[${title}]] — not found</span></div>`;
		});

		// --- LaTeX math: $inline$ and $$block$$ ---
		// Wrap in spans/divs with class so CSS/KaTeX can process them.
		// We don't run KaTeX here (no dep) but we mark them so they're
		// identifiable and don't get mangled by marked.
		md = md.replace(/\$\$([^$]+)\$\$/g, (_, math) => {
			return `<div class="math-block">${escapeHtml(math.trim())}</div>`;
		});
		md = md.replace(/(?<!\$)\$([^$\n]+)\$(?!\$)/g, (_, math) => {
			return `<span class="math-inline">${escapeHtml(math.trim())}</span>`;
		});

		return md;
	}

	function escapeHtml(s: string): string {
		return s
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;');
	}

	let extracted = $derived(extractDataviewBlocks(content));
	let dataviewBlocks = $derived(extracted.blocks);

	// Process custom syntax AFTER marked has rendered
	function postProcessHtml(html: string): string {
		// Process wikilinks [[Title]]
		html = html.replace(/\[\[([^\]]+)\]\]/g, (_, title) => {
			const memory = findMemoryObjectByTitle(title);
			if (memory) {
				return `<a href="/read/${memory.id}" class="wikilink">${title}</a>`;
			}
			return `<a href="/?search=${encodeURIComponent(title)}" class="wikilink wikilink-broken">${title}</a>`;
		});

		// Process dates //YYYY-MM-DD — use data attributes for popup.
		// Negative lookbehind `(?<!:)` excludes URL schemes so
		// https://... doesn't get its `//` turned into a date button.
		html = html.replace(/(?<!:)\/\/(\d{4}-\d{2}-\d{2})/g, (_, date) => {
			return `<button type="button" class="date-reference" data-ref-type="date" data-ref-value="${date}">${date}</button>`;
		});

		// Process people @Full Name - use data attributes for popup
		html = html.replace(/@([A-Z][a-zA-Z]*(?: [A-Z][a-zA-Z]*)*)/g, (_, name) => {
			return `<button type="button" class="person-reference" data-ref-type="person" data-ref-value="${name}">@${name}</button>`;
		});

		// Process tags #tag-name - use data attributes for popup
		html = html.replace(/(?<![<\w])#([a-zA-Z][a-zA-Z0-9_-]*)/g, (_, tag) => {
			return `<button type="button" class="tag-reference" data-ref-type="tag" data-ref-value="${tag}">#${tag}</button>`;
		});

		// Process URLs that aren't already in href attributes
		html = html.replace(/(?<!href=["'])(?<!src=["'])(https?:\/\/[^\s<>"]+)/g, (url) => {
			// YouTube embed: convert YouTube URLs to iframes
			const ytMatch = url.match(
				/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/
			);
			if (ytMatch) {
				return `<div class="embed-container"><iframe src="https://www.youtube-nocookie.com/embed/${ytMatch[1]}" frameborder="0" allowfullscreen class="embed-iframe"></iframe></div>`;
			}
			return `<a href="${url}" class="url-reference" target="_blank" rel="noopener noreferrer">${url}</a>`;
		});

		// Add copy button to fenced code blocks
		html = html.replace(
			/<pre><code(?: class="language-(\w+)")?>/g,
			(_, lang) => {
				const label = lang || 'code';
				return `<div class="code-block-wrapper"><div class="code-block-header"><span class="code-block-lang">${label}</span><button type="button" class="code-copy-btn" data-action="copy-code" title="Copy code">Copy</button></div><pre><code${lang ? ` class="language-${lang}"` : ''}>`;
			}
		);
		html = html.replace(/<\/code><\/pre>/g, '</code></pre></div>');

		// Add copy button to transcript blockquotes. Look for
		// blockquotes containing "Transcript:" and add a copy button.
		html = html.replace(
			/<blockquote>([\s\S]*?<strong>Transcript:<\/strong>[\s\S]*?)<\/blockquote>/g,
			(_, inner) => {
				return `<blockquote class="transcript-block"><button type="button" class="transcript-copy-btn" data-action="copy-transcript" title="Copy transcript">Copy</button>${inner}</blockquote>`;
			}
		);

		return html;
	}

	function renderMarkdown(markdown: string): string {
		if (!markdown) return '';

		// Pre-process custom syntax (callouts, embeds, math) that marked
		// doesn't understand — these produce raw HTML that marked passes
		// through when it sees them.
		let preprocessed = preProcessMarkdown(markdown);

		// Parse with marked (GFM + breaks)
		let html = marked.parse(preprocessed, { gfm: true, breaks: true }) as string;

		// Post-process for interactive elements (wikilinks, dates,
		// people, tags, YouTube embeds, etc.)
		html = postProcessHtml(html);

		return html;
	}

	let html = $derived(renderMarkdown(extracted.cleaned));

	function handleClick(e: MouseEvent) {
		const target = e.target as HTMLElement;

		// Handle code block copy button
		if (target.dataset.action === 'copy-code') {
			e.preventDefault();
			e.stopPropagation();
			const wrapper = target.closest('.code-block-wrapper');
			const code = wrapper?.querySelector('code');
			if (code) {
				navigator.clipboard.writeText(code.textContent || '').then(() => {
					target.textContent = 'Copied!';
					setTimeout(() => { target.textContent = 'Copy'; }, 2000);
				});
			}
			return;
		}

		// Handle transcript copy button
		if (target.dataset.action === 'copy-transcript') {
			e.preventDefault();
			e.stopPropagation();
			const block = target.closest('.transcript-block');
			if (block) {
				// Get text content excluding the copy button itself
				const clone = block.cloneNode(true) as HTMLElement;
				clone.querySelector('.transcript-copy-btn')?.remove();
				const text = clone.textContent?.replace(/^Transcript:\s*/, '').trim() || '';
				navigator.clipboard.writeText(text).then(() => {
					target.textContent = 'Copied!';
					setTimeout(() => { target.textContent = 'Copy'; }, 2000);
				});
			}
			return;
		}

		const refType = target.dataset.refType as 'person' | 'date' | 'tag' | undefined;
		const refValue = target.dataset.refValue;

		if (refType && refValue && onRefClick) {
			e.preventDefault();
			e.stopPropagation();
			onRefClick(refType, refValue, { x: e.clientX, y: e.clientY });
		}
	}

	// Resolve blob: image refs after the HTML is rendered. marked
	// outputs <img src="blob:abc123"> which the browser can't fetch;
	// we need to replace it with an object URL from the blob store.
	let contentDiv: HTMLDivElement | undefined = $state();

	async function resolveBlobImages() {
		if (!contentDiv) return;
		// Resolve blob: refs on images. Images whose alt starts with
		// "audio:" are swapped into real <audio> players.
		const imgs = contentDiv.querySelectorAll<HTMLImageElement>('img');
		for (const img of imgs) {
			const src = img.getAttribute('src') || '';
			const alt = img.getAttribute('alt') || '';
			if (isBlobRef(src) && !src.startsWith('blob:http')) {
				const url = await resolveBlobUrl(src);
				if (!url) continue;

				if (alt.startsWith('audio:')) {
					const audio = document.createElement('audio');
					audio.controls = true;
					audio.src = url;
					img.replaceWith(audio);
				} else {
					img.src = url;
				}
			}
		}
		// Resolve blob: refs on audio elements
		const audios = contentDiv.querySelectorAll<HTMLAudioElement>('audio');
		for (const audio of audios) {
			const src = audio.getAttribute('src') || '';
			if (isBlobRef(src) && !src.startsWith('blob:http')) {
				const url = await resolveBlobUrl(src);
				if (url) audio.src = url;
			}
		}
	}

	// Re-resolve whenever content changes
	$effect(() => {
		void html; // subscribe to changes
		// Delay to let the DOM update first
		requestAnimationFrame(() => resolveBlobImages());
	});
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="markdown-content" bind:this={contentDiv} onclick={handleClick}>
	{@html html}
	{#each dataviewBlocks as block (block.id)}
		<DataviewBlock source={block.source} />
	{/each}
</div>

<style>
	.markdown-content {
		line-height: 1.8;
		font-size: 1.0625rem;
		overflow-wrap: break-word;
		word-wrap: break-word;
		max-width: 100%;
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
		cursor: pointer;
		text-decoration: none;
	}

	.markdown-content :global(.wikilink:hover) {
		background: linear-gradient(
			135deg,
			color-mix(in srgb, var(--color-accent) 25%, transparent),
			color-mix(in srgb, var(--color-accent) 35%, transparent)
		);
		text-decoration: underline;
	}

	.markdown-content :global(.wikilink-broken) {
		opacity: 0.6;
		font-style: italic;
	}

	/* Date references - Catppuccin Blue */
	.markdown-content :global(.date-reference) {
		display: inline-flex;
		align-items: center;
		gap: 0.25em;
		background: linear-gradient(135deg, rgba(137, 180, 250, 0.15), rgba(137, 180, 250, 0.25));
		color: #89b4fa;
		padding: 0.1em 0.4em;
		border: none;
		border-radius: 4px;
		font-weight: 500;
		font-size: inherit;
		font-family: inherit;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.markdown-content :global(.date-reference:hover) {
		background: linear-gradient(135deg, rgba(137, 180, 250, 0.25), rgba(137, 180, 250, 0.35));
	}

	/* Person references - Catppuccin Green */
	.markdown-content :global(.person-reference) {
		display: inline-flex;
		align-items: center;
		gap: 0.25em;
		background: linear-gradient(135deg, rgba(166, 227, 161, 0.15), rgba(166, 227, 161, 0.25));
		color: #a6e3a1;
		padding: 0.1em 0.4em;
		border: none;
		border-radius: 1em;
		font-weight: 500;
		font-size: inherit;
		font-family: inherit;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.markdown-content :global(.person-reference:hover) {
		background: linear-gradient(135deg, rgba(166, 227, 161, 0.25), rgba(166, 227, 161, 0.35));
	}

	/* Tag references - Catppuccin Peach */
	.markdown-content :global(.tag-reference) {
		display: inline-flex;
		align-items: center;
		gap: 0.25em;
		background: linear-gradient(135deg, rgba(250, 179, 135, 0.15), rgba(250, 179, 135, 0.25));
		color: #fab387;
		padding: 0.1em 0.4em;
		border: none;
		border-radius: 4px;
		font-weight: 500;
		font-size: inherit;
		font-family: inherit;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.markdown-content :global(.tag-reference:hover) {
		background: linear-gradient(135deg, rgba(250, 179, 135, 0.25), rgba(250, 179, 135, 0.35));
	}

	/* URL references - Catppuccin Mauve */
	.markdown-content :global(.url-reference) {
		display: inline-flex;
		align-items: center;
		gap: 0.25em;
		background: linear-gradient(135deg, rgba(203, 166, 247, 0.15), rgba(203, 166, 247, 0.25));
		color: #cba6f7;
		padding: 0.1em 0.4em;
		border-radius: 4px;
		font-weight: 500;
		word-break: break-all;
		transition: all 0.15s ease;
	}

	.markdown-content :global(.url-reference:hover) {
		background: linear-gradient(135deg, rgba(203, 166, 247, 0.25), rgba(203, 166, 247, 0.35));
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
		-webkit-overflow-scrolling: touch;
		margin: 1.5em 0;
		max-width: 100%;
	}

	.markdown-content :global(pre code) {
		background: none;
		padding: 0;
	}

	/* Code block wrapper with copy button */
	.markdown-content :global(.code-block-wrapper) {
		position: relative;
		margin: 1.5em 0;
	}

	.markdown-content :global(.code-block-wrapper pre) {
		margin: 0;
		border-top-left-radius: 0;
		border-top-right-radius: 0;
	}

	.markdown-content :global(.code-block-header) {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.375rem 1rem;
		background: color-mix(in srgb, var(--color-bg-secondary) 80%, black);
		border-top-left-radius: 8px;
		border-top-right-radius: 8px;
		font-size: 0.6875rem;
	}

	.markdown-content :global(.code-block-lang) {
		color: var(--color-text-muted);
		text-transform: lowercase;
	}

	.markdown-content :global(.code-copy-btn) {
		padding: 0.125rem 0.5rem;
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 0.25rem;
		color: var(--color-text-muted);
		font-size: 0.625rem;
		cursor: pointer;
		transition: all 0.15s;
	}

	.markdown-content :global(.code-copy-btn:hover) {
		background: var(--color-bg-secondary);
		color: var(--color-accent);
		border-color: var(--color-accent);
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

	/* Tables - wrap in scrollable container on mobile */
	.markdown-content :global(table) {
		border-collapse: collapse;
		width: 100%;
		margin: 1.5em 0;
		display: block;
		overflow-x: auto;
		-webkit-overflow-scrolling: touch;
	}

	.markdown-content :global(th),
	.markdown-content :global(td) {
		border: 1px solid var(--color-border);
		padding: 0.5em 1em;
		text-align: left;
		white-space: nowrap;
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

	/* ---- Callouts (Obsidian-style) ---- */
	.markdown-content :global(.callout) {
		margin: 1em 0;
		padding: 0.875rem 1rem;
		border-radius: 0.5rem;
		border-left: 4px solid;
		font-size: 0.9375rem;
	}

	.markdown-content :global(.callout-title) {
		font-weight: 600;
		margin-bottom: 0.375rem;
	}

	.markdown-content :global(.callout-body) {
		line-height: 1.6;
	}

	.markdown-content :global(.callout-info),
	.markdown-content :global(.callout-note) {
		background: rgba(59, 130, 246, 0.08);
		border-color: #3b82f6;
		color: var(--color-text);
	}

	.markdown-content :global(.callout-warning),
	.markdown-content :global(.callout-danger) {
		background: rgba(239, 68, 68, 0.08);
		border-color: #ef4444;
	}

	.markdown-content :global(.callout-tip),
	.markdown-content :global(.callout-success) {
		background: rgba(34, 197, 94, 0.08);
		border-color: #22c55e;
	}

	.markdown-content :global(.callout-quote) {
		background: var(--color-bg-secondary);
		border-color: var(--color-text-muted);
		font-style: italic;
	}

	/* ---- Memory embeds ![[title]] ---- */
	.markdown-content :global(.memory-embed) {
		margin: 0.75em 0;
		border: 1px solid var(--color-border);
		border-radius: 0.5rem;
		overflow: hidden;
		transition: border-color 0.15s;
	}

	.markdown-content :global(.memory-embed:hover) {
		border-color: var(--color-accent);
	}

	.markdown-content :global(.embed-link) {
		display: block;
		padding: 0.75rem 1rem;
		text-decoration: none;
		color: var(--color-text);
	}

	.markdown-content :global(.embed-link strong) {
		display: block;
		color: var(--color-accent);
		margin-bottom: 0.25rem;
	}

	.markdown-content :global(.embed-preview) {
		display: block;
		font-size: 0.8125rem;
		color: var(--color-text-muted);
		line-height: 1.5;
	}

	.markdown-content :global(.memory-embed-broken) {
		background: var(--color-bg-secondary);
		padding: 0.625rem 1rem;
		color: var(--color-text-muted);
		font-size: 0.8125rem;
	}

	/* ---- LaTeX math ---- */
	.markdown-content :global(.math-block) {
		display: block;
		text-align: center;
		padding: 0.75rem 1rem;
		margin: 0.75em 0;
		background: var(--color-bg-secondary);
		border-radius: 0.375rem;
		font-family: ui-monospace, monospace;
		font-size: 0.9375rem;
		overflow-x: auto;
	}

	.markdown-content :global(.math-inline) {
		padding: 0.125rem 0.25rem;
		background: var(--color-bg-secondary);
		border-radius: 0.25rem;
		font-family: ui-monospace, monospace;
		font-size: 0.875em;
	}

	/* ---- YouTube / embeds ---- */
	.markdown-content :global(.embed-container) {
		position: relative;
		padding-bottom: 56.25%; /* 16:9 */
		height: 0;
		overflow: hidden;
		margin: 1em 0;
		border-radius: 0.5rem;
	}

	.markdown-content :global(.embed-iframe) {
		position: absolute;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		border-radius: 0.5rem;
	}

	/* ---- Details / toggles ---- */
	.markdown-content :global(details) {
		margin: 0.75em 0;
		border: 1px solid var(--color-border);
		border-radius: 0.5rem;
		overflow: hidden;
	}

	.markdown-content :global(details summary) {
		padding: 0.625rem 1rem;
		cursor: pointer;
		font-weight: 500;
		color: var(--color-text);
		background: var(--color-bg-secondary);
		user-select: none;
		list-style: none;
	}

	.markdown-content :global(details summary::before) {
		content: '▸ ';
		font-family: ui-monospace, monospace;
	}

	.markdown-content :global(details[open] summary::before) {
		content: '▾ ';
	}

	.markdown-content :global(details > *:not(summary)) {
		padding: 0 1rem;
	}

	.markdown-content :global(details > *:last-child) {
		padding-bottom: 0.75rem;
	}

	/* ---- Task list (GFM checkboxes) ---- */
	.markdown-content :global(.task-list-item) {
		list-style: none;
		margin-left: -1.25em;
	}

	.markdown-content :global(.task-list-item input[type="checkbox"]) {
		margin-right: 0.5em;
		accent-color: var(--color-accent);
		width: 1em;
		height: 1em;
		vertical-align: middle;
		cursor: default;
	}

	/* Checked items get a muted style for the text */
	.markdown-content :global(.task-list-item:has(input:checked)) {
		color: var(--color-text-muted);
		text-decoration: line-through;
	}

	/* ---- Highlight ==text== ---- */
	.markdown-content :global(mark) {
		background: rgba(250, 204, 21, 0.3);
		color: inherit;
		padding: 0.0625rem 0.25rem;
		border-radius: 0.1875rem;
	}

	/* ---- Horizontal rule ---- */
	.markdown-content :global(hr) {
		border: none;
		border-top: 1px solid var(--color-border);
		margin: 2em 0;
	}

	/* ---- Images ---- */
	.markdown-content :global(img) {
		max-width: 100%;
		border-radius: 0.5rem;
		margin: 0.75em 0;
	}

	/* ---- Audio embeds ---- */
	.markdown-content :global(audio) {
		width: 100%;
		max-width: 100%;
		border-radius: 0.5rem;
		margin: 0.5em 0;
	}

	/* ---- Transcript block with copy button ---- */
	.markdown-content :global(.transcript-block) {
		position: relative;
		padding-right: 4rem;
	}

	.markdown-content :global(.transcript-copy-btn) {
		position: absolute;
		top: 0.5rem;
		right: 0.5rem;
		padding: 0.25rem 0.625rem;
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 0.25rem;
		color: var(--color-text-muted);
		font-size: 0.6875rem;
		cursor: pointer;
		transition: all 0.15s;
	}

	.markdown-content :global(.transcript-copy-btn:hover) {
		background: var(--color-bg-secondary);
		color: var(--color-accent);
		border-color: var(--color-accent);
	}

	/* ---- Keyboard shortcuts ---- */
	.markdown-content :global(kbd) {
		display: inline-block;
		padding: 0.125rem 0.375rem;
		font-size: 0.8125em;
		font-family: ui-monospace, monospace;
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border);
		border-radius: 0.25rem;
		box-shadow: 0 1px 0 var(--color-border);
	}

	/* ---- Abbreviation / footnote markers ---- */
	.markdown-content :global(abbr) {
		text-decoration: underline dotted;
		cursor: help;
	}
</style>
