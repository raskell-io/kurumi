<script lang="ts">
	import type { ActionItem, ActionItemStatus } from '$lib/db';
	import { todayIso } from '$lib/db';
	import { dueInfo } from '$lib/utils/due';
	import { ArrowUpRight, CalendarClock, ChevronLeft, ChevronRight, Repeat, User } from 'lucide-svelte';

	// Kanban view of action items: Open → In progress → Done. Drag a card
	// to another column (or use its arrows) to change its status.
	interface Props {
		items: ActionItem[];
		memoryTitle: (id: string) => string;
		onMove: (item: ActionItem, status: ActionItemStatus) => void;
		onOpenSource: (memoryId: string) => void;
	}

	let { items, memoryTitle, onMove, onOpenSource }: Props = $props();

	const COLUMNS: { status: ActionItemStatus; label: string }[] = [
		{ status: 'open', label: 'Open' },
		{ status: 'in_progress', label: 'In progress' },
		{ status: 'done', label: 'Done' }
	];
	const DONE_LIMIT = 25;
	const today = todayIso();

	let showAllDone = $state(false);
	let dragId = $state<string | null>(null);
	let dropTarget = $state<ActionItemStatus | null>(null);

	let columns = $derived(
		COLUMNS.map((col) => {
			let colItems = items.filter((i) => i.status === col.status);
			if (col.status === 'done') colItems = [...colItems].sort((a, b) => b.updatedAt - a.updatedAt);
			const total = colItems.length;
			if (col.status === 'done' && !showAllDone) colItems = colItems.slice(0, DONE_LIMIT);
			return { ...col, items: colItems, total };
		})
	);

	function step(item: ActionItem, delta: -1 | 1) {
		const index = COLUMNS.findIndex((c) => c.status === item.status);
		const next = COLUMNS[index + delta];
		if (next) onMove(item, next.status);
	}

	function drop(status: ActionItemStatus) {
		const item = items.find((i) => i.id === dragId);
		if (item && item.status !== status) onMove(item, status);
		dragId = null;
		dropTarget = null;
	}
</script>

