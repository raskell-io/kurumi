<script lang="ts">
	import { getAllTags } from '$lib/db';

	interface Props {
		position: { x: number; y: number };
		initialQuery: string;
		onSelect: (tag: string) => void;
		onClose: () => void;
	}

	let { position, initialQuery, onSelect, onClose }: Props = $props();

	let query = $state(initialQuery || '');
	let selectedIndex = $state(0);
	let inputRef: HTMLInputElement;

	// Get all existing tags
	let allTags = $derived(getAllTags());

	// Filter tags based on query
	let filteredTags = $derived.by(() => {
		const q = query.toLowerCase().trim();
		if (!q) {
			return allTags.slice(0, 10);
		}
		return allTags
			.filter((t) => t.tag.toLowerCase().includes(q))
			.slice(0, 10);
	});

	// Check if query is a new tag
	let isNewTag = $derived.by(() => {
		const q = query.toLowerCase().trim();
		if (!q) return false;
		return !allTags.some((t) => t.tag.toLowerCase() === q);
	});

	$effect(() => {
		selectedIndex = 0;
	});

	$effect(() => {
		inputRef?.focus();
	});

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			onClose();
		} else if (e.key === 'ArrowDown') {
			e.preventDefault();
			const maxIndex = filteredTags.length + (isNewTag ? 0 : -1);
			selectedIndex = Math.min(selectedIndex + 1, maxIndex);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			selectedIndex = Math.max(selectedIndex - 1, 0);
		} else if (e.key === 'Enter' || e.key === 'Tab') {
			e.preventDefault();
			if (filteredTags.length > 0 && selectedIndex < filteredTags.length) {
				onSelect(filteredTags[selectedIndex].tag);
			} else if (query.trim()) {
				onSelect(query.trim().toLowerCase().replace(/\s+/g, '-'));
			}
		}
	}

	function formatTag(tag: string): string {
		return tag.toLowerCase().replace(/\s+/g, '-');
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="tag-autocomplete"
	style="left: {position.x}px; top: {position.y}px;"
	onkeydown={handleKeydown}
>
	<div class="search-input">
		<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-[var(--color-text-muted)]" viewBox="0 0 20 20" fill="currentColor">
			<path fill-rule="evenodd" d="M17.707 9.293a1 1 0 010 1.414l-7 7a1 1 0 01-1.414 0l-7-7A.997.997 0 012 10V5a3 3 0 013-3h5c.256 0 .512.098.707.293l7 7zM5 6a1 1 0 100-2 1 1 0 000 2z" clip-rule="evenodd" />
		</svg>
		<input
			bind:this={inputRef}
			bind:value={query}
			type="text"
			placeholder="Search or create tag..."
			class="flex-1 bg-transparent text-sm text-[var(--color-text)] placeholder-[var(--color-text-muted)] outline-none"
			onkeydown={handleKeydown}
		/>
		<kbd class="text-xs text-[var(--color-text-muted)] bg-[var(--color-bg-secondary)] px-1.5 py-0.5 rounded">ESC</kbd>
	</div>

	<div class="results">
		{#if filteredTags.length === 0 && !query.trim()}
			<div class="empty">
				<span>No tags yet. Type to create one.</span>
			</div>
		{:else if filteredTags.length === 0 && query.trim()}
			<button
				class="result-item selected"
				onclick={() => onSelect(formatTag(query.trim()))}
			>
				<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="currentColor">
					<path fill-rule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clip-rule="evenodd" />
				</svg>
				<span class="tag-name">Create #{formatTag(query.trim())}</span>
			</button>
		{:else}
			{#each filteredTags as tag, i (tag.tag)}
				<button
					class="result-item"
					class:selected={i === selectedIndex}
					onclick={() => onSelect(tag.tag)}
					onmouseenter={() => selectedIndex = i}
				>
					<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0 text-amber-500" viewBox="0 0 20 20" fill="currentColor">
						<path fill-rule="evenodd" d="M17.707 9.293a1 1 0 010 1.414l-7 7a1 1 0 01-1.414 0l-7-7A.997.997 0 012 10V5a3 3 0 013-3h5c.256 0 .512.098.707.293l7 7zM5 6a1 1 0 100-2 1 1 0 000 2z" clip-rule="evenodd" />
					</svg>
					<span class="tag-name">#{tag.tag}</span>
					<span class="tag-count">{tag.count}</span>
				</button>
			{/each}
			{#if isNewTag && query.trim()}
				<button
					class="result-item"
					class:selected={selectedIndex === filteredTags.length}
					onclick={() => onSelect(formatTag(query.trim()))}
					onmouseenter={() => selectedIndex = filteredTags.length}
				>
					<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0 text-[var(--color-accent)]" viewBox="0 0 20 20" fill="currentColor">
						<path fill-rule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clip-rule="evenodd" />
					</svg>
					<span class="tag-name">Create #{formatTag(query.trim())}</span>
					<span class="new-badge">New</span>
				</button>
			{/if}
		{/if}
	</div>

	<div class="footer">
		<span><kbd>↑↓</kbd> navigate</span>
		<span><kbd>Enter</kbd> select</span>
	</div>
</div>

<style>
	.tag-autocomplete {
		position: fixed;
		z-index: 1000;
		width: 280px;
		max-height: 360px;
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 0.5rem;
		box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
		display: flex;
		flex-direction: column;
		overflow: hidden;
		animation: fadeIn 0.15s ease-out;
	}

	@keyframes fadeIn {
		from {
			opacity: 0;
			transform: translateY(4px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	.search-input {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.75rem;
		border-bottom: 1px solid var(--color-border);
	}

	.results {
		flex: 1;
		overflow-y: auto;
		max-height: 240px;
	}

	.empty {
		padding: 1rem;
		text-align: center;
		color: var(--color-text-muted);
		font-size: 0.875rem;
	}

	.result-item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		padding: 0.5rem 0.75rem;
		text-align: left;
		background: transparent;
		border: none;
		cursor: pointer;
		transition: background 0.1s;
	}

	.result-item:hover,
	.result-item.selected {
		background: var(--color-bg-secondary);
	}

	.tag-name {
		flex: 1;
		font-size: 0.875rem;
		color: var(--color-text);
	}

	.tag-count {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		background: var(--color-bg-secondary);
		padding: 0.125rem 0.375rem;
		border-radius: 0.25rem;
	}

	.new-badge {
		font-size: 0.625rem;
		font-weight: 600;
		color: var(--color-accent);
		background: color-mix(in srgb, var(--color-accent) 15%, transparent);
		padding: 0.125rem 0.375rem;
		border-radius: 0.25rem;
		text-transform: uppercase;
	}

	.footer {
		display: flex;
		gap: 1rem;
		padding: 0.5rem 0.75rem;
		border-top: 1px solid var(--color-border);
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}

	.footer kbd {
		background: var(--color-bg-secondary);
		padding: 0.125rem 0.25rem;
		border-radius: 0.25rem;
		font-family: inherit;
	}
</style>
