<script lang="ts">
	import {
		draftProposals,
		memoryObjects,
		markDraftUsed,
		rejectDraftProposal,
		deleteDraftProposal,
		restoreDraftProposal,
		type DraftProposal
	} from '$lib/db';
	import { pushUndo } from '$lib/stores/undo';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import {
		ArrowUpRight,
		Calendar,
		Check,
		CircleCheck,
		Copy,
		Mail,
		RotateCcw,
		Square,
		SquareCheck,
		Trash2,
		X
	} from 'lucide-svelte';

	// Filter tabs. Pending is the review queue; used/rejected drafts are
	// history, one click away.
	type Filter = 'pending' | 'decided' | 'all';
	const FILTERS: Array<{ value: Filter; label: string }> = [
		{ value: 'pending', label: 'Pending' },
		{ value: 'decided', label: 'Used & rejected' },
		{ value: 'all', label: 'All' }
	];
	let filter = $state<Filter>('pending');

	function setFilter(next: Filter) {
		if (filter === next) return;
		filter = next;
		clearSelection();
		focusIndex = -1;
	}

	type Group = {
		label: string;
		status: DraftProposal['status'];
		items: DraftProposal[];
	};

	let groups = $derived.by<Group[]>(() => {
		const pending: DraftProposal[] = [];
		const used: DraftProposal[] = [];
		const rejected: DraftProposal[] = [];
		for (const d of $draftProposals) {
			if (d.status === 'pending') pending.push(d);
			else if (d.status === 'used') used.push(d);
			else rejected.push(d);
		}
		const all: Group[] = [
			{ label: 'Pending review', status: 'pending', items: pending },
			{ label: 'Used', status: 'used', items: used },
			{ label: 'Rejected', status: 'rejected', items: rejected }
		];
		if (filter === 'pending') return all.slice(0, 1);
		if (filter === 'decided') return all.slice(1);
		return all;
	});

	let pendingCount = $derived(
		$draftProposals.filter((d) => d.status === 'pending').length
	);
	let filterCounts = $derived<Record<Filter, number>>({
		pending: pendingCount,
		decided: $draftProposals.length - pendingCount,
		all: $draftProposals.length
	});

	let copiedId = $state<string | null>(null);

	// Flat order + selection + focus (same pattern as /actions, /proposals)
	let flatOrder = $derived(groups.flatMap((g) => g.items));
	let selected = $state<Set<string>>(new Set());
	let selectionSize = $derived(selected.size);
	let focusIndex = $state(-1);
	let focusedId = $derived<string | null>(
		focusIndex >= 0 && focusIndex < flatOrder.length ? flatOrder[focusIndex].id : null
	);
	let visiblePendingCount = $derived(flatOrder.filter((d) => d.status === 'pending').length);

	// Keep the keyboard cursor visible while moving through long lists.
	$effect(() => {
		if (!focusedId) return;
		document
			.querySelector(`[data-row-id="${CSS.escape(focusedId)}"]`)
			?.scrollIntoView({ block: 'nearest' });
	});

	// Bodies are clamped to two lines; the keyboard-focused row and any
	// row the user clicked open show the full text.
	let expanded = $state<Set<string>>(new Set());

	function toggleExpanded(id: string) {
		// Don't collapse while the user is selecting text to copy by hand.
		if (window.getSelection()?.toString()) return;
		const next = new Set(expanded);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		expanded = next;
	}

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
		selected = new Set(flatOrder.filter((d) => d.status === 'pending').map((d) => d.id));
	}

	function memoryTitle(id: string): string {
		return $memoryObjects.find((m) => m.id === id)?.title || 'Untitled';
	}

	async function copyDraft(draft: DraftProposal) {
		// Build a clipboard-friendly representation.
		let text: string;
		if (draft.kind === 'email') {
			const lines: string[] = [];
			if (draft.target) lines.push(`To: ${draft.target}`);
			lines.push(`Subject: ${draft.subject}`);
			lines.push('');
			lines.push(draft.body);
			text = lines.join('\n');
		} else {
			const lines: string[] = [`Event: ${draft.subject}`];
			if (draft.suggestedDate) {
				lines.push(
					`When: ${draft.suggestedDate}${draft.suggestedTime ? ' ' + draft.suggestedTime : ''}`
				);
			}
			if (draft.target) lines.push(`Attendees: ${draft.target}`);
			lines.push('');
			lines.push(draft.body);
			text = lines.join('\n');
		}
		try {
			await navigator.clipboard.writeText(text);
			copiedId = draft.id;
			setTimeout(() => {
				if (copiedId === draft.id) copiedId = null;
			}, 2000);
			if (draft.status === 'pending') {
				// Copying moves the draft out of the pending view, so the
				// undo toast doubles as the "copied" confirmation.
				const snapshot: DraftProposal = { ...draft };
				markDraftUsed(draft.id);
				pushUndo({
					label: `Copied draft — marked used`,
					undo: () => restoreDraftProposal(snapshot)
				});
			} else {
				markDraftUsed(draft.id);
			}
		} catch {
			// Clipboard API can fail in some contexts (permissions, insecure
			// origin). Silently ignore — the full text is visible when the
			// row is expanded so the user can select-copy.
		}
	}

	function handleReject(draft: DraftProposal) {
		if (draft.status === 'rejected') return;
		const snapshot: DraftProposal = { ...draft };
		rejectDraftProposal(draft.id);
		pushUndo({
			label: `Rejected draft`,
			undo: () => restoreDraftProposal(snapshot)
		});
	}

	function handleReopen(draft: DraftProposal) {
		// Move a used/rejected draft back to the pending queue.
		const snapshot: DraftProposal = { ...draft };
		restoreDraftProposal({ ...draft, status: 'pending', decidedAt: null });
		pushUndo({
			label: `Reopened draft`,
			undo: () => restoreDraftProposal(snapshot)
		});
	}

	function handleDelete(draft: DraftProposal) {
		const snapshot: DraftProposal = { ...draft };
		deleteDraftProposal(draft.id);
		pushUndo({
			label: `Deleted draft`,
			undo: () => restoreDraftProposal(snapshot)
		});
	}

	// --- Bulk operations --------------------------------------------------

	function bulkReject() {
		const targets = flatOrder.filter((d) => selected.has(d.id) && d.status !== 'rejected');
		if (targets.length === 0) return;
		const snapshots = targets.map((d) => ({ ...d }));
		for (const t of targets) rejectDraftProposal(t.id);
		pushUndo({
			label: `Rejected ${targets.length} drafts`,
			undo: () => {
				for (const snap of snapshots) restoreDraftProposal(snap);
			}
		});
		clearSelection();
	}

	function bulkDelete() {
		const targets = flatOrder.filter((d) => selected.has(d.id));
		if (targets.length === 0) return;
		const snapshots = targets.map((d) => ({ ...d }));
		for (const t of targets) deleteDraftProposal(t.id);
		pushUndo({
			label: `Deleted ${targets.length} drafts`,
			undo: () => {
				for (const snap of snapshots) restoreDraftProposal(snap);
			}
		});
		clearSelection();
	}

	// --- Keyboard navigation ---------------------------------------------
	//
	// Ignored while typing in form controls and when a modifier is held,
	// so Cmd+C / Cmd+R etc. keep their normal meaning.

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
			case 'c':
			case 'C':
				e.preventDefault();
				if (flatOrder[focusIndex]) void copyDraft(flatOrder[focusIndex]);
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
	<title>Drafts - Kurumi</title>
