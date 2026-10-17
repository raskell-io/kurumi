<script lang="ts">
	import {
		memoryObjects,
		actionItems,
		reminderProposals,
		draftProposals,
		updateActionItemStatus,
		completeRecurring,
		todayIso,
		type ActionItem
	} from '$lib/db';
	import { pushUndo } from '$lib/stores/undo';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import {
		Inbox,
		Bell,
		Calendar,
		Circle,
		FileText,
		Mail,
		Tag
	} from 'lucide-svelte';

	const now = Date.now();
	const oneDayMs = 86_400_000;
	// Local date, matching how due dates are entered and compared elsewhere
	// (a UTC date would flip "today" early/late around midnight).
	const today = todayIso();

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
					a.dueDate < today
			)
			.sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''))
	);

	// Due today
	let dueToday = $derived.by(() =>
		$actionItems
			.filter(
				(a) =>
					(a.status === 'open' || a.status === 'in_progress') &&
					a.dueDate === today
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

	function shortDate(iso: string): string {
		const date = new Date(iso + 'T00:00:00');
		if (Number.isNaN(date.getTime())) return iso;
		const days = Math.round((date.getTime() - new Date(today + 'T00:00:00').getTime()) / oneDayMs);
		if (days === 0) return 'Today';
		if (days === 1) return 'Tomorrow';
		if (days === -1) return 'Yesterday';
		return date.toLocaleDateString(undefined, {
			month: 'short',
			day: 'numeric',
			year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric'
		});
	}

	// Quick-complete from the inbox, with the same undo semantics as
	// the /actions page.
	function markDone(item: ActionItem) {
		const previousStatus = item.status;
		if (item.recurrence !== 'none') completeRecurring(item.id);
		else updateActionItemStatus(item.id, 'done');
		pushUndo({
			label: item.recurrence !== 'none' ? 'Completed recurring item' : 'Marked done',
			undo: () => updateActionItemStatus(item.id, previousStatus)
		});
	}

	// --- Keyboard navigation ---------------------------------------------
	// j/k move through every visible row in render order, Enter opens it.

	let flatRows = $derived<Array<{ id: string; href: string }>>([
		...overdue.slice(0, 5).map((a) => ({ id: `a:${a.id}`, href: '/actions' })),
		...dueToday.map((a) => ({ id: `a:${a.id}`, href: '/actions' })),
		...pendingProposals.slice(0, 5).map((p) => ({ id: `p:${p.id}`, href: '/proposals' })),
		...pendingDrafts.slice(0, 3).map((d) => ({ id: `d:${d.id}`, href: '/drafts' })),
		...unsummarized.map((m) => ({ id: `m:${m.id}`, href: `/memory/${m.id}` })),
		...untagged.map((m) => ({ id: `m:${m.id}`, href: `/memory/${m.id}` }))
	]);

	let focusIndex = $state(-1);
	let focusedId = $derived<string | null>(
		focusIndex >= 0 && focusIndex < flatRows.length ? flatRows[focusIndex].id : null
	);

	$effect(() => {
		if (!focusedId) return;
		document
			.querySelector(`[data-row-id="${CSS.escape(focusedId)}"]`)
			?.scrollIntoView({ block: 'nearest' });
	});

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
		if (e.key === 'Enter' && target.closest('button, a')) return;
		if (flatRows.length === 0) return;

		switch (e.key) {
			case 'j':
			case 'ArrowDown':
				e.preventDefault();
				focusIndex = Math.min(flatRows.length - 1, focusIndex < 0 ? 0 : focusIndex + 1);
				break;
			case 'k':
			case 'ArrowUp':
				e.preventDefault();
				focusIndex = Math.max(0, focusIndex < 0 ? 0 : focusIndex - 1);
				break;
			case 'Enter':
				if (flatRows[focusIndex]) {
					e.preventDefault();
					goto(flatRows[focusIndex].href);
				}
				break;
			case 'Escape':
				if (focusIndex >= 0) focusIndex = -1;
				break;
		}
	}

	onMount(() => {
		window.addEventListener('keydown', handlePageKeydown);
		return () => window.removeEventListener('keydown', handlePageKeydown);
	});
</script>

<svelte:head>
	<title>Inbox - Kurumi</title>
</svelte:head>

{#snippet sectionHeader(label: string, count: number, href?: string)}
	<h2 class="k-section-title">
		{label}
		<span class="tabular-nums font-normal">{count}</span>
		{#if href}
			<a class="view-all" {href}>View all</a>
		{/if}
	</h2>
{/snippet}

{#snippet actionRow(item: ActionItem, tone: 'danger' | 'warn')}
	<li class="k-row item" class:focused={focusedId === `a:${item.id}`} data-row-id="a:{item.id}">
		<button class="check" onclick={() => markDone(item)} title="Mark done" aria-label="Mark done">
			<Circle class="h-4 w-4" />
		</button>
		<a class="row-link" href="/actions">
			<span class="text">{item.text}</span>
			{#if item.assignee}
				<span class="meta">@{item.assignee}</span>
			{/if}
			{#if item.dueDate}
				<span class="k-badge" class:k-badge-danger={tone === 'danger'} class:k-badge-warn={tone === 'warn'}>
					{shortDate(item.dueDate)}
				</span>
			{/if}
		</a>
	</li>
{/snippet}

<div class="k-page">
	<header class="k-page-header">
		<div class="min-w-0">
			<h1 class="k-page-title">Inbox</h1>
			<p class="k-page-subtitle">
				{#if totalCount > 0}
					{totalCount} {totalCount === 1 ? 'item needs' : 'items need'} your attention
				{:else}
					Items that need your attention
				{/if}
			</p>
			{#if totalCount > 0}
				<div class="k-hints">
					<span><kbd class="k-kbd">j</kbd> <kbd class="k-kbd">k</kbd> navigate</span>
					<span><kbd class="k-kbd">↵</kbd> open</span>
				</div>
			{/if}
		</div>
	</header>

	{#if totalCount === 0}
		<div class="k-empty">
			<Inbox />
			<p class="k-empty-title">All clear</p>
			<p>Nothing needs your attention right now.</p>
		</div>
	{:else}
		<!-- Overdue action items -->
		{#if overdue.length > 0}
			<section>
				{@render sectionHeader('Overdue', overdue.length, '/actions')}
				<ul class="items">
					{#each overdue.slice(0, 5) as item (item.id)}
						{@render actionRow(item, 'danger')}
					{/each}
				</ul>
				{#if overdue.length > 5}
					<a class="more" href="/actions">{overdue.length - 5} more overdue</a>
				{/if}
			</section>
		{/if}

		<!-- Due today -->
		{#if dueToday.length > 0}
			<section>
				{@render sectionHeader('Due today', dueToday.length, '/actions')}
				<ul class="items">
					{#each dueToday as item (item.id)}
						{@render actionRow(item, 'warn')}
					{/each}
				</ul>
			</section>
		{/if}

		<!-- Pending proposals -->
		{#if pendingProposals.length > 0}
			<section>
				{@render sectionHeader('Reminder proposals', pendingProposals.length, '/proposals')}
				<ul class="items">
					{#each pendingProposals.slice(0, 5) as p (p.id)}
						<li>
							<a class="k-row item" class:focused={focusedId === `p:${p.id}`} data-row-id="p:{p.id}" href="/proposals">
								<Bell class="icon h-4 w-4" />
								<span class="text">{p.text}</span>
								<span class="k-badge">{shortDate(p.suggestedDate)}</span>
							</a>
						</li>
					{/each}
				</ul>
				{#if pendingProposals.length > 5}
					<a class="more" href="/proposals">{pendingProposals.length - 5} more to review</a>
				{/if}
			</section>
		{/if}

		<!-- Pending drafts -->
		{#if pendingDrafts.length > 0}
			<section>
				{@render sectionHeader('Drafts', pendingDrafts.length, '/drafts')}
				<ul class="items">
					{#each pendingDrafts.slice(0, 3) as d (d.id)}
						<li>
							<a class="k-row item" class:focused={focusedId === `d:${d.id}`} data-row-id="d:{d.id}" href="/drafts">
								{#if d.kind === 'email'}
									<Mail class="icon h-4 w-4" />
								{:else}
									<Calendar class="icon h-4 w-4" />
								{/if}
								<span class="text">{d.subject || d.body?.slice(0, 60)}</span>
								<span class="meta">{d.kind === 'email' ? 'Email' : 'Event'}</span>
							</a>
						</li>
					{/each}
				</ul>
				{#if pendingDrafts.length > 3}
					<a class="more" href="/drafts">{pendingDrafts.length - 3} more drafts</a>
				{/if}
			</section>
		{/if}

		<!-- Unsummarized voice memos/meetings -->
		{#if unsummarized.length > 0}
			<section>
				{@render sectionHeader('Needs summary', unsummarized.length)}
				<ul class="items">
					{#each unsummarized as m (m.id)}
						<li>
							<a class="k-row item" class:focused={focusedId === `m:${m.id}`} data-row-id="m:{m.id}" href="/memory/{m.id}">
								<FileText class="icon h-4 w-4" />
								<span class="text">{m.title || 'Untitled'}</span>
								<span class="meta">{relativeDate(m.createdAt)}</span>
							</a>
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		<!-- Untagged recent notes -->
		{#if untagged.length > 0}
			<section>
				{@render sectionHeader('Untagged notes', untagged.length)}
				<ul class="items">
					{#each untagged as m (m.id)}
						<li>
							<a class="k-row item" class:focused={focusedId === `m:${m.id}`} data-row-id="m:{m.id}" href="/memory/{m.id}">
								<Tag class="icon h-4 w-4" />
								<span class="text">{m.title || 'Untitled'}</span>
								<span class="meta">{relativeDate(m.createdAt)}</span>
							</a>
						</li>
					{/each}
				</ul>
			</section>
		{/if}
	{/if}
</div>

<style>
	.items {
		display: flex;
		flex-direction: column;
		gap: 1px;
	}

	.item {
		scroll-margin: 1rem 0;
	}

	.item :global(.icon),
	.check {
		flex-shrink: 0;
		color: var(--color-text-faint);
	}

	.check {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.25rem;
		height: 1.25rem;
	}

	.check:hover {
		color: var(--color-accent);
	}

	/* Action rows hold a button + a link, so the link fills the row. */
	.row-link {
		display: flex;
		flex: 1;
		align-items: center;
		gap: 0.625rem;
		min-width: 0;
		color: inherit;
		text-decoration: none;
	}

	.text {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.meta {
		flex-shrink: 0;
		font-size: 0.75rem;
		color: var(--color-text-faint);
	}

	.view-all {
		margin-left: auto;
		font-weight: 400;
		color: var(--color-text-faint);
		text-decoration: none;
	}

	.view-all:hover {
		color: var(--color-accent);
	}

	.more {
		display: block;
		padding: 0.375rem 0.625rem 0 2.5rem;
		font-size: 0.75rem;
		color: var(--color-text-faint);
		text-decoration: none;
	}

	.more:hover {
		color: var(--color-accent);
	}
</style>
