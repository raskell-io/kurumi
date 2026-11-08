<script lang="ts">
	import { memoryObjects, pdfHighlights, addMemoryObject, todayIso } from '$lib/db';
	import { collectHighlights, highlightsToMarkdown, type Highlight, type HighlightGroup } from '$lib/highlights';
	import { openPdf } from '$lib/stores/pdfViewer';
	import ReadNav from '$lib/components/ReadNav.svelte';
	import { goto } from '$app/navigation';
	import { Highlighter, Search, Shuffle, Eye, EyeOff, FilePlus, FileText, X } from 'lucide-svelte';

	let query = $state('');
	let tag = $state<string | null>(null);
	let quiz = $state(false);
	let shuffled = $state(false);
	let shuffleSeed = $state(0);
	// Highlights revealed in quiz mode, by key.
	let revealed = $state<Set<string>>(new Set());

	let groups = $derived(collectHighlights($memoryObjects, $pdfHighlights));
	let tags = $derived([...new Set(groups.flatMap((g) => g.tags))].sort((a, b) => a.localeCompare(b)));

	function matches(group: HighlightGroup, h: Highlight, q: string): boolean {
		if (!q) return true;
		const haystack = [group.title, h.text, h.kind === 'note' ? h.context : h.comment, h.kind === 'note' ? (h.heading ?? '') : h.file].join(' ').toLowerCase();
		return q.split(/\s+/).every((word) => haystack.includes(word));
	}

	// A seeded shuffle, so the order holds while you work through it.
	function shuffle<T>(items: T[], seed: number): T[] {
		const out = [...items];
		let s = seed || 1;
		for (let i = out.length - 1; i > 0; i--) {
			s = (s * 16807) % 2147483647;
			const j = s % (i + 1);
			[out[i], out[j]] = [out[j], out[i]];
		}
		return out;
	}

	let shown = $derived.by(() => {
		const q = query.trim().toLowerCase();
		const filtered = groups
			.filter((g) => !tag || g.tags.includes(tag))
			.map((g) => ({ ...g, highlights: g.highlights.filter((h) => matches(g, h, q)) }))
			.filter((g) => g.highlights.length > 0);
		return shuffled ? shuffle(filtered, shuffleSeed) : filtered;
	});
	let passageCount = $derived(shown.reduce((n, g) => n + g.highlights.length, 0));

	const keyOf = (group: HighlightGroup, h: Highlight, i: number) => `${group.noteId}:${i}:${h.text}`;

	function toggleReveal(key: string) {
		const next = new Set(revealed);
		if (next.has(key)) next.delete(key);
		else next.add(key);
		revealed = next;
	}

	function reshuffle() {
		shuffled = true;
		shuffleSeed = Math.floor(Math.random() * 2147483646) + 1;
		revealed = new Set();
	}

	// The context with the highlight cut out, for quiz mode.
	function cloze(context: string, text: string): [string, string] {
		const at = context.indexOf(text);
		return at < 0 ? ['', ''] : [context.slice(0, at), context.slice(at + text.length)];
	}

	function saveAsNote() {
		const title = `Highlights — ${todayIso()}${tag ? ` #${tag}` : ''}`;
		const note = addMemoryObject(title, highlightsToMarkdown(shown), null);
		goto(`/memory/${note.id}`);
	}

	let breadcrumbs = [{ label: 'Highlights', href: '/read/highlights' }];
</script>

<svelte:head>
	<title>Highlights - Kurumi</title>
</svelte:head>

<ReadNav {breadcrumbs} />

