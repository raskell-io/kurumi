<script lang="ts">
	import { getAllPeople } from '$lib/db';
	import { User, UserPlus } from 'lucide-svelte';
	import { placePopup } from '$lib/editor/datePeopleAutocomplete';

	interface Props {
		position: { x: number; y: number; top?: number };
		query: string;
		onSelect: (name: string) => void;
		onClose: () => void;
	}

	let { position, query, onSelect, onClose }: Props = $props();

	let selectedIndex = $state(0);
	let popupWidth = $state(0);
	let popupHeight = $state(0);

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

	// Everything selectable, in display order. Only the explicit "Add" row
	// title-cases what was typed; existing people keep their stored name.
	let options = $derived([
		...filteredPeople.map((p) => ({ value: p.name, count: p.count, isNew: false })),
		...(isNewPerson ? [{ value: formatName(query.trim()), count: 0, isNew: true }] : [])
	]);

	$effect(() => {
		// Reset selection whenever the typed query changes
		void query;
		selectedIndex = 0;
	});

	// The caret stays in the editor while this is open, so navigation keys
	// are intercepted before ProseMirror sees them. Everything else keeps
	// typing into the document, which updates `query`.
	$effect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.isComposing || e.metaKey || e.ctrlKey || e.altKey) return;
			if (handleKey(e.key)) {
				e.preventDefault();
				e.stopImmediatePropagation();
			}
		};
		window.addEventListener('keydown', onKey, true);
		return () => window.removeEventListener('keydown', onKey, true);
	});

	function handleKey(key: string): boolean {
		switch (key) {
			case 'Escape':
				onClose();
				return true;
			case 'ArrowDown':
				if (options.length === 0) return false;
				selectedIndex = Math.min(selectedIndex + 1, options.length - 1);
				return true;
			case 'ArrowUp':
				if (options.length === 0) return false;
				selectedIndex = Math.max(selectedIndex - 1, 0);
				return true;
			case 'Enter':
			case 'Tab':
				// Nothing to pick: let the key reach the editor
				if (options.length === 0) return false;
				onSelect(options[Math.min(selectedIndex, options.length - 1)].value);
				return true;
		}
		return false;
	}

	// Capitalize each word
	function formatName(input: string): string {
		return input
			.split(' ')
			.map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
			.join(' ');
	}
</script>

<div
	class="popup"
	style={placePopup(position, popupWidth, popupHeight)}
	bind:offsetWidth={popupWidth}
	bind:offsetHeight={popupHeight}
	role="listbox"
	aria-label="Mention a person"
>
	<div class="header">
		<span>Mention</span>
		{#if query.trim()}
			<span class="query">· {query}</span>
		{/if}
	</div>

	<div class="results">
		{#if options.length === 0}
			<div class="empty">
				<span>No people yet. Type a name to add.</span>
			</div>
		{:else}
			{#each options as option, i (option.value + option.isNew)}
				<button
					class="result-item"
					class:selected={i === selectedIndex}
					role="option"
					aria-selected={i === selectedIndex}
					onmousedown={(e) => {
						// Keep the editor's focus and selection intact
						e.preventDefault();
						onSelect(option.value);
					}}
					onmouseenter={() => (selectedIndex = i)}
					tabindex="-1"
				>
					{#if option.isNew}
						<UserPlus class="h-4 w-4 shrink-0 text-[var(--color-accent)]" />
						<span class="item-name">Add @{option.value}</span>
						<span class="new-badge">New</span>
					{:else}
						<User class="h-4 w-4 shrink-0 text-[var(--color-ref-person)]" />
						<span class="item-name">@{option.value}</span>
						<span class="item-count">{option.count}</span>
					{/if}
				</button>
			{/each}
		{/if}
	</div>

	<div class="footer">
		<span><kbd>↑↓</kbd> navigate</span>
		<span><kbd>↵</kbd> select</span>
		<span><kbd>esc</kbd> dismiss</span>
	</div>
</div>

<style>
	.popup {
		position: fixed;
		z-index: 1000;
		width: 260px;
		max-height: 360px;
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-lg);
		display: flex;
		flex-direction: column;
		overflow: hidden;
		animation: slideDownFadeIn 120ms var(--ease-out);
	}

	.header {
		display: flex;
		align-items: baseline;
		gap: 0.375rem;
		padding: 0.5rem 0.75rem 0.25rem;
		font-size: 0.6875rem;
		font-weight: 500;
		color: var(--color-text-faint);
	}

	.header .query {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--color-text-muted);
	}

	.results {
		flex: 1;
		overflow-y: auto;
		max-height: 260px;
		padding: 0.25rem;
	}

	.empty {
		padding: 0.75rem;
		text-align: center;
		color: var(--color-text-muted);
		font-size: 0.8125rem;
	}

	.result-item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		padding: 0.375rem 0.5rem;
		text-align: left;
		background: transparent;
		border: none;
		border-radius: var(--radius-sm);
		cursor: pointer;
	}

	.result-item.selected {
		background: var(--color-hover);
	}

	.item-name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 0.8125rem;
		color: var(--color-text);
	}

	.item-count {
		font-size: 0.6875rem;
		color: var(--color-text-faint);
		font-variant-numeric: tabular-nums;
	}

	.new-badge {
		font-size: 0.625rem;
		font-weight: 600;
		color: var(--color-accent);
		background: var(--color-accent-soft);
		padding: 0.0625rem 0.375rem;
		border-radius: 0.25rem;
		text-transform: uppercase;
	}

	.footer {
		display: flex;
		gap: 0.875rem;
		padding: 0.375rem 0.75rem;
		border-top: 1px solid var(--color-border);
		font-size: 0.6875rem;
		color: var(--color-text-faint);
	}

	.footer kbd {
		font-family: inherit;
		color: var(--color-text-muted);
	}
</style>
