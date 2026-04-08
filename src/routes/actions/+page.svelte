<script lang="ts">
	import {
		actionItems,
		memoryObjects,
		updateActionItemStatus,
		deleteActionItem,
		type ActionItem,
		type ActionItemStatus
	} from '$lib/db';
	import { CheckSquare, Square, Clock, Trash2, ArrowRight, X } from 'lucide-svelte';

	type Group = { label: string; status: ActionItemStatus; items: ActionItem[] };

	let groups = $derived.by<Group[]>(() => {
		const open: ActionItem[] = [];
		const inProgress: ActionItem[] = [];
		const done: ActionItem[] = [];
		const cancelled: ActionItem[] = [];
		for (const item of $actionItems) {
			if (item.status === 'open') open.push(item);
			else if (item.status === 'in_progress') inProgress.push(item);
			else if (item.status === 'done') done.push(item);
			else cancelled.push(item);
		}
		return [
			{ label: 'Open', status: 'open', items: open },
			{ label: 'In progress', status: 'in_progress', items: inProgress },
			{ label: 'Done', status: 'done', items: done },
			{ label: 'Cancelled', status: 'cancelled', items: cancelled }
		];
	});

	let totalOpen = $derived($actionItems.filter((i) => i.status === 'open').length);

	// Look up the source memory's title for display.
	function memoryTitle(id: string): string {
		return $memoryObjects.find((m) => m.id === id)?.title ?? 'Untitled';
	}

	function toggleDone(item: ActionItem) {
		updateActionItemStatus(item.id, item.status === 'done' ? 'open' : 'done');
	}

	function startProgress(item: ActionItem) {
		updateActionItemStatus(item.id, 'in_progress');
	}

	function cancelItem(item: ActionItem) {
		updateActionItemStatus(item.id, 'cancelled');
	}

	function remove(item: ActionItem) {
		if (confirm(`Delete action item: "${item.text}"?`)) {
			deleteActionItem(item.id);
		}
	}
</script>

<svelte:head>
	<title>Action items - Kurumi</title>
</svelte:head>

<main class="actions-page">
	<header class="page-header">
		<h1>Action items</h1>
		<p class="count">
			{totalOpen} open
			{#if $actionItems.length > totalOpen}
				· {$actionItems.length - totalOpen} completed
			{/if}
		</p>
	</header>

	{#if $actionItems.length === 0}
		<div class="empty-state">
			<CheckSquare class="h-12 w-12 opacity-50" />
			<h2>No action items yet</h2>
			<p>
				Action items are extracted automatically from meetings. Record a meeting
				to see them appear here.
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
						{#each group.items as item (item.id)}
							<li class="item" class:done={item.status === 'done'} class:cancelled={item.status === 'cancelled'}>
								<button
									class="toggle"
									onclick={() => toggleDone(item)}
									aria-label={item.status === 'done' ? 'Mark as open' : 'Mark as done'}
								>
									{#if item.status === 'done'}
										<CheckSquare class="h-5 w-5" />
									{:else}
										<Square class="h-5 w-5" />
									{/if}
								</button>

								<div class="body">
									<p class="text">{item.text}</p>
									<div class="meta">
										{#if item.assignee}
											<span class="assignee">@{item.assignee}</span>
										{/if}
										{#if item.dueDate}
											<span class="due"><Clock class="h-3 w-3" /> {item.dueDate}</span>
										{/if}
										<a class="source" href="/memory/{item.memoryObjectId}">
											from {memoryTitle(item.memoryObjectId)}
											<ArrowRight class="h-3 w-3" />
										</a>
									</div>
								</div>

								<div class="actions">
									{#if item.status === 'open'}
										<button class="action-btn" onclick={() => startProgress(item)} title="Start">
											<Clock class="h-4 w-4" />
										</button>
									{/if}
									{#if item.status !== 'cancelled' && item.status !== 'done'}
										<button class="action-btn" onclick={() => cancelItem(item)} title="Cancel">
											<X class="h-4 w-4" />
										</button>
									{/if}
									<button class="action-btn danger" onclick={() => remove(item)} title="Delete">
										<Trash2 class="h-4 w-4" />
									</button>
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
	.actions-page {
		max-width: 900px;
		margin: 0 auto;
		padding: 2rem 1.5rem 4rem;
	}

	.page-header {
		margin-bottom: 2rem;
	}

	.page-header h1 {
		font-size: 2rem;
		font-weight: 700;
		color: var(--color-text);
		margin-bottom: 0.25rem;
	}

	.count {
		font-size: 0.875rem;
		color: var(--color-text-muted);
	}

	.empty-state {
		text-align: center;
		padding: 4rem 2rem;
		color: var(--color-text-muted);
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.75rem;
	}

	.empty-state h2 {
		font-size: 1.25rem;
		color: var(--color-text);
		font-weight: 600;
	}

	.empty-state p {
		max-width: 32rem;
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

	.item.done .text,
	.item.cancelled .text {
		text-decoration: line-through;
		color: var(--color-text-muted);
	}

	.toggle {
		background: none;
		border: none;
		padding: 0;
		cursor: pointer;
		color: var(--color-text-muted);
		flex-shrink: 0;
		margin-top: 0.125rem;
	}

	.toggle:hover {
		color: var(--color-accent);
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

	.assignee {
		color: var(--color-accent);
		font-weight: 500;
	}

	.due {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
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
	}

	.action-btn {
		background: none;
		border: none;
		padding: 0.375rem;
		border-radius: 0.375rem;
		cursor: pointer;
		color: var(--color-text-muted);
		transition: all 0.15s;
	}

	.action-btn:hover {
		background: var(--color-border);
		color: var(--color-text);
	}

	.action-btn.danger:hover {
		background: rgba(239, 68, 68, 0.15);
		color: #ef4444;
	}
</style>
