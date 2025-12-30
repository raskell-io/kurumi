<script lang="ts">
	import Graph from '$lib/components/Graph.svelte';
	import { notes } from '$lib/db';
</script>

<div class="flex h-full flex-col">
	<!-- Header -->
	<header
		class="flex items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-4 py-3 md:px-6"
	>
		<h1 class="text-lg font-semibold text-[var(--color-text)]">Knowledge Graph</h1>
		<span class="text-sm text-[var(--color-text-muted)]">
			{$notes.length} {$notes.length === 1 ? 'note' : 'notes'}
		</span>
	</header>

	<!-- Graph -->
	<div class="relative flex-1 bg-[var(--color-bg)]">
		{#if $notes.length === 0}
			<div class="flex h-full items-center justify-center">
				<div class="text-center">
					<svg
						xmlns="http://www.w3.org/2000/svg"
						class="mx-auto mb-4 h-16 w-16 text-[var(--color-text-muted)]"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="1.5"
							d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
						/>
					</svg>
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
