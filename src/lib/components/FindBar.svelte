<script lang="ts">
	import type { EditorView } from '@milkdown/kit/prose/view';
	import { onMount, onDestroy, untrack } from 'svelte';
	import { memoryObjects, updateMemoryObject } from '$lib/db';
	import { pushUndo } from '$lib/stores/undo';
	import { autofocus } from '$lib/actions/autofocus';
	import {
		setFindQuery,
		clearFind,
		getFindState,
		stepMatch,
		replaceCurrent,
		replaceAll,
		focusCurrentMatch,
		escapeRegExp
	} from '$lib/editor/findReplace';
	import { ChevronUp, ChevronDown, X, Replace, CaseSensitive } from 'lucide-svelte';

	// Find (Cmd+F) / find & replace (Cmd+Option+F) bar for the open note,
	// plus "replace in all notes" across the current vault.
	interface Props {
		view: EditorView;
		noteId?: string;
		showReplace: boolean;
		onClose: () => void;
	}

	let { view, noteId, showReplace = $bindable(), onClose }: Props = $props();

	// Seed with the selected text when the bar opens.
	let query = $state(
		untrack(() => {
			const { empty, from, to } = view.state.selection;
			return empty ? '' : view.state.doc.textBetween(from, to, ' ');
		})
	);
	let replacement = $state('');
	let caseSensitive = $state(false);
	let tick = $state(0); // bumped after editor changes so counts re-read
	let input: HTMLInputElement | undefined = $state();
	let confirmAll = $state(false);
	let notice = $state<string | null>(null);

	let find = $derived.by(() => {
		void tick;
		return getFindState(view);
	});

	// The same text in other notes of this vault (stored markdown).
	let otherNotes = $derived.by(() => {
		if (!query) return [];
		const re = new RegExp(escapeRegExp(query), caseSensitive ? 'g' : 'gi');
		return $memoryObjects
			.filter((m) => m.id !== noteId)
			.map((m) => ({ memory: m, count: (m.bodyMarkdown.match(re) ?? []).length }))
			.filter((x) => x.count > 0);
	});
	let otherCount = $derived(otherNotes.reduce((n, x) => n + x.count, 0));

	$effect(() => {
		setFindQuery(view, query, caseSensitive);
		untrack(() => {
			tick++;
			confirmAll = false;
		});
	});

	// Typing in the note moves matches; re-read the count.
	onMount(() => {
		const refresh = () => tick++;
		view.dom.addEventListener('input', refresh);
		return () => view.dom.removeEventListener('input', refresh);
	});

	onDestroy(() => clearFind(view));

	// Sit just below the note header (whose height depends on the tab bar).
	function belowHeader(node: HTMLElement) {
		const header = document.querySelector('.note-header');
		const bottom = header?.getBoundingClientRect().bottom;
		if (bottom) node.style.top = `${Math.round(bottom) + 8}px`;
	}

	export function focusInput() {
		input?.focus();
		input?.select();
	}

	function close() {
		focusCurrentMatch(view);
		onClose();
	}

	function step(delta: 1 | -1) {
		stepMatch(view, delta);
		tick++;
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			e.stopPropagation();
			close();
		} else if (e.key === 'Enter' && e.target === input) {
			e.preventDefault();
			step(e.shiftKey ? -1 : 1);
		}
	}

	function doReplace() {
		replaceCurrent(view, replacement);
		tick++;
	}

	function doReplaceAll() {
		const n = replaceAll(view, replacement);
		tick++;
		notice = n ? `Replaced ${n} in this note` : null;
	}

	function doReplaceInAllNotes() {
		const previous = otherNotes.map(({ memory }) => ({ id: memory.id, body: memory.bodyMarkdown }));
		const total = otherCount; // read before the updates below empty it
		const re = new RegExp(escapeRegExp(query), caseSensitive ? 'g' : 'gi');
		for (const { memory } of otherNotes) {
			updateMemoryObject(memory.id, { bodyMarkdown: memory.bodyMarkdown.replace(re, () => replacement) });
		}
		const inThisNote = replaceAll(view, replacement);
		tick++;
		confirmAll = false;
		notice = `Replaced ${total + inThisNote} in ${previous.length + (inThisNote ? 1 : 0)} notes`;
		pushUndo({
			label: `Replaced “${query}” in ${previous.length} other notes`,
			undo: () => {
				for (const p of previous) updateMemoryObject(p.id, { bodyMarkdown: p.body });
			}
		});
	}
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div use:belowHeader class="find-bar k-menu" onkeydown={handleKeydown} role="search" aria-label="Find in note">
	<div class="flex items-center gap-1">
		<button
			class="k-icon-btn !h-7 !w-7"
			class:active={showReplace}
			onclick={() => (showReplace = !showReplace)}
			title="Toggle replace (⌥⌘F)"
			aria-label="Toggle replace"
			aria-pressed={showReplace}
		>
			<Replace class="h-3.5 w-3.5" />
		</button>
		<input
			bind:this={input}
			bind:value={query}
			use:autofocus={{ select: true }}
			type="text"
			placeholder="Find in note"
			aria-label="Find"
			class="find-input"
		/>
		<span class="w-16 shrink-0 text-right text-xs tabular-nums text-[var(--color-text-faint)]">
			{#if query}{find.matches.length ? `${find.current + 1} of ${find.matches.length}` : 'No results'}{/if}
		</span>
		<button
			class="k-icon-btn !h-7 !w-7"
			class:active={caseSensitive}
			onclick={() => (caseSensitive = !caseSensitive)}
			title="Match case"
			aria-label="Match case"
			aria-pressed={caseSensitive}
		>
			<CaseSensitive class="h-4 w-4" />
		</button>
		<button class="k-icon-btn !h-7 !w-7" onclick={() => step(-1)} title="Previous (⇧↵)" aria-label="Previous match">
			<ChevronUp class="h-4 w-4" />
		</button>
		<button class="k-icon-btn !h-7 !w-7" onclick={() => step(1)} title="Next (↵)" aria-label="Next match">
			<ChevronDown class="h-4 w-4" />
		</button>
		<button class="k-icon-btn !h-7 !w-7" onclick={close} title="Close (Esc)" aria-label="Close find">
			<X class="h-4 w-4" />
		</button>
	</div>

	{#if showReplace}
		<div class="mt-1 flex items-center gap-1 pl-8">
			<input
				bind:value={replacement}
				type="text"
				placeholder="Replace with"
				aria-label="Replace with"
				class="find-input"
				onkeydown={(e) => {
					if (e.key === 'Enter') {
						e.preventDefault();
						if (e.metaKey || e.ctrlKey) doReplaceAll();
						else doReplace();
					}
				}}
			/>
			<button class="k-btn k-btn-sm" onclick={doReplace} disabled={!find.matches.length}>Replace</button>
			<button class="k-btn k-btn-sm" onclick={doReplaceAll} disabled={!find.matches.length}>All</button>
		</div>
		{#if otherCount > 0}
			<div class="mt-1.5 flex items-center justify-between gap-2 pl-8 text-xs text-[var(--color-text-muted)]">
				{#if confirmAll}
					<span>Replace in {otherNotes.length + (find.matches.length ? 1 : 0)} notes?</span>
					<span class="flex gap-1">
						<button class="k-btn k-btn-sm k-btn-ghost" onclick={() => (confirmAll = false)}>Cancel</button>
						<button class="k-btn k-btn-sm k-btn-primary" onclick={doReplaceInAllNotes}>Replace all</button>
					</span>
				{:else}
					<span>{otherCount} more in {otherNotes.length} other {otherNotes.length === 1 ? 'note' : 'notes'}</span>
					<button class="k-btn k-btn-sm k-btn-ghost" onclick={() => (confirmAll = true)}>Replace in all notes…</button>
				{/if}
			</div>
		{/if}
	{/if}
	{#if notice}
		<p class="mt-1 pl-8 text-xs text-[var(--color-text-faint)]" role="status">{notice}</p>
	{/if}
</div>

<style>
	.find-bar {
		position: fixed;
		top: 3.25rem;
		right: 1rem;
		z-index: 40;
		width: min(28rem, calc(100vw - 2rem));
		padding: 0.375rem;
	}

	.find-input,
	.find-input:focus,
	.find-input:focus-visible {
		min-width: 0;
		flex: 1;
		height: 1.75rem;
		padding: 0 0.5rem;
		border: 1px solid var(--color-border) !important;
		border-radius: var(--radius-sm, 6px);
		background: var(--color-bg);
		color: var(--color-text);
		font-size: 0.8125rem;
		outline: none !important;
		box-shadow: none !important;
	}

	.find-input:focus {
		border-color: var(--color-accent) !important;
	}

	.active {
		background: var(--color-active);
		color: var(--color-accent);
	}
</style>
