<script lang="ts">
	import {
		reminderProposals,
		memoryObjects,
		approveReminderProposal,
		rejectReminderProposal,
		snoozeReminderProposal,
		reopenReminderProposal,
		deleteReminderProposal,
		restoreReminderProposal,
		type ReminderProposal
	} from '$lib/db';
	import { pushUndo } from '$lib/stores/undo';
	import { onMount } from 'svelte';
	import {
		Bell,
		Check,
		X,
		Clock,
		ArrowRight,
		Trash2,
		RotateCcw,
		Square,
		MinusSquare,
		CheckSquare
	} from 'lucide-svelte';

	type Group = { label: string; status: ReminderProposal['status']; items: ReminderProposal[] };

	let groups = $derived.by<Group[]>(() => {
		const pending: ReminderProposal[] = [];
		const snoozed: ReminderProposal[] = [];
		const approved: ReminderProposal[] = [];
		const rejected: ReminderProposal[] = [];
		for (const item of $reminderProposals) {
			if (item.status === 'pending') pending.push(item);
			else if (item.status === 'snoozed') snoozed.push(item);
			else if (item.status === 'approved') approved.push(item);
			else rejected.push(item);
		}
		return [
			{ label: 'Pending review', status: 'pending', items: pending },
			{ label: 'Snoozed', status: 'snoozed', items: snoozed },
			{ label: 'Approved', status: 'approved', items: approved },
			{ label: 'Rejected', status: 'rejected', items: rejected }
		];
	});

	let pendingCount = $derived(
		$reminderProposals.filter((p) => p.status === 'pending').length
	);

	// Flat order for keyboard navigation / bulk operations.
	let flatOrder = $derived(groups.flatMap((g) => g.items));

	// Selection state for bulk actions.
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

	function selectAllPending() {
		// Default to selecting pending only — bulk approving already-
		// decided proposals is almost never what the user wants.
		selected = new Set(flatOrder.filter((p) => p.status === 'pending').map((p) => p.id));
	}

	// Keyboard focus
	let focusIndex = $state(-1);
	let focusedId = $derived<string | null>(
		focusIndex >= 0 && focusIndex < flatOrder.length ? flatOrder[focusIndex].id : null
	);

	function memoryTitle(id: string): string {
		return $memoryObjects.find((m) => m.id === id)?.title ?? 'Untitled';
	}

	function formatDate(iso: string): string {
		try {
			return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', {
				weekday: 'short',
				month: 'short',
				day: 'numeric',
				year: 'numeric'
			});
		} catch {
			return iso;
		}
	}

	// --- Individual actions with undo ------------------------------------

	function handleApprove(proposal: ReminderProposal) {
		approveReminderProposal(proposal.id);
		pushUndo({
			label: `Approved reminder`,
			undo: () => reopenReminderProposal(proposal.id)
		});
	}

	function handleReject(proposal: ReminderProposal) {
		rejectReminderProposal(proposal.id);
		pushUndo({
			label: `Rejected reminder`,
			undo: () => reopenReminderProposal(proposal.id)
		});
	}

	function handleSnooze(proposal: ReminderProposal) {
		const next = prompt('Snooze until (YYYY-MM-DD)?', proposal.suggestedDate);
		if (!next) return;
		if (!/^\d{4}-\d{2}-\d{2}$/.test(next)) {
			alert('Please use YYYY-MM-DD format');
			return;
		}
		const previousDate = proposal.suggestedDate;
		const previousStatus = proposal.status;
		snoozeReminderProposal(proposal.id, next);
		pushUndo({
			label: `Snoozed reminder`,
			undo: () => {
				// snoozeReminderProposal sets status='snoozed'; we need to
				// restore the prior status + date by re-snoozing with the
				// old date and then transitioning back.
				snoozeReminderProposal(proposal.id, previousDate);
				if (previousStatus !== 'snoozed') {
					reopenReminderProposal(proposal.id);
				}
			}
		});
	}

	function handleDelete(proposal: ReminderProposal) {
		const snapshot: ReminderProposal = { ...proposal };
		deleteReminderProposal(proposal.id);
		pushUndo({
			label: `Deleted reminder proposal`,
			undo: () => restoreReminderProposal(snapshot)
		});
	}

	// --- Bulk operations --------------------------------------------------

	function bulkApprove() {
		const targets = flatOrder.filter((p) => selected.has(p.id) && p.status !== 'approved');
		if (targets.length === 0) return;
		for (const t of targets) approveReminderProposal(t.id);
		const ids = targets.map((t) => t.id);
		pushUndo({
			label: `Approved ${targets.length} proposals`,
			undo: () => {
				for (const id of ids) reopenReminderProposal(id);
			}
		});
		clearSelection();
	}

	function bulkReject() {
		const targets = flatOrder.filter((p) => selected.has(p.id) && p.status !== 'rejected');
		if (targets.length === 0) return;
		for (const t of targets) rejectReminderProposal(t.id);
		const ids = targets.map((t) => t.id);
		pushUndo({
			label: `Rejected ${targets.length} proposals`,
			undo: () => {
				for (const id of ids) reopenReminderProposal(id);
			}
		});
		clearSelection();
	}

	function bulkDelete() {
		const targets = flatOrder.filter((p) => selected.has(p.id));
		if (targets.length === 0) return;
		const snapshots = targets.map((p) => ({ ...p }));
		for (const t of targets) deleteReminderProposal(t.id);
		pushUndo({
			label: `Deleted ${targets.length} proposals`,
			undo: () => {
				for (const snap of snapshots) restoreReminderProposal(snap);
			}
		});
		clearSelection();
	}

	// --- Keyboard navigation ---------------------------------------------

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
			case ' ':
				e.preventDefault();
				if (focusedId) toggleSelected(focusedId);
				break;
			case 'Enter':
				if (flatOrder[focusIndex]?.memoryObjectId) {
					window.location.hash = `#/memory/${flatOrder[focusIndex].memoryObjectId}`;
				}
				break;
			case 'a':
			case 'A':
				e.preventDefault();
				if (flatOrder[focusIndex]) handleApprove(flatOrder[focusIndex]);
				break;
			case 'r':
			case 'R':
				e.preventDefault();
				if (flatOrder[focusIndex]) handleReject(flatOrder[focusIndex]);
				break;
			case 'Delete':
			case 'd':
			case 'D':
				e.preventDefault();
				if (flatOrder[focusIndex]) {
					handleDelete(flatOrder[focusIndex]);
					focusIndex = Math.min(focusIndex, flatOrder.length - 2);
				}
				break;
			case 'Escape':
				if (selectionSize > 0) {
					e.preventDefault();
					clearSelection();
				} else if (focusIndex >= 0) {
					focusIndex = -1;
				}
				break;
		}
	}

	onMount(() => {
		window.addEventListener('keydown', handlePageKeydown);
		return () => window.removeEventListener('keydown', handlePageKeydown);
	});
