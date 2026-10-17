<script lang="ts">
	import Graph from '$lib/components/Graph.svelte';
	import { memoryObjects, extractWikilinks, type MemoryObject } from '$lib/db';
	import { Link2 } from 'lucide-svelte';

	// Store subscription for Svelte 5 runes mode
	let memoriesData = $state<MemoryObject[]>([]);

	$effect(() => {
		const unsub = memoryObjects.subscribe((m) => {
			memoriesData = m;
		});
		return unsub;
	});

	// Count total links across all memories
	let linkCount = $derived.by(() => {
		const memoryMap = new Map(memoriesData.map((m) => [m.title.toLowerCase(), m.id]));
		let count = 0;
		for (const memory of memoriesData) {
			const wikilinks = extractWikilinks(memory.bodyMarkdown);
			for (const link of wikilinks) {
				if (memoryMap.has(link.toLowerCase())) {
					count++;
				}
			}
		}
		return count;
	});
</script>

<svelte:head>
	<title>Graph - Kurumi</title>
</svelte:head>

<div class="relative h-full bg-[var(--color-bg)]">
	{#if memoriesData.length === 0}
		<div class="k-empty h-full justify-center">
			<Link2 />
			<p class="k-empty-title">No notes yet</p>
			<p>Create notes and link them with [[wikilinks]] to see how they connect.</p>
		</div>
	{:else}
		<Graph />

		<!-- Floating title + stats (doesn't block canvas interaction) -->
		<div class="pointer-events-none absolute top-3 left-4 z-10 md:left-5">
			<h1 class="text-sm font-semibold text-[var(--color-text)]">Graph</h1>
			<p class="text-xs tabular-nums text-[var(--color-text-faint)]">
				{memoriesData.length} {memoriesData.length === 1 ? 'note' : 'notes'} · {linkCount} {linkCount === 1 ? 'link' : 'links'}
			</p>
		</div>

		<div class="k-hints pointer-events-none absolute bottom-3 left-4 z-10 !mt-0 md:left-5">
			<span>Click a node to preview</span>
			<span><kbd class="k-kbd">/</kbd> search</span>
			<span>Scroll to zoom · drag to pan</span>
		</div>
	{/if}
</div>
