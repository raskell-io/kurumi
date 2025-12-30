<script lang="ts">
	import { search, type SearchResult } from '$lib/search';
	import { goto } from '$app/navigation';

	interface Props {
		onClose: () => void;
	}

	let { onClose }: Props = $props();

	let query = $state('');
	let results = $state<SearchResult[]>([]);
	let selectedIndex = $state(0);
	let inputRef: HTMLInputElement;

	$effect(() => {
		results = search(query);
		selectedIndex = 0;
	});

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			onClose();
		} else if (e.key === 'ArrowDown') {
			e.preventDefault();
			selectedIndex = Math.min(selectedIndex + 1, results.length - 1);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			selectedIndex = Math.max(selectedIndex - 1, 0);
		} else if (e.key === 'Enter' && results.length > 0) {
			e.preventDefault();
			navigateToResult(results[selectedIndex]);
		}
	}

	function navigateToResult(result: SearchResult) {
		goto(`/note/${result.id}`);
		onClose();
	}

	function highlightMatch(text: string, maxLength: number = 100): string {
		if (!query.trim()) return text.slice(0, maxLength);

		const lowerText = text.toLowerCase();
		const lowerQuery = query.toLowerCase();
		const index = lowerText.indexOf(lowerQuery);

		if (index === -1) return text.slice(0, maxLength);

		// Show context around the match
		const start = Math.max(0, index - 30);
		const end = Math.min(text.length, index + query.length + 50);
		let excerpt = text.slice(start, end);

		if (start > 0) excerpt = '...' + excerpt;
		if (end < text.length) excerpt = excerpt + '...';

		return excerpt;
	}

	$effect(() => {
		// Focus input on mount
		inputRef?.focus();
	});
</script>

<div
	class="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-[15vh]"
	onclick={onClose}
	onkeydown={handleKeydown}
	role="dialog"
	aria-modal="true"
	tabindex="-1"
>
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div
		class="w-full max-w-xl overflow-hidden rounded-xl bg-[var(--color-bg)] shadow-2xl"
		onclick={(e) => e.stopPropagation()}
		onkeydown={(e) => e.stopPropagation()}
		role="search"
	>
		<!-- Search input -->
		<div class="flex items-center gap-3 border-b border-[var(--color-border)] px-4 py-3">
			<svg
				xmlns="http://www.w3.org/2000/svg"
				class="h-5 w-5 text-[var(--color-text-muted)]"
				viewBox="0 0 20 20"
				fill="currentColor"
			>
				<path
					fill-rule="evenodd"
					d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z"
					clip-rule="evenodd"
				/>
			</svg>
			<input
				bind:this={inputRef}
				bind:value={query}
				type="text"
				placeholder="Search notes..."
				class="flex-1 bg-transparent text-[var(--color-text)] placeholder-[var(--color-text-muted)] outline-none"
				onkeydown={handleKeydown}
			/>
			<kbd
				class="hidden rounded bg-[var(--color-bg-secondary)] px-2 py-1 text-xs text-[var(--color-text-muted)] md:inline"
			>
				ESC
			</kbd>
		</div>

		<!-- Results -->
		<div class="max-h-[60vh] overflow-y-auto">
			{#if query.trim() && results.length === 0}
				<div class="px-4 py-8 text-center text-[var(--color-text-muted)]">
					No notes found for "{query}"
				</div>
			{:else if results.length > 0}
				<ul class="py-2">
					{#each results as result, i}
						<li>
							<button
								onclick={() => navigateToResult(result)}
								class="w-full px-4 py-3 text-left transition-colors hover:bg-[var(--color-bg-secondary)]"
								class:bg-[var(--color-bg-secondary)]={i === selectedIndex}
							>
								<div class="font-medium text-[var(--color-text)]">
									{result.title}
								</div>
								<div class="mt-1 truncate text-sm text-[var(--color-text-muted)]">
									{highlightMatch(result.content)}
								</div>
							</button>
						</li>
					{/each}
				</ul>
			{:else}
				<div class="px-4 py-8 text-center text-[var(--color-text-muted)]">
					Type to search your notes
				</div>
			{/if}
		</div>

		<!-- Footer -->
		<div
			class="flex items-center justify-between border-t border-[var(--color-border)] px-4 py-2 text-xs text-[var(--color-text-muted)]"
		>
			<div class="flex items-center gap-4">
				<span class="hidden items-center gap-1 md:flex">
					<kbd class="rounded bg-[var(--color-bg-secondary)] px-1.5 py-0.5">↑</kbd>
					<kbd class="rounded bg-[var(--color-bg-secondary)] px-1.5 py-0.5">↓</kbd>
					to navigate
				</span>
				<span class="hidden items-center gap-1 md:flex">
					<kbd class="rounded bg-[var(--color-bg-secondary)] px-1.5 py-0.5">↵</kbd>
					to open
				</span>
			</div>
			<span>{results.length} {results.length === 1 ? 'result' : 'results'}</span>
		</div>
	</div>
</div>
