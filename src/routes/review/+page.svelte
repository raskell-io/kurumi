<script lang="ts">
	import {
		memoryObjects,
		actionItems,
		reminderProposals,
		todayIso
	} from '$lib/db';
	import { inferenceRouter } from '$lib/inference';
	import { isAIConfigured } from '$lib/ai';
	import MarkdownRenderer from '$lib/components/MarkdownRenderer.svelte';
	import {
		Calendar,
		CheckSquare,
		Bell,
		Sparkles,
		AlertCircle,
		ChevronLeft,
		ChevronRight
	} from 'lucide-svelte';

	// Controls which 7-day window to show. 0 = current week (today minus 6
	// days through today). Negative = weeks in the past.
	let weekOffset = $state(0);

	// Compute the [start, end) range (start inclusive, end exclusive) for
	// the selected week in the user's local timezone.
	let range = $derived.by(() => {
		const now = new Date();
		now.setHours(0, 0, 0, 0);
		const end = new Date(now);
		end.setDate(end.getDate() + 1 + weekOffset * 7);
		const start = new Date(end);
		start.setDate(start.getDate() - 7);
		return { start: start.getTime(), end: end.getTime() };
	});

	let rangeLabel = $derived.by(() => {
		const fmt = (ts: number) =>
			new Date(ts).toLocaleDateString('en-US', {
				month: 'short',
				day: 'numeric'
			});
		return `${fmt(range.start)} – ${fmt(range.end - 1)}`;
	});

	// Week stats
	let newMemories = $derived(
		$memoryObjects.filter(
			(m) => m.createdAt >= range.start && m.createdAt < range.end
		)
	);

	let meetingsThisWeek = $derived(
		newMemories.filter((m) => m.type === 'meeting')
	);

	let voiceMemosThisWeek = $derived(
		newMemories.filter((m) => m.type === 'voice-memo')
	);

	let notesThisWeek = $derived(
		newMemories.filter((m) => m.type === 'note')
	);

	let actionsCreatedThisWeek = $derived(
		$actionItems.filter((a) => a.createdAt >= range.start && a.createdAt < range.end)
	);

	let actionsCompletedThisWeek = $derived(
		$actionItems.filter(
			(a) =>
				a.status === 'done' &&
				a.updatedAt >= range.start &&
				a.updatedAt < range.end
		)
	);

	let pendingProposalsCount = $derived(
		$reminderProposals.filter((p) => p.status === 'pending').length
	);

	let openActions = $derived(
		$actionItems.filter((a) => a.status === 'open' || a.status === 'in_progress')
	);

	let overdueActions = $derived.by(() => {
		const today = todayIso();
		return openActions.filter((a) => a.dueDate !== null && a.dueDate < today);
	});

	// Optional LLM summary of the week's activity.
	let aiAvailable = $state(false);
	$effect(() => {
		aiAvailable = isAIConfigured();
	});

	let summary = $state<string | null>(null);
	let summarizing = $state(false);
	let summaryError = $state<string | null>(null);

	async function generateSummary() {
		if (summarizing) return;
		summarizing = true;
		summaryError = null;
		summary = null;
		try {
			const provider = inferenceRouter.findProvider((c) => c.target === 'remote');
			if (!provider) throw new Error('No inference provider available');

			const lines: string[] = [];
			lines.push(`Week: ${rangeLabel}`);
			lines.push('');
			if (meetingsThisWeek.length > 0) {
				lines.push(`Meetings (${meetingsThisWeek.length}):`);
				for (const m of meetingsThisWeek) {
					lines.push(`- ${m.title || 'Untitled'}${m.summaryShort ? ': ' + m.summaryShort : ''}`);
				}
				lines.push('');
			}
			if (voiceMemosThisWeek.length > 0) {
				lines.push(`Voice memos (${voiceMemosThisWeek.length}):`);
				for (const m of voiceMemosThisWeek.slice(0, 10)) {
					lines.push(`- ${m.title || 'Untitled'}${m.summaryShort ? ': ' + m.summaryShort : ''}`);
				}
				lines.push('');
			}
			if (actionsCreatedThisWeek.length > 0) {
				lines.push(`To-dos created (${actionsCreatedThisWeek.length}):`);
				for (const a of actionsCreatedThisWeek.slice(0, 15)) {
					lines.push(`- ${a.text}${a.dueDate ? ` (due ${a.dueDate})` : ''}`);
				}
				lines.push('');
			}
			if (actionsCompletedThisWeek.length > 0) {
				lines.push(`To-dos completed (${actionsCompletedThisWeek.length}):`);
				for (const a of actionsCompletedThisWeek.slice(0, 15)) {
					lines.push(`- ${a.text}`);
				}
				lines.push('');
			}

			if (lines.length <= 2) {
				summaryError = 'No activity in this week to summarize.';
				return;
			}

			const result = await provider.summarize({
				text: lines.join('\n'),
				style: 'long'
			});
			if (!result.ok || !result.value) {
				throw new Error(result.error || 'Summarization failed');
			}
			summary = result.value;
		} catch (err) {
			summaryError = err instanceof Error ? err.message : 'Failed to generate summary';
		} finally {
			summarizing = false;
		}
	}
