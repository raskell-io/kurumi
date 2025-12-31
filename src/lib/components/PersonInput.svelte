<script lang="ts">
	import { getAllPeople } from '$lib/db';

	interface Props {
		position: { x: number; y: number };
		initialQuery: string;
		onSelect: (name: string) => void;
		onClose: () => void;
	}

	let { position, initialQuery, onSelect, onClose }: Props = $props();

	let query = $state(initialQuery || '');
	let selectedIndex = $state(0);
	let inputRef: HTMLInputElement;

	// Get all existing people
	let allPeople = $derived(getAllPeople());

	// Filter people based on query
	let filteredPeople = $derived.by(() => {
		const q = query.toLowerCase().trim();
		if (!q) {
			return allPeople.slice(0, 10);
		}
		return allPeople
			.filter((p) => p.name.toLowerCase().includes(q))
			.slice(0, 10);
	});

	// Check if query is a new person
	let isNewPerson = $derived.by(() => {
		const q = query.trim();
		if (!q) return false;
		return !allPeople.some((p) => p.name.toLowerCase() === q.toLowerCase());
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
			const maxIndex = filteredPeople.length + (isNewPerson ? 0 : -1);
			selectedIndex = Math.min(selectedIndex + 1, maxIndex);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			selectedIndex = Math.max(selectedIndex - 1, 0);
		} else if (e.key === 'Enter' || e.key === 'Tab') {
			e.preventDefault();
			if (filteredPeople.length > 0 && selectedIndex < filteredPeople.length) {
				onSelect(filteredPeople[selectedIndex].name);
			} else if (query.trim()) {
				onSelect(formatName(query.trim()));
			}
		}
	}

	// Capitalize each word
	function formatName(input: string): string {
		return input
			.split(' ')
			.map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
			.join(' ');
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="person-autocomplete"
	style="left: {position.x}px; top: {position.y}px;"
	onkeydown={handleKeydown}
>
	<div class="search-input">
		<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-[var(--color-text-muted)]" viewBox="0 0 20 20" fill="currentColor">
			<path fill-rule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clip-rule="evenodd" />
		</svg>
		<input
			bind:this={inputRef}
			bind:value={query}
			type="text"
			placeholder="Search or add person..."
			class="flex-1 bg-transparent text-sm text-[var(--color-text)] placeholder-[var(--color-text-muted)] outline-none"
			onkeydown={handleKeydown}
		/>
		<kbd class="text-xs text-[var(--color-text-muted)] bg-[var(--color-bg-secondary)] px-1.5 py-0.5 rounded">ESC</kbd>
	</div>

	<div class="results">
		{#if filteredPeople.length === 0 && !query.trim()}
			<div class="empty">
				<span>No people yet. Type a name to add.</span>
			</div>
		{:else if filteredPeople.length === 0 && query.trim()}
			<button
				class="result-item selected"
				onclick={() => onSelect(formatName(query.trim()))}
			>
				<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0 text-[var(--color-accent)]" viewBox="0 0 20 20" fill="currentColor">
					<path d="M8 9a3 3 0 100-6 3 3 0 000 6zM8 11a6 6 0 016 6H2a6 6 0 016-6zM16 7a1 1 0 10-2 0v1h-1a1 1 0 100 2h1v1a1 1 0 102 0v-1h1a1 1 0 100-2h-1V7z" />
				</svg>
				<span class="person-name">Add @{formatName(query.trim())}</span>
			</button>
		{:else}
			{#each filteredPeople as person, i (person.name)}
				<button
					class="result-item"
					class:selected={i === selectedIndex}
					onclick={() => onSelect(person.name)}
					onmouseenter={() => selectedIndex = i}
				>
					<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0 text-green-500" viewBox="0 0 20 20" fill="currentColor">
						<path fill-rule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clip-rule="evenodd" />
					</svg>
					<span class="person-name">@{person.name}</span>
					<span class="person-count">{person.count}</span>
				</button>
			{/each}
			{#if isNewPerson && query.trim()}
				<button
					class="result-item"
					class:selected={selectedIndex === filteredPeople.length}
					onclick={() => onSelect(formatName(query.trim()))}
					onmouseenter={() => selectedIndex = filteredPeople.length}
				>
					<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0 text-[var(--color-accent)]" viewBox="0 0 20 20" fill="currentColor">
						<path d="M8 9a3 3 0 100-6 3 3 0 000 6zM8 11a6 6 0 016 6H2a6 6 0 016-6zM16 7a1 1 0 10-2 0v1h-1a1 1 0 100 2h1v1a1 1 0 102 0v-1h1a1 1 0 100-2h-1V7z" />
					</svg>
					<span class="person-name">Add @{formatName(query.trim())}</span>
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
	.person-autocomplete {
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

	.person-name {
		flex: 1;
		font-size: 0.875rem;
		color: var(--color-text);
	}

	.person-count {
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
