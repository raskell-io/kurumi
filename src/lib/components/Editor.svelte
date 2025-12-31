<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { goto } from '$app/navigation';
	import { Editor, rootCtx, defaultValueCtx } from '@milkdown/kit/core';
	import { commonmark } from '@milkdown/kit/preset/commonmark';
	import { gfm } from '@milkdown/kit/preset/gfm';
	import { listener, listenerCtx } from '@milkdown/kit/plugin/listener';
	import { history } from '@milkdown/kit/plugin/history';
	import { clipboard } from '@milkdown/kit/plugin/clipboard';
	import { nord } from '@milkdown/theme-nord';
	import '@milkdown/theme-nord/style.css';
	import { wikilinkPlugin, setWikilinkClickHandler } from '$lib/editor/wikilink';
	import { trailingPlugin } from '$lib/editor/trailing';
	import {
		frontmatterToCodeBlock,
		codeBlockToFrontmatter
	} from '$lib/editor/frontmatter';
	import {
		wikilinkAutocompletePlugin,
		setAutocompleteCallbacks,
		completeWikilink
	} from '$lib/editor/wikilinkAutocomplete';
	import {
	datePeoplePlugin,
	setTagClickHandler,
	setPersonClickHandler,
	setDateClickHandler
} from '$lib/editor/datePeople';
	import {
		datePeopleAutocompletePlugin,
		setDatePeopleCallbacks,
		insertDate,
		insertPerson,
		insertTag,
		type AutocompleteType
	} from '$lib/editor/datePeopleAutocomplete';
	import WikilinkAutocomplete from './WikilinkAutocomplete.svelte';
	import DatePicker from './DatePicker.svelte';
	import PersonInput from './PersonInput.svelte';
	import TagAutocomplete from './TagAutocomplete.svelte';
	import AIActionMenu from './AIActionMenu.svelte';
	import { isAIConfigured } from '$lib/ai';
	import { editorViewCtx } from '@milkdown/kit/core';

	interface Props {
		content: string;
		onchange?: (markdown: string) => void;
		onWikilinkClick?: (title: string) => void;
		placeholder?: string;
		currentFolderId?: string | null;
	}

	let {
		content,
		onchange,
		onWikilinkClick,
		placeholder = 'Start writing...',
		currentFolderId = null
	}: Props = $props();

	let editorContainer: HTMLDivElement;
	let editor: Editor | null = null;

	// Wikilink autocomplete state
	let showAutocomplete = $state(false);
	let autocompletePosition = $state<{ x: number; y: number }>({ x: 0, y: 0 });

	// Date/People/Tag autocomplete state
	let showDatePicker = $state(false);
	let showPersonInput = $state(false);
	let showTagAutocomplete = $state(false);
	let datePeoplePosition = $state<{ x: number; y: number }>({ x: 0, y: 0 });
	let datePeopleQuery = $state('');

	// AI action menu state
	let showAIMenu = $state(false);
	let aiMenuPosition = $state<{ x: number; y: number }>({ x: 0, y: 0 });
	let selectedText = $state('');
	let selectionFrom = $state(0);
	let selectionTo = $state(0);

	function handleAutocompleteSelect(noteTitle: string) {
		completeWikilink(noteTitle);
		showAutocomplete = false;
	}

	function handleAutocompleteClose() {
		showAutocomplete = false;
	}

	function handleDateSelect(date: string) {
		insertDate(date);
		showDatePicker = false;
	}

	function handleDateClose() {
		showDatePicker = false;
	}

	function handlePersonSelect(name: string) {
		insertPerson(name);
		showPersonInput = false;
	}

	function handlePersonClose() {
		showPersonInput = false;
	}

	function handleTagSelect(tag: string) {
		insertTag(tag);
		showTagAutocomplete = false;
	}

	function handleTagClose() {
		showTagAutocomplete = false;
	}

	function handleAIResult(newText: string) {
		// Replace the selected text with the AI result
		if (editor) {
			try {
				const view = editor.ctx.get(editorViewCtx);
				const { state } = view;
				const tr = state.tr.replaceWith(
					selectionFrom,
					selectionTo,
					state.schema.text(newText)
				);
				view.dispatch(tr);
			} catch (e) {
				console.error('Failed to replace text:', e);
			}
		}
		showAIMenu = false;
	}

	function handleAIClose() {
		showAIMenu = false;
	}

	function checkSelection() {
		if (!editor || !isAIConfigured()) return;

		try {
			const view = editor.ctx.get(editorViewCtx);
			const { state } = view;
			const { from, to } = state.selection;

			if (from !== to) {
				// Get the selected text
				const text = state.doc.textBetween(from, to, ' ');
				if (text.trim().length > 0) {
					selectedText = text;
					selectionFrom = from;
					selectionTo = to;

					// Get position for the menu
					const start = view.coordsAtPos(from);
					const end = view.coordsAtPos(to);
					const x = (start.left + end.left) / 2;
					const y = start.top - 10; // Position above selection

					aiMenuPosition = { x, y };
					showAIMenu = true;
				} else {
					showAIMenu = false;
				}
			} else {
				showAIMenu = false;
			}
		} catch (e) {
			// Editor not ready
		}
	}

	onMount(async () => {
		// Set up wikilink click handler
		if (onWikilinkClick) {
			setWikilinkClickHandler(onWikilinkClick);
		}

		// Set up tag/person/date click handlers to navigate to references page
		setTagClickHandler((tag) => {
			goto(`/references?tab=tags&item=${encodeURIComponent(tag)}`);
		});

		setPersonClickHandler((name) => {
			goto(`/references?tab=people&item=${encodeURIComponent(name)}`);
		});

		setDateClickHandler((date) => {
			goto(`/references?tab=dates&item=${encodeURIComponent(date)}`);
		});

		// Set up wikilink autocomplete callbacks
		setAutocompleteCallbacks({
			onOpen: (state) => {
				if (state.position) {
					autocompletePosition = state.position;
					showAutocomplete = true;
				}
			},
			onClose: () => {
				showAutocomplete = false;
			},
			onUpdate: (state) => {
				if (state.position) {
					autocompletePosition = state.position;
				}
			}
		});

		// Set up date/people/tag autocomplete callbacks
		setDatePeopleCallbacks({
			onOpen: (state) => {
				if (state.position) {
					datePeoplePosition = state.position;
					datePeopleQuery = state.query;
					showDatePicker = state.type === 'date';
					showPersonInput = state.type === 'person';
					showTagAutocomplete = state.type === 'tag';
				}
			},
			onClose: () => {
				showDatePicker = false;
				showPersonInput = false;
				showTagAutocomplete = false;
			},
			onUpdate: (state) => {
				if (state.position) {
					datePeoplePosition = state.position;
					datePeopleQuery = state.query;
				}
			}
		});

		// Transform frontmatter to code block for display
		const displayContent = frontmatterToCodeBlock(content || '');

		editor = await Editor.make()
			.config((ctx) => {
				ctx.set(rootCtx, editorContainer);
				ctx.set(defaultValueCtx, displayContent);

				// Listen for changes - transform code block back to frontmatter for storage
				ctx.get(listenerCtx).markdownUpdated((_, markdown) => {
					if (onchange) {
						const storageContent = codeBlockToFrontmatter(markdown);
						onchange(storageContent);
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
			.use(wikilinkAutocompletePlugin)
			.use(datePeoplePlugin)
			.use(datePeopleAutocompletePlugin)
			.use(trailingPlugin)
			.create();

		// Add mouseup listener to check for text selection
		editorContainer.addEventListener('mouseup', checkSelection);
	});

	onDestroy(() => {
		// Remove mouseup listener
		if (editorContainer) {
			editorContainer.removeEventListener('mouseup', checkSelection);
		}
		editor?.destroy();
		setWikilinkClickHandler(() => {});
		setTagClickHandler(() => {});
		setPersonClickHandler(() => {});
		setDateClickHandler(() => {});
		setAutocompleteCallbacks({
			onOpen: () => {},
			onClose: () => {},
			onUpdate: () => {}
		});
		setDatePeopleCallbacks({
			onOpen: () => {},
			onClose: () => {},
			onUpdate: () => {}
		});
	});
</script>

<div class="milkdown-wrapper">
	<div bind:this={editorContainer} class="milkdown-editor" data-placeholder={placeholder}></div>

	{#if showAutocomplete}
		<WikilinkAutocomplete
			{currentFolderId}
			position={autocompletePosition}
			onSelect={handleAutocompleteSelect}
			onClose={handleAutocompleteClose}
		/>
	{/if}

	{#if showDatePicker}
		<DatePicker
			position={datePeoplePosition}
			initialQuery={datePeopleQuery}
			onSelect={handleDateSelect}
			onClose={handleDateClose}
		/>
	{/if}

	{#if showPersonInput}
		<PersonInput
			position={datePeoplePosition}
			initialQuery={datePeopleQuery}
			onSelect={handlePersonSelect}
			onClose={handlePersonClose}
		/>
	{/if}

	{#if showTagAutocomplete}
		<TagAutocomplete
			position={datePeoplePosition}
			initialQuery={datePeopleQuery}
			onSelect={handleTagSelect}
			onClose={handleTagClose}
		/>
	{/if}

	{#if showAIMenu}
		<AIActionMenu
			position={aiMenuPosition}
			{selectedText}
			onResult={handleAIResult}
			onClose={handleAIClose}
		/>
	{/if}
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

	/* Date references //YYYY-MM-DD */
	:global(.milkdown .date-reference) {
		display: inline-flex;
		align-items: center;
		gap: 0.25em;
		background: linear-gradient(
			135deg,
			rgba(59, 130, 246, 0.15),
			rgba(59, 130, 246, 0.25)
		);
		color: #3b82f6;
		padding: 0.1em 0.4em;
		border-radius: 4px;
		font-weight: 500;
		font-size: 0.95em;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	:global(.milkdown .date-reference:hover) {
		background: linear-gradient(
			135deg,
			rgba(59, 130, 246, 0.25),
			rgba(59, 130, 246, 0.35)
		);
		text-decoration: underline;
	}

	:global(.milkdown .date-reference::before) {
		content: '';
		display: inline-block;
		width: 0.875em;
		height: 0.875em;
		background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='%233b82f6'%3E%3Cpath fill-rule='evenodd' d='M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z' clip-rule='evenodd'/%3E%3C/svg%3E");
		background-size: contain;
		background-repeat: no-repeat;
		flex-shrink: 0;
	}

	/* Person references @Name */
	:global(.milkdown .person-reference) {
		display: inline-flex;
		align-items: center;
		gap: 0.25em;
		background: linear-gradient(
			135deg,
			rgba(34, 197, 94, 0.15),
			rgba(34, 197, 94, 0.25)
		);
		color: #22c55e;
		padding: 0.1em 0.4em;
		border-radius: 1em;
		font-weight: 500;
		font-size: 0.95em;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	:global(.milkdown .person-reference:hover) {
		background: linear-gradient(
			135deg,
			rgba(34, 197, 94, 0.25),
			rgba(34, 197, 94, 0.35)
		);
		text-decoration: underline;
	}

	:global(.milkdown .person-reference::before) {
		content: '';
		display: inline-block;
		width: 0.875em;
		height: 0.875em;
		background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='%2322c55e'%3E%3Cpath fill-rule='evenodd' d='M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z' clip-rule='evenodd'/%3E%3C/svg%3E");
		background-size: contain;
		background-repeat: no-repeat;
		flex-shrink: 0;
	}

	/* Tag references #tag */
	:global(.milkdown .tag-reference) {
		display: inline-flex;
		align-items: center;
		gap: 0.25em;
		background: linear-gradient(
			135deg,
			rgba(245, 158, 11, 0.15),
			rgba(245, 158, 11, 0.25)
		);
		color: #f59e0b;
		padding: 0.1em 0.4em;
		border-radius: 4px;
		font-weight: 500;
		font-size: 0.95em;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	:global(.milkdown .tag-reference:hover) {
		background: linear-gradient(
			135deg,
			rgba(245, 158, 11, 0.25),
			rgba(245, 158, 11, 0.35)
		);
		text-decoration: underline;
	}

	:global(.milkdown .tag-reference::before) {
		content: '';
		display: inline-block;
		width: 0.875em;
		height: 0.875em;
		background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='%23f59e0b'%3E%3Cpath fill-rule='evenodd' d='M17.707 9.293a1 1 0 010 1.414l-7 7a1 1 0 01-1.414 0l-7-7A.997.997 0 012 10V5a3 3 0 013-3h5c.256 0 .512.098.707.293l7 7zM5 6a1 1 0 100-2 1 1 0 000 2z' clip-rule='evenodd'/%3E%3C/svg%3E");
		background-size: contain;
		background-repeat: no-repeat;
		flex-shrink: 0;
	}

	/* URL references */
	:global(.milkdown .url-reference) {
		display: inline-flex;
		align-items: center;
		gap: 0.25em;
		background: linear-gradient(
			135deg,
			rgba(139, 92, 246, 0.15),
			rgba(139, 92, 246, 0.25)
		);
		color: #8b5cf6;
		padding: 0.1em 0.4em;
		border-radius: 4px;
		font-weight: 500;
		font-size: 0.95em;
		cursor: pointer;
		transition: all 0.15s ease;
		word-break: break-all;
	}

	:global(.milkdown .url-reference:hover) {
		background: linear-gradient(
			135deg,
			rgba(139, 92, 246, 0.25),
			rgba(139, 92, 246, 0.35)
		);
		text-decoration: underline;
	}

	:global(.milkdown .url-reference::before) {
		content: '';
		display: inline-block;
		width: 0.875em;
		height: 0.875em;
		background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='%238b5cf6'%3E%3Cpath fill-rule='evenodd' d='M12.586 4.586a2 2 0 112.828 2.828l-3 3a2 2 0 01-2.828 0 1 1 0 00-1.414 1.414 4 4 0 005.656 0l3-3a4 4 0 00-5.656-5.656l-1.5 1.5a1 1 0 101.414 1.414l1.5-1.5zm-5 5a2 2 0 012.828 0 1 1 0 101.414-1.414 4 4 0 00-5.656 0l-3 3a4 4 0 105.656 5.656l1.5-1.5a1 1 0 10-1.414-1.414l-1.5 1.5a2 2 0 11-2.828-2.828l3-3z' clip-rule='evenodd'/%3E%3C/svg%3E");
		background-size: contain;
		background-repeat: no-repeat;
		flex-shrink: 0;
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

	/* Frontmatter code block - styled as Properties panel */
	:global(.milkdown pre:first-child) {
		background: linear-gradient(
			135deg,
			rgba(99, 102, 241, 0.08),
			rgba(99, 102, 241, 0.12)
		);
		border: 1px solid rgba(99, 102, 241, 0.2);
		border-radius: 8px;
		padding: 1em;
		margin-bottom: 1.5em;
		position: relative;
	}

	:global(.milkdown pre:first-child::before) {
		content: 'Properties';
		position: absolute;
		top: -0.6em;
		left: 1em;
		background: var(--color-bg);
		padding: 0 0.5em;
		font-size: 0.7em;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #6366f1;
	}

	:global(.milkdown pre:first-child code) {
		color: var(--color-text);
		font-size: 0.85em;
		line-height: 1.6;
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

	/* Mobile: larger font for better readability */
	@media (max-width: 768px) {
		:global(.milkdown .ProseMirror) {
			font-size: 1.125rem;
			line-height: 1.75;
		}

		:global(.milkdown h1) {
			font-size: 1.75em;
		}

		:global(.milkdown h2) {
			font-size: 1.375em;
		}

		:global(.milkdown h3) {
			font-size: 1.125em;
		}

		:global(.milkdown code) {
			font-size: 0.875em;
		}

		:global(.milkdown pre:first-child code) {
			font-size: 0.8em;
		}
	}
</style>
