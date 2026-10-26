<script lang="ts">
	import type { EditorView } from '@milkdown/kit/prose/view';
	import { portal } from '$lib/actions/portal';
	import {
		BLOCK_KINDS,
		blockKindAt,
		turnInto,
		duplicateBlock,
		deleteBlock,
		type BlockKind
	} from '$lib/editor/blocks';
	import {
		Pilcrow,
		Heading1,
		Heading2,
		Heading3,
		List,
		ListOrdered,
		ListTodo,
		Quote,
		Code,
		Copy,
		Trash2,
		Check
	} from 'lucide-svelte';

	// Menu for the block handle's ⋮⋮ button: turn the block into another
	// type, duplicate it, or delete it.
	interface Props {
		view: EditorView;
		blockPos: number;
		anchor: DOMRect;
		onClose: () => void;
	}

	let { view, blockPos, anchor, onClose }: Props = $props();

	const ICONS: Record<BlockKind, typeof Pilcrow> = {
		paragraph: Pilcrow,
		h1: Heading1,
		h2: Heading2,
		h3: Heading3,
		bullet: List,
		ordered: ListOrdered,
		task: ListTodo,
		quote: Quote,
		code: Code
	};

	// Position just inside the block, where its first textblock starts.
	let inside = $derived(blockPos + 1);
	let current = $derived(blockKindAt(view, Math.min(inside + 1, view.state.doc.content.size)));

	// Act first: closing clears the parent's state, and with it these props.
	function run(fn: () => void) {
		fn();
		onClose();
	}

	function place(node: HTMLElement) {
		const margin = 8;
		const rect = node.getBoundingClientRect();
		let top = anchor.bottom + 4;
		if (top + rect.height > window.innerHeight - margin) top = Math.max(margin, anchor.top - rect.height - 4);
		node.style.top = `${top}px`;
		node.style.left = `${Math.min(anchor.left, window.innerWidth - rect.width - margin)}px`;
	}
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onClose()} />

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div use:portal class="fixed inset-0 z-[150]" onclick={onClose}></div>
<div use:portal use:place class="k-menu fixed z-[151] w-56" role="menu">
	<div class="k-menu-label">Turn into</div>
	{#each BLOCK_KINDS as item (item.kind)}
		{@const Icon = ICONS[item.kind]}
		<button class="k-menu-item" role="menuitem" onclick={() => run(() => turnInto(view, item.kind, inside))}>
			<Icon class="h-4 w-4 text-[var(--color-text-muted)]" />
			<span class="flex-1">{item.label}</span>
			{#if current === item.kind}<Check class="h-3.5 w-3.5 text-[var(--color-accent)]" />{/if}
		</button>
	{/each}
	<div class="k-menu-sep"></div>
	<button class="k-menu-item" role="menuitem" onclick={() => run(() => duplicateBlock(view, blockPos))}>
		<Copy class="h-4 w-4 text-[var(--color-text-muted)]" /> Duplicate
	</button>
	<button class="k-menu-item danger" role="menuitem" onclick={() => run(() => deleteBlock(view, blockPos))}>
		<Trash2 class="h-4 w-4" /> Delete
	</button>
</div>
