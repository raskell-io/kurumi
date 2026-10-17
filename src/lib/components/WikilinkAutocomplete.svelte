<script lang="ts">
	import { memoryObjects, folders, type MemoryObject } from '$lib/db';
	import { NotebookText } from 'lucide-svelte';
	import { placePopup } from '$lib/editor/datePeopleAutocomplete';

	interface Props {
		currentFolderId: string | null;
		position: { x: number; y: number; top?: number };
		query: string;
		onSelect: (noteTitle: string) => void;
		onClose: () => void;
	}

	let { currentFolderId, position, query, onSelect, onClose }: Props = $props();

	let selectedIndex = $state(0);
	let popupWidth = $state(0);
	let popupHeight = $state(0);

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

	// Filter and sort memories
	let filteredNotes = $derived.by(() => {
		const q = query.toLowerCase().trim();

		let filtered = $memoryObjects.filter((memory) => {
			if (!q) return true;
			return (memory.title || 'Untitled').toLowerCase().includes(q);
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

	function handleSelect(memory: MemoryObject) {
		onSelect(memory.title || 'Untitled');
	}

	function handleKey(key: string): boolean {
		switch (key) {
			case 'Escape':
				onClose();
				return true;
			case 'ArrowDown':
				if (filteredNotes.length === 0) return false;
				selectedIndex = Math.min(selectedIndex + 1, filteredNotes.length - 1);
				return true;
			case 'ArrowUp':
				if (filteredNotes.length === 0) return false;
				selectedIndex = Math.max(selectedIndex - 1, 0);
				return true;
			case 'Enter':
			case 'Tab':
				if (filteredNotes.length > 0) {
					onSelect(filteredNotes[selectedIndex].title || 'Untitled');
				} else if (query.trim()) {
					// Create link with typed text
					onSelect(query.trim());
				} else {
					return false;
				}
				return true;
		}
		return false;
	}
</script>

<div
	class="wikilink-autocomplete"
	style={placePopup(position, popupWidth, popupHeight)}
	bind:offsetWidth={popupWidth}
	bind:offsetHeight={popupHeight}
	role="listbox"
	aria-label="Link to note"
>
	<div class="header">
		<span>Link to note</span>
		{#if query.trim()}
			<span class="query">· {query}</span>
		{/if}
	</div>

	<div class="results">
		{#if filteredNotes.length === 0}
			<div class="empty">
				{#if query.trim()}
					<span>Press Enter to link to "{query.trim()}"</span>
				{:else}
					<span>No notes found</span>
				{/if}
			</div>
		{:else}
			{#each filteredNotes as note, i (note.id)}
				<button
					class="result-item"
					class:selected={i === selectedIndex}
					role="option"
					aria-selected={i === selectedIndex}
					onmousedown={(e) => {
						// Keep the editor's focus and selection intact
						e.preventDefault();
						handleSelect(note);
					}}
					onmouseenter={() => (selectedIndex = i)}
					tabindex="-1"
				>
					<NotebookText class="h-4 w-4 shrink-0 text-[var(--color-text-muted)]" />
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
		<span><kbd>↵</kbd> link</span>
		<span><kbd>esc</kbd> dismiss</span>
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
		max-height: 280px;
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

	.note-info {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.0625rem;
	}

	.note-title {
		font-size: 0.8125rem;
		color: var(--color-text);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.note-folder {
		font-size: 0.6875rem;
		color: var(--color-text-faint);
	}

	.same-folder-badge {
		font-size: 0.625rem;
		padding: 0.0625rem 0.375rem;
		background: var(--color-accent-soft);
		color: var(--color-accent);
		border-radius: 0.25rem;
		white-space: nowrap;
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
