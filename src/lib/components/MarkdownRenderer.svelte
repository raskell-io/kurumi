<script lang="ts">
	import { handleAttachmentClick } from '$lib/attachments';
	import { openImageFromContainer, isViewable } from '$lib/stores/imageViewer';
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

	interface MermaidEntry {
		id: string;
		source: string;
	}

	function extractDataviewBlocks(md: string): { cleaned: string; blocks: DataviewEntry[]; mermaidBlocks: MermaidEntry[] } {
		const blocks: DataviewEntry[] = [];
		const mermaidBlocks: MermaidEntry[] = [];
		let dvIdx = 0;
		let mmIdx = 0;
		let cleaned = md.replace(/```kurumi\n([\s\S]*?)```/g, (_, body) => {
			const id = `dv-${dvIdx++}`;
			blocks.push({ id, source: body });
			return `<div data-dataview-id="${id}"></div>`;
		});
		cleaned = cleaned.replace(/```mermaid\n([\s\S]*?)```/g, (_, body) => {
			const id = `mm-${mmIdx++}`;
			mermaidBlocks.push({ id, source: body.trim() });
			return `<div class="mermaid-block" data-mermaid-id="${id}"></div>`;
		});
		return { cleaned, blocks, mermaidBlocks };
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
	let mermaidBlocks = $derived(extracted.mermaidBlocks);

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

		// Attachment links open the stored file.
		if (handleAttachmentClick(e)) return;

		// Images open in the full-screen viewer (unless they're a link).
		if (target instanceof HTMLImageElement && !target.closest('a') && isViewable(target)) {
			e.preventDefault();
			openImageFromContainer(contentDiv ?? target.parentElement!, target);
			return;
		}

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

	// Render mermaid diagrams after DOM update
	$effect(() => {
		const blocks = mermaidBlocks;
		if (blocks.length === 0 || !contentDiv) return;
		requestAnimationFrame(async () => {
			try {
				const { default: mermaid } = await import('mermaid');
				// Follow the app theme (manual .dark/.light class, else system)
				const root = document.documentElement;
				const isDark =
					root.classList.contains('dark') ||
					(!root.classList.contains('light') &&
						window.matchMedia('(prefers-color-scheme: dark)').matches);
				mermaid.initialize({
					startOnLoad: false,
					theme: isDark ? 'dark' : 'default',
					securityLevel: 'loose'
				});
				for (const block of blocks) {
					const el = contentDiv?.querySelector(`[data-mermaid-id="${block.id}"]`);
					if (!el) continue;
					const { svg } = await mermaid.render(`mermaid-${block.id}`, block.source);
					el.innerHTML = svg;
				}
			} catch {
				// mermaid not installed or rendering failed — show source as fallback
				for (const block of blocks) {
					const el = contentDiv?.querySelector(`[data-mermaid-id="${block.id}"]`);
					if (el) el.innerHTML = `<pre class="mermaid-fallback"><code>${block.source.replace(/</g, '&lt;')}</code></pre>`;
				}
			}
		});
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
	/* Base sizing inherits from the host so this renderer stays compact
	   in chat answers and summaries. The read page scales it up to the
	   editor's typography via its own wrapper. Rules below mirror
	   Editor.svelte so reading and writing look the same. */
	.markdown-content {
		line-height: 1.65;
		overflow-wrap: break-word;
		word-wrap: break-word;
		max-width: 100%;
	}

	.markdown-content > :global(:first-child) {
		margin-top: 0;
	}

	.markdown-content > :global(:last-child) {
		margin-bottom: 0;
	}

	/* Headings */
	.markdown-content :global(:is(h1, h2, h3, h4, h5, h6)) {
		color: var(--color-text);
		line-height: 1.3;
		letter-spacing: -0.01em;
	}

	.markdown-content :global(h1) {
		font-size: 1.75em;
		font-weight: 700;
		margin-top: 1.4em;
		margin-bottom: 0.4em;
	}

	.markdown-content :global(h2) {
		font-size: 1.4em;
		font-weight: 650;
		margin-top: 1.3em;
		margin-bottom: 0.35em;
	}

	.markdown-content :global(h3) {
		font-size: 1.18em;
		font-weight: 600;
		margin-top: 1.1em;
		margin-bottom: 0.3em;
	}

	.markdown-content :global(:is(h4, h5, h6)) {
		font-size: 1em;
		font-weight: 600;
		margin-top: 1em;
		margin-bottom: 0.25em;
	}

	/* Paragraphs */
	.markdown-content :global(p) {
		margin-bottom: 0.6em;
	}

	/* Links */
	.markdown-content :global(a) {
		color: var(--color-accent);
		text-decoration: underline;
		text-decoration-color: color-mix(in srgb, var(--color-accent) 35%, transparent);
		text-underline-offset: 0.2em;
		text-decoration-thickness: 1px;
	}

	.markdown-content :global(a:hover) {
		text-decoration-color: var(--color-accent);
	}

	/* Wikilinks: read as links, not buttons */
	.markdown-content :global(.wikilink) {
		border-radius: 3px;
		font-weight: 500;
		transition: background-color 0.12s ease, text-decoration-color 0.12s ease;
	}

	.markdown-content :global(.wikilink:hover) {
		background: var(--color-accent-soft);
	}

	.markdown-content :global(.wikilink-broken) {
		color: var(--color-text-muted);
		text-decoration-style: dashed;
		text-decoration-color: var(--color-text-faint);
	}

	/* Inline references share one chip shape; each type sets --ref */
	.markdown-content :global(:is(.date-reference, .person-reference, .tag-reference, .url-reference)) {
		display: inline-flex;
		align-items: center;
		gap: 0.25em;
		padding: 0.05em 0.4em;
		border: none;
		border-radius: 4px;
		background: color-mix(in srgb, var(--ref) 12%, transparent);
		color: var(--ref);
		font-family: inherit;
		font-size: 0.92em;
		font-weight: 500;
		line-height: 1.5;
		text-decoration: none;
		vertical-align: baseline;
		cursor: pointer;
		transition: background-color 0.12s ease;
	}

	.markdown-content :global(:is(.date-reference, .person-reference, .tag-reference, .url-reference):hover) {
		background: color-mix(in srgb, var(--ref) 22%, transparent);
	}

	.markdown-content :global(:is(.date-reference, .person-reference, .url-reference)::before) {
		content: '';
		display: inline-block;
		width: 0.85em;
		height: 0.85em;
		flex-shrink: 0;
		background-color: currentColor;
		-webkit-mask-size: contain;
		mask-size: contain;
		-webkit-mask-repeat: no-repeat;
		mask-repeat: no-repeat;
		opacity: 0.8;
	}

	.markdown-content :global(.date-reference) {
		--ref: var(--color-ref-date);
	}

	.markdown-content :global(.date-reference::before) {
		-webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20'%3E%3Cpath fill-rule='evenodd' d='M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z' clip-rule='evenodd'/%3E%3C/svg%3E");
		mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20'%3E%3Cpath fill-rule='evenodd' d='M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z' clip-rule='evenodd'/%3E%3C/svg%3E");
	}

	.markdown-content :global(.person-reference) {
		--ref: var(--color-ref-person);
		border-radius: 1em;
	}

	.markdown-content :global(.person-reference::before) {
		-webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20'%3E%3Cpath fill-rule='evenodd' d='M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z' clip-rule='evenodd'/%3E%3C/svg%3E");
		mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20'%3E%3Cpath fill-rule='evenodd' d='M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z' clip-rule='evenodd'/%3E%3C/svg%3E");
	}

	.markdown-content :global(.tag-reference) {
		--ref: var(--color-ref-tag);
	}

	.markdown-content :global(.url-reference) {
		--ref: var(--color-ref-url);
		word-break: break-all;
	}

	.markdown-content :global(.url-reference::before) {
		-webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20'%3E%3Cpath fill-rule='evenodd' d='M12.586 4.586a2 2 0 112.828 2.828l-3 3a2 2 0 01-2.828 0 1 1 0 00-1.414 1.414 4 4 0 005.656 0l3-3a4 4 0 00-5.656-5.656l-1.5 1.5a1 1 0 101.414 1.414l1.5-1.5zm-5 5a2 2 0 012.828 0 1 1 0 101.414-1.414 4 4 0 00-5.656 0l-3 3a4 4 0 105.656 5.656l1.5-1.5a1 1 0 10-1.414-1.414l-1.5 1.5a2 2 0 11-2.828-2.828l3-3z' clip-rule='evenodd'/%3E%3C/svg%3E");
		mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20'%3E%3Cpath fill-rule='evenodd' d='M12.586 4.586a2 2 0 112.828 2.828l-3 3a2 2 0 01-2.828 0 1 1 0 00-1.414 1.414 4 4 0 005.656 0l3-3a4 4 0 00-5.656-5.656l-1.5 1.5a1 1 0 101.414 1.414l1.5-1.5zm-5 5a2 2 0 012.828 0 1 1 0 101.414-1.414 4 4 0 00-5.656 0l-3 3a4 4 0 105.656 5.656l1.5-1.5a1 1 0 10-1.414-1.414l-1.5 1.5a2 2 0 11-2.828-2.828l3-3z' clip-rule='evenodd'/%3E%3C/svg%3E");
	}

	/* Inline code */
	.markdown-content :global(code) {
		padding: 0.15em 0.35em;
		border-radius: 4px;
		background: var(--color-hover);
		color: var(--color-text);
		font-family: var(--font-mono);
		font-size: 0.85em;
	}

	/* Code blocks: one bordered surface with a quiet header */
	.markdown-content :global(pre) {
		margin: 1em 0;
		padding: 0.875em 1em;
		max-width: 100%;
		overflow-x: auto;
		-webkit-overflow-scrolling: touch;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-bg-secondary);
		font-size: 0.95em;
		line-height: 1.6;
	}

	.markdown-content :global(pre code) {
		padding: 0;
		background: none;
	}

	.markdown-content :global(.code-block-wrapper) {
		margin: 1em 0;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-bg-secondary);
		overflow: hidden;
	}

	.markdown-content :global(.code-block-wrapper pre) {
		margin: 0;
		padding-top: 0.25em;
		border: none;
		border-radius: 0;
	}

	.markdown-content :global(.code-block-header) {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.375rem 0.5rem 0 1rem;
		font-family: var(--font-sans);
		font-size: 0.6875rem;
	}

	.markdown-content :global(.code-block-lang) {
		color: var(--color-text-faint);
		text-transform: lowercase;
	}

	.markdown-content :global(:is(.code-copy-btn, .transcript-copy-btn)) {
		padding: 0.125rem 0.4375rem;
		border: none;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--color-text-faint);
		font-family: var(--font-sans);
		font-size: 0.6875rem;
		cursor: pointer;
	}

	.markdown-content :global(:is(.code-copy-btn, .transcript-copy-btn):hover) {
		background: var(--color-hover);
		color: var(--color-text);
	}

	/* Mermaid diagrams */
	.markdown-content :global(.mermaid-block) {
		margin: 1em 0;
		padding: 1rem;
		overflow-x: auto;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		text-align: center;
	}

	.markdown-content :global(.mermaid-block svg) {
		max-width: 100%;
		height: auto;
	}

	.markdown-content :global(.mermaid-fallback) {
		margin: 0;
		text-align: left;
	}

	/* Blockquotes */
	.markdown-content :global(blockquote) {
		margin: 0.75em 0;
		padding-left: 1em;
		border-left: 3px solid var(--color-border);
		color: var(--color-text-muted);
	}

	.markdown-content :global(blockquote > :last-child) {
		margin-bottom: 0;
	}

	/* Transcript quotes get a quiet copy action */
	.markdown-content :global(.transcript-block) {
		position: relative;
		padding-right: 3.5rem;
	}

	.markdown-content :global(.transcript-copy-btn) {
		position: absolute;
		top: 0;
		right: 0;
	}

	/* Lists */
	.markdown-content :global(:is(ul, ol)) {
		margin-bottom: 0.75em;
		padding-left: 1.5em;
	}

	.markdown-content :global(ul) {
		list-style-type: disc;
	}

	.markdown-content :global(ol) {
		list-style-type: decimal;
	}

	.markdown-content :global(li) {
		margin-bottom: 0.15em;
	}

	.markdown-content :global(li > p) {
		margin-bottom: 0.15em;
	}

	.markdown-content :global(li > :is(ul, ol)) {
		margin-top: 0.15em;
		margin-bottom: 0;
	}

	.markdown-content :global(li::marker) {
		color: var(--color-text-faint);
	}

	/* Task lists: marked emits <li><input type="checkbox"> without
	   classes, so detect them structurally. */
	.markdown-content :global(li:has(> input[type='checkbox'])),
	.markdown-content :global(li:has(> p:first-child > input[type='checkbox'])) {
		list-style: none;
		margin-left: -1.25em;
	}

	.markdown-content :global(input[type='checkbox']) {
		appearance: none;
		-webkit-appearance: none;
		position: relative;
		top: -0.075em;
		width: 1.0625em;
		height: 1.0625em;
		margin: 0 0.5em 0 0;
		border: 1.5px solid var(--color-text-faint);
		border-radius: 0.25em;
		background: transparent;
		vertical-align: middle;
		cursor: default;
	}

	.markdown-content :global(input[type='checkbox']:checked) {
		border-color: var(--color-accent);
		background: var(--color-accent);
	}

	.markdown-content :global(input[type='checkbox']:checked::after) {
		content: '';
		position: absolute;
		left: 0.3em;
		top: 0.1em;
		width: 0.3em;
		height: 0.55em;
		border: solid var(--color-bg);
		border-width: 0 2px 2px 0;
		transform: rotate(45deg);
	}

	.markdown-content :global(li:has(> input:checked)),
	.markdown-content :global(li:has(> p:first-child > input:checked)) {
		color: var(--color-text-muted);
		text-decoration: line-through;
		text-decoration-color: var(--color-text-faint);
	}

	/* Tables scroll horizontally instead of overflowing on mobile */
	.markdown-content :global(table) {
		display: block;
		max-width: 100%;
		margin: 1em 0;
		overflow-x: auto;
		-webkit-overflow-scrolling: touch;
		border-collapse: collapse;
		font-size: 0.95em;
	}

	.markdown-content :global(:is(th, td)) {
		padding: 0.4em 0.9em;
		border: 1px solid var(--color-border);
		text-align: left;
		vertical-align: top;
	}

	.markdown-content :global(th) {
		background: var(--color-bg-secondary);
		font-weight: 600;
	}

	/* Rules, media */
	.markdown-content :global(hr) {
		margin: 1.75em 0;
		border: none;
		border-top: 1px solid var(--color-border);
	}

	.markdown-content :global(img) {
		max-width: 100%;
		margin: 1em 0;
		border-radius: var(--radius-md);
	}

	.markdown-content :global(audio) {
		width: 100%;
		max-width: 100%;
		margin: 0.5em 0;
	}

	/* Inline marks */
	.markdown-content :global(strong) {
		font-weight: 600;
	}

	.markdown-content :global(em) {
		font-style: italic;
	}

	.markdown-content :global(del) {
		color: var(--color-text-muted);
		text-decoration: line-through;
	}

	.markdown-content :global(mark) {
		padding: 0.05em 0.2em;
		border-radius: 3px;
		background: color-mix(in srgb, #df8e1d 22%, transparent);
		color: inherit;
	}

	.markdown-content :global(kbd) {
		display: inline-block;
		padding: 0.05em 0.35em;
		border: 1px solid var(--color-border);
		border-radius: 0.25rem;
		background: var(--color-bg);
		font-family: var(--font-sans);
		font-size: 0.8em;
		color: var(--color-text-muted);
	}

	.markdown-content :global(abbr) {
		text-decoration: underline dotted;
		cursor: help;
	}

	/* Callouts (Obsidian-style); each type sets --callout */
	.markdown-content :global(.callout) {
		--callout: var(--color-ref-date);
		margin: 1em 0;
		padding: 0.75em 1em;
		border-left: 3px solid var(--callout);
		border-radius: var(--radius-md);
		background: color-mix(in srgb, var(--callout) 8%, transparent);
	}

	.markdown-content :global(.callout-title) {
		margin-bottom: 0.25em;
		font-weight: 600;
		color: var(--callout);
	}

	.markdown-content :global(:is(.callout-tip, .callout-success)) {
		--callout: var(--color-ref-person);
	}

	.markdown-content :global(.callout-warning) {
		--callout: #df8e1d;
	}

	.markdown-content :global(.callout-danger) {
		--callout: var(--color-danger);
	}

	.markdown-content :global(.callout-quote) {
		--callout: var(--color-text-faint);
		color: var(--color-text-muted);
	}

	/* Memory embeds ![[title]] */
	.markdown-content :global(.memory-embed) {
		margin: 0.75em 0;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		overflow: hidden;
	}

	.markdown-content :global(.embed-link) {
		display: block;
		padding: 0.625em 0.875em;
		color: var(--color-text);
		text-decoration: none;
	}

	.markdown-content :global(.embed-link:hover) {
		background: var(--color-hover);
	}

	.markdown-content :global(.embed-link strong) {
		display: block;
		margin-bottom: 0.125em;
		font-weight: 600;
	}

	.markdown-content :global(.embed-preview) {
		display: block;
		font-family: var(--font-sans);
		font-size: 0.8125rem;
		line-height: 1.5;
		color: var(--color-text-muted);
	}

	.markdown-content :global(.memory-embed-broken) {
		padding: 0.625em 0.875em;
		border-style: dashed;
		font-size: 0.8125rem;
		color: var(--color-text-faint);
	}

	/* LaTeX math (marked, not typeset) */
	.markdown-content :global(.math-block) {
		display: block;
		margin: 0.75em 0;
		padding: 0.75em 1em;
		overflow-x: auto;
		border-radius: var(--radius-md);
		background: var(--color-bg-secondary);
		font-family: var(--font-mono);
		font-size: 0.9em;
		text-align: center;
	}

	.markdown-content :global(.math-inline) {
		padding: 0.1em 0.25em;
		border-radius: 4px;
		background: var(--color-hover);
		font-family: var(--font-mono);
		font-size: 0.85em;
	}

	/* YouTube embeds */
	.markdown-content :global(.embed-container) {
		position: relative;
		height: 0;
		margin: 1em 0;
		padding-bottom: 56.25%; /* 16:9 */
		overflow: hidden;
		border-radius: var(--radius-md);
	}

	.markdown-content :global(.embed-iframe) {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
	}

	/* Toggles */
	.markdown-content :global(details) {
		margin: 0.75em 0;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		overflow: hidden;
	}

	.markdown-content :global(details summary) {
		padding: 0.5em 0.875em;
		list-style: none;
		font-weight: 500;
		color: var(--color-text);
		cursor: pointer;
		user-select: none;
	}

	.markdown-content :global(details summary::-webkit-details-marker) {
		display: none;
	}

	.markdown-content :global(details summary:hover) {
		background: var(--color-hover);
	}

	.markdown-content :global(details summary::before) {
		content: '';
		display: inline-block;
		width: 0.4em;
		height: 0.4em;
		margin: 0 0.6em 0.15em 0;
		border: solid var(--color-text-faint);
		border-width: 0 1.5px 1.5px 0;
		transform: rotate(-45deg);
		transition: transform 0.15s var(--ease-out);
	}

	.markdown-content :global(details[open] summary::before) {
		transform: rotate(45deg);
	}

	.markdown-content :global(details > :not(summary)) {
		padding: 0 0.875em;
	}

	.markdown-content :global(details > :last-child) {
		padding-bottom: 0.625em;
	}

	.markdown-content :global(img:not(a img)) {
		cursor: zoom-in;
	}
</style>