</script>

<svelte:head>
	<title>Reminder proposals - Kurumi</title>
</svelte:head>

<main class="proposals-page">
	<header class="page-header">
		<div class="header-icon">
			<Bell class="h-8 w-8" />
		</div>
		<h1>Reminder proposals</h1>
		<p class="count">
			{pendingCount} pending
			{#if $reminderProposals.length > pendingCount}
				· {$reminderProposals.length - pendingCount} decided
			{/if}
			<span class="hint">j/k nav · Space select · a approve · r reject · d delete</span>
		</p>
	</header>

	{#if selectionSize > 0}
		<div class="bulk-bar">
			<button class="bulk-select" onclick={clearSelection}>
				<CheckSquare class="h-4 w-4" />
				{selectionSize} selected
			</button>
			<button class="bulk-action" onclick={bulkApprove}>
				<Check class="h-4 w-4" />
				Approve
			</button>
			<button class="bulk-action" onclick={bulkReject}>
				<X class="h-4 w-4" />
				Reject
			</button>
			<button class="bulk-action danger" onclick={bulkDelete}>
				<Trash2 class="h-4 w-4" />
				Delete
			</button>
			<button
				class="bulk-select-all"
				onclick={selectAllPending}
			>
				Select all pending
			</button>
		</div>
	{/if}

	{#if $reminderProposals.length === 0}
		<div class="empty-state">
			<p>No reminder proposals yet.</p>
			<p class="muted">
				Kurumi scans voice memos and meetings for time-anchored follow-ups
				("remind me tomorrow", "next Monday", "in two weeks"). Proposals
				appear here for your review.
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
						{#each group.items as proposal (proposal.id)}
							<li
								class="item"
								class:decided={proposal.status !== 'pending' && proposal.status !== 'snoozed'}
								class:focused={focusedId === proposal.id}
								class:selected={isSelected(proposal.id)}
							>
								<button
									class="select-box"
									onclick={() => toggleSelected(proposal.id)}
									aria-label={isSelected(proposal.id) ? 'Deselect' : 'Select'}
								>
									{#if isSelected(proposal.id)}
										<MinusSquare class="h-4 w-4" />
									{:else}
										<Square class="h-4 w-4" />
									{/if}
								</button>
								<div class="body">
									<p class="text">{proposal.text}</p>
									<div class="meta">
										<span class="due">
											<Clock class="h-3 w-3" />
											{formatDate(proposal.suggestedDate)}
										</span>
										{#if proposal.reason}
											<span class="reason">"{proposal.reason}"</span>
										{/if}
										<a class="source" href="/memory/{proposal.memoryObjectId}">
											from {memoryTitle(proposal.memoryObjectId)}
											<ArrowRight class="h-3 w-3" />
										</a>
									</div>
								</div>

								<div class="actions">
									{#if proposal.status === 'pending' || proposal.status === 'snoozed'}
										<button
											class="action-btn approve"
											onclick={() => handleApprove(proposal)}
											title="Approve and create action item"
										>
											<Check class="h-4 w-4" />
											<span class="label">Approve</span>
										</button>
										<button
											class="action-btn"
											onclick={() => handleSnooze(proposal)}
											title="Snooze"
										>
											<Clock class="h-4 w-4" />
										</button>
										<button
											class="action-btn"
											onclick={() => handleReject(proposal)}
											title="Reject"
										>
											<X class="h-4 w-4" />
										</button>
									{:else}
										<button
											class="action-btn"
											onclick={() => reopenReminderProposal(proposal.id)}
											title="Reopen"
										>
											<RotateCcw class="h-4 w-4" />
										</button>
										<button
											class="action-btn danger"
											onclick={() => handleDelete(proposal)}
											title="Delete permanently"
										>
											<Trash2 class="h-4 w-4" />
										</button>
									{/if}
								</div>
							</li>
						{/each}
					</ul>
				</section>
			{/if}
		{/each}
	{/if}
</main>

<style>
	.proposals-page {
		max-width: 900px;
		margin: 0 auto;
		padding: 2rem 1.5rem 4rem;
	}

	.page-header {
		text-align: center;
		margin-bottom: 2rem;
	}

	.header-icon {
		display: inline-flex;
		padding: 1rem;
		background: color-mix(in srgb, var(--color-accent) 15%, transparent);
		color: var(--color-accent);
		border-radius: 1rem;
		margin-bottom: 0.75rem;
	}

	.page-header h1 {
		font-size: 2rem;
		font-weight: 700;
		color: var(--color-text);
		margin-bottom: 0.25rem;
	}

	.count {
		color: var(--color-text-muted);
		font-size: 0.875rem;
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
		margin-bottom: 1rem;
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

	.bulk-select-all:hover {
		color: var(--color-text);
	}

	.select-box {
		background: none;
		border: none;
		padding: 0;
		cursor: pointer;
		color: var(--color-text-muted);
		flex-shrink: 0;
		margin-top: 0.1875rem;
	}

	.select-box:hover {
		color: var(--color-accent);
	}

	.item.selected .select-box {
		color: var(--color-accent);
	}

	.empty-state {
		text-align: center;
		padding: 4rem 2rem;
		color: var(--color-text);
	}

	.empty-state .muted {
		margin-top: 0.75rem;
		color: var(--color-text-muted);
		max-width: 32rem;
		margin-left: auto;
		margin-right: auto;
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

	.item.decided {
		opacity: 0.65;
	}

	.item.focused {
		box-shadow: 0 0 0 2px var(--color-accent);
	}

	.item.selected {
		background: color-mix(in srgb, var(--color-accent) 12%, var(--color-bg-secondary));
		border-color: var(--color-accent);
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

	.due {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		color: var(--color-accent);
		font-weight: 500;
	}

	.reason {
		font-style: italic;
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

	.actions {
		display: flex;
		gap: 0.25rem;
		flex-shrink: 0;
		align-items: center;
	}

	.action-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		background: transparent;
		border: 1px solid var(--color-border);
		padding: 0.375rem 0.625rem;
		border-radius: 0.375rem;
		cursor: pointer;
		color: var(--color-text-muted);
		font-size: 0.75rem;
		transition: all 0.15s;
	}

	.action-btn:hover {
		background: var(--color-bg);
		color: var(--color-text);
	}

	.action-btn.approve {
		background: var(--color-accent);
		border-color: var(--color-accent);
		color: white;
	}

	.action-btn.approve:hover {
		background: var(--color-accent-hover);
	}

	.action-btn.danger:hover {
		background: rgba(239, 68, 68, 0.15);
		color: #ef4444;
		border-color: rgba(239, 68, 68, 0.4);
	}

	.action-btn .label {
		font-weight: 500;
	}
</style>