</script>

<svelte:head>
	<title>Review - Kurumi</title>
</svelte:head>

<div class="h-full overflow-y-auto">
	<main class="k-page">
		<header class="k-page-header review-header">
			<div class="min-w-0">
				<h1 class="k-page-title">Weekly review</h1>
				<p class="k-page-subtitle">
					{rangeLabel}{weekOffset === 0 ? ' · this week' : ''}
				</p>
			</div>
			<div class="week-nav">
				{#if weekOffset < 0}
					<button onclick={() => (weekOffset = 0)} class="k-btn k-btn-sm">This week</button>
				{/if}
				<button
					onclick={() => weekOffset--}
					class="k-icon-btn"
					aria-label="Previous week"
					title="Previous week"
				>
					<ChevronLeft class="h-4 w-4" />
				</button>
				<button
					onclick={() => weekOffset++}
					disabled={weekOffset >= 0}
					class="k-icon-btn"
					aria-label="Next week"
					title="Next week"
				>
					<ChevronRight class="h-4 w-4" />
				</button>
			</div>
		</header>

		<section class="stats" aria-label="Week at a glance">
			<div class="stat">
				<div class="stat-value">{meetingsThisWeek.length}</div>
				<div class="stat-label">Meetings</div>
			</div>
			<div class="stat">
				<div class="stat-value">{voiceMemosThisWeek.length}</div>
				<div class="stat-label">Voice memos</div>
			</div>
			<div class="stat">
				<div class="stat-value">{notesThisWeek.length}</div>
				<div class="stat-label">Notes</div>
			</div>
			<div class="stat">
				<div class="stat-value">
					{actionsCompletedThisWeek.length}<span class="stat-of">/{actionsCreatedThisWeek.length}</span>
				</div>
				<div class="stat-label">To-dos done / new</div>
			</div>
		</section>

		{#if overdueActions.length > 0 || pendingProposalsCount > 0}
			<section class="alerts">
				{#if overdueActions.length > 0}
					<a href="/actions" class="k-row">
						<AlertCircle class="h-4 w-4 shrink-0 text-[var(--color-danger)]" />
						<span class="flex-1 min-w-0">
							{overdueActions.length} to-do{overdueActions.length === 1 ? '' : 's'} overdue
						</span>
						<span class="row-cta">Review <ChevronRight class="h-3.5 w-3.5" /></span>
					</a>
				{/if}
				{#if pendingProposalsCount > 0}
					<a href="/proposals" class="k-row">
						<Bell class="h-4 w-4 shrink-0 text-[var(--color-text-faint)]" />
						<span class="flex-1 min-w-0">
							{pendingProposalsCount} reminder proposal{pendingProposalsCount === 1 ? '' : 's'}
							waiting for review
						</span>
						<span class="row-cta">Review <ChevronRight class="h-3.5 w-3.5" /></span>
					</a>
				{/if}
			</section>
		{/if}

		{#if aiAvailable}
			<section>
				<div class="section-head">
					<h2 class="k-section-title">
						<Sparkles class="h-3.5 w-3.5" />
						Summary
					</h2>
					<button onclick={generateSummary} disabled={summarizing} class="k-btn k-btn-sm k-btn-ghost">
						{#if summarizing}
							Generating…
						{:else if summary}
							Regenerate
						{:else}
							Generate
						{/if}
					</button>
				</div>
				<div class="section-body">
					{#if summaryError}
						<p class="summary-error">{summaryError}</p>
					{:else if summary}
						<div class="summary-body">
							<MarkdownRenderer content={summary} />
						</div>
					{:else if summarizing}
						<p class="summary-placeholder">Writing a recap of this week…</p>
					{:else}
						<p class="summary-placeholder">
							Generate a short natural-language recap of this week's meetings, memos, and
							to-dos.
						</p>
					{/if}
				</div>
			</section>
		{/if}

		{#if meetingsThisWeek.length > 0}
			<section>
				<h2 class="k-section-title">Meetings</h2>
				<ul class="row-list">
					{#each meetingsThisWeek as memory (memory.id)}
						<li>
							<a href="/memory/{memory.id}" class="k-row meeting-row">
								<div class="min-w-0 flex-1">
									<div class="truncate font-medium">{memory.title || 'Untitled'}</div>
									{#if memory.summaryShort}
										<div class="meeting-summary">{memory.summaryShort}</div>
									{/if}
								</div>
								<span class="row-date">
									{new Date(memory.createdAt).toLocaleDateString('en-US', {
										weekday: 'short',
										month: 'short',
										day: 'numeric'
									})}
								</span>
							</a>
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		{#if actionsCompletedThisWeek.length > 0}
			<section>
				<h2 class="k-section-title">Completed this week</h2>
				<ul class="row-list">
					{#each actionsCompletedThisWeek as item (item.id)}
						<li class="k-row completed-row">
							<CheckSquare class="h-4 w-4 shrink-0 text-[var(--color-accent)]" />
							<span class="completed-text">{item.text}</span>
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		{#if newMemories.length === 0 && actionsCompletedThisWeek.length === 0}
			<div class="k-empty">
				<Calendar />
				<div class="k-empty-title">A quiet week</div>
				<p>Nothing was captured or completed between {rangeLabel}.</p>
			</div>
		{/if}
	</main>
</div>

<style>
	.review-header {
		flex-wrap: wrap;
	}

	.week-nav {
		display: flex;
		align-items: center;
		gap: 0.125rem;
	}

	.week-nav .k-btn {
		margin-right: 0.25rem;
	}

	/* Quiet row of numbers between two hairlines */
	.stats {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 1rem;
		padding: 1rem 0.25rem;
		border-top: 1px solid var(--color-border);
		border-bottom: 1px solid var(--color-border);
	}

	@media (max-width: 480px) {
		.stats {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}

	.stat-value {
		font-size: 1.5rem;
		font-weight: 600;
		line-height: 1.1;
		letter-spacing: -0.01em;
		font-variant-numeric: tabular-nums;
		color: var(--color-text);
	}

	.stat-of {
		font-size: 1rem;
		font-weight: 400;
		color: var(--color-text-faint);
	}

	.stat-label {
		margin-top: 0.25rem;
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}

	.alerts {
		display: flex;
		flex-direction: column;
		margin-top: 1rem;
	}

	.row-cta {
		display: inline-flex;
		align-items: center;
		gap: 0.125rem;
		flex-shrink: 0;
		font-size: 0.75rem;
		color: var(--color-text-faint);
	}

	.section-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		margin-top: 1.75rem;
		margin-bottom: 0.25rem;
	}

	.section-head .k-section-title {
		margin: 0;
	}

	.section-body {
		padding: 0 0.25rem;
	}

	.summary-body {
		color: var(--color-text);
		font-size: 0.875rem;
		line-height: 1.65;
	}

	.summary-placeholder {
		font-size: 0.875rem;
		color: var(--color-text-faint);
	}

	.summary-error {
		font-size: 0.875rem;
		color: var(--color-danger);
	}

	.row-list {
		display: flex;
		flex-direction: column;
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.meeting-row {
		align-items: flex-start;
	}

	.meeting-summary {
		margin-top: 0.125rem;
		font-size: 0.8125rem;
		line-height: 1.5;
		color: var(--color-text-muted);
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.row-date {
		flex-shrink: 0;
		padding-top: 0.125rem;
		font-size: 0.75rem;
		color: var(--color-text-faint);
	}

	.completed-row:hover {
		background: none;
	}

	.completed-text {
		min-width: 0;
		color: var(--color-text-muted);
		text-decoration: line-through;
		text-decoration-color: var(--color-text-faint);
	}
</style>
