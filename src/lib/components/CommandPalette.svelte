<script lang="ts">
	import { search, type SearchResult } from '$lib/search';
	import { goto } from '$app/navigation';
	import { addNote } from '$lib/db';

	interface Props {
		onClose: () => void;
	}

	let { onClose }: Props = $props();

	interface Command {
		id: string;
		type: 'action' | 'note';
		title: string;
		description?: string;
		icon?: string;
		action: () => void;
	}

	const actions: Command[] = [
		{
			id: 'new-note',
			type: 'action',
			title: 'New Note',
			description: 'Create a new note',
			icon: 'plus',
			action: () => {
				const note = addNote();
				goto(`/note/${note.id}`);
				onClose();
			}
		},
		{
			id: 'graph',
			type: 'action',
			title: 'Open Graph',
			description: 'View knowledge graph',
			icon: 'graph',
			action: () => {
				goto('/graph');
				onClose();
			}
		},
		{
			id: 'settings',
			type: 'action',
			title: 'Settings',
			description: 'Open settings',
			icon: 'settings',
			action: () => {
				goto('/settings');
				onClose();
			}
		},
		{
			id: 'home',
			type: 'action',
			title: 'Go Home',
			description: 'Return to home page',
			icon: 'home',
			action: () => {
				goto('/');
				onClose();
			}
		}
	];

	let query = $state('');
	let results = $state<Command[]>([]);
	let selectedIndex = $state(0);
	let inputRef: HTMLInputElement;

	$effect(() => {
		const q = query.toLowerCase().trim();

		if (!q) {
			// Show actions when empty
			results = actions;
		} else if (q.startsWith('>')) {
			// Command mode - only show actions
			const actionQuery = q.slice(1).trim();
			results = actions.filter(
				(a) =>
					a.title.toLowerCase().includes(actionQuery) ||
					a.description?.toLowerCase().includes(actionQuery)
			);
		} else {
			// Search notes + filter actions
			const noteResults = search(q);
			const matchingActions = actions.filter(
				(a) =>
					a.title.toLowerCase().includes(q) || a.description?.toLowerCase().includes(q)
			);

			const noteCommands: Command[] = noteResults.slice(0, 10).map((r) => ({
				id: r.id,
				type: 'note',
				title: r.title,
				description: r.content.slice(0, 60),
				action: () => {
					goto(`/note/${r.id}`);
					onClose();
				}
			}));

			results = [...matchingActions, ...noteCommands];
		}

		selectedIndex = 0;
	});

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			onClose();
		} else if (e.key === 'ArrowDown') {
			e.preventDefault();
			selectedIndex = Math.min(selectedIndex + 1, results.length - 1);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			selectedIndex = Math.max(selectedIndex - 1, 0);
		} else if (e.key === 'Enter' && results.length > 0) {
			e.preventDefault();
			results[selectedIndex].action();
		}
	}

	function getIcon(icon?: string) {
		switch (icon) {
			case 'plus':
				return 'M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z';
			case 'graph':
				return 'M17.707 9.293a1 1 0 010 1.414l-7 7a1 1 0 01-1.414 0l-7-7A.997.997 0 012 10V5a3 3 0 013-3h5c.256 0 .512.098.707.293l7 7zM5 6a1 1 0 100-2 1 1 0 000 2z';
			case 'settings':
				return 'M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z';
			case 'home':
				return 'M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z';
			default:
				return 'M9 2a1 1 0 000 2h2a1 1 0 100-2H9z M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 4a1 1 0 000 2h.01a1 1 0 100-2H7zm3 0a1 1 0 000 2h3a1 1 0 100-2h-3zm-3 4a1 1 0 100 2h.01a1 1 0 100-2H7zm3 0a1 1 0 100 2h3a1 1 0 100-2h-3z';
		}
	}

	$effect(() => {
		inputRef?.focus();
	});
</script>

