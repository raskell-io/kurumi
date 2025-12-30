<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { Editor, rootCtx, defaultValueCtx } from '@milkdown/kit/core';
	import { commonmark } from '@milkdown/kit/preset/commonmark';
	import { gfm } from '@milkdown/kit/preset/gfm';
	import { listener, listenerCtx } from '@milkdown/kit/plugin/listener';
	import { history } from '@milkdown/kit/plugin/history';
	import { clipboard } from '@milkdown/kit/plugin/clipboard';
	import { nord } from '@milkdown/theme-nord';
	import '@milkdown/theme-nord/style.css';
	import { wikilinkPlugin, setWikilinkClickHandler } from '$lib/editor/wikilink';

	interface Props {
		content: string;
		onchange?: (markdown: string) => void;
		onWikilinkClick?: (title: string) => void;
		placeholder?: string;
	}

	let { content, onchange, onWikilinkClick, placeholder = 'Start writing...' }: Props = $props();

	let editorContainer: HTMLDivElement;
	let editor: Editor | null = null;

	onMount(async () => {
		// Set up wikilink click handler
		if (onWikilinkClick) {
			setWikilinkClickHandler(onWikilinkClick);
		}

		editor = await Editor.make()
			.config((ctx) => {
				ctx.set(rootCtx, editorContainer);
				ctx.set(defaultValueCtx, content || '');

				// Listen for changes
				ctx.get(listenerCtx).markdownUpdated((_, markdown) => {
					if (onchange) {
						onchange(markdown);
					}
				});
			})
			.config(nord)
			.use(commonmark)
			.use(gfm)
			.use(listener)
			.use(history)
			.use(clipboard)
			.use(wikilinkPlugin)
			.create();
	});

	onDestroy(() => {
		editor?.destroy();
		setWikilinkClickHandler(() => {});
	});
</script>

<div class="milkdown-wrapper">
	<div bind:this={editorContainer} class="milkdown-editor" data-placeholder={placeholder}></div>
</div>

<style>
	.milkdown-wrapper {
		height: 100%;
		width: 100%;
	}

	.milkdown-editor {
		height: 100%;
		min-height: 400px;
	}

	/* Override Nord theme for our color scheme */
	:global(.milkdown) {
		background: transparent !important;
		color: var(--color-text) !important;
		font-family: inherit !important;
	}

	:global(.milkdown .editor) {
		padding: 0 !important;
		outline: none !important;
	}

	:global(.milkdown .ProseMirror) {
		min-height: 400px;
		outline: none !important;
	}

	:global(.milkdown .ProseMirror:focus) {
		outline: none !important;
	}

	/* Wikilinks */
	:global(.milkdown .wikilink) {
		background: linear-gradient(
			135deg,
			color-mix(in srgb, var(--color-accent) 15%, transparent),
			color-mix(in srgb, var(--color-accent) 25%, transparent)
		);
		color: var(--color-accent);
		padding: 0.1em 0.3em;
		border-radius: 4px;
		cursor: pointer;
		transition: all 0.15s ease;
		font-weight: 500;
	}

	:global(.milkdown .wikilink:hover) {
		background: linear-gradient(
			135deg,
			color-mix(in srgb, var(--color-accent) 25%, transparent),
			color-mix(in srgb, var(--color-accent) 35%, transparent)
		);
		text-decoration: underline;
	}

	/* Placeholder */
	:global(.milkdown .ProseMirror p.is-editor-empty:first-child::before) {
		content: attr(data-placeholder);
		color: var(--color-text-muted);
		pointer-events: none;
		float: left;
		height: 0;
	}

	/* Headings */
	:global(.milkdown h1) {
		font-size: 2em;
		font-weight: 700;
		margin-top: 1em;
		margin-bottom: 0.5em;
		color: var(--color-text);
	}

	:global(.milkdown h2) {
		font-size: 1.5em;
		font-weight: 600;
		margin-top: 0.8em;
		margin-bottom: 0.4em;
		color: var(--color-text);
	}

	:global(.milkdown h3) {
		font-size: 1.25em;
		font-weight: 600;
		margin-top: 0.6em;
		margin-bottom: 0.3em;
		color: var(--color-text);
	}

	/* Paragraphs */
	:global(.milkdown p) {
		margin-bottom: 0.75em;
		line-height: 1.7;
	}

	/* Links */
	:global(.milkdown a) {
		color: var(--color-accent);
		text-decoration: none;
	}

	:global(.milkdown a:hover) {
		text-decoration: underline;
	}

	/* Code */
	:global(.milkdown code) {
		background: var(--color-bg-secondary);
		padding: 0.2em 0.4em;
		border-radius: 4px;
		font-family: 'SF Mono', 'Fira Code', monospace;
		font-size: 0.9em;
	}

	:global(.milkdown pre) {
		background: var(--color-bg-secondary);
		padding: 1em;
		border-radius: 8px;
		overflow-x: auto;
		margin: 1em 0;
	}

	:global(.milkdown pre code) {
		background: none;
		padding: 0;
	}

	/* Blockquotes */
	:global(.milkdown blockquote) {
		border-left: 4px solid var(--color-accent);
		padding-left: 1em;
		margin-left: 0;
		color: var(--color-text-muted);
		font-style: italic;
	}

	/* Lists */
	:global(.milkdown ul),
	:global(.milkdown ol) {
		padding-left: 1.5em;
		margin-bottom: 0.75em;
	}

	:global(.milkdown li) {
		margin-bottom: 0.25em;
	}

	:global(.milkdown ul) {
		list-style-type: disc;
	}

	:global(.milkdown ol) {
		list-style-type: decimal;
	}

	/* Task lists */
	:global(.milkdown ul.task-list) {
		list-style: none;
		padding-left: 0;
	}

	:global(.milkdown li.task-list-item) {
		display: flex;
		align-items: flex-start;
		gap: 0.5em;
	}

	:global(.milkdown input[type='checkbox']) {
		margin-top: 0.3em;
		accent-color: var(--color-accent);
	}

	/* Horizontal rule */
	:global(.milkdown hr) {
		border: none;
		border-top: 2px solid var(--color-border);
		margin: 1.5em 0;
	}

	/* Strong and emphasis */
	:global(.milkdown strong) {
		font-weight: 600;
	}

	:global(.milkdown em) {
		font-style: italic;
	}

	/* Tables (GFM) */
	:global(.milkdown table) {
		border-collapse: collapse;
		width: 100%;
		margin: 1em 0;
	}

	:global(.milkdown th),
	:global(.milkdown td) {
		border: 1px solid var(--color-border);
		padding: 0.5em 1em;
		text-align: left;
	}

	:global(.milkdown th) {
		background: var(--color-bg-secondary);
		font-weight: 600;
	}

	/* Strikethrough */
	:global(.milkdown del) {
		text-decoration: line-through;
		color: var(--color-text-muted);
	}

	/* Images */
	:global(.milkdown img) {
		max-width: 100%;
		border-radius: 8px;
		margin: 1em 0;
	}
</style>
