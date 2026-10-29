<script lang="ts">
	import { autofocus } from '$lib/actions/autofocus';
	import {
		actionItems,
		memoryObjects,
		projects,
		addActionItem,
		updateActionItem,
		updateActionItemStatus,
		deleteActionItem,
		restoreActionItem,
		completeRecurring,
		todayIso,
		type ActionItem,
		type ActionItemStatus,
		type Recurrence
	} from '$lib/db';
	import { pushUndo } from '$lib/stores/undo';
	import { dueInfo as dueLabel } from '$lib/utils/due';
	import ActionBoard from '$lib/components/ActionBoard.svelte';
	import { myNames, isWaitingFor, waitingByPerson } from '$lib/work';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import {
		ArrowUpRight,
		CalendarClock,
		Check,
		Circle,
		CircleCheck,
		CircleDot,
		CircleSlash,
		Pencil,
		Play,
		Plus,
		Repeat,
		RotateCcw,
		Square,
		SquareCheck,
		Trash2,
		X,
		List,
		Columns3
	} from 'lucide-svelte';
	import { onMount } from 'svelte';

	const RECURRENCE_OPTIONS: Array<{ value: Recurrence; label: string }> = [
		{ value: 'none', label: 'One-off' },
		{ value: 'daily', label: 'Daily' },
		{ value: 'weekly', label: 'Weekly' },
		{ value: 'monthly', label: 'Monthly' },
		{ value: 'yearly', label: 'Yearly' }
	];

	// Filter tabs. "Active" (open + in progress) is the default so the
	// list reads as a to-do list; finished work is one click away.
	// Active: your open items. Waiting for: open items assigned to others
	// (see $lib/work), grouped by person.
	type Filter = 'active' | 'waiting' | 'closed' | 'all';
	const FILTERS: Array<{ value: Filter; label: string }> = [
		{ value: 'active', label: 'Active' },
		{ value: 'waiting', label: 'Waiting for' },
		{ value: 'closed', label: 'Completed' },
		{ value: 'all', label: 'All' }
	];
	let filter = $state<Filter>(
		(['active', 'waiting', 'closed', 'all'] as const).find((f) => f === $page.url.searchParams.get('filter')) ?? 'active'
	);

	function setFilter(next: Filter) {
		if (filter === next) return;
		filter = next;
		// Selection and cursor refer to rows that may no longer be visible.
		clearSelection();
		focusIndex = -1;
	}

	// List or board (Kanban) layout, remembered per device.
	const VIEW_KEY = 'kurumi-actions-view';
	let view = $state<'list' | 'board'>('list');
	onMount(() => {
		try {
			if (localStorage.getItem(VIEW_KEY) === 'board') view = 'board';
		} catch {
			// Storage unavailable: default to the list.
		}
	});
	function setView(next: 'list' | 'board') {
		view = next;
		clearSelection();
		try {
			localStorage.setItem(VIEW_KEY, next);
		} catch {
			// Not persisted; fine.
		}
	}

	// Project / assignee filters. Projects come from the source note.
	let projectFilter = $state('');
	let assigneeFilter = $state('');
	let memoryById = $derived(new Map($memoryObjects.map((m) => [m.id, m])));
	// Projects an item is in: set directly, or through its source note.
	function itemProjects(item: ActionItem): string[] {
		const direct = item.projectId ? $projects.find((p) => p.id === item.projectId)?.name : undefined;
		if (direct) return [direct];
		return item.memoryObjectId ? (memoryById.get(item.memoryObjectId)?.projects ?? []) : [];
	}
	let projectOptions = $derived(
		[...new Set($actionItems.flatMap((i) => itemProjects(i)))].sort((a, b) => a.localeCompare(b))
	);
	let assigneeOptions = $derived(
		[...new Set($actionItems.flatMap((i) => (i.assignee ? [i.assignee] : [])))].sort((a, b) =>
			a.localeCompare(b)
		)
	);
	let visibleItems = $derived(
		$actionItems.filter(
			(i) =>
				(!projectFilter || itemProjects(i).includes(projectFilter)) &&
				(!assigneeFilter || i.assignee === assigneeFilter)
		)
	);

	type Group = { key: string; label: string; status: ActionItemStatus; items: ActionItem[] };

	let groups = $derived.by<Group[]>(() => {
		const open: ActionItem[] = [];
		const inProgress: ActionItem[] = [];
		const done: ActionItem[] = [];
		const cancelled: ActionItem[] = [];
		if (filter === 'waiting') {
			return waitingByPerson(visibleItems, $myNames).map((g) => ({
				key: `person:${g.person}`,
				label: g.person,
				status: 'open' as const,
				items: g.items
			}));
		}
		for (const item of visibleItems) {
			// Active is your own work; others' open items are under Waiting for.
			if (filter === 'active' && isWaitingFor(item, $myNames)) continue;
			if (item.status === 'open') open.push(item);
			else if (item.status === 'in_progress') inProgress.push(item);
			else if (item.status === 'done') done.push(item);
			else cancelled.push(item);
		}
		const all: Group[] = [
			{ key: 'open', label: 'Open', status: 'open', items: open },
			{ key: 'in_progress', label: 'In progress', status: 'in_progress', items: inProgress },
			{ key: 'done', label: 'Done', status: 'done', items: done },
			{ key: 'cancelled', label: 'Cancelled', status: 'cancelled', items: cancelled }
		];
		if (filter === 'active') return all.slice(0, 2);
		if (filter === 'closed') return all.slice(2);
		return all;
	});

	let totalOpen = $derived($actionItems.filter((i) => i.status === 'open').length);
	let totalInProgress = $derived($actionItems.filter((i) => i.status === 'in_progress').length);
	let totalClosed = $derived($actionItems.length - totalOpen - totalInProgress);
	let totalWaiting = $derived($actionItems.filter((i) => isWaitingFor(i, $myNames)).length);
	let filterCounts = $derived<Record<Filter, number>>({
		active: totalOpen + totalInProgress - totalWaiting,
		waiting: totalWaiting,
		closed: totalClosed,
		all: $actionItems.length
	});

	function isActive(item: ActionItem): boolean {
		return item.status === 'open' || item.status === 'in_progress';
	}

	// Flat ordered list matching the rendered groups, used by bulk and
	// keyboard navigation so "next item" is deterministic.
	let flatOrder = $derived(groups.flatMap((g) => g.items));

	// Selection set for bulk operations. Holds action item ids.
	let selected = $state<Set<string>>(new Set());
	let selectionSize = $derived(selected.size);

	function isSelected(id: string): boolean {
		return selected.has(id);
	}

	function toggleSelected(id: string) {
		const next = new Set(selected);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		selected = next;
	}

	function clearSelection() {
		selected = new Set();
	}

	function selectAll() {
		selected = new Set(flatOrder.map((i) => i.id));
	}

	// Keyboard focus — index into flatOrder. -1 means nothing focused.
	let focusIndex = $state(-1);
	let focusedId = $derived<string | null>(
		focusIndex >= 0 && focusIndex < flatOrder.length ? flatOrder[focusIndex].id : null
	);

	// Keep the keyboard cursor visible while moving through long lists.
	$effect(() => {
		if (!focusedId) return;
		document
			.querySelector(`[data-row-id="${CSS.escape(focusedId)}"]`)
			?.scrollIntoView({ block: 'nearest' });
	});

	// Look up the source memory's title for display.
	function memoryTitle(id: string): string {
		return $memoryObjects.find((m) => m.id === id)?.title || 'Untitled';
	}

	// Human due-date label + tone. Only active items get overdue/today
	// colouring; a finished item's due date is just history.
	const today = todayIso();

	function dueInfo(iso: string, active: boolean) {
		return dueLabel(iso, active, today);
	}

	// --- Status transitions with undo -------------------------------------

	function changeStatus(item: ActionItem, next: ActionItemStatus, label: string) {
		const previousStatus = item.status;
		updateActionItemStatus(item.id, next);
		pushUndo({
			label,
			undo: () => updateActionItemStatus(item.id, previousStatus)
		});
	}

	function toggleDone(item: ActionItem) {
		if (item.status === 'done') {
			changeStatus(item, 'open', 'Reopened action item');
		} else if (item.recurrence !== 'none') {
			// Recurring: mark this occurrence done AND spawn the next one.
			// Undo is best-effort — we restore the original status but
			// leave the new occurrence in place (deleting it could lose
			// user edits if they modified it already).
			const previousStatus = item.status;
			completeRecurring(item.id);
			pushUndo({
				label: `Completed recurring item`,
				undo: () => updateActionItemStatus(item.id, previousStatus)
			});
		} else {
			changeStatus(item, 'done', 'Marked done');
		}
	}

	// Board drag/arrow moves. Done goes through toggleDone so recurring
	// items spawn their next occurrence.
	function moveTo(item: ActionItem, status: ActionItemStatus) {
		if (status === 'done') toggleDone(item);
		else if (status === 'in_progress') startProgress(item);
		else reopenItem(item);
	}

	function startProgress(item: ActionItem) {
		changeStatus(item, 'in_progress', 'Marked in progress');
	}

	function cancelItem(item: ActionItem) {
		changeStatus(item, 'cancelled', 'Cancelled action item');
	}

	function reopenItem(item: ActionItem) {
		changeStatus(item, 'open', 'Reopened action item');
	}

	function remove(item: ActionItem) {
		// Capture full state before deleting so undo can restore it
		// with the same id and cross-references.
		const snapshot: ActionItem = { ...item };
		deleteActionItem(item.id);
		pushUndo({
			label: `Deleted "${item.text.slice(0, 40)}${item.text.length > 40 ? '…' : ''}"`,
			undo: () => restoreActionItem(snapshot)
		});
	}

	// --- Bulk operations --------------------------------------------------

	function bulkMarkDone() {
		const targets = flatOrder.filter((i) => selected.has(i.id));
		if (targets.length === 0) return;
		const snapshots = targets.map((i) => ({ id: i.id, status: i.status }));
		for (const target of targets) {
			updateActionItemStatus(target.id, 'done');
		}
		pushUndo({
			label: `Marked ${targets.length} done`,
			undo: () => {
				for (const s of snapshots) updateActionItemStatus(s.id, s.status);
			}
		});
		clearSelection();
	}

	function bulkCancel() {
		const targets = flatOrder.filter((i) => selected.has(i.id));
		if (targets.length === 0) return;
		const snapshots = targets.map((i) => ({ id: i.id, status: i.status }));
		for (const target of targets) {
			updateActionItemStatus(target.id, 'cancelled');
		}
		pushUndo({
			label: `Cancelled ${targets.length} items`,
			undo: () => {
				for (const s of snapshots) updateActionItemStatus(s.id, s.status);
			}
		});
		clearSelection();
	}

	function bulkDelete() {
		const targets = flatOrder.filter((i) => selected.has(i.id));
		if (targets.length === 0) return;
		const snapshots = targets.map((i) => ({ ...i }));
		for (const target of targets) {
			deleteActionItem(target.id);
		}
		pushUndo({
			label: `Deleted ${targets.length} items`,
			undo: () => {
				for (const snap of snapshots) restoreActionItem(snap);
			}
		});
		clearSelection();
	}

	// --- Keyboard navigation ---------------------------------------------
	//
	// Standard j/k (or arrow) moves focus, Space toggles selection, Enter
	// opens the source memory, e edits, x marks done, Delete deletes.
	// Handlers no-op when typing in form controls (edit form, create
	// form) and when a modifier is held, so global shortcuts like Cmd+D
	// or Cmd+K don't also act on the focused row.

	function handlePageKeydown(e: KeyboardEvent) {
		const target = e.target as HTMLElement | null;
		if (!target) return;
		if (
			target.tagName === 'INPUT' ||
			target.tagName === 'TEXTAREA' ||
			target.tagName === 'SELECT' ||
			target.isContentEditable
		) {
			return;
		}
		if (e.metaKey || e.ctrlKey || e.altKey) return;
		// Let a focused button/link handle its own activation keys.
		if ((e.key === 'Enter' || e.key === ' ') && target.closest('button, a')) return;
		if (view === 'board' || flatOrder.length === 0) return;

		switch (e.key) {
			case 'j':
			case 'ArrowDown':
				e.preventDefault();
				focusIndex = Math.min(flatOrder.length - 1, focusIndex < 0 ? 0 : focusIndex + 1);
				break;
			case 'k':
			case 'ArrowUp':
				e.preventDefault();
				focusIndex = Math.max(0, focusIndex < 0 ? 0 : focusIndex - 1);
				break;
			case ' ': {
				e.preventDefault();
				if (focusedId) toggleSelected(focusedId);
				break;
			}
			case 'Enter': {
				if (!focusedId) return;
				const current = flatOrder[focusIndex];
				if (current?.memoryObjectId) {
					e.preventDefault();
					goto(`/memory/${current.memoryObjectId}`);
				}
				break;
			}
			case 'x':
			case 'X': {
				e.preventDefault();
				const current = flatOrder[focusIndex];
				if (current) toggleDone(current);
				break;
			}
			case 'e':
			case 'E': {
				e.preventDefault();
				const current = flatOrder[focusIndex];
				if (current) startEdit(current);
				break;
			}
			case 'Delete':
			case 'd':
			case 'D': {
				e.preventDefault();
				const current = flatOrder[focusIndex];
				if (current) {
					remove(current);
					focusIndex = Math.min(focusIndex, flatOrder.length - 2);
				}
				break;
			}
			case 'Escape': {
				if (selectionSize > 0) {
					e.preventDefault();
					clearSelection();
				} else if (focusIndex >= 0) {
					focusIndex = -1;
				}
				break;
			}
		}
	}

	onMount(() => {
		window.addEventListener('keydown', handlePageKeydown);
		return () => window.removeEventListener('keydown', handlePageKeydown);
	});

	// ---- Inline edit state ----
	// A single editingId at a time keeps the UI simple and avoids having
	// to manage N edit buffers. When editing, local state is bufferred
	// until the user saves or cancels.
	let editingId = $state<string | null>(null);
	let editText = $state('');
	let editAssignee = $state('');
	let editDueDate = $state('');
	let editRecurrence = $state<Recurrence>('none');

	function startEdit(item: ActionItem) {
		editingId = item.id;
		editText = item.text;
		editAssignee = item.assignee ?? '';
		editDueDate = item.dueDate ?? '';
		editRecurrence = item.recurrence ?? 'none';
	}

	function cancelEdit() {
		editingId = null;
		editText = '';
		editAssignee = '';
		editDueDate = '';
		editRecurrence = 'none';
	}

	function saveEdit() {
		if (!editingId) return;
		const trimmedText = editText.trim();
		if (!trimmedText) {
			// Empty text == delete (undoable, like any other delete)
			const item = $actionItems.find((i) => i.id === editingId);
			if (item) remove(item);
		} else {
			updateActionItem(editingId, {
				text: trimmedText,
				assignee: editAssignee.trim() || null,
				dueDate: editDueDate.trim() || null,
				recurrence: editRecurrence
			});
		}
		cancelEdit();
	}

	function handleEditKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			saveEdit();
		} else if (e.key === 'Escape') {
			e.preventDefault();
			cancelEdit();
		}
	}

	// ---- Create form state ----
	let showCreate = $state(false);
	let newText = $state('');
	let newAssignee = $state('');
	let newDueDate = $state('');
	let newRecurrence = $state<Recurrence>('none');

	let createInput: HTMLInputElement | undefined = $state();

	function openCreate() {
		showCreate = true;
		newText = '';
		newAssignee = '';
		newDueDate = '';
		newRecurrence = 'none';
	}

	function cancelCreate() {
		showCreate = false;
		newText = '';
		newAssignee = '';
		newDueDate = '';
		newRecurrence = 'none';
	}

	function submitCreate() {
		const trimmed = newText.trim();
		if (!trimmed) return;
		addActionItem({
			text: trimmed,
			assignee: newAssignee.trim() || null,
			dueDate: newDueDate.trim() || null,
			recurrence: newRecurrence
		});
		// Stay in the form for rapid capture: clear the text (keep assignee,
		// due date and recurrence for a batch) and refocus. Escape finishes.
		newText = '';
		createInput?.focus();
	}

	function handleCreateKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			submitCreate();
		} else if (e.key === 'Escape') {
			e.preventDefault();
			cancelCreate();
		}
	}
