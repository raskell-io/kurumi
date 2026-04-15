<script lang="ts">
	import {
		memoryObjects,
		actionItems,
		reminderProposals,
		draftProposals
	} from '$lib/db';
	import { goto } from '$app/navigation';
	import {
		Inbox,
		Bell,
		CheckSquare,
		FileText,
		Mail,
		AlertTriangle,
		ChevronRight,
		Tag
	} from 'lucide-svelte';

	const now = Date.now();
	const oneDayMs = 86_400_000;
	const todayIso = new Date().toISOString().split('T')[0];

	// Recent un-summarized memories (voice memos/meetings without summaries)
	let unsummarized = $derived.by(() =>
		$memoryObjects
			.filter(
				(m) =>
					!m.deletedAt &&
					(m.type === 'voice-memo' || m.type === 'meeting') &&
					m.processingState === 'ready' &&
					!m.summaryShort &&
					m.transcript
			)
			.sort((a, b) => b.createdAt - a.createdAt)
			.slice(0, 10)
	);

	// Recent notes missing tags (created in last 7 days)
	let untagged = $derived.by(() =>
		$memoryObjects
			.filter(
				(m) =>
					!m.deletedAt &&
					m.type === 'note' &&
					m.createdAt > now - 7 * oneDayMs &&
					(!m.tags || m.tags.length === 0)
			)
			.sort((a, b) => b.createdAt - a.createdAt)
			.slice(0, 10)
	);

	// Overdue action items
	let overdue = $derived.by(() =>
		$actionItems
			.filter(
				(a) =>
					(a.status === 'open' || a.status === 'in_progress') &&
					a.dueDate !== null &&
					a.dueDate < todayIso
			)
			.sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''))
	);

	// Due today
	let dueToday = $derived.by(() =>
		$actionItems
			.filter(
				(a) =>
					(a.status === 'open' || a.status === 'in_progress') &&
					a.dueDate === todayIso
			)
	);

	// Pending proposals
	let pendingProposals = $derived(
		$reminderProposals.filter((p) => p.status === 'pending')
	);

	// Pending drafts
	let pendingDrafts = $derived(
		$draftProposals.filter((d) => d.status === 'pending')
	);

	// Total attention count
	let totalCount = $derived(
		unsummarized.length +
		untagged.length +
		overdue.length +
		dueToday.length +
		pendingProposals.length +
		pendingDrafts.length
	);

	function relativeDate(ts: number): string {
		const diff = Math.floor((now - ts) / 1000);
		if (diff < 60) return 'just now';
		if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
		if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
		return `${Math.floor(diff / 86400)}d ago`;
	}
</script>

