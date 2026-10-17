<script lang="ts">
	import { autofocus } from '$lib/actions/autofocus';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import {
		getDatabaseView,
		getMemoryObjectsInFolder,
		getFolder,
		setMemoryCustomProp,
		getMemoryCustomProp,
		updateDatabaseView,
		deleteDatabaseView,
		databaseViews,
		memoryObjects,
		type MemoryObject,
		type DatabaseView,
		type PropertyDefinition,
		type DatabaseColumn
	} from '$lib/db';
	import { search, filterMemories, parseSearchQuery, hasAnyFilter } from '$lib/search';
	import { Table, LayoutGrid, Trash2, ArrowUp, ArrowDown, Database, Folder } from 'lucide-svelte';

	let viewId = $derived($page.params.id ?? '');
	let view = $derived.by(() => {
		void $databaseViews; // subscribe
		void $memoryObjects; // re-derive on memory changes
		return getDatabaseView(viewId);
	});
	let folder = $derived(view ? getFolder(view.folderId) : null);

	// Get memories in this folder, optionally further filtered
	let memories = $derived.by(() => {
		if (!view) return [];
		void $memoryObjects;
		let items = getMemoryObjectsInFolder(view.folderId);
		if (view.filterQuery) {
			const parsed = parseSearchQuery(view.filterQuery);
			if (hasAnyFilter(parsed.filters)) {
				items = filterMemories(items, parsed.filters);
			}
		}
		return sortMemories(items, view.sortField, view.sortDirection);
	});

	function sortMemories(
		items: MemoryObject[],
		field: string | null,
		direction: 'asc' | 'desc'
	): MemoryObject[] {
		if (!field) return items;
		const sorted = [...items];
		const dir = direction === 'asc' ? 1 : -1;
		sorted.sort((a, b) => {
			const av = getFieldValue(a, field);
			const bv = getFieldValue(b, field);
			if (typeof av === 'string' && typeof bv === 'string') return av.localeCompare(bv) * dir;
			if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
			return 0;
		});
		return sorted;
	}

	function getFieldValue(memory: MemoryObject, field: string): unknown {
		if (field.startsWith('prop:')) {
			return memory.customProps?.[field.slice(5)] ?? '';
		}
		switch (field) {
			case 'title':
				return memory.title || 'Untitled';
			case 'type':
				return memory.type;
			case 'createdAt':
				return memory.createdAt;
			case 'updatedAt':
				return memory.updatedAt;
			case 'tags':
				return memory.tags.join(', ');
			case 'participants':
				return memory.participants.join(', ');
			case 'topics':
				return memory.topics.join(', ');
			case 'projects':
				return memory.projects.join(', ');
			case 'processingState':
				return memory.processingState;
			default:
				return '';
		}
	}

	function formatFieldValue(memory: MemoryObject, col: DatabaseColumn): string {
		const value = getFieldValue(memory, col.field);
		if (col.field === 'createdAt' || col.field === 'updatedAt') {
			return new Date(value as number).toLocaleDateString();
		}
		if (typeof value === 'boolean') return value ? 'Yes' : 'No';
		if (value == null || value === '') return '—';
		return String(value);
	}

	function getColumnLabel(col: DatabaseColumn): string {
		if (col.field.startsWith('prop:')) {
			const propKey = col.field.slice(5);
			const def = view?.properties.find((p) => p.key === propKey);
			return def?.label ?? propKey;
		}
		const builtInLabels: Record<string, string> = {
			title: 'Title',
			type: 'Type',
			createdAt: 'Created',
			updatedAt: 'Updated',
			tags: 'Tags',
			participants: 'Participants',
			topics: 'Topics',
			projects: 'Projects',
			processingState: 'Status'
		};
		return builtInLabels[col.field] ?? col.field;
	}

	function toggleSort(field: string) {
		if (!view) return;
		const newDirection =
			view.sortField === field && view.sortDirection === 'asc' ? 'desc' : 'asc';
		updateDatabaseView(view.id, { sortField: field, sortDirection: newDirection });
	}

	// Inline editing for custom props
	let editingCell = $state<{ memoryId: string; field: string } | null>(null);
	let editValue = $state('');

	function startEditCell(memoryId: string, field: string, currentValue: string) {
		editingCell = { memoryId, field };
		editValue = currentValue;
	}

	function saveCell() {
		if (!editingCell) return;
		if (editingCell.field.startsWith('prop:')) {
			const propKey = editingCell.field.slice(5);
			const def = view?.properties.find((p) => p.key === propKey);
			let typedValue: unknown = editValue;
			if (def?.type === 'number') typedValue = parseFloat(editValue) || 0;
			else if (def?.type === 'checkbox') typedValue = editValue === 'true' || editValue === '1';
			setMemoryCustomProp(editingCell.memoryId, propKey, typedValue);
		}
		editingCell = null;
		editValue = '';
	}

	function handleCellKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			saveCell();
		} else if (e.key === 'Escape') {
			editingCell = null;
		}
	}

	// Hard delete with no undo path, so this keeps a confirm.
	function handleDelete() {
		if (!view) return;
		if (confirm(`Delete database view "${view.name}"?`)) {
			deleteDatabaseView(view.id);
			goto('/');
		}
	}

	let visibleColumns = $derived(
		(view?.columns ?? []).filter((c) => c.visible)
	);

	// Board grouping
	let boardGroups = $derived.by(() => {
		if (!view || view.viewType !== 'board' || !view.groupField) return new Map<string, MemoryObject[]>();
		const groups = new Map<string, MemoryObject[]>();
		for (const memory of memories) {
			const value = String(getFieldValue(memory, view.groupField) || '(none)');
			if (!groups.has(value)) groups.set(value, []);
			groups.get(value)!.push(memory);
		}
		return groups;
	});
