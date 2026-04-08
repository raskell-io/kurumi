<script lang="ts">
	import {
		actionItems,
		memoryObjects,
		addActionItem,
		updateActionItem,
		updateActionItemStatus,
		deleteActionItem,
		restoreActionItem,
		completeRecurring,
		type ActionItem,
		type ActionItemStatus,
		type Recurrence
	} from '$lib/db';
	import { pushUndo } from '$lib/stores/undo';
	import {
		CheckSquare,
		Square,
		Clock,
		Trash2,
		ArrowRight,
		X,
		Plus,
		Pencil,
		Check,
		MinusSquare,
		Repeat
	} from 'lucide-svelte';
	import { onMount } from 'svelte';

	const RECURRENCE_OPTIONS: Array<{ value: Recurrence; label: string }> = [
		{ value: 'none', label: 'One-off' },
		{ value: 'daily', label: 'Daily' },
		{ value: 'weekly', label: 'Weekly' },
		{ value: 'monthly', label: 'Monthly' },
		{ value: 'yearly', label: 'Yearly' }
	];

	type Group = { label: string; status: ActionItemStatus; items: ActionItem[] };

	let groups = $derived.by<Group[]>(() => {
		const open: ActionItem[] = [];
		const inProgress: ActionItem[] = [];
		const done: ActionItem[] = [];
		const cancelled: ActionItem[] = [];
		for (const item of $actionItems) {
			if (item.status === 'open') open.push(item);
			else if (item.status === 'in_progress') inProgress.push(item);
			else if (item.status === 'done') done.push(item);
			else cancelled.push(item);
		}
		return [
			{ label: 'Open', status: 'open', items: open },
			{ label: 'In progress', status: 'in_progress', items: inProgress },
			{ label: 'Done', status: 'done', items: done },
			{ label: 'Cancelled', status: 'cancelled', items: cancelled }
		];
	});

	let totalOpen = $derived($actionItems.filter((i) => i.status === 'open').length);

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

	// Look up the source memory's title for display.
	function memoryTitle(id: string): string {
		return $memoryObjects.find((m) => m.id === id)?.title ?? 'Untitled';
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

	function startProgress(item: ActionItem) {
		changeStatus(item, 'in_progress', 'Marked in progress');
	}

	function cancelItem(item: ActionItem) {
		changeStatus(item, 'cancelled', 'Cancelled action item');
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
	// Handlers no-op when typing in inputs (edit form, create form).

	function handlePageKeydown(e: KeyboardEvent) {
		const target = e.target as HTMLElement | null;
		if (!target) return;
		if (
			target.tagName === 'INPUT' ||
			target.tagName === 'TEXTAREA' ||
			target.isContentEditable
		) {
			return;
		}
		if (flatOrder.length === 0) return;

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
					window.location.hash = `#/memory/${current.memoryObjectId}`;
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
			// Empty text == delete
			deleteActionItem(editingId);
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
			cancelEdit();
		}
	}

	// ---- Create form state ----
	let showCreate = $state(false);
	let newText = $state('');
	let newAssignee = $state('');
	let newDueDate = $state('');
	let newRecurrence = $state<Recurrence>('none');

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
		cancelCreate();
	}

	function handleCreateKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			submitCreate();
		} else if (e.key === 'Escape') {
			cancelCreate();
		}
	}
</script>

<svelte:head>
	<title>Action items - Kurumi</title>
</svelte:head>