</script>

<svelte:head>
	<title>Action items - Kurumi</title>
</svelte:head>

<div class="k-page" class:board-page={view === 'board'}>
	<header class="k-page-header">
		<div class="min-w-0">
			<h1 class="k-page-title">Action items</h1>
			<p class="k-page-subtitle">
				{totalOpen} open
				{#if totalInProgress > 0}· {totalInProgress} in progress{/if}
				{#if totalClosed > 0}· {totalClosed} completed{/if}
			</p>
			<div class="k-hints" class:hidden={view === 'board'}>
				<span><kbd class="k-kbd">j</kbd> <kbd class="k-kbd">k</kbd> navigate</span>
				<span><kbd class="k-kbd">Space</kbd> select</span>
				<span><kbd class="k-kbd">x</kbd> done</span>
				<span><kbd class="k-kbd">e</kbd> edit</span>
				<span><kbd class="k-kbd">d</kbd> delete</span>
				<span><kbd class="k-kbd">↵</kbd> open source</span>
			</div>
		</div>
		<button class="k-btn k-btn-primary shrink-0" onclick={openCreate} disabled={showCreate}>
			<Plus class="h-4 w-4" />
			New
		</button>
	</header>

	{#if $actionItems.length > 0}
		<div class="mb-4 flex flex-wrap items-center gap-2">
			<div class="k-segmented" role="group" aria-label="Layout">
				<button class="inline-flex items-center gap-1.5" onclick={() => setView('list')} aria-pressed={view === 'list'}>
					<List class="h-3.5 w-3.5" /> List
				</button>
				<button class="inline-flex items-center gap-1.5" onclick={() => setView('board')} aria-pressed={view === 'board'}>
					<Columns3 class="h-3.5 w-3.5" /> Board
				</button>
			</div>
			{#if view === 'list'}
				<div class="k-segmented" role="group" aria-label="Filter">
					{#each FILTERS as f (f.value)}
						<button
							class="inline-flex items-center gap-1.5"
							onclick={() => setFilter(f.value)}
							aria-pressed={filter === f.value}
						>
							{f.label}
							<span class="text-xs tabular-nums text-[var(--color-text-faint)]">{filterCounts[f.value]}</span>
						</button>
					{/each}
				</div>
			{/if}
			{#if projectOptions.length > 0}
				<select class="k-input !h-8 !w-auto !py-0 text-sm" bind:value={projectFilter} aria-label="Filter by project">
					<option value="">All projects</option>
					{#each projectOptions as project (project)}<option value={project}>{project}</option>{/each}
				</select>
			{/if}
			{#if assigneeOptions.length > 0}
				<select class="k-input !h-8 !w-auto !py-0 text-sm" bind:value={assigneeFilter} aria-label="Filter by assignee">
					<option value="">Anyone</option>
					{#each assigneeOptions as person (person)}<option value={person}>{person}</option>{/each}
				</select>
			{/if}
		</div>
	{/if}

	{#if selectionSize > 0}
		<div class="k-bulk-bar" role="toolbar" aria-label="Bulk actions">
			<span class="px-2 text-xs font-medium tabular-nums text-[var(--color-text)]">
				{selectionSize} selected
			</span>
			<button class="k-btn k-btn-ghost k-btn-sm" onclick={bulkMarkDone}>
				<Check class="h-3.5 w-3.5" />
				Mark done
			</button>
			<button class="k-btn k-btn-ghost k-btn-sm" onclick={bulkCancel}>
				<CircleSlash class="h-3.5 w-3.5" />
				Cancel
			</button>
			<button class="k-btn k-btn-ghost k-btn-danger k-btn-sm" onclick={bulkDelete}>
				<Trash2 class="h-3.5 w-3.5" />
				Delete
			</button>
			<span class="ml-auto flex items-center gap-1">
				<button
					class="k-btn k-btn-ghost k-btn-sm"
					onclick={selectAll}
					disabled={selectionSize === flatOrder.length}
				>
					Select all
				</button>
				<button class="k-icon-btn" onclick={clearSelection} title="Clear selection (Esc)" aria-label="Clear selection">
					<X class="h-4 w-4" />
				</button>
			</span>
		</div>
	{/if}

	{#if showCreate}
		<div class="k-card mb-4 p-2 shadow-[var(--shadow-sm)]">
						<input
				type="text"
				bind:this={createInput}
				bind:value={newText}
				placeholder="What needs to be done?"
				onkeydown={handleCreateKeydown}
				class="k-input border-transparent shadow-none focus:border-transparent focus:shadow-none"
				aria-label="Action item"
				use:autofocus
			/>
			<div class="form-row">
				<input
					type="text"
					bind:value={newAssignee}
					placeholder="Assignee"
					onkeydown={handleCreateKeydown}
					class="k-input h-8 text-xs"
					aria-label="Assignee"
				/>
				<input
					type="date"
					bind:value={newDueDate}
					onkeydown={handleCreateKeydown}
					class="k-input h-8 text-xs"
					aria-label="Due date"
				/>
				<select bind:value={newRecurrence} onkeydown={handleCreateKeydown} class="k-input h-8 text-xs" aria-label="Repeat">
					{#each RECURRENCE_OPTIONS as opt (opt.value)}
						<option value={opt.value}>{opt.label}</option>
					{/each}
				</select>
				<span class="form-buttons">
					<button class="k-btn k-btn-ghost k-btn-sm" onclick={cancelCreate}>Cancel</button>
					<button class="k-btn k-btn-primary k-btn-sm" onclick={submitCreate} disabled={!newText.trim()}>
						Create
					</button>
				</span>
			</div>
		</div>
	{/if}

	{#if $actionItems.length === 0 && !showCreate}
		<div class="k-empty">
			<CircleCheck />
			<p class="k-empty-title">No action items yet</p>
			<p>Action items are extracted from meetings, or you can add your own.</p>
			<button class="k-btn mt-2" onclick={openCreate}>
				<Plus class="h-4 w-4" />
				New action item
			</button>
		</div>
	{:else if view === 'board'}
		<ActionBoard
			items={visibleItems}
			{memoryTitle}
			onMove={moveTo}
			onOpenSource={(id) => goto(`/memory/${id}`)}
		/>
	{:else if flatOrder.length === 0 && $actionItems.length > 0}
		<div class="k-empty">
			<CircleCheck />
			<p class="k-empty-title">{filter === 'active' ? 'All caught up' : 'Nothing here'}</p>
			<p>
				{filter === 'active'
					? 'Every action item is done, cancelled, or with someone else.'
					: filter === 'waiting'
						? 'Open items assigned to other people show up here. Set your own name in Settings → Profile.'
						: 'Completed and cancelled items will show up here.'}
			</p>
		</div>
	{:else}
		{#each groups as group (group.key)}
			{#if group.items.length > 0}
				<section>
					<h2 class="k-section-title">
						{group.label}
						<span class="tabular-nums font-normal">{group.items.length}</span>
					</h2>
					<ul class="items" class:has-selection={selectionSize > 0}>
						{#each group.items as item (item.id)}
							{@const due = item.dueDate ? dueInfo(item.dueDate, isActive(item)) : null}
							<li
								class="k-row item"
								class:closed={!isActive(item)}
								class:done={item.status === 'done'}
								class:editing={editingId === item.id}
								class:focused={focusedId === item.id}
								class:selected={isSelected(item.id)}
								data-row-id={item.id}
							>
								<button
									class="select-box"
									onclick={() => toggleSelected(item.id)}
									aria-label={isSelected(item.id) ? 'Deselect' : 'Select'}
									aria-pressed={isSelected(item.id)}
								>
									{#if isSelected(item.id)}
										<SquareCheck class="h-4 w-4" />
									{:else}
										<Square class="h-4 w-4" />
									{/if}
								</button>
								<button
									class="status"
									class:status-done={item.status === 'done'}
									class:status-progress={item.status === 'in_progress'}
									onclick={() => toggleDone(item)}
									title={item.status === 'done' ? 'Mark as open' : 'Mark as done (x)'}
									aria-label={item.status === 'done' ? 'Mark as open' : 'Mark as done'}
								>
									{#if item.status === 'done'}
										<CircleCheck class="h-4 w-4" />
									{:else if item.status === 'in_progress'}
										<CircleDot class="h-4 w-4" />
									{:else if item.status === 'cancelled'}
										<CircleSlash class="h-4 w-4" />
									{:else}
										<Circle class="h-4 w-4" />
									{/if}
								</button>

								{#if editingId === item.id}
									<div class="edit-form">
																				<input
											type="text"
											bind:value={editText}
											onkeydown={handleEditKeydown}
											class="k-input h-8"
											aria-label="Action item"
											use:autofocus
										/>
										<div class="form-row">
											<input
												type="text"
												bind:value={editAssignee}
												placeholder="Assignee"
												onkeydown={handleEditKeydown}
												class="k-input h-8 text-xs"
												aria-label="Assignee"
											/>
											<input
												type="date"
												bind:value={editDueDate}
												onkeydown={handleEditKeydown}
												class="k-input h-8 text-xs"
												aria-label="Due date"
											/>
											<select bind:value={editRecurrence} onkeydown={handleEditKeydown} class="k-input h-8 text-xs" aria-label="Repeat">
												{#each RECURRENCE_OPTIONS as opt (opt.value)}
													<option value={opt.value}>{opt.label}</option>
												{/each}
											</select>
											<span class="form-buttons">
												<button class="k-btn k-btn-ghost k-btn-sm" onclick={cancelEdit}>Cancel</button>
												<button class="k-btn k-btn-primary k-btn-sm" onclick={saveEdit}>Save</button>
											</span>
										</div>
									</div>
								{:else}
									<div class="body">
										<p class="text">{item.text}</p>
										{#if item.assignee || item.memoryObjectId}
											<div class="meta">
												{#if item.assignee}
													<span class="assignee">@{item.assignee}</span>
												{/if}
												{#if item.memoryObjectId}
													<a class="source" href="/memory/{item.memoryObjectId}">
														<ArrowUpRight class="h-3 w-3 shrink-0" />
														<span class="truncate">{memoryTitle(item.memoryObjectId)}</span>
													</a>
												{/if}
											</div>
										{/if}
									</div>

									<div class="badges">
										{#if item.recurrence && item.recurrence !== 'none'}
											<span class="k-badge capitalize" title="Repeats {item.recurrence}">
												<Repeat class="h-3 w-3" />
												{item.recurrence}
											</span>
										{/if}
										{#if due}
											<span
												class="k-badge"
												class:k-badge-danger={due.tone === 'danger'}
												class:k-badge-warn={due.tone === 'warn'}
												title="Due {item.dueDate}"
											>
												<CalendarClock class="h-3 w-3" />
												{due.label}
											</span>
										{/if}
									</div>

									<div class="row-actions">
										<button class="k-icon-btn" onclick={() => startEdit(item)} title="Edit (e)" aria-label="Edit">
											<Pencil class="h-4 w-4" />
										</button>
										{#if item.status === 'open'}
											<button class="k-icon-btn" onclick={() => startProgress(item)} title="Start" aria-label="Mark in progress">
												<Play class="h-4 w-4" />
											</button>
										{/if}
										{#if item.status === 'cancelled'}
											<button class="k-icon-btn" onclick={() => reopenItem(item)} title="Reopen" aria-label="Reopen">
												<RotateCcw class="h-4 w-4" />
											</button>
										{:else if item.status !== 'done'}
											<button class="k-icon-btn" onclick={() => cancelItem(item)} title="Cancel" aria-label="Cancel">
												<CircleSlash class="h-4 w-4" />
											</button>
										{/if}
										<button class="k-icon-btn danger" onclick={() => remove(item)} title="Delete (d)" aria-label="Delete">
											<Trash2 class="h-4 w-4" />
										</button>
									</div>
								{/if}
							</li>
						{/each}
					</ul>
				</section>
			{/if}
		{/each}
	{/if}
</div>

<style>
	/* The board needs more room than the list's reading width. */
	.board-page {
		max-width: 76rem;
	}

	.items {
		display: flex;
		flex-direction: column;
		gap: 1px;
	}

	.item {
		align-items: flex-start;
		gap: 0.5rem;
		padding-top: 0.4375rem;
		padding-bottom: 0.4375rem;
		/* Keep the cursor clear of the sticky bulk bar when scrolling */
		scroll-margin: 4rem 0 1rem;
	}

	.item.editing {
		background: var(--color-hover);
	}

	/* Leading controls: selection checkbox (revealed on hover / when a
	   selection exists) and the status circle that toggles done. */
	.select-box,
	.status {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.25rem;
		height: 1.375rem;
		flex-shrink: 0;
		color: var(--color-text-faint);
	}

	.select-box {
		margin-left: -0.25rem;
		opacity: 0;
	}

	.select-box:hover,
	.status:hover {
		color: var(--color-accent);
	}

	.item:hover .select-box,
	.item.focused .select-box,
	.item.selected .select-box,
	.has-selection .select-box,
	.select-box:focus-visible {
		opacity: 1;
	}

	.item.selected .select-box,
	.status-done,
	.status-progress {
		color: var(--color-accent);
	}

	.body {
		flex: 1;
		min-width: 0;
		padding-top: 0.0625rem;
	}

	.text {
		line-height: 1.4;
		overflow-wrap: anywhere;
	}

	.item.closed .text {
		color: var(--color-text-muted);
	}

	.item.done .text {
		text-decoration: line-through;
		text-decoration-color: var(--color-text-faint);
	}

	.meta {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		min-width: 0;
		margin-top: 0.125rem;
		font-size: 0.75rem;
		color: var(--color-text-faint);
	}

	.assignee {
		flex-shrink: 0;
		color: var(--color-text-muted);
	}

	.source {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		min-width: 0;
		color: inherit;
		text-decoration: none;
	}

	.source:hover {
		color: var(--color-accent);
	}

	.badges {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		flex-shrink: 0;
		padding-top: 0.0625rem;
	}

	/* Row actions appear on hover / keyboard focus, always on touch. */
	.row-actions {
		display: flex;
		align-items: center;
		gap: 0.125rem;
		flex-shrink: 0;
		margin: -0.1875rem -0.25rem -0.1875rem 0;
		opacity: 0;
	}

	.item:hover .row-actions,
	.item.focused .row-actions,
	.row-actions:focus-within {
		opacity: 1;
	}

	.row-actions .danger:hover {
		color: var(--color-danger);
	}

	/* Inline create / edit forms */
	.edit-form {
		display: flex;
		flex: 1;
		min-width: 0;
		flex-direction: column;
		gap: 0.375rem;
	}

	.form-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.375rem;
	}

	.form-row > .k-input {
		flex: 1 1 8rem;
		width: auto;
		min-width: 0;
	}

	.form-buttons {
		display: flex;
		gap: 0.25rem;
		margin-left: auto;
	}

	@media (hover: none) {
		.select-box,
		.row-actions {
			opacity: 1;
		}
	}

	@media (max-width: 639px) {
		.item {
			flex-wrap: wrap;
		}

		.body {
			flex-basis: calc(100% - 5rem);
		}

		.badges {
			margin-left: 2.5rem;
		}

		.row-actions {
			margin-left: auto;
		}
	}
</style>