</script>

<svelte:head>
	<title>{view?.name || 'Database'} - Kurumi</title>
</svelte:head>

{#if view}
	<div class="k-page k-page-wide">
		<header class="k-page-header">
			<div class="min-w-0">
				<h1 class="k-page-title truncate">{view.name}</h1>
				<p class="k-page-subtitle flex items-center gap-1.5 text-sm">
					{#if folder}
						<a
							href="/read/folder/{folder.id}"
							class="inline-flex min-w-0 items-center gap-1 text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
						>
							<Folder class="h-3.5 w-3.5 shrink-0 text-[var(--color-text-faint)]" />
							<span class="truncate">{folder.name}</span>
						</a>
						<span class="text-[var(--color-text-faint)]">·</span>
					{/if}
					<span class="tabular-nums">{memories.length} row{memories.length === 1 ? '' : 's'}</span>
				</p>
			</div>
			<button
				class="k-icon-btn hover:!text-[var(--color-danger)]"
				onclick={handleDelete}
				aria-label="Delete view"
				title="Delete view"
			>
				<Trash2 class="h-4 w-4" />
			</button>
		</header>

		<!-- View switcher -->
		<div class="k-segmented mb-4" role="group" aria-label="Layout">
			<button
				class="inline-flex items-center gap-1.5"
				aria-pressed={view.viewType === 'table'}
				onclick={() => updateDatabaseView(view.id, { viewType: 'table' })}
			>
				<Table class="h-3.5 w-3.5" />
				Table
			</button>
			<button
				class="inline-flex items-center gap-1.5"
				aria-pressed={view.viewType === 'board'}
				onclick={() => updateDatabaseView(view.id, { viewType: 'board' })}
			>
				<LayoutGrid class="h-3.5 w-3.5" />
				Board
			</button>
		</div>

		{#if view.viewType === 'table'}
			<div class="table-wrap">
				<table class="db-table">
					<thead>
						<tr>
							{#each visibleColumns as col (col.field)}
								<th aria-sort={view.sortField === col.field ? (view.sortDirection === 'asc' ? 'ascending' : 'descending') : undefined}>
									<button class="th-btn" onclick={() => toggleSort(col.field)}>
										{getColumnLabel(col)}
										{#if view.sortField === col.field}
											{#if view.sortDirection === 'asc'}
												<ArrowUp class="h-3 w-3" />
											{:else}
												<ArrowDown class="h-3 w-3" />
											{/if}
										{/if}
									</button>
								</th>
							{/each}
						</tr>
					</thead>
					<tbody>
						{#each memories as memory (memory.id)}
							<tr>
								{#each visibleColumns as col (col.field)}
									<td>
										{#if col.field === 'title'}
											<a href="/memory/{memory.id}" class="title-link">
												{memory.title || 'Untitled'}
											</a>
										{:else if col.field.startsWith('prop:') && editingCell?.memoryId === memory.id && editingCell?.field === col.field}
																						<input
												type="text"
												bind:value={editValue}
												onkeydown={handleCellKeydown}
												onblur={saveCell}
												class="k-input !h-7 !px-1.5 !text-[0.8125rem]"
												aria-label="Edit {getColumnLabel(col)}"
												use:autofocus
											/>
										{:else if col.field.startsWith('prop:')}
											<button
												class="cell-btn"
												onclick={() =>
													startEditCell(
														memory.id,
														col.field,
														String(getFieldValue(memory, col.field) || '')
													)}
											>
												{formatFieldValue(memory, col) || '—'}
											</button>
										{:else}
											<span class:faint={formatFieldValue(memory, col) === '—'}>{formatFieldValue(memory, col)}</span>
										{/if}
									</td>
								{/each}
							</tr>
						{:else}
							<tr class="empty-row">
								<td colspan={Math.max(1, visibleColumns.length)}>
									No notes in this folder{view.filterQuery ? ' match the filter' : ' yet'}.
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{:else if view.viewType === 'board' && view.groupField}
			<div class="board">
				{#each [...boardGroups.entries()] as [groupName, items] (groupName)}
					<div class="board-col">
						<div class="flex items-center justify-between gap-2 px-2 pt-1 pb-2">
							<span class="truncate text-xs font-semibold text-[var(--color-text-muted)]">{groupName}</span>
							<span class="k-badge">{items.length}</span>
						</div>
						{#each items as memory (memory.id)}
							<a href="/memory/{memory.id}" class="board-card">
								{memory.title || 'Untitled'}
							</a>
						{/each}
					</div>
				{:else}
					<p class="px-1 py-8 text-sm text-[var(--color-text-muted)]">No notes in this folder yet.</p>
				{/each}
			</div>
		{:else if view.viewType === 'board'}
			<div class="k-empty">
				<LayoutGrid />
				<p class="k-empty-title">Choose a group field</p>
				<p>Board view groups rows by a field. Set one in the view config to use it.</p>
			</div>
		{/if}
	</div>
{:else}
	<div class="k-empty">
		<Database />
		<p class="k-empty-title">Database view not found</p>
		<p>It may have been deleted or moved to another vault.</p>
		<a href="/" class="k-btn mt-2">Back to home</a>
	</div>
{/if}

<style>
	/* Table view */
	.table-wrap {
		overflow-x: auto;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
	}

	.db-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.8125rem;
	}

	.db-table th {
		padding: 0;
		border-bottom: 1px solid var(--color-border);
		background: var(--color-bg-secondary);
		text-align: left;
		white-space: nowrap;
	}

	.th-btn {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		width: 100%;
		padding: 0.4375rem 0.75rem;
		font-size: 0.75rem;
		font-weight: 500;
		color: var(--color-text-muted);
		text-align: left;
	}

	.th-btn:hover {
		color: var(--color-text);
	}

	.db-table td {
		padding: 0.4375rem 0.75rem;
		border-bottom: 1px solid var(--color-border);
		color: var(--color-text);
		vertical-align: middle;
	}

	.db-table tbody tr:last-child td {
		border-bottom: none;
	}

	.db-table tbody tr:not(.empty-row):hover td {
		background: var(--color-hover);
	}

	.empty-row td {
		padding: 2rem 0.75rem;
		text-align: center;
		color: var(--color-text-muted);
	}

	.faint {
		color: var(--color-text-faint);
	}

	.title-link {
		font-weight: 500;
		color: var(--color-text);
		text-decoration: none;
	}

	.title-link:hover {
		text-decoration: underline;
		text-decoration-color: var(--color-text-faint);
		text-underline-offset: 2px;
	}

	.cell-btn {
		width: 100%;
		margin: -0.125rem -0.375rem;
		padding: 0.125rem 0.375rem;
		border-radius: var(--radius-sm);
		font-size: 0.8125rem;
		color: var(--color-text);
		text-align: left;
		cursor: text;
	}

	.cell-btn:hover {
		background: var(--color-hover);
	}

	/* Board view */
	.board {
		display: flex;
		gap: 0.75rem;
		overflow-x: auto;
		padding-bottom: 1rem;
		min-height: 18rem;
	}

	.board-col {
		display: flex;
		flex: 0 0 15rem;
		flex-direction: column;
		gap: 0.375rem;
		padding: 0.5rem;
		border-radius: var(--radius-lg);
		background: var(--color-bg-secondary);
	}

	.board-card {
		display: block;
		padding: 0.5rem 0.75rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-bg);
		box-shadow: var(--shadow-sm);
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--color-text);
		text-decoration: none;
	}

	.board-card:hover {
		border-color: color-mix(in srgb, var(--color-text) 18%, var(--color-border));
	}
</style>
