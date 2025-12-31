<script lang="ts">
	import Graph from '$lib/components/Graph.svelte';
	import { notes, extractWikilinks } from '$lib/db';
	import { Link2 } from 'lucide-svelte';

	// Count total links across all notes
	let linkCount = $derived.by(() => {
		const noteMap = new Map($notes.map(n => [n.title.toLowerCase(), n.id]));
		let count = 0;
		for (const note of $notes) {
			const wikilinks = extractWikilinks(note.content);
			for (const link of wikilinks) {
				if (noteMap.has(link.toLowerCase())) {
					count++;
				}
			}
		}
		return count;
	});
</script>

<div class="flex h-full flex-col">
	<!-- Header -->
	<header
		class="flex items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-4 py-3 md:px-6"
	>
		<h1 class="text-lg font-semibold text-[var(--color-text)]">Knowledge Graph</h1>
		<span class="text-sm text-[var(--color-text-muted)]">
			{$notes.length} {$notes.length === 1 ? 'note' : 'notes'} · {linkCount} {linkCount === 1 ? 'link' : 'links'}
		</span>
	</header>

	<!-- Graph -->
	<div class="relative flex-1 bg-[var(--color-bg)]">
		{#if $notes.length === 0}
			<div class="flex h-full items-center justify-center">
				<div class="text-center">
					<Link2 class="mx-auto mb-4 h-16 w-16 text-[var(--color-text-muted)]" />
					<p class="text-lg text-[var(--color-text-muted)]">No notes yet</p>
					<p class="mt-2 text-sm text-[var(--color-text-muted)]">
						Create notes and link them with [[wikilinks]]
					</p>
				</div>
			</div>
		{:else}
			<Graph />
			<div
				class="absolute bottom-4 left-4 rounded-lg bg-[var(--color-bg-secondary)] px-3 py-2 text-xs text-[var(--color-text-muted)] shadow-lg"
			>
				Click a node to open the note
			</div>
		{/if}
	</div>
</div>
