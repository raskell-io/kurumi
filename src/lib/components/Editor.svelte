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
	import {
		slashCommandPlugin,
		setSlashCallbacks
	} from '$lib/editor/slashCommands';
	import { taskListInputPlugin } from '$lib/editor/taskListInput';
	import { codeBlockExitPlugin } from '$lib/editor/codeBlockExit';
	import { startCheckboxRenderer } from '$lib/editor/checkboxRenderer';
	import { processAndStoreImage } from '$lib/utils/image';
	import CameraCapture from './CameraCapture.svelte';
	import WikilinkAutocomplete from './WikilinkAutocomplete.svelte';
	import DatePicker from './DatePicker.svelte';
	import PersonInput from './PersonInput.svelte';
	import TagAutocomplete from './TagAutocomplete.svelte';
	import SlashCommandMenu from './SlashCommandMenu.svelte';
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

	// Camera capture state
	let showCamera = $state(false);

	// Cleanup references for onDestroy
	let stopCheckboxRenderer: (() => void) | undefined;
	let handleCameraEvent: () => void;
	let handleInsertText: (e: Event) => void;

	// Slash command state
	let showSlashMenu = $state(false);
	let slashPosition = $state<{ x: number; y: number }>({ x: 0, y: 0 });
	let slashQuery = $state('');

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

	/**
	 * Insert text at the current cursor position in the editor.
	 * Detects ![alt](src) image patterns and inserts actual image
	 * nodes (not text) so Milkdown renders them inline.
	 */
	function insertTextAtCursor(text: string) {
		if (!editor) return;
		try {
			const view = editor.ctx.get(editorViewCtx);
			const { state } = view;
			const { from } = state.selection;

			// Check if the text is an image markdown pattern
			const imageMatch = text.trim().match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
			if (imageMatch && state.schema.nodes.image) {
				const [, alt, src] = imageMatch;
				// Resolve blob: refs to object URLs for display
				const displaySrc = src.startsWith('blob:') && !src.startsWith('blob:http')
					? resolveImageSrc(src)
					: src;

				const imageNode = state.schema.nodes.image.create({
					src: displaySrc ?? src,
					alt: alt || 'image',
					title: alt || ''
				});
				const tr = state.tr.insert(from, imageNode);
				view.dispatch(tr);
				view.focus();

				// If we used a placeholder, resolve async and update
				if (displaySrc === null && src.startsWith('blob:')) {
					void resolveAndUpdateImage(view, src);
				}
				return;
			}

			// Plain text insertion
			const tr = state.tr.insertText(text, from);
			view.dispatch(tr);
			view.focus();
		} catch (e) {
			console.error('Failed to insert text:', e);
		}
	}

	// Sync resolve: check the cache first (returns null if not cached)
	function resolveImageSrc(ref: string): string | null {
		// The urlCache in image.ts is module-scoped; we can't access it
		// directly. Return null and let the async path handle it.
		return null;
	}

	/**
	 * Insert an image node directly into the editor. Uses the blob ref
	 * as the src (so markdown serialization preserves it), then the
	 * MutationObserver swaps in the object URL for display.
	 */
	async function insertImageNode(blobRef: string, alt: string) {
		if (!editor) return;
		try {
			const view = editor.ctx.get(editorViewCtx);
			const { state } = view;
			const imageType = state.schema.nodes.image;
			if (!imageType) return;

			// Use the blob ref as src — the MutationObserver will replace
			// it with an object URL for display. This way markdown
			// serialization always stores the blob ref, not a temporary
			// object URL.
			const imageNode = imageType.create({
				src: blobRef,
				alt: alt || 'image',
				title: alt || ''
			});
			const { from } = state.selection;
			const tr = state.tr.insert(from, imageNode);
			view.dispatch(tr);
			view.focus();

			// Trigger the blob resolver immediately (don't wait for the
			// next MutationObserver tick).
			requestAnimationFrame(async () => {
				const { resolveBlobUrl } = await import('$lib/utils/image');
				const url = await resolveBlobUrl(blobRef);
				if (!url) return;
				const imgs = editorContainer.querySelectorAll<HTMLImageElement>('img');
				for (const img of imgs) {
					if (img.getAttribute('src') === blobRef) {
						img.src = url;
					}
				}
			});
		} catch (e) {
			console.error('Failed to insert image node:', e);
		}
	}

	// Async resolve: update the image src after the blob loads
	async function resolveAndUpdateImage(view: import('@milkdown/kit/prose/view').EditorView, blobRef: string) {
		try {
			const { resolveBlobUrl } = await import('$lib/utils/image');
			const url = await resolveBlobUrl(blobRef);
			if (!url) return;
			// Find the image node with this blob ref and update its src
			view.state.doc.descendants((node, pos) => {
				if (node.type.name === 'image' && (node.attrs.src === blobRef || node.attrs.src === null)) {
					const tr = view.state.tr.setNodeMarkup(pos, undefined, {
						...node.attrs,
						src: url
					});
					view.dispatch(tr);
					return false; // stop traversal
				}
			});
		} catch {
			// Blob resolution failed — image stays with blob: src
		}
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

		// Set up slash command callbacks
		setSlashCallbacks({
			onOpen: (state) => {
				if (state.position) {
					slashPosition = state.position;
					slashQuery = state.query;
					showSlashMenu = true;
				}
			},
			onClose: () => {
				showSlashMenu = false;
			},
			onUpdate: (state) => {
				if (state.position) {
					slashPosition = state.position;
					slashQuery = state.query;
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
			.use(slashCommandPlugin)
			.use(taskListInputPlugin)
			.use(codeBlockExitPlugin)
			.use(trailingPlugin)
			.create();

		// Add mouseup listener to check for text selection
		editorContainer.addEventListener('mouseup', checkSelection);

		// Start the visual checkbox renderer that turns [ ] / [x] text
		// into styled interactive checkboxes.
		const stopCheckboxRenderer = startCheckboxRenderer(editorContainer);

		// Listen for the /camera slash command's custom event
		handleCameraEvent = () => { showCamera = true; };
		window.addEventListener('kurumi-open-camera', handleCameraEvent);

		// Listen for external text insertion (image/camera buttons in the
		// memory page fire this to insert into the editor at cursor).
		handleInsertText = (e: Event) => {
			const text = (e as CustomEvent<string>).detail;
			if (!text) return;
			// Detect image markdown and use the image node path
			const imgMatch = text.trim().match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
			if (imgMatch) {
				const [, alt, src] = imgMatch;
				void insertImageNode(src, alt || 'image');
			} else {
				insertTextAtCursor(text);
			}
		};
		window.addEventListener('kurumi-insert-text', handleInsertText);

		// Periodically resolve blob: image srcs in the editor's rendered
		// output. Milkdown renders <img src="blob:..."> which the browser
		// can't fetch; we swap in object URLs from the blob store.
		const resolveBlobImages = async () => {
			const imgs = editorContainer.querySelectorAll<HTMLImageElement>('img');
			for (const img of imgs) {
				const src = img.getAttribute('src') || '';
				if (src.startsWith('blob:') && !src.startsWith('blob:http')) {
					const { resolveBlobUrl } = await import('$lib/utils/image');
					const url = await resolveBlobUrl(src);
					if (url) img.src = url;
				}
			}
		};
		const blobResolver = new MutationObserver(() => void resolveBlobImages());
		blobResolver.observe(editorContainer, { childList: true, subtree: true });

		// Image paste handler: intercept clipboard paste events that
		// contain images, convert to AVIF, store, and insert as an
		// image node (not markdown text — Milkdown doesn't re-parse).
		editorContainer.addEventListener('paste', async (e: ClipboardEvent) => {
			const items = e.clipboardData?.items;
			if (!items) return;
			for (const item of items) {
				if (item.type.startsWith('image/')) {
					e.preventDefault();
					const file = item.getAsFile();
					if (!file) continue;
					try {
						const result = await processAndStoreImage(file);
						await insertImageNode(result.ref, 'pasted image');
					} catch (err) {
						console.error('Image paste failed:', err);
					}
					return;
				}
			}
		});

		// Image drop handler: intercept drag-and-drop of image files.
		editorContainer.addEventListener('drop', async (e: DragEvent) => {
			const files = e.dataTransfer?.files;
			if (!files) return;
			for (const file of files) {
				if (file.type.startsWith('image/')) {
					e.preventDefault();
					try {
						const result = await processAndStoreImage(file, file.name.replace(/\.[^.]+$/, ''));
						await insertImageNode(result.ref, file.name.replace(/\.[^.]+$/, ''));
					} catch (err) {
						console.error('Image drop failed:', err);
					}
					return;
				}
			}
		});

		editorContainer.addEventListener('dragover', (e: DragEvent) => {
			if (e.dataTransfer?.types.includes('Files')) {
				e.preventDefault();
			}
		});
	});

	onDestroy(() => {
		if (editorContainer) {
			editorContainer.removeEventListener('mouseup', checkSelection);
		}
		window.removeEventListener('kurumi-open-camera', handleCameraEvent);
		window.removeEventListener('kurumi-insert-text', handleInsertText);
		stopCheckboxRenderer?.();
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
		setSlashCallbacks({
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

	{#if showSlashMenu}
		<SlashCommandMenu
			query={slashQuery}
			position={slashPosition}
		/>
	{/if}

	{#if showCamera}
		<CameraCapture
			onCapture={(markdown) => {
				insertTextAtCursor(markdown + '\n');
				showCamera = false;
			}}
			onClose={() => (showCamera = false)}
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

	/* Date references //YYYY-MM-DD - Catppuccin Blue */
	:global(.milkdown .date-reference) {
		display: inline-flex;
		align-items: center;
		gap: 0.25em;
		background: linear-gradient(
			135deg,
			rgba(137, 180, 250, 0.15),
			rgba(137, 180, 250, 0.25)
		);
		color: #89b4fa;
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
			rgba(137, 180, 250, 0.25),
			rgba(137, 180, 250, 0.35)
		);
		text-decoration: underline;
	}

	:global(.milkdown .date-reference::before) {
		content: '';
		display: inline-block;
		width: 0.875em;
		height: 0.875em;
		background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='%2389b4fa'%3E%3Cpath fill-rule='evenodd' d='M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z' clip-rule='evenodd'/%3E%3C/svg%3E");
		background-size: contain;
		background-repeat: no-repeat;
		flex-shrink: 0;
	}

	/* Person references @Name - Catppuccin Green */
	:global(.milkdown .person-reference) {
		display: inline-flex;
		align-items: center;
		gap: 0.25em;
		background: linear-gradient(
			135deg,
			rgba(166, 227, 161, 0.15),
			rgba(166, 227, 161, 0.25)
		);
		color: #a6e3a1;
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
			rgba(166, 227, 161, 0.25),
			rgba(166, 227, 161, 0.35)
		);
		text-decoration: underline;
	}

	:global(.milkdown .person-reference::before) {
		content: '';
		display: inline-block;
		width: 0.875em;
		height: 0.875em;
		background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='%23a6e3a1'%3E%3Cpath fill-rule='evenodd' d='M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z' clip-rule='evenodd'/%3E%3C/svg%3E");
		background-size: contain;
		background-repeat: no-repeat;
		flex-shrink: 0;
	}

	/* Tag references #tag - Catppuccin Peach */
	:global(.milkdown .tag-reference) {
		display: inline-flex;
		align-items: center;
		gap: 0.25em;
		background: linear-gradient(
			135deg,
			rgba(250, 179, 135, 0.15),
			rgba(250, 179, 135, 0.25)
		);
		color: #fab387;
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
			rgba(250, 179, 135, 0.25),
			rgba(250, 179, 135, 0.35)
		);
		text-decoration: underline;
	}

	:global(.milkdown .tag-reference::before) {
		content: '';
		display: inline-block;
		width: 0.875em;
		height: 0.875em;
		background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='%23fab387'%3E%3Cpath fill-rule='evenodd' d='M17.707 9.293a1 1 0 010 1.414l-7 7a1 1 0 01-1.414 0l-7-7A.997.997 0 012 10V5a3 3 0 013-3h5c.256 0 .512.098.707.293l7 7zM5 6a1 1 0 100-2 1 1 0 000 2z' clip-rule='evenodd'/%3E%3C/svg%3E");
		background-size: contain;
		background-repeat: no-repeat;
		flex-shrink: 0;
	}

	/* URL references - Catppuccin Mauve */
	:global(.milkdown .url-reference) {
		display: inline-flex;
		align-items: center;
		gap: 0.25em;
		background: linear-gradient(
			135deg,
			rgba(203, 166, 247, 0.15),
			rgba(203, 166, 247, 0.25)
		);
		color: #cba6f7;
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
			rgba(203, 166, 247, 0.25),
			rgba(203, 166, 247, 0.35)
		);
		text-decoration: underline;
	}

	:global(.milkdown .url-reference::before) {
		content: '';
		display: inline-block;
		width: 0.875em;
		height: 0.875em;
		background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='%23cba6f7'%3E%3Cpath fill-rule='evenodd' d='M12.586 4.586a2 2 0 112.828 2.828l-3 3a2 2 0 01-2.828 0 1 1 0 00-1.414 1.414 4 4 0 005.656 0l3-3a4 4 0 00-5.656-5.656l-1.5 1.5a1 1 0 101.414 1.414l1.5-1.5zm-5 5a2 2 0 012.828 0 1 1 0 101.414-1.414 4 4 0 00-5.656 0l-3 3a4 4 0 105.656 5.656l1.5-1.5a1 1 0 10-1.414-1.414l-1.5 1.5a2 2 0 11-2.828-2.828l3-3z' clip-rule='evenodd'/%3E%3C/svg%3E");
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
		font-size: 1.75em;
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
			font-size: 1.25rem;
			line-height: 1.8;
		}

		:global(.milkdown h1) {
			font-size: 1.5em;
		}

		:global(.milkdown h2) {
			font-size: 1.5em;
		}

		:global(.milkdown h3) {
			font-size: 1.25em;
		}

		:global(.milkdown p) {
			margin-bottom: 1em;
		}

		:global(.milkdown code) {
			font-size: 0.9em;
			padding: 0.25em 0.5em;
		}

		:global(.milkdown pre:first-child code) {
			font-size: 0.85em;
		}
	}

	/* ---- Task list checkboxes (GFM native) ---- */
	:global(.milkdown li.task-list-item),
	:global(.milkdown .task-list-item) {
		list-style: none !important;
		position: relative;
		padding-left: 0.25em;
	}

	:global(.milkdown .task-list-item input[type="checkbox"]) {
		appearance: none;
		-webkit-appearance: none;
		width: 1.125em;
		height: 1.125em;
		border: 2px solid var(--color-text-muted);
		border-radius: 0.25em;
		margin-right: 0.5em;
		vertical-align: middle;
		cursor: pointer;
		position: relative;
		top: -0.075em;
		transition: all 0.15s;
		background: transparent;
	}

	:global(.milkdown .task-list-item input[type="checkbox"]:hover) {
		border-color: var(--color-accent);
	}

	:global(.milkdown .task-list-item input[type="checkbox"]:checked) {
		background: var(--color-accent);
		border-color: var(--color-accent);
	}

	:global(.milkdown .task-list-item input[type="checkbox"]:checked::after) {
		content: '';
		position: absolute;
		left: 0.25em;
		top: 0.0625em;
		width: 0.375em;
		height: 0.625em;
		border: solid white;
		border-width: 0 2px 2px 0;
		transform: rotate(45deg);
	}

	:global(.milkdown .task-list-item:has(input:checked)) {
		color: var(--color-text-muted);
		text-decoration: line-through;
	}

	/* ---- Visual checkbox overlay (for [ ] / [x] text) ---- */
	:global(.kurumi-checkbox) {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.25em;
		height: 1.25em;
		border: 2px solid var(--color-text-muted);
		border-radius: 0.3em;
		vertical-align: middle;
		cursor: pointer;
		transition: all 0.15s;
		font-size: 0;
		color: transparent;
		position: relative;
		margin-right: 0.35em;
		user-select: none;
		flex-shrink: 0;
	}

	:global(.kurumi-checkbox:hover) {
		border-color: var(--color-accent);
		transform: scale(1.1);
	}

	:global(.kurumi-checkbox.unchecked) {
		background: transparent;
	}

	:global(.kurumi-checkbox.checked) {
		background: var(--color-accent);
		border-color: var(--color-accent);
	}

	:global(.kurumi-checkbox.checked::after) {
		content: '';
		position: absolute;
		left: 0.25em;
		top: 0.0625em;
		width: 0.375em;
		height: 0.625em;
		border: solid white;
		border-width: 0 2.5px 2.5px 0;
		transform: rotate(45deg);
	}

	:global(.kurumi-checkbox.unchecked::after) {
		content: '';
	}
</style>
