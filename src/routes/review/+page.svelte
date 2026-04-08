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
		Mic,
		Users as UsersIcon,
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
				lines.push(`Action items created (${actionsCreatedThisWeek.length}):`);
				for (const a of actionsCreatedThisWeek.slice(0, 15)) {
					lines.push(`- ${a.text}${a.dueDate ? ` (due ${a.dueDate})` : ''}`);
				}
				lines.push('');
			}
			if (actionsCompletedThisWeek.length > 0) {
				lines.push(`Action items completed (${actionsCompletedThisWeek.length}):`);
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

<main class="review-page">
	<header class="page-header">
		<div class="header-icon">
			<Calendar class="h-8 w-8" />
		</div>
		<h1>Weekly review</h1>
		<div class="week-nav">
			<button onclick={() => weekOffset--} class="nav-btn" aria-label="Previous week">
				<ChevronLeft class="h-4 w-4" />
			</button>
			<span class="week-label">{rangeLabel}</span>
			<button
				onclick={() => weekOffset++}
				disabled={weekOffset >= 0}
				class="nav-btn"
				aria-label="Next week"
			>
				<ChevronRight class="h-4 w-4" />
			</button>
		</div>
	</header>

	<section class="stats-grid">
		<div class="stat">
			<UsersIcon class="h-6 w-6 shrink-0 text-[var(--color-accent)]" />
			<div class="stat-body">
				<div class="stat-value">{meetingsThisWeek.length}</div>
				<div class="stat-label">Meetings</div>
			</div>
		</div>
		<div class="stat">
			<Mic class="h-6 w-6 shrink-0 text-[var(--color-accent)]" />
			<div class="stat-body">
				<div class="stat-value">{voiceMemosThisWeek.length}</div>
				<div class="stat-label">Voice memos</div>
			</div>
		</div>
		<div class="stat">
			<Sparkles class="h-6 w-6 shrink-0 text-[var(--color-accent)]" />
			<div class="stat-body">
				<div class="stat-value">{notesThisWeek.length}</div>
				<div class="stat-label">Notes</div>
			</div>
		</div>
		<div class="stat">
			<CheckSquare class="h-6 w-6 shrink-0 text-[var(--color-accent)]" />
			<div class="stat-body">
				<div class="stat-value">{actionsCompletedThisWeek.length}</div>
				<div class="stat-label">
					Completed
					<span class="stat-sub">of {actionsCreatedThisWeek.length} new</span>
				</div>
			</div>
		</div>
	</section>

	{#if overdueActions.length > 0 || pendingProposalsCount > 0}
		<section class="alerts">
			{#if overdueActions.length > 0}
				<a href="/actions" class="alert alert-warn">
					<AlertCircle class="h-4 w-4" />
					<span>
						<strong>{overdueActions.length}</strong> action item{overdueActions.length === 1 ? '' : 's'}
						overdue
					</span>
					<span class="alert-cta">Review →</span>
				</a>
			{/if}
			{#if pendingProposalsCount > 0}
				<a href="/proposals" class="alert">
					<Bell class="h-4 w-4" />
					<span>
						<strong>{pendingProposalsCount}</strong> reminder proposal{pendingProposalsCount === 1 ? '' : 's'}
						waiting for review
					</span>
					<span class="alert-cta">Review →</span>
				</a>
			{/if}
		</section>
	{/if}

	{#if aiAvailable}
		<section class="summary-section">
			<div class="summary-header">
				<h2 class="section-title">
					<Sparkles class="h-4 w-4" />
					AI summary of the week
				</h2>
				<button
					onclick={generateSummary}
					disabled={summarizing}
					class="generate-btn"
				>
					{#if summarizing}
						Generating…
					{:else if summary}
						Regenerate
					{:else}
						Generate
					{/if}
				</button>
			</div>
			{#if summaryError}
				<div class="summary-error">{summaryError}</div>
			{:else if summary}
				<div class="summary-body">
					<MarkdownRenderer content={summary} />
				</div>
			{:else if !summarizing}
				<p class="summary-placeholder">
					Click Generate to get a natural-language recap of this week's
					meetings, memos, and action items.
				</p>
			{/if}
		</section>
	{/if}

	{#if meetingsThisWeek.length > 0}
		<section class="memory-section">
			<h2 class="section-title">
				<UsersIcon class="h-4 w-4" />
				Meetings
			</h2>
			<ul class="memory-list">
				{#each meetingsThisWeek as memory (memory.id)}
					<li>
						<a href="/memory/{memory.id}" class="memory-card">
							<div class="memory-title">{memory.title || 'Untitled'}</div>
							{#if memory.summaryShort}
								<div class="memory-summary">{memory.summaryShort}</div>
							{/if}
							<div class="memory-date">
								{new Date(memory.createdAt).toLocaleDateString()}
							</div>
						</a>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	{#if actionsCompletedThisWeek.length > 0}
		<section class="memory-section">
			<h2 class="section-title">
				<CheckSquare class="h-4 w-4" />
				Completed this week
			</h2>
			<ul class="simple-list">
				{#each actionsCompletedThisWeek as item (item.id)}
					<li class="completed-item">
						<CheckSquare class="h-4 w-4 text-[var(--color-accent)]" />
						<span class="completed-text">{item.text}</span>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	{#if newMemories.length === 0 && actionsCompletedThisWeek.length === 0}
		<div class="empty-state">
			<p>No activity in this week.</p>
		</div>
	{/if}
</main>

<style>
	.review-page {
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
		margin-bottom: 0.75rem;
	}

	.week-nav {
		display: inline-flex;
		align-items: center;
		gap: 0.75rem;
	}

	.nav-btn {
		background: transparent;
		border: 1px solid var(--color-border);
		padding: 0.375rem 0.5rem;
		border-radius: 0.375rem;
		cursor: pointer;
		color: var(--color-text-muted);
		transition: all 0.15s;
	}

	.nav-btn:hover:not(:disabled) {
		background: var(--color-bg-secondary);
		color: var(--color-text);
	}

	.nav-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.week-label {
		font-size: 0.875rem;
		color: var(--color-text);
		font-weight: 500;
	}

	.stats-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
		gap: 0.75rem;
		margin-bottom: 1.5rem;
	}

	.stat {
		display: flex;
		align-items: center;
		gap: 0.875rem;
		padding: 1rem;
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border);
		border-radius: 0.75rem;
	}

	.stat-body {
		min-width: 0;
	}

	.stat-value {
		font-size: 1.75rem;
		font-weight: 700;
		color: var(--color-text);
		line-height: 1;
	}

	.stat-label {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		margin-top: 0.25rem;
	}

	.stat-sub {
		display: block;
		opacity: 0.75;
	}

	.alerts {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin-bottom: 1.5rem;
	}

	.alert {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.75rem 1rem;
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border);
		border-radius: 0.5rem;
		font-size: 0.875rem;
		color: var(--color-text);
		text-decoration: none;
		transition: border-color 0.15s;
	}

	.alert:hover {
		border-color: var(--color-accent);
	}

	.alert.alert-warn {
		border-color: rgba(239, 68, 68, 0.3);
		color: #ef4444;
	}

	.alert-cta {
		margin-left: auto;
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}

	.section-title {
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

	.summary-section {
		margin-bottom: 2rem;
		padding: 1.25rem;
		background: color-mix(in srgb, var(--color-accent) 5%, var(--color-bg-secondary));
		border: 1px solid color-mix(in srgb, var(--color-accent) 30%, var(--color-border));
		border-radius: 0.75rem;
	}

	.summary-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
		margin-bottom: 0.75rem;
	}

	.summary-header .section-title {
		margin-bottom: 0;
	}

	.generate-btn {
		padding: 0.375rem 0.875rem;
		background: var(--color-accent);
		color: white;
		border: none;
		border-radius: 0.375rem;
		font-size: 0.8125rem;
		font-weight: 500;
		cursor: pointer;
		transition: background 0.15s;
	}

	.generate-btn:hover:not(:disabled) {
		background: var(--color-accent-hover);
	}

	.generate-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.summary-body {
		color: var(--color-text);
		font-size: 0.875rem;
		line-height: 1.6;
	}

	.summary-placeholder {
		color: var(--color-text-muted);
		font-size: 0.875rem;
	}

	.summary-error {
		color: #ef4444;
		font-size: 0.875rem;
	}

	.memory-section {
		margin-bottom: 2rem;
	}

	.memory-list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.memory-card {
		display: block;
		padding: 0.875rem 1rem;
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border);
		border-radius: 0.5rem;
		text-decoration: none;
		transition: border-color 0.15s;
	}

	.memory-card:hover {
		border-color: var(--color-accent);
	}

	.memory-title {
		font-weight: 500;
		color: var(--color-text);
		margin-bottom: 0.25rem;
	}

	.memory-summary {
		font-size: 0.875rem;
		color: var(--color-text-muted);
		line-height: 1.5;
		margin-bottom: 0.25rem;
	}

	.memory-date {
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}

	.simple-list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}

	.completed-item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.75rem;
		background: var(--color-bg-secondary);
		border-radius: 0.375rem;
	}

	.completed-text {
		font-size: 0.875rem;
		color: var(--color-text-muted);
		text-decoration: line-through;
	}

	.empty-state {
		text-align: center;
		padding: 4rem 2rem;
		color: var(--color-text-muted);
	}
</style>
