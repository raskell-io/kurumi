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
	import { onMount } from 'svelte';
	import {
		Mail,
		Calendar,
		Copy,
		Check,
		X,
		Trash2,
		ArrowRight,
		RotateCcw,
		Square,
		MinusSquare,
		CheckSquare
	} from 'lucide-svelte';

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
		return [
			{ label: 'Pending review', status: 'pending', items: pending },
			{ label: 'Used', status: 'used', items: used },
			{ label: 'Rejected', status: 'rejected', items: rejected }
		];
	});

	let pendingCount = $derived(
		$draftProposals.filter((d) => d.status === 'pending').length
	);

	let copiedId = $state<string | null>(null);

	// Flat order + selection + focus (same pattern as /actions, /proposals)
	let flatOrder = $derived(groups.flatMap((g) => g.items));
	let selected = $state<Set<string>>(new Set());
	let selectionSize = $derived(selected.size);
	let focusIndex = $state(-1);
	let focusedId = $derived<string | null>(
		focusIndex >= 0 && focusIndex < flatOrder.length ? flatOrder[focusIndex].id : null
	);

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
		return $memoryObjects.find((m) => m.id === id)?.title ?? 'Untitled';
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
			markDraftUsed(draft.id);
		} catch {
			// Clipboard API can fail in some contexts (permissions, insecure
			// origin). Silently ignore — the markdown is still visible in
			// the UI so the user can select-copy.
		}
	}

	function handleReject(draft: DraftProposal) {
		const snapshot: DraftProposal = { ...draft };
		rejectDraftProposal(draft.id);
		pushUndo({
			label: `Rejected draft`,
			undo: () => restoreDraftProposal(snapshot)
		});
	}

	function handleReopen(draft: DraftProposal) {
		// For this pass, "reopen" on a decided draft just deletes it,
		// letting the user re-extract from the source memory if they
		// want. Dedicated reopenDraft helper can come later if needed.
		const snapshot: DraftProposal = { ...draft };
		deleteDraftProposal(draft.id);
		pushUndo({
			label: `Removed draft`,
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
	<title>Draft proposals - Kurumi</title>
</svelte:head>

<main class="drafts-page">
	<header class="page-header">
		<div class="header-icon">
			<Mail class="h-8 w-8" />
		</div>
		<h1>Draft proposals</h1>
		<p class="count">
			{pendingCount} pending
			{#if $draftProposals.length > pendingCount}
				· {$draftProposals.length - pendingCount} decided
			{/if}
			<span class="hint">j/k nav · Space select · c copy · r reject · d delete</span>
		</p>
	</header>

	{#if selectionSize > 0}
		<div class="bulk-bar">
			<button class="bulk-select" onclick={clearSelection}>
				<CheckSquare class="h-4 w-4" />
				{selectionSize} selected
			</button>
			<button class="bulk-action" onclick={bulkReject}>
				<X class="h-4 w-4" />
				Reject
			</button>
			<button class="bulk-action danger" onclick={bulkDelete}>
				<Trash2 class="h-4 w-4" />
				Delete
			</button>
			<button class="bulk-select-all" onclick={selectAllPending}>
				Select all pending
			</button>
		</div>
	{/if}

	{#if $draftProposals.length === 0}
		<div class="empty-state">
			<p>No draft proposals yet.</p>
			<p class="muted">
				Kurumi scans voice memos and meetings for obvious follow-up emails and
				calendar invites. Drafts appear here for your review — copy them into
				your real email/calendar client when ready.
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
						{#each group.items as draft (draft.id)}
							<li
								class="draft"
								class:decided={draft.status !== 'pending'}
								class:focused={focusedId === draft.id}
								class:selected={isSelected(draft.id)}
							>
								<button
									class="select-box"
									onclick={() => toggleSelected(draft.id)}
									aria-label={isSelected(draft.id) ? 'Deselect' : 'Select'}
								>
									{#if isSelected(draft.id)}
										<MinusSquare class="h-4 w-4" />
									{:else}
										<Square class="h-4 w-4" />
									{/if}
								</button>
								<div class="draft-content">
								<div class="draft-header">
									<span class="kind">
										{#if draft.kind === 'email'}
											<Mail class="h-4 w-4" />
											Email
										{:else}
											<Calendar class="h-4 w-4" />
											Calendar event
										{/if}
									</span>
									{#if draft.target}
										<span class="target">→ {draft.target}</span>
									{/if}
									{#if draft.suggestedDate}
										<span class="when">
											{draft.suggestedDate}
											{#if draft.suggestedTime} · {draft.suggestedTime}{/if}
										</span>
									{/if}
								</div>
								<h3 class="subject">{draft.subject}</h3>
								<p class="body">{draft.body}</p>
								<div class="footer">
									<a class="source" href="/memory/{draft.memoryObjectId}">
										from {memoryTitle(draft.memoryObjectId)}
										<ArrowRight class="h-3 w-3" />
									</a>
									<div class="actions">
										{#if draft.status === 'pending'}
											<button
												class="action-btn primary"
												onclick={() => copyDraft(draft)}
											>
												{#if copiedId === draft.id}
													<Check class="h-4 w-4" />
													Copied
												{:else}
													<Copy class="h-4 w-4" />
													Copy
												{/if}
											</button>
											<button
												class="action-btn"
												onclick={() => handleReject(draft)}
												title="Reject"
											>
												<X class="h-4 w-4" />
											</button>
										{:else}
											<button
												class="action-btn"
												onclick={() => handleReopen(draft)}
												title="Reopen"
											>
												<RotateCcw class="h-4 w-4" />
											</button>
											<button
												class="action-btn danger"
												onclick={() => handleDelete(draft)}
												title="Delete permanently"
											>
												<Trash2 class="h-4 w-4" />
											</button>
										{/if}
									</div>
								</div>
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
	.drafts-page {
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
		margin-top: 0.125rem;
	}

	.select-box:hover {
		color: var(--color-accent);
	}

	.draft.selected .select-box {
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
		gap: 0.75rem;
	}

	.draft {
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
		padding: 1rem;
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border);
		border-radius: 0.75rem;
		transition: border-color 0.15s;
	}

	.draft-content {
		flex: 1;
		min-width: 0;
	}

	.draft:hover {
		border-color: color-mix(in srgb, var(--color-accent) 40%, var(--color-border));
	}

	.draft.decided {
		opacity: 0.65;
	}

	.draft.focused {
		box-shadow: 0 0 0 2px var(--color-accent);
	}

	.draft.selected {
		background: color-mix(in srgb, var(--color-accent) 12%, var(--color-bg-secondary));
		border-color: var(--color-accent);
	}

	.draft-header {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.75rem;
		font-size: 0.75rem;
		color: var(--color-text-muted);
		margin-bottom: 0.5rem;
	}

	.kind {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		color: var(--color-accent);
		font-weight: 500;
	}

	.target {
		color: var(--color-text);
	}

	.when {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.125rem 0.5rem;
		background: var(--color-bg);
		border-radius: 999px;
	}

	.subject {
		font-size: 1rem;
		font-weight: 600;
		color: var(--color-text);
		margin: 0 0 0.5rem 0;
	}

	.body {
		font-size: 0.875rem;
		line-height: 1.5;
		color: var(--color-text);
		margin: 0 0 0.75rem 0;
		white-space: pre-wrap;
	}

	.footer {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.75rem;
	}

	.source {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		font-size: 0.75rem;
		color: var(--color-text-muted);
		text-decoration: none;
	}

	.source:hover {
		color: var(--color-accent);
	}

	.actions {
		display: flex;
		gap: 0.375rem;
	}

	.action-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.375rem 0.75rem;
		background: transparent;
		border: 1px solid var(--color-border);
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

	.action-btn.primary {
		background: var(--color-accent);
		border-color: var(--color-accent);
		color: white;
	}

	.action-btn.primary:hover {
		background: var(--color-accent-hover);
	}

	.action-btn.danger:hover {
		background: rgba(239, 68, 68, 0.15);
		color: #ef4444;
		border-color: rgba(239, 68, 68, 0.4);
	}
</style>
