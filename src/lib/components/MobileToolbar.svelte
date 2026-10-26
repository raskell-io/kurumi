<script lang="ts">
	import type { Editor } from '@milkdown/kit/core';
	import { editorViewCtx } from '@milkdown/kit/core';
	import { callCommand } from '@milkdown/kit/utils';
	import { toggleStrongCommand, toggleEmphasisCommand } from '@milkdown/kit/preset/commonmark';
	import { undoCommand, redoCommand } from '@milkdown/kit/plugin/history';
	import { turnInto, blockKindAt, type BlockKind } from '$lib/editor/blocks';
	import { onMount } from 'svelte';
	import {
		Bold,
		Italic,
		Heading2,
		List,
		ListTodo,
		Quote,
		Brackets,
		Undo2,
		Redo2,
		ChevronDown
	} from 'lucide-svelte';

	// Formatting bar pinned above the on-screen keyboard while editing on a
	// touch device. Uses visualViewport to sit on top of the keyboard.
	let { editor }: { editor: Editor } = $props();

	let bottom = $state(0);

	onMount(() => {
		const vv = window.visualViewport;
		if (!vv) return;
		const place = () => {
			bottom = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
		};
		place();
		vv.addEventListener('resize', place);
		vv.addEventListener('scroll', place);
		return () => {
			vv.removeEventListener('resize', place);
			vv.removeEventListener('scroll', place);
		};
	});

	function run(fn: () => void) {
		fn();
		editor.action((ctx) => ctx.get(editorViewCtx).focus());
	}

	// Toggle a block type: applying the type it already is turns it back
	// into plain text.
	function toggleBlock(kind: BlockKind) {
		editor.action((ctx) => {
			const view = ctx.get(editorViewCtx);
			const current = blockKindAt(view, view.state.selection.from);
			turnInto(view, current === kind ? 'paragraph' : kind);
		});
	}

	const command = (cmd: Parameters<typeof callCommand>[0]) => () => editor.action(callCommand(cmd));
	const insert = (text: string) => () =>
		editor.action((ctx) => {
			const view = ctx.get(editorViewCtx);
			view.dispatch(view.state.tr.insertText(text));
		});
</script>

<!-- Keep focus in the editor: buttons act on mousedown/touch without blurring it. -->
<div
	class="mobile-toolbar"
	style="bottom: {bottom}px"
	role="toolbar"
	aria-label="Formatting"
	tabindex="-1"
	onmousedown={(e) => e.preventDefault()}
>
	<button aria-label="Bold" onclick={() => run(command(toggleStrongCommand.key))}><Bold class="h-[18px] w-[18px]" /></button>
	<button aria-label="Italic" onclick={() => run(command(toggleEmphasisCommand.key))}><Italic class="h-[18px] w-[18px]" /></button>
	<button aria-label="Heading" onclick={() => run(() => toggleBlock('h2'))}><Heading2 class="h-[18px] w-[18px]" /></button>
	<button aria-label="Bulleted list" onclick={() => run(() => toggleBlock('bullet'))}><List class="h-[18px] w-[18px]" /></button>
	<button aria-label="To-do" onclick={() => run(() => toggleBlock('task'))}><ListTodo class="h-[18px] w-[18px]" /></button>
	<button aria-label="Quote" onclick={() => run(() => toggleBlock('quote'))}><Quote class="h-[18px] w-[18px]" /></button>
	<button aria-label="Link to note" onclick={() => run(insert('[['))}><Brackets class="h-[18px] w-[18px]" /></button>
	<button aria-label="Undo" onclick={() => run(command(undoCommand.key))}><Undo2 class="h-[18px] w-[18px]" /></button>
	<button aria-label="Redo" onclick={() => run(command(redoCommand.key))}><Redo2 class="h-[18px] w-[18px]" /></button>
	<button
		aria-label="Hide keyboard"
		onclick={() => editor.action((ctx) => (ctx.get(editorViewCtx).dom as HTMLElement).blur())}
	>
		<ChevronDown class="h-[18px] w-[18px]" />
	</button>
</div>

<style>
	.mobile-toolbar {
		position: fixed;
		left: 0;
		right: 0;
		z-index: 60;
		display: flex;
		align-items: center;
		gap: 0.125rem;
		overflow-x: auto;
		border-top: 1px solid var(--color-border);
		background: var(--color-bg-secondary);
		padding: 0.25rem 0.5rem calc(0.25rem + env(safe-area-inset-bottom, 0px));
	}

	/* Share the width so every button fits on a phone screen. */
	.mobile-toolbar button {
		display: flex;
		flex: 1 1 0;
		height: 2.5rem;
		min-width: 2rem;
		align-items: center;
		justify-content: center;
		border-radius: var(--radius-md, 8px);
		color: var(--color-text-muted);
	}

	.mobile-toolbar button:active {
		background: var(--color-hover);
		color: var(--color-text);
	}
</style>