<main class="actions-page">
	<header class="page-header">
		<div class="header-row">
			<div>
				<h1>Action items</h1>
				<p class="count">
					{totalOpen} open
					{#if $actionItems.length > totalOpen}
						· {$actionItems.length - totalOpen} completed
					{/if}
					<span class="hint">j/k to navigate · Space to select · x done · e edit · d delete</span>
				</p>
			</div>
			{#if !showCreate}
				<button class="create-btn" onclick={openCreate}>
					<Plus class="h-4 w-4" />
					New action item
				</button>
			{/if}
		</div>

		{#if selectionSize > 0}
			<div class="bulk-bar">
				<button class="bulk-select" onclick={clearSelection} title="Clear selection">
					<CheckSquare class="h-4 w-4" />
					{selectionSize} selected
				</button>
				<button class="bulk-action" onclick={bulkMarkDone}>
					<Check class="h-4 w-4" />
					Mark done
				</button>
				<button class="bulk-action" onclick={bulkCancel}>
					<X class="h-4 w-4" />
					Cancel
				</button>
				<button class="bulk-action danger" onclick={bulkDelete}>
					<Trash2 class="h-4 w-4" />
					Delete
				</button>
				<button
					class="bulk-select-all"
					onclick={selectAll}
					disabled={selectionSize === flatOrder.length}
				>
					Select all
				</button>
			</div>
		{/if}

		{#if showCreate}
			<div class="create-form">
				<input
					type="text"
					bind:value={newText}
					placeholder="What needs to be done?"
					onkeydown={handleCreateKeydown}
					class="form-input text"
				/>
				<div class="form-row">
					<input
						type="text"
						bind:value={newAssignee}
						placeholder="Assignee (optional)"
						onkeydown={handleCreateKeydown}
						class="form-input"
					/>
					<input
						type="date"
						bind:value={newDueDate}
						onkeydown={handleCreateKeydown}
						class="form-input"
					/>
					<select bind:value={newRecurrence} class="form-input">
						{#each RECURRENCE_OPTIONS as opt (opt.value)}
							<option value={opt.value}>{opt.label}</option>
						{/each}
					</select>
					<button class="form-btn-cancel" onclick={cancelCreate}>Cancel</button>
					<button class="form-btn-submit" onclick={submitCreate} disabled={!newText.trim()}>
						Create
					</button>
				</div>
			</div>
		{/if}
	</header>

	{#if $actionItems.length === 0 && !showCreate}
		<div class="empty-state">
			<CheckSquare class="h-12 w-12 opacity-50" />
			<h2>No action items yet</h2>
			<p>
				Action items are extracted automatically from meetings, or you can
				create your own with the button above.
			</p>
		</div>
	{:else}
		{#each groups as group (group.status)}
			{#if group.items.length > 0}
				<section class="group">
					<h2 class="group-title">
						{group.label}
						<span class="group-count">{group.items.length}</span>
					</h2>
					<ul class="items">
						{#each group.items as item (item.id)}
							<li
								class="item"
								class:done={item.status === 'done'}
								class:cancelled={item.status === 'cancelled'}
								class:editing={editingId === item.id}
								class:focused={focusedId === item.id}
								class:selected={isSelected(item.id)}
							>
								<button
									class="select-box"
									onclick={() => toggleSelected(item.id)}
									aria-label={isSelected(item.id) ? 'Deselect' : 'Select'}
								>
									{#if isSelected(item.id)}
										<MinusSquare class="h-4 w-4" />
									{:else}
										<Square class="h-4 w-4" />
									{/if}
								</button>
								<button
									class="toggle"
									onclick={() => toggleDone(item)}
									aria-label={item.status === 'done' ? 'Mark as open' : 'Mark as done'}
								>
									{#if item.status === 'done'}
										<CheckSquare class="h-5 w-5" />
									{:else}
										<Square class="h-5 w-5" />
									{/if}
								</button>

								{#if editingId === item.id}
									<div class="edit-form">
										<!-- svelte-ignore a11y_autofocus -->
										<input
											type="text"
											bind:value={editText}
											onkeydown={handleEditKeydown}
											class="form-input text"
											autofocus
										/>
										<div class="form-row">
											<input
												type="text"
												bind:value={editAssignee}
												placeholder="Assignee"
												onkeydown={handleEditKeydown}
												class="form-input"
											/>
											<input
												type="date"
												bind:value={editDueDate}
												onkeydown={handleEditKeydown}
												class="form-input"
											/>
											<select bind:value={editRecurrence} class="form-input">
												{#each RECURRENCE_OPTIONS as opt (opt.value)}
													<option value={opt.value}>{opt.label}</option>
												{/each}
											</select>
											<button class="form-btn-cancel" onclick={cancelEdit}>Cancel</button>
											<button class="form-btn-submit" onclick={saveEdit}>
												<Check class="h-4 w-4" />
												Save
											</button>
										</div>
									</div>
								{:else}
									<div class="body">
										<p class="text">{item.text}</p>
										<div class="meta">
											{#if item.assignee}
												<span class="assignee">@{item.assignee}</span>
											{/if}
											{#if item.recurrence && item.recurrence !== 'none'}
												<span class="recurrence"><Repeat class="h-3 w-3" /> {item.recurrence}</span>
											{/if}
											{#if item.dueDate}
												<span class="due"><Clock class="h-3 w-3" /> {item.dueDate}</span>
											{/if}
											{#if item.memoryObjectId}
												<a class="source" href="/memory/{item.memoryObjectId}">
													from {memoryTitle(item.memoryObjectId)}
													<ArrowRight class="h-3 w-3" />
												</a>
											{:else}
												<span class="source manual">manual entry</span>
											{/if}
										</div>
									</div>
								{/if}

								{#if editingId !== item.id}
									<div class="actions">
										<button class="action-btn" onclick={() => startEdit(item)} title="Edit">
											<Pencil class="h-4 w-4" />
										</button>
										{#if item.status === 'open'}
											<button
												class="action-btn"
												onclick={() => startProgress(item)}
												title="Start"
											>
												<Clock class="h-4 w-4" />
											</button>
										{/if}
										{#if item.status !== 'cancelled' && item.status !== 'done'}
											<button class="action-btn" onclick={() => cancelItem(item)} title="Cancel">
												<X class="h-4 w-4" />
											</button>
										{/if}
										<button
											class="action-btn danger"
											onclick={() => remove(item)}
											title="Delete"
										>
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
</main>

<style>
	.actions-page {
		max-width: 900px;
		margin: 0 auto;
		padding: 2rem 1.5rem 4rem;
	}

	.page-header {
		margin-bottom: 2rem;
	}

	.header-row {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 1rem;
		margin-bottom: 0.25rem;
	}

	.page-header h1 {
		font-size: 2rem;
		font-weight: 700;
		color: var(--color-text);
		margin-bottom: 0.25rem;
	}

	.count {
		font-size: 0.875rem;
		color: var(--color-text-muted);
	}

	.hint {
		display: block;
		margin-top: 0.25rem;
		font-size: 0.75rem;
		opacity: 0.7;
	}

	.bulk-bar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
		margin-top: 1rem;
		padding: 0.625rem 0.875rem;
		background: color-mix(in srgb, var(--color-accent) 8%, var(--color-bg-secondary));
		border: 1px solid var(--color-accent);
		border-radius: 0.625rem;
	}

	.bulk-select {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.375rem 0.625rem;
		background: var(--color-accent);
		color: white;
		border: none;
		border-radius: 0.375rem;
		font-size: 0.8125rem;
		font-weight: 500;
		cursor: pointer;
	}

	.bulk-action {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.375rem 0.75rem;
		background: var(--color-bg);
		color: var(--color-text);
		border: 1px solid var(--color-border);
		border-radius: 0.375rem;
		font-size: 0.8125rem;
		cursor: pointer;
		transition: all 0.15s;
	}

	.bulk-action:hover {
		border-color: var(--color-accent);
	}

	.bulk-action.danger:hover {
		background: rgba(239, 68, 68, 0.15);
		color: #ef4444;
		border-color: rgba(239, 68, 68, 0.4);
	}

	.bulk-select-all {
		margin-left: auto;
		background: none;
		border: none;
		color: var(--color-text-muted);
		font-size: 0.75rem;
		cursor: pointer;
	}

	.bulk-select-all:hover:not(:disabled) {
		color: var(--color-text);
	}

	.bulk-select-all:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.create-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.5rem 0.875rem;
		background: var(--color-accent);
		color: white;
		border: none;
		border-radius: 0.5rem;
		font-size: 0.875rem;
		font-weight: 500;
		cursor: pointer;
		transition: background 0.15s;
	}

	.create-btn:hover {
		background: var(--color-accent-hover);
	}

	.create-form,
	.edit-form {
		width: 100%;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.create-form {
		margin-top: 1rem;
		padding: 1rem;
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border);
		border-radius: 0.75rem;
	}

	.form-row {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.form-input {
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 0.375rem;
		padding: 0.5rem 0.75rem;
		color: var(--color-text);
		font-size: 0.875rem;
		min-width: 0;
	}

	.form-input:focus {
		outline: none;
		border-color: var(--color-accent);
	}

	.form-input.text {
		width: 100%;
	}

	.form-row .form-input {
		flex: 1;
	}

	.form-btn-cancel,
	.form-btn-submit {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.4375rem 0.875rem;
		border-radius: 0.375rem;
		font-size: 0.8125rem;
		font-weight: 500;
		cursor: pointer;
		flex-shrink: 0;
	}

	.form-btn-cancel {
		background: transparent;
		border: 1px solid var(--color-border);
		color: var(--color-text-muted);
	}

	.form-btn-cancel:hover {
		color: var(--color-text);
	}

	.form-btn-submit {
		background: var(--color-accent);
		border: 1px solid var(--color-accent);
		color: white;
	}

	.form-btn-submit:hover:not(:disabled) {
		background: var(--color-accent-hover);
	}

	.form-btn-submit:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.empty-state {
		text-align: center;
		padding: 4rem 2rem;
		color: var(--color-text-muted);
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.75rem;
	}

	.empty-state h2 {
		font-size: 1.25rem;
		color: var(--color-text);
		font-weight: 600;
	}

	.empty-state p {
		max-width: 32rem;
	}

	.group {
		margin-bottom: 2rem;
	}

	.group-title {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.75rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--color-text-muted);
		margin-bottom: 0.75rem;
	}

	.group-count {
		background: var(--color-bg-secondary);
		border-radius: 999px;
		padding: 0.125rem 0.5rem;
		font-weight: 500;
	}

	.items {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.item {
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
		padding: 0.875rem 1rem;
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border);
		border-radius: 0.75rem;
		transition: border-color 0.15s;
	}

	.item:hover {
		border-color: color-mix(in srgb, var(--color-accent) 40%, var(--color-border));
	}

	.item.editing {
		border-color: var(--color-accent);
	}

	.item.focused {
		box-shadow: 0 0 0 2px var(--color-accent);
	}

	.item.selected {
		background: color-mix(in srgb, var(--color-accent) 12%, var(--color-bg-secondary));
		border-color: var(--color-accent);
	}

	.item.done .text,
	.item.cancelled .text {
		text-decoration: line-through;
		color: var(--color-text-muted);
	}

	.select-box {
		background: none;
		border: none;
		padding: 0;
		cursor: pointer;
		color: var(--color-text-muted);
		flex-shrink: 0;
		margin-top: 0.25rem;
	}

	.select-box:hover {
		color: var(--color-accent);
	}

	.item.selected .select-box {
		color: var(--color-accent);
	}

	.toggle {
		background: none;
		border: none;
		padding: 0;
		cursor: pointer;
		color: var(--color-text-muted);
		flex-shrink: 0;
		margin-top: 0.125rem;
	}

	.toggle:hover {
		color: var(--color-accent);
	}

	.body {
		flex: 1;
		min-width: 0;
	}

	.text {
		color: var(--color-text);
		margin: 0 0 0.375rem 0;
		line-height: 1.45;
	}

	.meta {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}

	.assignee {
		color: var(--color-accent);
		font-weight: 500;
	}

	.recurrence {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.125rem 0.5rem;
		background: color-mix(in srgb, var(--color-accent) 12%, transparent);
		color: var(--color-accent);
		border-radius: 999px;
		text-transform: capitalize;
	}

	.due {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
	}

	.source {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		color: var(--color-text-muted);
		text-decoration: none;
		opacity: 0.8;
	}

	.source:hover {
		color: var(--color-accent);
		opacity: 1;
	}

	.source.manual {
		font-style: italic;
	}

	.actions {
		display: flex;
		gap: 0.25rem;
		flex-shrink: 0;
	}

	.action-btn {
		background: none;
		border: none;
		padding: 0.375rem;
		border-radius: 0.375rem;
		cursor: pointer;
		color: var(--color-text-muted);
		transition: all 0.15s;
	}

	.action-btn:hover {
		background: var(--color-border);
		color: var(--color-text);
	}

	.action-btn.danger:hover {
		background: rgba(239, 68, 68, 0.15);
		color: #ef4444;
	}
</style>
