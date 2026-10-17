<script lang="ts">
	import { autofocus } from '$lib/actions/autofocus';
	import {
		savedSearches,
		addSavedSearch,
		deleteSavedSearch,
		memoryObjects,
		getAllTags,
		getAllPeople
	} from '$lib/db';
	import type { MemoryObject } from '$lib/db/types';
	import type { SavedSearch } from '$lib/db/types';
	import { pushUndo } from '$lib/stores/undo';
	import {
		FolderSearch,
		Plus,
		Trash2,
		FileText,
		Mic,
		Users,
		X
	} from 'lucide-svelte';

	let showCreate = $state(false);
	let newName = $state('');
	let filterType = $state('');
	let filterTag = $state('');
	let filterPerson = $state('');
	let filterQuery = $state('');

	let tags = $derived(getAllTags());
	let people = $derived(getAllPeople());

	function buildQuery(): string {
		const parts: string[] = [];
		if (filterQuery) parts.push(filterQuery);
		if (filterType) parts.push(`type:${filterType}`);
		if (filterTag) parts.push(`tag:${filterTag}`);
		if (filterPerson) parts.push(`person:${filterPerson}`);
		return parts.join(' ');
	}

	function handleCreate() {
		const name = newName.trim();
		const query = buildQuery();
		if (!name || !query) return;
		addSavedSearch(name, query, undefined);
		showCreate = false;
		newName = '';
		filterType = '';
		filterTag = '';
		filterPerson = '';
		filterQuery = '';
	}

	// Count matches for a saved search query
	function countMatches(query: string): number {
		return filterMemories(query, $memoryObjects).length;
	}

	function filterMemories(query: string, memories: MemoryObject[]): MemoryObject[] {
		let filtered = memories.filter((m) => !m.deletedAt);
		const parts = query.split(/\s+/);
		const textParts: string[] = [];

		for (const part of parts) {
			if (part.startsWith('type:')) {
				const t = part.slice(5);
				filtered = filtered.filter((m) => m.type === t);
			} else if (part.startsWith('tag:')) {
				const t = part.slice(4);
				filtered = filtered.filter((m) => m.tags?.includes(t));
			} else if (part.startsWith('person:')) {
				const p = part.slice(7);
				filtered = filtered.filter((m) => m.participants?.some((pp) => pp.toLowerCase().includes(p.toLowerCase())));
			} else {
				textParts.push(part);
			}
		}

		if (textParts.length > 0) {
			const text = textParts.join(' ').toLowerCase();
			filtered = filtered.filter((m) =>
				(m.title || '').toLowerCase().includes(text) ||
				(m.bodyMarkdown || '').toLowerCase().includes(text)
			);
		}

		return filtered;
	}

	let previewQuery = $derived(buildQuery());

	let selectedFolder = $state<string | null>(null);

	// Hard delete, so offer undo (re-creates the folder with the same name/query)
	function handleDelete(search: SavedSearch) {
		deleteSavedSearch(search.id);
		if (selectedFolder === search.id) selectedFolder = null;
		pushUndo({
			label: `Deleted smart folder "${search.name}"`,
			undo: () => addSavedSearch(search.name, search.query, search.icon)
		});
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape' && showCreate) showCreate = false;
	}

	let selectedResults = $derived.by(() => {
		if (!selectedFolder) return [];
		const search = $savedSearches.find((s) => s.id === selectedFolder);
		if (!search) return [];
		return filterMemories(search.query, $memoryObjects)
			.sort((a, b) => b.updatedAt - a.updatedAt)
			.slice(0, 50);
	});
</script>

<svelte:window onkeydown={handleKeydown} />

<svelte:head>
	<title>Smart folders - Kurumi</title>
</svelte:head>