<div class="k-page">
	<header class="k-page-header">
		<div class="min-w-0">
			<p class="eyebrow"><Highlighter class="h-3.5 w-3.5" /> Study</p>
			<h1 class="k-page-title">Highlights</h1>
			<p class="k-page-subtitle">
				{passageCount} passage{passageCount === 1 ? '' : 's'} from {shown.length} note{shown.length === 1 ? '' : 's'}
			</p>
		</div>
		{#if groups.length > 0}
			<button type="button" class="k-btn k-btn-sm" onclick={saveAsNote} disabled={passageCount === 0}>
				<FilePlus class="h-3.5 w-3.5" /> Save as note
			</button>
		{/if}
	</header>

	{#if groups.length > 0}
		<div class="toolbar">
			<label class="search">
				<Search class="h-3.5 w-3.5 shrink-0 text-[var(--color-text-faint)]" />
				<input type="search" placeholder="Filter highlights" bind:value={query} aria-label="Filter highlights" />
			</label>
			<button type="button" class="k-btn k-btn-sm" class:is-on={quiz} aria-pressed={quiz} onclick={() => { quiz = !quiz; revealed = new Set(); }} title="Hide each highlight in its sentence until you click it">
				{#if quiz}<EyeOff class="h-3.5 w-3.5" />{:else}<Eye class="h-3.5 w-3.5" />{/if} Quiz
			</button>
			<button type="button" class="k-btn k-btn-sm" class:is-on={shuffled} onclick={reshuffle} title="Shuffle the notes">
				<Shuffle class="h-3.5 w-3.5" /> Shuffle
			</button>
			{#if shuffled}
				<button type="button" class="k-btn k-btn-sm k-btn-ghost" onclick={() => (shuffled = false)}>Newest first</button>
			{/if}
		</div>
		{#if tags.length > 0}
			<div class="tags" role="group" aria-label="Filter by tag">
				{#each tags as t (t)}
					<button type="button" class="k-chip" class:is-on={tag === t} aria-pressed={tag === t} onclick={() => (tag = tag === t ? null : t)}>#{t}</button>
				{/each}
				{#if tag}
					<button type="button" class="k-btn k-btn-sm k-btn-ghost" onclick={() => (tag = null)}><X class="h-3 w-3" /> Clear</button>
				{/if}
			</div>
		{/if}

		<div class="groups">
			{#each shown as group (group.noteId)}
				<section class="group">
					<h2 class="group-title">
						<a href="/read/{group.noteId}"><FileText class="h-3.5 w-3.5 shrink-0" /> {group.title}</a>
					</h2>
					{#each group.highlights as h, i (keyOf(group, h, i))}
						{@const key = keyOf(group, h, i)}
						<blockquote class="passage" class:pdf={h.kind === 'pdf'}>
							{#if h.kind === 'note'}
								{#if quiz && !revealed.has(key)}
									{@const [before, after] = cloze(h.context, h.text)}
									<button type="button" class="cloze" onclick={() => toggleReveal(key)} title="Show the highlight">
										{#if before || after}
											{before}<span class="blank" aria-label="Hidden highlight">{' '.repeat(Math.min(24, h.text.length))}</span>{after}
										{:else}
											<span class="blank" aria-label="Hidden highlight">{' '.repeat(Math.min(24, h.text.length))}</span>
										{/if}
									</button>
								{:else}
									<p class="text"><mark>{h.text}</mark></p>
									{#if h.context && h.context !== h.text}
										<p class="context">{h.context}</p>
									{/if}
								{/if}
								{#if h.heading}<p class="where">{h.heading}</p>{/if}
							{:else}
								{#if quiz && !revealed.has(key)}
									<button type="button" class="cloze" onclick={() => toggleReveal(key)} title="Show the highlight">
										<span class="blank" aria-label="Hidden highlight">{' '.repeat(Math.min(24, h.text.length))}</span>
									</button>
								{:else}
									<p class="text"><mark class="pdf-{h.color}">{h.text}</mark></p>
								{/if}
								{#if h.comment}<p class="context">{h.comment}</p>{/if}
								<button type="button" class="where where-link" onclick={() => openPdf(h.ref, h.file, h.page, group.noteId)}>
									{h.file}, p. {h.page}
								</button>
							{/if}
						</blockquote>
					{/each}
				</section>
			{:else}
				<div class="k-empty">
					<Search />
					<p class="k-empty-title">No highlights match</p>
					<button type="button" class="k-btn mt-2" onclick={() => { query = ''; tag = null; }}>Show all</button>
				</div>
			{/each}
		</div>
	{:else}
		<div class="k-empty">
			<Highlighter />
			<p class="k-empty-title">No highlights yet</p>
			<p>Wrap words in a note in <code>==double equals==</code> (or select them and pick Highlight), or highlight text in a PDF. They all gather here to review.</p>
		</div>
	{/if}
</div>

<style>
	.eyebrow {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		margin-bottom: 0.375rem;
		font-size: 0.75rem;
		font-weight: 500;
		color: var(--color-text-faint);
	}

	.toolbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 0.75rem;
	}

	.search {
		display: flex;
		flex: 1 1 12rem;
		align-items: center;
		gap: 0.5rem;
		padding: 0.375rem 0.625rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-bg);
	}

	.search input {
		flex: 1;
		min-width: 0;
		border: none;
		background: none;
		outline: none;
		font-size: 0.875rem;
		color: var(--color-text);
	}

	.is-on {
		border-color: color-mix(in srgb, var(--color-accent) 50%, var(--color-border));
		color: var(--color-accent);
	}

	.tags {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
		margin-bottom: 1rem;
	}

	.groups {
		display: flex;
		flex-direction: column;
		gap: 1.75rem;
		margin-top: 0.5rem;
	}

	.group-title {
		margin-bottom: 0.5rem;
		font-size: 0.8125rem;
		font-weight: 600;
	}

	.group-title a {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		color: var(--color-text-muted);
	}

	.group-title a:hover {
		color: var(--color-accent);
	}

	.passage {
		margin: 0 0 0.75rem;
		padding: 0.125rem 0 0.125rem 1rem;
		border-left: 3px solid color-mix(in srgb, var(--color-accent) 45%, transparent);
	}

	.passage .text {
		font-size: 1.0625rem;
		line-height: 1.6;
		color: var(--color-text);
	}

	.passage mark {
		padding: 0 0.15em;
		border-radius: 3px;
		background: color-mix(in srgb, #df8e1d 28%, transparent);
		color: inherit;
	}

	.passage mark.pdf-green { background: color-mix(in srgb, #40a02b 28%, transparent); }
	.passage mark.pdf-blue { background: color-mix(in srgb, #1e66f5 24%, transparent); }
	.passage mark.pdf-pink { background: color-mix(in srgb, #ea76cb 28%, transparent); }

	.passage .context {
		margin-top: 0.25rem;
		font-size: 0.875rem;
		line-height: 1.55;
		color: var(--color-text-muted);
	}

	.where {
		margin-top: 0.25rem;
		font-size: 0.75rem;
		color: var(--color-text-faint);
	}

	.where-link:hover {
		color: var(--color-accent);
		text-decoration: underline;
	}

	.cloze {
		display: block;
		width: 100%;
		text-align: left;
		font-size: 1.0625rem;
		line-height: 1.6;
		color: var(--color-text);
		cursor: pointer;
	}

	.blank {
		display: inline-block;
		min-width: 3em;
		border-bottom: 2px dashed var(--color-accent);
		background: color-mix(in srgb, var(--color-accent) 10%, transparent);
	}
</style>
