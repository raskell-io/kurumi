<script lang="ts">
	/**
	 * Full-screen PDF viewer with highlights ($lib/stores/pdfViewer). Pages
	 * render as they scroll into view (pdf.js, loaded on first use) with a
	 * text layer, so text can be selected and highlighted. Highlights live
	 * in the database (PdfHighlight), per file, and can be copied as a quote
	 * with a link to their page, or added to the note the PDF was opened from.
	 */
	import { pdfViewer, closePdf } from '$lib/stores/pdfViewer';
	import {
		pdfHighlights,
		addPdfHighlight,
		updatePdfHighlight,
		deletePdfHighlight,
		restorePdfHighlight,
		getMemoryObject,
		updateMemoryObject,
		type PdfHighlight
	} from '$lib/db';
	import { getBlob } from '$lib/db/blob-store';
	import { pushUndo } from '$lib/stores/undo';
	import { showNotice } from '$lib/stores/notice';
	import { X, ZoomIn, ZoomOut, Download, Highlighter, Copy, Trash2, FileText, PanelRight, NotebookPen, ExternalLink } from 'lucide-svelte';
	import { openAttachment } from '$lib/attachments';
	import { tick } from 'svelte';
	import type { PDFDocumentProxy } from 'pdfjs-dist';

	type Color = PdfHighlight['color'];
	const COLORS: { id: Color; label: string }[] = [
		{ id: 'yellow', label: 'Yellow' },
		{ id: 'green', label: 'Green' },
		{ id: 'blue', label: 'Blue' },
		{ id: 'pink', label: 'Pink' }
	];

	let pdf = $state<PDFDocumentProxy | null>(null);
	let error = $state<string | null>(null);
	let sizes = $state<{ width: number; height: number }[]>([]); // at scale 1
	let scale = $state(1);
	let currentPage = $state(1);
	let scroller: HTMLDivElement | undefined = $state();
	let showList = $state(typeof window !== 'undefined' && window.innerWidth > 900);
	let selection = $state<{ page: number; rects: [number, number, number, number][]; text: string; x: number; y: number } | null>(null);
	let loadedFor: string | null = null;

	let open = $derived($pdfViewer);
	let highlights = $derived(open ? $pdfHighlights.filter((h) => h.ref === open.ref) : []);

	// ---- Loading -----------------------------------------------------------

	let pdfjs: typeof import('pdfjs-dist') | null = null;
	async function loadPdfjs() {
		if (pdfjs) return pdfjs;
		const [lib, worker] = await Promise.all([
			import('pdfjs-dist/legacy/build/pdf.mjs'),
			import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')
		]);
		lib.GlobalWorkerOptions.workerSrc = worker.default;
		pdfjs = lib as unknown as typeof import('pdfjs-dist');
		return pdfjs;
	}

	$effect(() => {
		const state = open;
		if (!state) {
			void pdf?.destroy();
			pdf = null;
			loadedFor = null;
			return;
		}
		if (loadedFor === state.ref) {
			void tick().then(() => goToPage(state.page));
			return;
		}
		loadedFor = state.ref;
		void load(state.ref, state.page);
	});

	async function load(ref: string, page: number) {
		error = null;
		pdf = null;
		sizes = [];
		rendered.clear();
		try {
			const [lib, stored] = await Promise.all([loadPdfjs(), getBlob(ref)]);
			if (!stored) throw new Error('This file isn’t on this device yet. Sync to fetch it.');
			const data = new Uint8Array(await stored.blob.arrayBuffer());
			const doc = await lib.getDocument({ data, isEvalSupported: false }).promise;
			if (loadedFor !== ref) return void doc.destroy();
			const all: { width: number; height: number }[] = [];
			for (let i = 1; i <= doc.numPages; i++) {
				const p = await doc.getPage(i);
				const v = p.getViewport({ scale: 1 });
				all.push({ width: v.width, height: v.height });
			}
			pdf = doc;
			sizes = all;
			await tick();
			fitWidth();
			await tick();
			goToPage(page);
		} catch (err) {
			error = err instanceof Error ? err.message : 'Couldn’t open this PDF.';
		}
	}

	function fitWidth() {
		if (!scroller || sizes.length === 0) return;
		const widest = Math.max(...sizes.map((s) => s.width));
		scale = Math.max(0.5, Math.min(2.5, (scroller.clientWidth - 48) / widest));
	}

	function zoom(by: number) {
		const keep = currentPage;
		scale = Math.max(0.5, Math.min(4, Math.round((scale + by) * 10) / 10));
		rendered.clear();
		void tick().then(() => goToPage(keep));
	}

	// ---- Rendering pages as they come into view ------------------------------

	const rendered = new Map<number, number>(); // page → scale it's drawn at

	async function renderPage(n: number, el: HTMLElement) {
		if (!pdf || rendered.get(n) === scale || !pdfjs) return;
		const at = scale;
		rendered.set(n, at);
		const page = await pdf.getPage(n);
		const viewport = page.getViewport({ scale: at });
		const ratio = window.devicePixelRatio || 1;
		const canvas = document.createElement('canvas');
		canvas.width = Math.floor(viewport.width * ratio);
		canvas.height = Math.floor(viewport.height * ratio);
		canvas.style.width = `${viewport.width}px`;
		canvas.style.height = `${viewport.height}px`;
		const ctx = canvas.getContext('2d')!;
		await page.render({ canvasContext: ctx, canvas, viewport, transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined }).promise;
		if (rendered.get(n) !== at) return; // zoomed meanwhile
		const text = document.createElement('div');
		text.className = 'textLayer';
		const layer = new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: text, viewport });
		await layer.render();
		if (rendered.get(n) !== at) return;
		el.querySelector('canvas')?.remove();
		el.querySelector('.textLayer')?.remove();
		el.prepend(canvas);
		el.append(text);
	}

	function observePage(el: HTMLElement, n: number) {
		const io = new IntersectionObserver(
			(entries) => {
				for (const e of entries) {
					if (e.isIntersecting) void renderPage(n, el);
				}
			},
			{ root: scroller, rootMargin: '600px 0px' }
		);
		io.observe(el);
		const visible = new IntersectionObserver(
			(entries) => {
				for (const e of entries) if (e.isIntersecting && e.intersectionRatio > 0.4) currentPage = n;
			},
			{ root: scroller, threshold: [0.4] }
		);
		visible.observe(el);
		return {
			update(next: number) {
				n = next;
				void renderPage(n, el);
			},
			destroy() {
				io.disconnect();
				visible.disconnect();
			}
		};
	}

	// Re-render visible pages after a zoom.
	$effect(() => {
		void scale;
		if (!scroller) return;
		for (const el of scroller.querySelectorAll<HTMLElement>('.pdf-page')) {
			const r = el.getBoundingClientRect();
			if (r.bottom > -600 && r.top < window.innerHeight + 600) void renderPage(Number(el.dataset.page), el);
		}
	});

	function goToPage(n: number, highlight?: PdfHighlight) {
		const el = scroller?.querySelector<HTMLElement>(`.pdf-page[data-page="${n}"]`);
		if (!el || !scroller) return;
		const offset = highlight ? highlight.rects[0][1] * el.offsetHeight - 120 : -12;
		scroller.scrollTo({ top: el.offsetTop + offset });
		if (highlight) {
			const node = el.querySelector<HTMLElement>(`[data-highlight="${highlight.id}"]`);
			node?.classList.remove('flash');
			void node?.offsetWidth;
			node?.classList.add('flash');
		}
	}

	// ---- Selecting and highlighting -----------------------------------------

	function onPointerUp() {
		setTimeout(readSelection, 0);
	}

	function readSelection() {
		const sel = window.getSelection();
		if (!sel || sel.isCollapsed || !scroller) return (selection = null);
		const range = sel.getRangeAt(0);
		const pageEl = (range.commonAncestorContainer instanceof Element
			? range.commonAncestorContainer
			: range.commonAncestorContainer.parentElement
		)?.closest<HTMLElement>('.pdf-page');
		const text = sel.toString().replace(/\s+/g, ' ').trim();
		if (!pageEl || !text) return (selection = null);
		const box = pageEl.getBoundingClientRect();
		const rects = mergeRects(
			[...range.getClientRects()]
				.filter((r) => r.width > 1 && r.height > 1)
				.map((r) => [(r.left - box.left) / box.width, (r.top - box.top) / box.height, r.width / box.width, r.height / box.height] as [number, number, number, number])
				.filter(([x, y, w, h]) => x >= -0.01 && y >= -0.01 && x + w <= 1.01 && y + h <= 1.01)
		);
		if (rects.length === 0) return (selection = null);
		const last = range.getBoundingClientRect();
		selection = { page: Number(pageEl.dataset.page), rects, text, x: last.left + last.width / 2, y: last.bottom + 8 };
	}

	/** Join the per-span rectangles of each line into one. */
	function mergeRects(rects: [number, number, number, number][]): [number, number, number, number][] {
		const lines: [number, number, number, number][] = [];
		for (const r of rects.sort((a, b) => a[1] - b[1] || a[0] - b[0])) {
			const line = lines.find((l) => Math.abs(l[1] - r[1]) < r[3] * 0.5);
			if (line) {
				const x2 = Math.max(line[0] + line[2], r[0] + r[2]);
				const y2 = Math.max(line[1] + line[3], r[1] + r[3]);
				line[0] = Math.min(line[0], r[0]);
				line[1] = Math.min(line[1], r[1]);
				line[2] = x2 - line[0];
				line[3] = y2 - line[1];
			} else lines.push([...r]);
		}
		return lines.map((r) => r.map((v) => Math.round(v * 10000) / 10000) as [number, number, number, number]);
	}

	function highlight(color: Color) {
		if (!selection || !open) return;
		addPdfHighlight({ ref: open.ref, page: selection.page, rects: selection.rects, text: selection.text, color });
		window.getSelection()?.removeAllRanges();
		selection = null;
		showList = true;
	}

	function remove(h: PdfHighlight) {
		const removed = deletePdfHighlight(h.id);
		if (removed) pushUndo({ label: 'Deleted highlight', undo: () => restorePdfHighlight(removed) });
	}

	// ---- Quotes ----------------------------------------------------------------

	const escapeLinkText = (text: string) => text.replace(/([[\]\\])/g, '\\$1');

	function quote(h: PdfHighlight): string {
		const lines = [`> ${h.text}`, `> — [${escapeLinkText(open?.name ?? 'PDF')}, p. ${h.page}](${h.ref}#page=${h.page})`];
		if (h.comment.trim()) lines.push('', h.comment.trim());
		return lines.join('\n');
	}

	async function copy(text: string) {
		await navigator.clipboard?.writeText(text);
		showNotice('Copied as a quote');
	}

	function addToNote() {
		if (!open?.noteId) return;
		const note = getMemoryObject(open.noteId);
		if (!note) return;
		const block = [`## Highlights from ${open.name}`, ...highlights.map(quote)].join('\n\n');
		updateMemoryObject(note.id, { bodyMarkdown: `${note.bodyMarkdown.trimEnd()}\n\n${block}\n` });
		showNotice(`Added ${highlights.length} highlight${highlights.length === 1 ? '' : 's'} to “${note.title || 'Untitled'}”`);
	}

	async function download() {
		if (!open) return;
		const stored = await getBlob(open.ref);
		if (!stored) return;
		const url = URL.createObjectURL(stored.blob);
		const a = Object.assign(document.createElement('a'), { href: url, download: open.name });
		document.body.append(a);
		a.click();
		a.remove();
		setTimeout(() => URL.revokeObjectURL(url), 30_000);
	}

	function onKey(e: KeyboardEvent) {
		if (!open) return;
		if (e.key === 'Escape') {
			e.preventDefault();
			if (selection) {
				window.getSelection()?.removeAllRanges();
				selection = null;
			} else closePdf();
		} else if ((e.metaKey || e.ctrlKey) && (e.key === '=' || e.key === '+')) {
			e.preventDefault();
			zoom(0.2);
		} else if ((e.metaKey || e.ctrlKey) && e.key === '-') {
			e.preventDefault();
			zoom(-0.2);
		}
	}