<div class="board" role="list" aria-label="Action items board">
	{#each columns as col (col.status)}
		<section
			class="board-col"
			class:drop-target={dropTarget === col.status && dragId !== null}
			aria-label={col.label}
			role="listitem"
			ondragover={(e) => {
				if (!dragId) return;
				e.preventDefault();
				dropTarget = col.status;
			}}
			ondragleave={(e) => {
				if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) dropTarget = null;
			}}
			ondrop={(e) => {
				e.preventDefault();
				drop(col.status);
			}}
		>
			<h2 class="board-col-title">
				{col.label}
				<span class="tabular-nums font-normal text-[var(--color-text-faint)]">{col.total}</span>
			</h2>
			<ul class="board-cards">
				{#each col.items as item (item.id)}
					{@const due = item.dueDate ? dueInfo(item.dueDate, item.status !== 'done', today) : null}
					{@const index = COLUMNS.findIndex((c) => c.status === item.status)}
					<li
						class="board-card"
						class:dragging={dragId === item.id}
						draggable="true"
						data-id={item.id}
						ondragstart={(e) => {
							dragId = item.id;
							e.dataTransfer?.setData('text/plain', item.id);
							if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
						}}
						ondragend={() => {
							dragId = null;
							dropTarget = null;
						}}
					>
						<p class="board-card-text" class:line-through={item.status === 'done'}>{item.text}</p>
						<div class="board-card-meta">
							{#if due}
								<span class="meta-chip" class:danger={due.tone === 'danger'} class:warn={due.tone === 'warn'}>
									<CalendarClock class="h-3 w-3" />{due.label}
								</span>
							{/if}
							{#if item.recurrence !== 'none'}
								<span class="meta-chip" title="Repeats {item.recurrence}"><Repeat class="h-3 w-3" /></span>
							{/if}
							{#if item.assignee}
								<span class="meta-chip"><User class="h-3 w-3" />{item.assignee}</span>
							{/if}
							{#if item.memoryObjectId}
								<button class="meta-chip source" onclick={() => onOpenSource(item.memoryObjectId!)} title="Open source note">
									<ArrowUpRight class="h-3 w-3" /><span class="truncate">{memoryTitle(item.memoryObjectId)}</span>
								</button>
							{/if}
							<span class="ml-auto flex">
								<button
									class="k-icon-btn !h-6 !w-6"
									disabled={index === 0}
									onclick={() => step(item, -1)}
									aria-label="Move to {COLUMNS[index - 1]?.label ?? 'previous column'}"
									title="Move left"
								>
									<ChevronLeft class="h-3.5 w-3.5" />
								</button>
								<button
									class="k-icon-btn !h-6 !w-6"
									disabled={index === COLUMNS.length - 1}
									onclick={() => step(item, 1)}
									aria-label="Move to {COLUMNS[index + 1]?.label ?? 'next column'}"
									title="Move right"
								>
									<ChevronRight class="h-3.5 w-3.5" />
								</button>
							</span>
						</div>
					</li>
				{:else}
					<li class="board-empty">{dragId ? 'Drop here' : 'Nothing here'}</li>
				{/each}
			</ul>
			{#if col.status === 'done' && col.total > DONE_LIMIT}
				<button class="k-btn k-btn-ghost k-btn-sm mt-1 w-full" onclick={() => (showAllDone = !showAllDone)}>
					{showAllDone ? 'Show recent only' : `Show all ${col.total}`}
				</button>
			{/if}
		</section>
	{/each}
</div>

<style>
	.board {
		display: grid;
		grid-template-columns: repeat(3, minmax(15rem, 1fr));
		gap: 0.75rem;
		overflow-x: auto;
		padding-bottom: 0.5rem;
	}

	.board-col {
		display: flex;
		min-height: 12rem;
		flex-direction: column;
		border: 1px solid transparent;
		border-radius: var(--radius-lg, 10px);
		background: var(--color-bg-secondary);
		padding: 0.5rem;
		transition: border-color 120ms ease, background 120ms ease;
	}

	.board-col.drop-target {
		border-color: var(--color-accent);
		background: var(--color-accent-soft);
	}

	.board-col-title {
		display: flex;
		gap: 0.375rem;
		padding: 0.25rem 0.375rem 0.5rem;
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--color-text-muted);
	}

	.board-cards {
		display: flex;
		flex: 1;
		flex-direction: column;
		gap: 0.375rem;
	}

	.board-card {
		cursor: grab;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md, 8px);
		background: var(--color-bg);
		padding: 0.5rem 0.625rem;
		box-shadow: var(--shadow-sm, none);
	}

	.board-card:hover {
		border-color: var(--color-border-strong, var(--color-border));
	}

	.board-card.dragging {
		opacity: 0.4;
	}

	.board-card-text {
		font-size: 0.875rem;
		color: var(--color-text);
		overflow-wrap: anywhere;
	}

	.board-card-text.line-through {
		color: var(--color-text-muted);
	}

	.board-card-meta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.25rem;
		margin-top: 0.375rem;
	}

	.meta-chip {
		display: inline-flex;
		max-width: 11rem;
		align-items: center;
		gap: 0.25rem;
		border-radius: 999px;
		background: var(--color-bg-secondary);
		padding: 0.0625rem 0.4375rem;
		font-size: 0.6875rem;
		color: var(--color-text-muted);
	}

	.meta-chip.source:hover {
		color: var(--color-text);
	}

	.meta-chip.danger {
		color: var(--color-danger);
	}

	.meta-chip.warn {
		color: #df8e1d;
	}

	.board-empty {
		padding: 1rem 0.5rem;
		text-align: center;
		font-size: 0.75rem;
		color: var(--color-text-faint);
	}
</style>
