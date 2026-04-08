<script lang="ts">
	import {
		reminderProposals,
		memoryObjects,
		approveReminderProposal,
		rejectReminderProposal,
		snoozeReminderProposal,
		reopenReminderProposal,
		deleteReminderProposal,
		type ReminderProposal
	} from '$lib/db';
	import { Bell, Check, X, Clock, ArrowRight, Trash2, RotateCcw } from 'lucide-svelte';

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

	function handleSnooze(proposal: ReminderProposal) {
		const next = prompt('Snooze until (YYYY-MM-DD)?', proposal.suggestedDate);
		if (!next) return;
		if (!/^\d{4}-\d{2}-\d{2}$/.test(next)) {
			alert('Please use YYYY-MM-DD format');
			return;
		}
		snoozeReminderProposal(proposal.id, next);
	}

	function handleDelete(proposal: ReminderProposal) {
		if (confirm(`Permanently delete this proposal?\n"${proposal.text}"`)) {
			deleteReminderProposal(proposal.id);
		}
	}
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
		</p>
	</header>

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
							<li class="item" class:decided={proposal.status !== 'pending' && proposal.status !== 'snoozed'}>
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
											onclick={() => approveReminderProposal(proposal.id)}
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
											onclick={() => rejectReminderProposal(proposal.id)}
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