<div class="inbox-page">
	<header class="inbox-header">
		<div class="inbox-title">
			<Inbox class="h-5 w-5" />
			<h1>Inbox</h1>
			{#if totalCount > 0}
				<span class="inbox-badge">{totalCount}</span>
			{/if}
		</div>
		<p class="inbox-subtitle">Items that need your attention</p>
	</header>

	{#if totalCount === 0}
		<div class="inbox-empty">
			<Inbox class="h-10 w-10 opacity-20" />
			<p>All clear! Nothing needs your attention right now.</p>
		</div>
	{:else}
		<div class="inbox-sections">
			<!-- Overdue action items -->
			{#if overdue.length > 0}
				<section class="inbox-section">
					<button class="section-header danger" onclick={() => goto('/actions')}>
						<AlertTriangle class="h-4 w-4" />
						<span>Overdue ({overdue.length})</span>
						<ChevronRight class="h-4 w-4 ml-auto" />
					</button>
					<div class="section-items">
						{#each overdue.slice(0, 5) as item}
							<div class="inbox-item">
								<CheckSquare class="h-3.5 w-3.5 text-red-500 shrink-0" />
								<span class="item-text">{item.text}</span>
								<span class="item-meta">due {item.dueDate}</span>
							</div>
						{/each}
						{#if overdue.length > 5}
							<button class="see-all" onclick={() => goto('/actions')}>
								+{overdue.length - 5} more
							</button>
						{/if}
					</div>
				</section>
			{/if}

			<!-- Due today -->
			{#if dueToday.length > 0}
				<section class="inbox-section">
					<button class="section-header accent" onclick={() => goto('/actions')}>
						<CheckSquare class="h-4 w-4" />
						<span>Due today ({dueToday.length})</span>
						<ChevronRight class="h-4 w-4 ml-auto" />
					</button>
					<div class="section-items">
						{#each dueToday as item}
							<div class="inbox-item">
								<CheckSquare class="h-3.5 w-3.5 shrink-0" />
								<span class="item-text">{item.text}</span>
								{#if item.assignee}
									<span class="item-meta">@{item.assignee}</span>
								{/if}
							</div>
						{/each}
					</div>
				</section>
			{/if}

			<!-- Pending proposals -->
			{#if pendingProposals.length > 0}
				<section class="inbox-section">
					<button class="section-header" onclick={() => goto('/proposals')}>
						<Bell class="h-4 w-4" />
						<span>Reminder proposals ({pendingProposals.length})</span>
						<ChevronRight class="h-4 w-4 ml-auto" />
					</button>
					<div class="section-items">
						{#each pendingProposals.slice(0, 5) as p}
							<div class="inbox-item">
								<Bell class="h-3.5 w-3.5 shrink-0" />
								<span class="item-text">{p.text}</span>
								<span class="item-meta">{p.suggestedDate}</span>
							</div>
						{/each}
						{#if pendingProposals.length > 5}
							<button class="see-all" onclick={() => goto('/proposals')}>
								+{pendingProposals.length - 5} more
							</button>
						{/if}
					</div>
				</section>
			{/if}

			<!-- Pending drafts -->
			{#if pendingDrafts.length > 0}
				<section class="inbox-section">
					<button class="section-header" onclick={() => goto('/drafts')}>
						<Mail class="h-4 w-4" />
						<span>Draft proposals ({pendingDrafts.length})</span>
						<ChevronRight class="h-4 w-4 ml-auto" />
					</button>
					<div class="section-items">
						{#each pendingDrafts.slice(0, 3) as d}
							<div class="inbox-item">
								<Mail class="h-3.5 w-3.5 shrink-0" />
								<span class="item-text">{d.type}: {d.subject || d.body?.slice(0, 60)}</span>
							</div>
						{/each}
					</div>
				</section>
			{/if}

			<!-- Unsummarized voice memos/meetings -->
			{#if unsummarized.length > 0}
				<section class="inbox-section">
					<div class="section-header muted">
						<FileText class="h-4 w-4" />
						<span>Needs summary ({unsummarized.length})</span>
					</div>
					<div class="section-items">
						{#each unsummarized as m}
							<button class="inbox-item clickable" onclick={() => goto(`/memory/${m.id}`)}>
								<FileText class="h-3.5 w-3.5 shrink-0" />
								<span class="item-text">{m.title || 'Untitled'}</span>
								<span class="item-meta">{relativeDate(m.createdAt)}</span>
							</button>
						{/each}
					</div>
				</section>
			{/if}

			<!-- Untagged recent notes -->
			{#if untagged.length > 0}
				<section class="inbox-section">
					<div class="section-header muted">
						<Tag class="h-4 w-4" />
						<span>Untagged notes ({untagged.length})</span>
					</div>
					<div class="section-items">
						{#each untagged as m}
							<button class="inbox-item clickable" onclick={() => goto(`/memory/${m.id}`)}>
								<Tag class="h-3.5 w-3.5 shrink-0" />
								<span class="item-text">{m.title || 'Untitled'}</span>
								<span class="item-meta">{relativeDate(m.createdAt)}</span>
							</button>
						{/each}
					</div>
				</section>
			{/if}
		</div>
	{/if}
</div>

<style>
	.inbox-page {
		max-width: 640px;
		margin: 0 auto;
		padding: 1.5rem 1rem;
	}

	.inbox-header {
		margin-bottom: 1.5rem;
	}

	.inbox-title {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		color: var(--color-text);
	}

	.inbox-title h1 {
		font-size: 1.25rem;
		font-weight: 700;
		margin: 0;
	}

	.inbox-badge {
		display: flex;
		align-items: center;
		justify-content: center;
		min-width: 1.25rem;
		height: 1.25rem;
		padding: 0 0.375rem;
		border-radius: 999px;
		background: var(--color-accent);
		color: white;
		font-size: 0.6875rem;
		font-weight: 600;
	}

	.inbox-subtitle {
		font-size: 0.8125rem;
		color: var(--color-text-muted);
		margin: 0.25rem 0 0;
	}

	.inbox-empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.75rem;
		padding: 4rem 1rem;
		text-align: center;
		color: var(--color-text-muted);
		font-size: 0.875rem;
	}

	.inbox-sections {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.inbox-section {
		border: 1px solid var(--color-border);
		border-radius: 0.5rem;
		overflow: hidden;
	}

	.section-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		padding: 0.625rem 0.75rem;
		background: var(--color-bg-secondary);
		border: none;
		color: var(--color-text);
		font-size: 0.8125rem;
		font-weight: 600;
		cursor: pointer;
		text-align: left;
	}

	.section-header:hover {
		background: var(--color-border);
	}

	.section-header.danger {
		color: #ef4444;
	}

	.section-header.accent {
		color: var(--color-accent);
	}

	.section-header.muted {
		color: var(--color-text-muted);
		cursor: default;
	}

	.section-items {
		display: flex;
		flex-direction: column;
	}

	.inbox-item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.75rem;
		border-top: 1px solid var(--color-border);
		font-size: 0.8125rem;
		color: var(--color-text);
		background: none;
		border-left: none;
		border-right: none;
		border-bottom: none;
		text-align: left;
		width: 100%;
	}

	.inbox-item.clickable {
		cursor: pointer;
	}

	.inbox-item.clickable:hover {
		background: var(--color-bg-secondary);
	}

	.item-text {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.item-meta {
		font-size: 0.6875rem;
		color: var(--color-text-muted);
		flex-shrink: 0;
	}

	.see-all {
		display: block;
		width: 100%;
		padding: 0.375rem 0.75rem;
		border: none;
		border-top: 1px solid var(--color-border);
		background: none;
		color: var(--color-accent);
		font-size: 0.75rem;
		cursor: pointer;
		text-align: center;
	}

	.see-all:hover {
		background: var(--color-bg-secondary);
	}
</style>