</script>

<svelte:window onkeydown={onKey} />

{#if open}
	<div class="pdf-viewer" role="dialog" aria-modal="true" aria-label={open.name}>
		<header class="pdf-bar">
			<FileText class="h-4 w-4 shrink-0 text-[var(--color-text-faint)]" />
			<span class="pdf-name truncate" title={open.name}>{open.name}</span>
			{#if sizes.length}
				<span class="pdf-pages tabular-nums">{currentPage} / {sizes.length}</span>
			{/if}
			<span class="flex-1"></span>
			<button type="button" class="k-icon-btn" onclick={() => zoom(-0.2)} aria-label="Zoom out" title="Zoom out"><ZoomOut class="h-4 w-4" /></button>
			<button type="button" class="pdf-scale tabular-nums" onclick={() => { fitWidth(); rendered.clear(); }} title="Fit to width">{Math.round(scale * 100)}%</button>
			<button type="button" class="k-icon-btn" onclick={() => zoom(0.2)} aria-label="Zoom in" title="Zoom in"><ZoomIn class="h-4 w-4" /></button>
			<button type="button" class="k-icon-btn" onclick={() => open && openAttachment(open.ref, open.name)} aria-label="Open in a new tab" title="Open in a new tab"><ExternalLink class="h-4 w-4" /></button>
			<button type="button" class="k-icon-btn" onclick={download} aria-label="Download" title="Download"><Download class="h-4 w-4" /></button>
			<button type="button" class="k-icon-btn" class:is-on={showList} onclick={() => (showList = !showList)} aria-label="Highlights" title="Highlights" aria-pressed={showList}>
				<PanelRight class="h-4 w-4" />
			</button>
			<button type="button" class="k-icon-btn" onclick={closePdf} aria-label="Close" title="Close (Esc)"><X class="h-4 w-4" /></button>
		</header>

		<div class="pdf-body">
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div class="pdf-scroll" bind:this={scroller} onpointerup={onPointerUp} onscroll={() => (selection = null)}>
				{#if error}
					<p class="pdf-message">{error}</p>
				{:else if !pdf}
					<p class="pdf-message">Opening…</p>
				{:else}
					{#each sizes as size, i (i)}
						{@const n = i + 1}
						<div
							class="pdf-page"
							data-page={n}
							style="width: {size.width * scale}px; height: {size.height * scale}px; --scale-factor: {scale}; --total-scale-factor: {scale}; --user-unit: 1; --scale-round-x: 1px; --scale-round-y: 1px"
							use:observePage={n}
						>
							<div class="pdf-marks" aria-hidden="true">
								{#each highlights.filter((h) => h.page === n) as h (h.id)}
									<div class="pdf-mark-group" data-highlight={h.id}>
										{#each h.rects as r, j (j)}
											<div class="pdf-mark mark-{h.color}" style="left: {r[0] * 100}%; top: {r[1] * 100}%; width: {r[2] * 100}%; height: {r[3] * 100}%"></div>
										{/each}
									</div>
								{/each}
							</div>
						</div>
					{/each}
				{/if}
			</div>

			{#if showList}
				<aside class="pdf-list" aria-label="Highlights">
					<div class="pdf-list-head">
						<span>Highlights</span>
						<span class="tabular-nums text-[var(--color-text-faint)]">{highlights.length}</span>
					</div>
					{#if highlights.length === 0}
						<p class="pdf-list-empty">Select text in the PDF, then pick a colour to highlight it.</p>
					{:else}
						<div class="pdf-list-actions">
							<button type="button" class="k-btn k-btn-ghost" onclick={() => copy(highlights.map(quote).join('\n\n'))}><Copy class="h-3.5 w-3.5" />Copy all</button>
							{#if open.noteId && getMemoryObject(open.noteId)}
								<button type="button" class="k-btn k-btn-ghost" onclick={addToNote}><NotebookPen class="h-3.5 w-3.5" />Add to note</button>
							{/if}
						</div>
						<ul class="pdf-list-items">
							{#each highlights as h (h.id)}
								<li class="pdf-item bar-{h.color}">
									<button type="button" class="pdf-item-text" onclick={() => goToPage(h.page, h)}>
										<span class="pdf-item-page">p. {h.page}</span>
										{h.text}
									</button>
									<textarea
										class="pdf-item-comment"
										rows="1"
										placeholder="Add a comment"
										value={h.comment}
										onchange={(e) => updatePdfHighlight(h.id, { comment: e.currentTarget.value })}
										aria-label="Comment"
									></textarea>
									<div class="pdf-item-tools">
										{#each COLORS as c (c.id)}
											<button type="button" class="pdf-dot mark-{c.id}" class:is-on={h.color === c.id} onclick={() => updatePdfHighlight(h.id, { color: c.id })} aria-label={c.label} title={c.label}></button>
										{/each}
										<span class="flex-1"></span>
										<button type="button" class="k-icon-btn" onclick={() => copy(quote(h))} aria-label="Copy as quote" title="Copy as quote"><Copy class="h-3.5 w-3.5" /></button>
										<button type="button" class="k-icon-btn hover:!text-[var(--color-danger)]" onclick={() => remove(h)} aria-label="Delete highlight" title="Delete"><Trash2 class="h-3.5 w-3.5" /></button>
									</div>
								</li>
							{/each}
						</ul>
					{/if}
				</aside>
			{/if}
		</div>

		{#if selection}
			<div class="pdf-pick" style="left: {selection.x}px; top: {selection.y}px" role="toolbar" aria-label="Highlight">
				<Highlighter class="h-3.5 w-3.5 text-[var(--color-text-faint)]" />
				{#each COLORS as c (c.id)}
					<button type="button" class="pdf-dot mark-{c.id}" onpointerdown={(e) => e.preventDefault()} onclick={() => highlight(c.id)} aria-label="Highlight {c.label.toLowerCase()}" title={c.label}></button>
				{/each}
			</div>
		{/if}
	</div>
{/if}

<style>
	.pdf-viewer {
		position: fixed;
		inset: 0;
		z-index: 200;
		display: flex;
		flex-direction: column;
		background: var(--color-bg-secondary);
	}

	.pdf-bar {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.375rem 0.75rem;
		border-bottom: 1px solid var(--color-border);
		background: var(--color-bg);
		font-size: 0.8125rem;
	}

	.pdf-name {
		min-width: 0;
		font-weight: 500;
		color: var(--color-text);
	}

	.pdf-pages,
	.pdf-scale {
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}

	.pdf-scale {
		min-width: 3rem;
		padding: 0.25rem;
		border-radius: var(--radius-sm);
	}

	.pdf-scale:hover {
		background: var(--color-hover);
	}

	.is-on {
		color: var(--color-accent) !important;
	}

	.pdf-body {
		position: relative;
		display: flex;
		min-height: 0;
		flex: 1;
	}

	.pdf-scroll {
		flex: 1;
		overflow: auto;
		padding: 1.5rem;
	}

	.pdf-message {
		padding: 3rem 1rem;
		text-align: center;
		color: var(--color-text-muted);
	}

	.pdf-page {
		position: relative;
		margin: 0 auto 1.25rem;
		background: white;
		box-shadow: var(--shadow-md);
	}

	.pdf-page :global(canvas) {
		display: block;
	}

	.pdf-marks {
		position: absolute;
		inset: 0;
		pointer-events: none;
		z-index: 1;
	}

	.pdf-mark {
		position: absolute;
		border-radius: 2px;
		mix-blend-mode: multiply;
	}

	.mark-yellow {
		--dot: #f2c200;
		--mark: rgb(255 214 0 / 0.45);
	}
	.mark-green {
		--dot: #3fb36b;
		--mark: rgb(80 200 120 / 0.4);
	}
	.mark-blue {
		--dot: #3b8cf0;
		--mark: rgb(80 160 255 / 0.38);
	}
	.mark-pink {
		--dot: #ec5a96;
		--mark: rgb(255 110 170 / 0.38);
	}

	.pdf-mark {
		background: var(--mark);
	}

	:global(.pdf-mark-group.flash) .pdf-mark {
		animation: markFlash 1.2s ease-out;
	}

	@keyframes markFlash {
		0%,
		50% {
			box-shadow: 0 0 0 3px var(--mark);
		}
		100% {
			box-shadow: none;
		}
	}

	/* pdf.js text layer: invisible text over the canvas, for selecting */
	.pdf-page :global(.textLayer) {
		position: absolute;
		inset: 0;
		z-index: 2;
		overflow: clip;
		line-height: 1;
		text-align: initial;
		text-size-adjust: none;
		forced-color-adjust: none;
		transform-origin: 0 0;
		--min-font-size: 1;
		--text-scale-factor: calc(var(--total-scale-factor) * var(--min-font-size));
		--min-font-size-inv: calc(1 / var(--min-font-size));
	}

	.pdf-page :global(.textLayer :is(span, br)) {
		position: absolute;
		color: transparent;
		white-space: pre;
		cursor: text;
		transform-origin: 0% 0%;
	}

	.pdf-page :global(.textLayer > :not(.markedContent)),
	.pdf-page :global(.textLayer .markedContent span:not(.markedContent)) {
		z-index: 1;
		--font-height: 0;
		font-size: calc(var(--text-scale-factor) * var(--font-height));
		--scale-x: 1;
		--rotate: 0deg;
		transform: rotate(var(--rotate)) scaleX(var(--scale-x)) scale(var(--min-font-size-inv));
	}

	.pdf-page :global(.textLayer .markedContent) {
		display: contents;
	}

	.pdf-page :global(.textLayer ::selection) {
		background: rgb(0 90 255 / 0.25);
	}

	.pdf-page :global(.textLayer br::selection) {
		background: transparent;
	}

	.pdf-page :global(.textLayer .endOfContent) {
		position: absolute;
		inset: 100% 0 0;
		z-index: 0;
		display: block;
		cursor: default;
		user-select: none;
	}

	.pdf-page :global(.textLayer.selecting .endOfContent) {
		top: 0;
	}

	/* Highlights list */
	.pdf-list {
		display: flex;
		width: 20rem;
		flex-direction: column;
		border-left: 1px solid var(--color-border);
		background: var(--color-bg);
		overflow-y: auto;
	}

	.pdf-list-head {
		display: flex;
		justify-content: space-between;
		padding: 0.75rem 1rem 0.5rem;
		font-size: 0.8125rem;
		font-weight: 600;
	}

	.pdf-list-empty {
		padding: 0 1rem;
		font-size: 0.8125rem;
		color: var(--color-text-muted);
	}

	.pdf-list-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
		padding: 0 0.75rem 0.5rem;
	}

	.pdf-list-items {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0 0.75rem 1rem;
	}

	.pdf-item {
		padding: 0.5rem 0.625rem;
		border: 1px solid var(--color-border);
		border-left: 3px solid var(--bar);
		border-radius: var(--radius-md);
		font-size: 0.8125rem;
	}

	.bar-yellow {
		--bar: rgb(230 190 0);
	}
	.bar-green {
		--bar: rgb(60 170 100);
	}
	.bar-blue {
		--bar: rgb(60 140 240);
	}
	.bar-pink {
		--bar: rgb(235 90 150);
	}

	.pdf-item-text {
		display: block;
		width: 100%;
		text-align: left;
		line-height: 1.45;
		color: var(--color-text);
	}

	.pdf-item-page {
		margin-right: 0.25rem;
		font-size: 0.6875rem;
		color: var(--color-text-faint);
	}

	.pdf-item-comment {
		width: 100%;
		margin-top: 0.375rem;
		padding: 0.25rem 0.375rem;
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
		background: var(--color-bg-secondary);
		font: inherit;
		font-size: 0.75rem;
		color: var(--color-text);
		resize: vertical;
	}

	.pdf-item-comment:focus {
		border-color: var(--color-accent);
		outline: none;
	}

	.pdf-item-tools {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		margin-top: 0.25rem;
	}

	.pdf-dot {
		width: 1rem;
		height: 1rem;
		border-radius: 999px;
		background: var(--dot);
		border: 2px solid transparent;
	}

	.pdf-dot.is-on {
		border-color: var(--color-text-muted);
	}

	.pdf-pick {
		position: fixed;
		z-index: 210;
		display: flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.375rem 0.5rem;
		border: 1px solid var(--color-border);
		border-radius: 999px;
		background: var(--color-bg);
		box-shadow: var(--shadow-lg);
		transform: translateX(-50%);
	}

	.pdf-pick .pdf-dot {
		width: 1.25rem;
		height: 1.25rem;
	}

	@media (max-width: 720px) {
		.pdf-list {
			position: absolute;
			right: 0;
			bottom: 0;
			left: 0;
			width: auto;
			max-height: 45%;
			border-left: none;
			border-top: 1px solid var(--color-border);
			box-shadow: var(--shadow-lg);
		}

		.pdf-scroll {
			padding: 0.75rem;
		}
	}
</style>
