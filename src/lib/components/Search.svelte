<script lang="ts">
	import { search, type SearchResult } from '$lib/search';
	import { goto } from '$app/navigation';
	import { Search } from 'lucide-svelte';

	interface Props {
		onClose: () => void;
	}

	let { onClose }: Props = $props();

	let query = $state('');
	let results = $state<SearchResult[]>([]);
	let selectedIndex = $state(0);
	let inputRef: HTMLInputElement;
	let listRef = $state<HTMLUListElement | null>(null);

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
		goto(`/memory/${result.id}`);
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

	// Keep the keyboard-selected result in view
	$effect(() => {
		const el = listRef?.children[selectedIndex] as HTMLElement | undefined;
		el?.scrollIntoView({ block: 'nearest' });
	});

	$effect(() => {
		// Focus input on mount
		inputRef?.focus();
	});
</script>

<div
	class="k-dialog-backdrop"
	onclick={onClose}
	onkeydown={handleKeydown}
	role="dialog"
	aria-modal="true"
	aria-label="Search notes"
	tabindex="-1"
>
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div
		class="k-dialog flex !max-w-xl flex-col !overflow-hidden"
		onclick={(e) => e.stopPropagation()}
		onkeydown={(e) => e.stopPropagation()}
		role="search"
	>
		<!-- Search input -->
		<div class="flex items-center gap-3 border-b border-[var(--color-border)] px-4">
			<Search class="h-4 w-4 shrink-0 text-[var(--color-text-faint)]" />
			<input
				bind:this={inputRef}
				bind:value={query}
				type="text"
				placeholder="Search notes…"
				aria-label="Search notes"
				class="search-input h-12 flex-1 bg-transparent text-[0.9375rem] text-[var(--color-text)] placeholder-[var(--color-text-faint)]"
				onkeydown={handleKeydown}
			/>
			<span class="k-kbd hidden md:inline-flex">esc</span>
		</div>

		<!-- Results -->
		<div class="max-h-[60vh] overflow-y-auto overscroll-contain">
			{#if query.trim() && results.length === 0}
				<div class="px-4 py-10 text-center text-sm text-[var(--color-text-muted)]">
					No notes found for “{query}”
				</div>
			{:else if results.length > 0}
				<ul class="p-1.5" bind:this={listRef}>
					{#each results as result, i}
						<li>
							<button
								type="button"
								onclick={() => navigateToResult(result)}
								onmousemove={() => { if (selectedIndex !== i) selectedIndex = i; }}
								class="w-full rounded-[var(--radius-md)] px-2.5 py-2 text-left"
								class:bg-[var(--color-hover)]={i === selectedIndex}
							>
								<div class="truncate text-sm font-medium text-[var(--color-text)]">
									{result.title}
								</div>
								<div class="mt-0.5 truncate text-xs text-[var(--color-text-faint)]">
									{highlightMatch(result.content)}
								</div>
							</button>
						</li>
					{/each}
				</ul>
			{:else}
				<div class="px-4 py-10 text-center text-sm text-[var(--color-text-muted)]">
					Type to search your notes
				</div>
			{/if}
		</div>

		<!-- Footer -->
		<div
			class="flex items-center justify-between border-t border-[var(--color-border)] px-4 py-2 text-xs text-[var(--color-text-faint)]"
		>
			<div class="flex items-center gap-4">
				<span class="hidden items-center gap-1.5 md:flex"><span class="k-kbd">↑</span><span class="k-kbd">↓</span> navigate</span>
				<span class="hidden items-center gap-1.5 md:flex"><span class="k-kbd">↵</span> open</span>
			</div>
			<span>{results.length} {results.length === 1 ? 'result' : 'results'}</span>
		</div>
	</div>
</div>

<style>
	.search-input,
	.search-input:focus,
	.search-input:focus-visible {
		border: none;
		outline: none;
		box-shadow: none;
	}
</style>