<div
	class="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-[15vh]"
	onclick={onClose}
	onkeydown={handleKeydown}
	role="dialog"
	aria-modal="true"
	tabindex="-1"
>
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div
		class="w-full max-w-xl overflow-hidden rounded-xl bg-[var(--color-bg)] shadow-2xl"
		onclick={(e) => e.stopPropagation()}
		onkeydown={(e) => e.stopPropagation()}
		role="search"
	>
		<!-- Input -->
		<div class="flex items-center gap-3 border-b border-[var(--color-border)] px-4 py-3">
			<svg
				xmlns="http://www.w3.org/2000/svg"
				class="h-5 w-5 text-[var(--color-text-muted)]"
				viewBox="0 0 20 20"
				fill="currentColor"
			>
				<path
					fill-rule="evenodd"
					d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z"
					clip-rule="evenodd"
				/>
			</svg>
			<input
				bind:this={inputRef}
				bind:value={query}
				type="text"
				placeholder="Search notes or type > for commands..."
				class="flex-1 bg-transparent text-[var(--color-text)] placeholder-[var(--color-text-muted)] outline-none"
				onkeydown={handleKeydown}
			/>
			<kbd
				class="hidden rounded bg-[var(--color-bg-secondary)] px-2 py-1 text-xs text-[var(--color-text-muted)] md:inline"
			>
				ESC
			</kbd>
		</div>

		<!-- Results -->
		<div class="max-h-[60vh] overflow-y-auto">
			{#if results.length === 0}
				<div class="px-4 py-8 text-center text-[var(--color-text-muted)]">
					No results found
				</div>
			{:else}
				<ul class="py-2">
					{#each results as item, i}
						<li>
							<button
								onclick={item.action}
								class="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--color-bg-secondary)]"
								class:bg-[var(--color-bg-secondary)]={i === selectedIndex}
							>
								<div
									class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
									class:bg-[var(--color-accent)]={item.type === 'action'}
									class:text-white={item.type === 'action'}
									class:bg-[var(--color-border)]={item.type === 'note'}
									class:text-[var(--color-text-muted)]={item.type === 'note'}
								>
									<svg
										xmlns="http://www.w3.org/2000/svg"
										class="h-4 w-4"
										viewBox="0 0 20 20"
										fill="currentColor"
									>
										<path fill-rule="evenodd" d={getIcon(item.icon)} clip-rule="evenodd" />
									</svg>
								</div>
								<div class="min-w-0 flex-1">
									<div class="font-medium text-[var(--color-text)]">
										{item.title}
									</div>
									{#if item.description}
										<div class="truncate text-sm text-[var(--color-text-muted)]">
											{item.description}
										</div>
									{/if}
								</div>
								{#if item.type === 'action'}
									<span
										class="shrink-0 rounded bg-[var(--color-bg-secondary)] px-2 py-0.5 text-xs text-[var(--color-text-muted)]"
									>
										Action
									</span>
								{/if}
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		</div>

		<!-- Footer -->
		<div
			class="flex items-center justify-between border-t border-[var(--color-border)] px-4 py-2 text-xs text-[var(--color-text-muted)]"
		>
			<div class="flex items-center gap-4">
				<span class="hidden items-center gap-1 md:flex">
					<kbd class="rounded bg-[var(--color-bg-secondary)] px-1.5 py-0.5">↑↓</kbd>
					navigate
				</span>
				<span class="hidden items-center gap-1 md:flex">
					<kbd class="rounded bg-[var(--color-bg-secondary)] px-1.5 py-0.5">↵</kbd>
					select
				</span>
				<span class="hidden items-center gap-1 md:flex">
					<kbd class="rounded bg-[var(--color-bg-secondary)] px-1.5 py-0.5">&gt;</kbd>
					commands
				</span>
			</div>
			<span>{results.length} {results.length === 1 ? 'result' : 'results'}</span>
		</div>
	</div>
</div>