</svelte:head>

<div class="k-page">
	<header class="k-page-header">
		<div class="min-w-0">
			<h1 class="k-page-title">Drafts</h1>
			<p class="k-page-subtitle">
				{pendingCount} pending
				{#if $draftProposals.length > pendingCount}
					· {$draftProposals.length - pendingCount} decided
				{/if}
			</p>
			<div class="k-hints">
				<span><kbd class="k-kbd">j</kbd> <kbd class="k-kbd">k</kbd> navigate</span>
				<span><kbd class="k-kbd">Space</kbd> select</span>
				<span><kbd class="k-kbd">c</kbd> copy</span>
				<span><kbd class="k-kbd">r</kbd> reject</span>
				<span><kbd class="k-kbd">d</kbd> delete</span>
				<span><kbd class="k-kbd">↵</kbd> open source</span>
			</div>
		</div>
		{#if visiblePendingCount > 0}
			<button class="k-btn shrink-0" onclick={selectAllPending}>
				<SquareCheck class="h-4 w-4" />
				Select pending
			</button>
		{/if}
	</header>

	{#if $draftProposals.length > 0}
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

	{#if $draftProposals.length === 0}
		<div class="k-empty">
			<Mail />
			<p class="k-empty-title">No drafts yet</p>
			<p class="max-w-sm">
				Follow-up emails and calendar invites spotted in voice memos and
				meetings land here, ready to copy into your mail or calendar.
			</p>
		</div>
	{:else if flatOrder.length === 0}
		<div class="k-empty">
			<CircleCheck />
			<p class="k-empty-title">{filter === 'pending' ? 'All reviewed' : 'Nothing here yet'}</p>
			<p>
				{filter === 'pending'
					? 'Every draft has been used or rejected.'
					: 'Used and rejected drafts will show up here.'}
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
						{#each group.items as draft (draft.id)}
							{@const isExpanded = expanded.has(draft.id) || focusedId === draft.id}
							<li
								class="k-row item"
								class:decided={draft.status !== 'pending'}
								class:focused={focusedId === draft.id}
								class:selected={isSelected(draft.id)}
								data-row-id={draft.id}
							>
								<button
									class="select-box"
									onclick={() => toggleSelected(draft.id)}
									aria-label={isSelected(draft.id) ? 'Deselect' : 'Select'}
									aria-pressed={isSelected(draft.id)}
								>
									{#if isSelected(draft.id)}
										<SquareCheck class="h-4 w-4" />
									{:else}
										<Square class="h-4 w-4" />
									{/if}
								</button>
								<span class="lead" title={draft.kind === 'email' ? 'Email' : 'Calendar event'}>
									{#if draft.kind === 'email'}
										<Mail class="h-4 w-4" />
									{:else}
										<Calendar class="h-4 w-4" />
									{/if}
								</span>

								<div class="content">
									<div class="head">
										<p class="subject">{draft.subject || '(no subject)'}</p>
										{#if draft.status === 'used'}
											<span class="k-badge k-badge-success">Used</span>
										{:else if draft.status === 'rejected'}
											<span class="k-badge">Rejected</span>
										{/if}
									</div>
									<div class="meta">
										{#if draft.target}
											<span class="truncate">
												{draft.kind === 'email' ? 'To' : 'With'}
												<span class="text-[var(--color-text-muted)]">{draft.target}</span>
											</span>
										{/if}
										{#if draft.suggestedDate}
											<span class="shrink-0 tabular-nums">
												{draft.suggestedDate}{#if draft.suggestedTime}&nbsp;· {draft.suggestedTime}{/if}
											</span>
										{/if}
										<a class="source" href="/memory/{draft.memoryObjectId}">
											<ArrowUpRight class="h-3 w-3 shrink-0" />
											<span class="truncate">{memoryTitle(draft.memoryObjectId)}</span>
										</a>
									</div>
									{#if draft.body}
										<button
											class="preview"
											class:expanded={isExpanded}
											onclick={() => toggleExpanded(draft.id)}
											aria-expanded={isExpanded}
										>
											{draft.body}
										</button>
									{/if}
								</div>

								<div class="row-actions">
									{#if draft.status === 'pending'}
										<button
											class="k-icon-btn"
											class:copied={copiedId === draft.id}
											onclick={() => copyDraft(draft)}
											title={copiedId === draft.id ? 'Copied' : 'Copy to clipboard (c)'}
											aria-label={copiedId === draft.id ? 'Copied' : 'Copy to clipboard'}
										>
											{#if copiedId === draft.id}
												<Check class="h-4 w-4" />
											{:else}
												<Copy class="h-4 w-4" />
											{/if}
										</button>
										<button
											class="k-icon-btn"
											onclick={() => handleReject(draft)}
											title="Reject (r)"
											aria-label="Reject"
										>
											<X class="h-4 w-4" />
										</button>
									{:else}
										<button
											class="k-icon-btn"
											class:copied={copiedId === draft.id}
											onclick={() => copyDraft(draft)}
											title={copiedId === draft.id ? 'Copied' : 'Copy again (c)'}
											aria-label={copiedId === draft.id ? 'Copied' : 'Copy to clipboard'}
										>
											{#if copiedId === draft.id}
												<Check class="h-4 w-4" />
											{:else}
												<Copy class="h-4 w-4" />
											{/if}
										</button>
										<button
											class="k-icon-btn"
											onclick={() => handleReopen(draft)}
											title="Move back to pending"
											aria-label="Reopen"
										>
											<RotateCcw class="h-4 w-4" />
										</button>
										<button
											class="k-icon-btn danger"
											onclick={() => handleDelete(draft)}
											title="Delete (d)"
											aria-label="Delete"
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
		padding-top: 0.5rem;
		padding-bottom: 0.5rem;
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
	.item.selected .select-box {
		color: var(--color-accent);
	}

	.item:hover .select-box,
	.item.focused .select-box,
	.item.selected .select-box,
	.has-selection .select-box,
	.select-box:focus-visible {
		opacity: 1;
	}

	.content {
		flex: 1;
		min-width: 0;
		padding-top: 0.0625rem;
	}

	.head {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-width: 0;
	}

	.subject {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-weight: 500;
		line-height: 1.4;
	}

	.item.decided .subject {
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

	.preview {
		display: -webkit-box;
		width: 100%;
		margin-top: 0.25rem;
		overflow: hidden;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		font-size: 0.8125rem;
		line-height: 1.5;
		color: var(--color-text-muted);
		text-align: left;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		cursor: pointer;
	}

	.preview.expanded {
		display: block;
		color: var(--color-text);
		cursor: text;
		user-select: text;
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

	.row-actions .copied {
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

		.content {
			flex-basis: calc(100% - 5rem);
		}

		.row-actions {
			margin-left: auto;
		}
	}
</style>
