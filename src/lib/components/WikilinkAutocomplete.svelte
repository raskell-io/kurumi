<script lang="ts">
	import { notes, folders, type Note, type Folder } from '$lib/db';
	import { Search, FileText } from 'lucide-svelte';

	interface Props {
		currentFolderId: string | null;
		position: { x: number; y: number };
		onSelect: (noteTitle: string) => void;
		onClose: () => void;
	}

	let { currentFolderId, position, onSelect, onClose }: Props = $props();

	let query = $state('');
	let selectedIndex = $state(0);
	let inputRef: HTMLInputElement;

	// Calculate folder distance for sorting
	function getFolderDistance(noteFolderId: string | null): number {
		if (noteFolderId === currentFolderId) return 0;
		if (noteFolderId === null || currentFolderId === null) return 100;

		// Build path to root for current folder
		const currentPath: string[] = [];
		let current: string | null = currentFolderId;
		while (current) {
			currentPath.push(current);
			const folder = $folders.find((f) => f.id === current);
			current = folder?.parentId ?? null;
		}

		// Build path to root for note's folder
		const notePath: string[] = [];
		let noteFolder: string | null = noteFolderId;
		while (noteFolder) {
			notePath.push(noteFolder);
			const folder = $folders.find((f) => f.id === noteFolder);
			noteFolder = folder?.parentId ?? null;
		}

		// Find common ancestor
		for (let i = 0; i < currentPath.length; i++) {
			const idx = notePath.indexOf(currentPath[i]);
			if (idx !== -1) {
				return i + idx + 1; // Distance = steps to common ancestor from both sides
			}
		}

		return 100; // No common ancestor
	}

	// Get folder name for display
	function getFolderName(folderId: string | null): string {
		if (!folderId) return '';
		const folder = $folders.find((f) => f.id === folderId);
		return folder?.name ?? '';
	}

	// Filter and sort notes
	let filteredNotes = $derived.by(() => {
		const q = query.toLowerCase().trim();

		let filtered = $notes.filter((note) => {
			if (!q) return true;
			return (note.title || 'Untitled').toLowerCase().includes(q);
		});

		// Sort by folder proximity, then by title
		filtered.sort((a, b) => {
			const distA = getFolderDistance(a.folderId);
			const distB = getFolderDistance(b.folderId);
			if (distA !== distB) return distA - distB;
			return (a.title || 'Untitled').localeCompare(b.title || 'Untitled');
		});

		return filtered.slice(0, 10);
	});

	$effect(() => {
		// Reset selection when results change
		selectedIndex = 0;
	});

	$effect(() => {
		// Focus input on mount
		inputRef?.focus();
	});

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			onClose();
		} else if (e.key === 'ArrowDown') {
			e.preventDefault();
			selectedIndex = Math.min(selectedIndex + 1, filteredNotes.length - 1);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			selectedIndex = Math.max(selectedIndex - 1, 0);
		} else if (e.key === 'Enter') {
			e.preventDefault();
			if (filteredNotes.length > 0) {
				onSelect(filteredNotes[selectedIndex].title || 'Untitled');
			} else if (query.trim()) {
				// Create link with typed text
				onSelect(query.trim());
			}
		} else if (e.key === 'Tab') {
			e.preventDefault();
			if (filteredNotes.length > 0) {
				onSelect(filteredNotes[selectedIndex].title || 'Untitled');
			}
		}
	}

	function handleSelect(note: Note) {
		onSelect(note.title || 'Untitled');
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="wikilink-autocomplete"
	style="left: {position.x}px; top: {position.y}px;"
	onkeydown={handleKeydown}
>
	<div class="search-input">
		<Search class="h-4 w-4 text-[var(--color-text-muted)]" />
		<input
			bind:this={inputRef}
			bind:value={query}
			type="text"
			placeholder="Search notes..."
			class="autocomplete-input min-w-0 flex-1 bg-transparent text-sm text-[var(--color-text)] placeholder-[var(--color-text-muted)]"
			onkeydown={handleKeydown}
		/>
		<kbd class="shrink-0 text-xs text-[var(--color-text-muted)] bg-[var(--color-bg-secondary)] px-1.5 py-0.5 rounded">ESC</kbd>
	</div>

	<div class="results">
		{#if filteredNotes.length === 0}
			<div class="empty">
				{#if query.trim()}
					<span>Press Enter to create link to "{query.trim()}"</span>
				{:else}
					<span>No notes found</span>
				{/if}
			</div>
		{:else}
			{#each filteredNotes as note, i (note.id)}
				<button
					class="result-item"
					class:selected={i === selectedIndex}
					onclick={() => handleSelect(note)}
					onmouseenter={() => selectedIndex = i}
				>
					<FileText class="h-4 w-4 shrink-0 text-[var(--color-text-muted)]" />
					<div class="note-info">
						<span class="note-title">{note.title || 'Untitled'}</span>
						{#if note.folderId}
							<span class="note-folder">{getFolderName(note.folderId)}</span>
						{/if}
					</div>
					{#if note.folderId === currentFolderId}
						<span class="same-folder-badge">Same folder</span>
					{/if}
				</button>
			{/each}
		{/if}
	</div>

	<div class="footer">
		<span><kbd>↑↓</kbd> navigate</span>
		<span><kbd>Enter</kbd> select</span>
		<span><kbd>Tab</kbd> complete</span>
	</div>
</div>

<style>
	.wikilink-autocomplete {
		position: fixed;
		z-index: 1000;
		width: 320px;
		max-height: 400px;
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 0.5rem;
		box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
		display: flex;
		flex-direction: column;
		overflow: hidden;
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
		max-height: 280px;
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

	.note-info {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
	}

	.note-title {
		font-size: 0.875rem;
		color: var(--color-text);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.note-folder {
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}

	.same-folder-badge {
		font-size: 0.625rem;
		padding: 0.125rem 0.375rem;
		background: color-mix(in srgb, var(--color-accent) 20%, transparent);
		color: var(--color-accent);
		border-radius: 0.25rem;
		white-space: nowrap;
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

	.autocomplete-input {
		border: none !important;
		outline: none !important;
		box-shadow: none !important;
	}

	.autocomplete-input:focus,
	.autocomplete-input:focus-visible {
		border: none !important;
		outline: none !important;
		box-shadow: none !important;
	}
</style>