<div class="k-page k-page-wide">
	<header class="k-page-header">
		<div class="min-w-0">
			<h1 class="k-page-title">Smart folders</h1>
			<p class="k-page-subtitle">Saved filters that stay up to date as you capture.</p>
		</div>
		{#if !showCreate}
			<button class="k-btn k-btn-primary shrink-0" onclick={() => (showCreate = true)}>
				<Plus class="h-4 w-4" />
				New smart folder
			</button>
		{/if}
	</header>

	{#if showCreate}
		<form
			class="k-card mb-8 max-w-2xl space-y-4 p-4 md:p-5"
			aria-labelledby="sf-create-title"
			onsubmit={(e) => {
				e.preventDefault();
				handleCreate();
			}}
		>
			<div class="flex items-center justify-between">
				<h2 id="sf-create-title" class="text-sm font-semibold text-[var(--color-text)]">New smart folder</h2>
				<button type="button" class="k-icon-btn" onclick={() => (showCreate = false)} aria-label="Close">
					<X class="h-4 w-4" />
				</button>
			</div>
			<div class="grid gap-4 sm:grid-cols-2">
				<div>
					<label for="sf-name" class="k-label">Name</label>
					<input id="sf-name" bind:value={newName} placeholder="e.g., Work meetings" class="k-input" use:autofocus />
				</div>
				<div>
					<label for="sf-text" class="k-label">
						Text <span class="font-normal text-[var(--color-text-faint)]">(optional)</span>
					</label>
					<input id="sf-text" bind:value={filterQuery} placeholder="Contains…" class="k-input" />
				</div>
			</div>
			<div class="grid gap-2 sm:grid-cols-3">
				<select class="k-input" bind:value={filterType} aria-label="Type">
					<option value="">Any type</option>
					<option value="note">Notes</option>
					<option value="voice-memo">Voice memos</option>
					<option value="meeting">Meetings</option>
				</select>
				<select class="k-input" bind:value={filterTag} aria-label="Tag">
					<option value="">Any tag</option>
					{#each tags.slice(0, 30) as t}
						<option value={t.tag}>#{t.tag}</option>
					{/each}
				</select>
				<select class="k-input" bind:value={filterPerson} aria-label="Person">
					<option value="">Any person</option>
					{#each people.slice(0, 30) as p}
						<option value={p.name}>@{p.name}</option>
					{/each}
				</select>
			</div>
			<div class="flex flex-wrap items-center justify-end gap-2">
				{#if previewQuery}
					<p class="mr-auto min-w-0 truncate text-xs text-[var(--color-text-faint)]">
						<code class="text-[var(--color-text-muted)]">{previewQuery}</code>
						· {countMatches(previewQuery)} match{countMatches(previewQuery) === 1 ? '' : 'es'}
					</p>
				{:else}
					<p class="mr-auto text-xs text-[var(--color-text-faint)]">Pick at least one filter.</p>
				{/if}
				<button type="button" class="k-btn k-btn-ghost" onclick={() => (showCreate = false)}>Cancel</button>
				<button type="submit" class="k-btn k-btn-primary" disabled={!newName.trim() || !previewQuery}>
					Create
				</button>
			</div>
		</form>
	{/if}

	{#if $savedSearches.length === 0}
		{#if !showCreate}
			<div class="k-empty">
				<FolderSearch />
				<p class="k-empty-title">No smart folders yet</p>
				<p>Save a filter by type, tag, person or text to find it again in one click.</p>
			</div>
		{/if}
	{:else}
		<div class="sf-layout">
			<div class="sf-list">
				{#each $savedSearches as search (search.id)}
					<div
						class="k-row group cursor-pointer"
						class:selected={selectedFolder === search.id}
						role="button"
						tabindex="0"
						aria-pressed={selectedFolder === search.id}
						onclick={() => (selectedFolder = search.id)}
						onkeydown={(e) => {
							if (e.key === 'Enter' || e.key === ' ') {
								e.preventDefault();
								selectedFolder = search.id;
							}
						}}
					>
						<FolderSearch class="h-4 w-4 shrink-0 text-[var(--color-text-faint)]" />
						<div class="min-w-0 flex-1">
							<div class="truncate">{search.name}</div>
							<div class="truncate text-xs text-[var(--color-text-faint)]">{search.query}</div>
						</div>
						<span class="row-actions">
							<button
								class="k-icon-btn !h-6 !w-6 hover:!text-[var(--color-danger)]"
								onclick={(e) => {
									e.stopPropagation();
									handleDelete(search);
								}}
								title="Delete"
								aria-label="Delete {search.name}"
							>
								<Trash2 class="h-3.5 w-3.5" />
							</button>
						</span>
						<span class="k-badge shrink-0">{countMatches(search.query)}</span>
					</div>
				{/each}
			</div>

			<div class="sf-results">
				{#if !selectedFolder}
					<p class="py-8 text-center text-sm text-[var(--color-text-faint)]">Select a smart folder to see its memories.</p>
				{:else if selectedResults.length === 0}
					<p class="py-8 text-center text-sm text-[var(--color-text-faint)]">No memories match this filter.</p>
				{:else}
					<ul>
						{#each selectedResults as m (m.id)}
							<li>
								<a class="k-row" href="/memory/{m.id}">
									{#if m.type === 'meeting'}
										<Users class="h-4 w-4 shrink-0 text-[var(--color-text-faint)]" />
									{:else if m.type === 'voice-memo'}
										<Mic class="h-4 w-4 shrink-0 text-[var(--color-text-faint)]" />
									{:else}
										<FileText class="h-4 w-4 shrink-0 text-[var(--color-text-faint)]" />
									{/if}
									<span class="min-w-0 flex-1 truncate">{m.title || 'Untitled'}</span>
									<span class="shrink-0 text-xs text-[var(--color-text-faint)]">
										{new Date(m.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
									</span>
								</a>
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		</div>
	{/if}
</div>

<style>
	.sf-layout {
		display: flex;
		gap: 1.5rem;
		align-items: flex-start;
	}

	.sf-list {
		width: 18rem;
		flex-shrink: 0;
	}

	.sf-results {
		flex: 1;
		min-width: 0;
		border-left: 1px solid var(--color-border);
		padding-left: 1.5rem;
		min-height: 10rem;
	}

	/* Delete reveals on hover/focus; always visible on touch */
	.row-actions {
		display: inline-flex;
		opacity: 0;
	}

	:global(.k-row:hover) > .row-actions,
	.row-actions:focus-within {
		opacity: 1;
	}

	@media (hover: none) {
		.row-actions {
			opacity: 1;
		}
	}

	@media (max-width: 640px) {
		.sf-layout {
			flex-direction: column;
			gap: 1rem;
		}

		.sf-list {
			width: 100%;
		}

		.sf-results {
			width: 100%;
			border-left: none;
			border-top: 1px solid var(--color-border);
			padding: 1rem 0 0;
		}
	}
</style>
