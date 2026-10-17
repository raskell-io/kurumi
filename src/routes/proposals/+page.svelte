<script lang="ts">
	import { autofocus } from '$lib/actions/autofocus';
	import {
		reminderProposals,
		memoryObjects,
		approveReminderProposal,
		rejectReminderProposal,
		snoozeReminderProposal,
		reopenReminderProposal,
		deleteReminderProposal,
		restoreReminderProposal,
		updateReminderProposalRecurrence,
		deleteActionItem,
		restoreActionItem,
		actionItems,
		todayIso,
		type ReminderProposal,
		type Recurrence
	} from '$lib/db';
	import { pushUndo } from '$lib/stores/undo';
	import { goto } from '$app/navigation';
	import { get } from 'svelte/store';
	import { onMount } from 'svelte';
	import {
		AlarmClock,
		ArrowUpRight,
		Bell,
		CalendarClock,
		Check,
		CircleCheck,
		CircleX,
		Repeat,
		RotateCcw,
		Square,
		SquareCheck,
		Trash2,
		X
	} from 'lucide-svelte';

	const RECURRENCE_OPTIONS: Array<{ value: Recurrence; label: string }> = [
		{ value: 'none', label: 'One-off' },
		{ value: 'daily', label: 'Daily' },
		{ value: 'weekly', label: 'Weekly' },
		{ value: 'monthly', label: 'Monthly' },
		{ value: 'yearly', label: 'Yearly' }
	];

	// Filter tabs. "To review" (pending + snoozed) is the default — the
	// decided ones are an audit log, one click away.
	type Filter = 'open' | 'decided' | 'all';
	const FILTERS: Array<{ value: Filter; label: string }> = [
		{ value: 'open', label: 'To review' },
		{ value: 'decided', label: 'Decided' },
		{ value: 'all', label: 'All' }
	];
	let filter = $state<Filter>('open');

	function setFilter(next: Filter) {
		if (filter === next) return;
		filter = next;
		clearSelection();
		focusIndex = -1;
		snoozingId = null;
	}

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
		const all: Group[] = [
			{ label: 'Pending review', status: 'pending', items: pending },
			{ label: 'Snoozed', status: 'snoozed', items: snoozed },
			{ label: 'Approved', status: 'approved', items: approved },
			{ label: 'Rejected', status: 'rejected', items: rejected }
		];
		if (filter === 'open') return all.slice(0, 2);
		if (filter === 'decided') return all.slice(2);
		return all;
	});

	let pendingCount = $derived(
		$reminderProposals.filter((p) => p.status === 'pending').length
	);
	let openCount = $derived($reminderProposals.filter(isOpen).length);
	let filterCounts = $derived<Record<Filter, number>>({
		open: openCount,
		decided: $reminderProposals.length - openCount,
		all: $reminderProposals.length
	});

	function isOpen(p: ReminderProposal): boolean {
		return p.status === 'pending' || p.status === 'snoozed';
	}

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

	let visiblePendingCount = $derived(flatOrder.filter((p) => p.status === 'pending').length);

	// Keyboard focus
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

	function memoryTitle(id: string): string {
		return $memoryObjects.find((m) => m.id === id)?.title || 'Untitled';
	}

	// Human date label + tone. Only open proposals get overdue/today
	// colouring; a decided proposal's date is just history.
	const today = todayIso();

	function dueInfo(iso: string, active: boolean): { label: string; tone: '' | 'danger' | 'warn' } {
		const date = new Date(iso + 'T00:00:00');
		if (Number.isNaN(date.getTime())) return { label: iso, tone: '' };
		const days = Math.round((date.getTime() - new Date(today + 'T00:00:00').getTime()) / 86_400_000);
		let label: string;
		if (days === 0) label = 'Today';
		else if (days === 1) label = 'Tomorrow';
		else if (days === -1) label = 'Yesterday';
		else if (days > 1 && days < 7) label = date.toLocaleDateString(undefined, { weekday: 'short' });
		else
			label = date.toLocaleDateString(undefined, {
				month: 'short',
				day: 'numeric',
				year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric'
			});
		const tone = !active ? '' : days < 0 ? 'danger' : days === 0 ? 'warn' : '';
		return { label, tone };
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
	//
	// Undo restores the exact pre-action snapshot (status, date,
	// recurrence) rather than blindly reopening, and approving also
	// removes the ActionItem it created so undo + re-approve doesn't
	// leave duplicates behind.

	function createdActionItemId(id: string): string | null {
		return get(reminderProposals).find((p) => p.id === id)?.actionItemId ?? null;
	}

	function handleApprove(proposal: ReminderProposal) {
		if (proposal.status === 'approved') return;
		const snapshot: ReminderProposal = { ...proposal };
		approveReminderProposal(proposal.id);
		const actionItemId = createdActionItemId(proposal.id);
		pushUndo({
			label: `Approved reminder`,
			undo: () => {
				if (actionItemId) deleteActionItem(actionItemId);
				restoreReminderProposal(snapshot);
			}
		});
	}

	function handleReject(proposal: ReminderProposal) {
		if (proposal.status === 'rejected') return;
		const snapshot: ReminderProposal = { ...proposal };
		rejectReminderProposal(proposal.id);
		pushUndo({
			label: `Rejected reminder`,
			undo: () => restoreReminderProposal(snapshot)
		});
	}

	function handleReopen(proposal: ReminderProposal) {
		const snapshot: ReminderProposal = { ...proposal };
		// Approving created an action item. If it's still untouched (never
		// edited, still open), take it back too so re-approving later doesn't
		// leave a duplicate. Items the user has worked on are kept.
		const created = proposal.actionItemId
			? get(actionItems).find((item) => item.id === proposal.actionItemId)
			: undefined;
		const removeCreated =
			created && created.status === 'open' && created.updatedAt === created.createdAt;
		const itemSnapshot = removeCreated ? { ...created } : null;
		if (itemSnapshot) deleteActionItem(itemSnapshot.id);
		reopenReminderProposal(proposal.id);
		pushUndo({
			label: itemSnapshot ? 'Reopened reminder and removed its action item' : 'Reopened reminder',
			undo: () => {
				if (itemSnapshot) restoreActionItem(itemSnapshot);
				restoreReminderProposal(snapshot);
			}
		});
	}

	// Inline snooze: the row swaps its meta for a date field (Enter
	// saves, Escape cancels) instead of a blocking prompt().
	let snoozingId = $state<string | null>(null);
	let snoozeDate = $state('');

	function startSnooze(proposal: ReminderProposal) {
		if (!isOpen(proposal)) return;
		snoozingId = proposal.id;
		snoozeDate = proposal.suggestedDate;
	}

	function cancelSnooze() {
		snoozingId = null;
		snoozeDate = '';
	}

	function saveSnooze() {
		const proposal = $reminderProposals.find((p) => p.id === snoozingId);
		const next = snoozeDate.trim();
		if (!proposal || !/^\d{4}-\d{2}-\d{2}$/.test(next)) return;
		const snapshot: ReminderProposal = { ...proposal };
		snoozeReminderProposal(proposal.id, next);
		pushUndo({
			label: `Snoozed reminder`,
			undo: () => restoreReminderProposal(snapshot)
		});
		cancelSnooze();
	}

	function handleSnoozeKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			saveSnooze();
		} else if (e.key === 'Escape') {
			e.preventDefault();
			cancelSnooze();
		}
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
		const snapshots = targets.map((p) => ({ ...p }));
		for (const t of targets) approveReminderProposal(t.id);
		const created = targets.map((t) => createdActionItemId(t.id));
		pushUndo({
			label: `Approved ${targets.length} proposals`,
			undo: () => {
				for (const id of created) if (id) deleteActionItem(id);
				for (const snap of snapshots) restoreReminderProposal(snap);
			}
		});
		clearSelection();
	}

	function bulkReject() {
		const targets = flatOrder.filter((p) => selected.has(p.id) && p.status !== 'rejected');
		if (targets.length === 0) return;
		const snapshots = targets.map((p) => ({ ...p }));
		for (const t of targets) rejectReminderProposal(t.id);
		pushUndo({
			label: `Rejected ${targets.length} proposals`,
			undo: () => {
				for (const snap of snapshots) restoreReminderProposal(snap);
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
	//
	// Ignored while typing in form controls and when a modifier is held,
	// so global shortcuts (Cmd+R, Cmd+Shift+A, ...) don't also act on
	// the focused row.

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
					e.preventDefault();
					goto(`/memory/${flatOrder[focusIndex].memoryObjectId}`);
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
			case 's':
			case 'S':
				e.preventDefault();
				if (flatOrder[focusIndex]) startSnooze(flatOrder[focusIndex]);
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

<div class="k-page">
	<header class="k-page-header">
		<div class="min-w-0">
			<h1 class="k-page-title">Reminder proposals</h1>
			<p class="k-page-subtitle">
				{pendingCount} pending
				{#if $reminderProposals.length > pendingCount}
					· {$reminderProposals.length - pendingCount} snoozed or decided
				{/if}
			</p>
			<div class="k-hints">
				<span><kbd class="k-kbd">j</kbd> <kbd class="k-kbd">k</kbd> navigate</span>
				<span><kbd class="k-kbd">Space</kbd> select</span>
				<span><kbd class="k-kbd">a</kbd> approve</span>
				<span><kbd class="k-kbd">s</kbd> snooze</span>
				<span><kbd class="k-kbd">r</kbd> reject</span>
				<span><kbd class="k-kbd">d</kbd> delete</span>
			</div>
		</div>
		{#if visiblePendingCount > 0}
			<button class="k-btn shrink-0" onclick={selectAllPending}>
				<SquareCheck class="h-4 w-4" />
				Select pending
			</button>
		{/if}
	</header>

	{#if $reminderProposals.length > 0}
		<div class="k-segmented mb-4" role="group" aria-label="Filter">
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

	{#if selectionSize > 0}
		<div class="k-bulk-bar" role="toolbar" aria-label="Bulk actions">
			<span class="px-2 text-xs font-medium tabular-nums text-[var(--color-text)]">
				{selectionSize} selected
			</span>
			<button class="k-btn k-btn-ghost k-btn-sm" onclick={bulkApprove}>
				<Check class="h-3.5 w-3.5" />
				Approve
			</button>
			<button class="k-btn k-btn-ghost k-btn-sm" onclick={bulkReject}>
				<X class="h-3.5 w-3.5" />
				Reject
			</button>
			<button class="k-btn k-btn-ghost k-btn-danger k-btn-sm" onclick={bulkDelete}>
				<Trash2 class="h-3.5 w-3.5" />
				Delete
			</button>
			<span class="ml-auto flex items-center gap-1">
				{#if visiblePendingCount > 0}
					<button class="k-btn k-btn-ghost k-btn-sm" onclick={selectAllPending}>
						Select all pending
					</button>
				{/if}
				<button class="k-icon-btn" onclick={clearSelection} title="Clear selection (Esc)" aria-label="Clear selection">
					<X class="h-4 w-4" />
				</button>
			</span>
		</div>
	{/if}

	{#if $reminderProposals.length === 0}
		<div class="k-empty">
			<Bell />
			<p class="k-empty-title">No reminder proposals yet</p>
			<p class="max-w-sm">
				Kurumi scans voice memos and meetings for follow-ups like “remind me
				tomorrow” and queues them here for your review.
			</p>
		</div>
	{:else if flatOrder.length === 0}
		<div class="k-empty">
			<CircleCheck />
			<p class="k-empty-title">{filter === 'open' ? 'All reviewed' : 'Nothing decided yet'}</p>
			<p>
				{filter === 'open'
					? 'Every proposal has been approved or rejected.'
					: 'Approved and rejected proposals will show up here.'}
			</p>
		</div>
	{:else}
		{#each groups as group (group.status)}
			{#if group.items.length > 0}
				<section>
					<h2 class="k-section-title">
						{group.label}
						<span class="tabular-nums font-normal">{group.items.length}</span>
					</h2>
					<ul class="items" class:has-selection={selectionSize > 0}>
						{#each group.items as proposal (proposal.id)}
							{@const open = isOpen(proposal)}
							{@const due = dueInfo(proposal.suggestedDate, open)}
							<li
								class="k-row item"
								class:decided={!open}
								class:focused={focusedId === proposal.id}
								class:selected={isSelected(proposal.id)}
								data-row-id={proposal.id}
							>
								<button
									class="select-box"
									onclick={() => toggleSelected(proposal.id)}
									aria-label={isSelected(proposal.id) ? 'Deselect' : 'Select'}
									aria-pressed={isSelected(proposal.id)}
								>
									{#if isSelected(proposal.id)}
										<SquareCheck class="h-4 w-4" />
									{:else}
										<Square class="h-4 w-4" />
									{/if}
								</button>
								<span class="lead" class:lead-approved={proposal.status === 'approved'} aria-hidden="true">
									{#if proposal.status === 'approved'}
										<CircleCheck class="h-4 w-4" />
									{:else if proposal.status === 'rejected'}
										<CircleX class="h-4 w-4" />
									{:else if proposal.status === 'snoozed'}
										<AlarmClock class="h-4 w-4" />
									{:else}
										<Bell class="h-4 w-4" />
									{/if}
								</span>

								<div class="body">
									<p class="text">{proposal.text}</p>
									<div class="meta">
										{#if proposal.reason}
											<span class="reason" title={proposal.reason}>“{proposal.reason}”</span>
										{/if}
										<a class="source" href="/memory/{proposal.memoryObjectId}">
											<ArrowUpRight class="h-3 w-3 shrink-0" />
											<span class="truncate">{memoryTitle(proposal.memoryObjectId)}</span>
										</a>
									</div>
								</div>

								{#if snoozingId === proposal.id}
									<div class="snooze-form">
																				<input
											type="date"
											bind:value={snoozeDate}
											onkeydown={handleSnoozeKeydown}
											class="k-input h-7 w-auto text-xs"
											aria-label="Snooze until"
											use:autofocus
										/>
										<button class="k-btn k-btn-ghost k-btn-sm" onclick={cancelSnooze}>Cancel</button>
										<button class="k-btn k-btn-primary k-btn-sm" onclick={saveSnooze} disabled={!snoozeDate}>
											Snooze
										</button>
									</div>
								{:else}
									<div class="badges">
										{#if open}
											<label class="k-badge recurrence-picker" title="Repeat">
												<Repeat class="h-3 w-3" />
												<select
													value={proposal.recurrence ?? 'none'}
													aria-label="Repeat"
													onchange={(e) =>
														updateReminderProposalRecurrence(
															proposal.id,
															(e.currentTarget as HTMLSelectElement).value as Recurrence
														)}
												>
													{#each RECURRENCE_OPTIONS as opt (opt.value)}
														<option value={opt.value}>{opt.label}</option>
													{/each}
												</select>
											</label>
										{:else if proposal.recurrence && proposal.recurrence !== 'none'}
											<span class="k-badge capitalize">
												<Repeat class="h-3 w-3" />
												{proposal.recurrence}
											</span>
										{/if}
										<span
											class="k-badge"
											class:k-badge-danger={due.tone === 'danger'}
											class:k-badge-warn={due.tone === 'warn'}
											title={formatDate(proposal.suggestedDate)}
										>
											<CalendarClock class="h-3 w-3" />
											{due.label}
										</span>
									</div>

									<div class="row-actions">
										{#if open}
											<button
												class="k-icon-btn approve"
												onclick={() => handleApprove(proposal)}
												title="Approve and create action item (a)"
												aria-label="Approve"
											>
												<Check class="h-4 w-4" />
											</button>
											<button
												class="k-icon-btn"
												onclick={() => startSnooze(proposal)}
												title="Snooze (s)"
												aria-label="Snooze"
											>
												<AlarmClock class="h-4 w-4" />
											</button>
											<button
												class="k-icon-btn"
												onclick={() => handleReject(proposal)}
												title="Reject (r)"
												aria-label="Reject"
											>
												<X class="h-4 w-4" />
											</button>
										{:else}
											<button
												class="k-icon-btn"
												onclick={() => handleReopen(proposal)}
												title="Reopen"
												aria-label="Reopen"
											>
												<RotateCcw class="h-4 w-4" />
											</button>
											<button
												class="k-icon-btn danger"
												onclick={() => handleDelete(proposal)}
												title="Delete (d)"
												aria-label="Delete"
											>
												<Trash2 class="h-4 w-4" />
											</button>
										{/if}
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

	.select-box,
	.lead {
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
	.item.selected .select-box,
	.lead-approved {
		color: var(--color-accent);
	}

	.item:hover .select-box,
	.item.focused .select-box,
	.item.selected .select-box,
	.has-selection .select-box,
	.select-box:focus-visible {
		opacity: 1;
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

	.item.decided .text {
		color: var(--color-text-muted);
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

	.reason {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-style: italic;
		color: var(--color-text-muted);
	}

	.source {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		min-width: 0;
		max-width: 50%;
		flex-shrink: 0;
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

	/* Recurrence picker dressed as a badge; the native select keeps
	   keyboard + mobile pickers working. */
	.recurrence-picker {
		cursor: pointer;
	}

	.recurrence-picker:hover {
		color: var(--color-text);
	}

	.recurrence-picker select {
		padding: 0;
		border: none;
		background: transparent;
		color: inherit;
		font: inherit;
		cursor: pointer;
		outline: none;
	}

	.snooze-form {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		flex-shrink: 0;
		margin: -0.125rem 0;
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

	.row-actions .approve:hover {
		color: var(--color-accent);
	}

	.row-actions .danger:hover {
		color: var(--color-danger);
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

		.badges,
		.snooze-form {
			margin-left: 2.5rem;
		}

		.row-actions {
			margin-left: auto;
		}
	}
</style>
