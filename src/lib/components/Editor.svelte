<script lang="ts">
	import { onMount, onDestroy, untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { Editor, rootCtx, defaultValueCtx } from '@milkdown/kit/core';
	import { commonmark } from '@milkdown/kit/preset/commonmark';
	import { gfm } from '@milkdown/kit/preset/gfm';
	import { listener, listenerCtx } from '@milkdown/kit/plugin/listener';
	import { history } from '@milkdown/kit/plugin/history';
	import { clipboard } from '@milkdown/kit/plugin/clipboard';
	import { nord } from '@milkdown/theme-nord';
	import { wikilinkPlugin, setWikilinkClickHandler } from '$lib/editor/wikilink';
	import { toStorageMarkdown } from '$lib/editor/serialize';
	import { trailingPlugin } from '$lib/editor/trailing';
	import { frontmatterToCodeBlock } from '$lib/editor/frontmatter';
	import {
		wikilinkAutocompletePlugin,
		setAutocompleteCallbacks,
		completeWikilink,
		closeAutocomplete as dismissWikilinkAutocomplete
	} from '$lib/editor/wikilinkAutocomplete';
	import { datePeoplePlugin, setReferenceClickHandlers } from '$lib/editor/datePeople';
	import {
		datePeopleAutocompletePlugin,
		setDatePeopleCallbacks,
		insertDate,
		insertPerson,
		insertTag,
		closeAutocomplete as dismissDatePeopleAutocomplete,
		type AutocompleteType
	} from '$lib/editor/datePeopleAutocomplete';
	import {
		slashCommandPlugin,
		setSlashCallbacks
	} from '$lib/editor/slashCommands';
	import { taskListInputPlugin } from '$lib/editor/taskListInput';
	import { taskTogglePlugin } from '$lib/editor/taskToggle';
	import { codeBlockExitPlugin } from '$lib/editor/codeBlockExit';
	import { mermaidPlugin } from '$lib/editor/mermaid';
	import { codeHighlightPlugin } from '$lib/editor/codeHighlight';
	import { mathPlugins } from '$lib/editor/math';
	import { columnsPlugins } from '$lib/editor/columns';
	import { audioEmbedPlugin } from '$lib/editor/audioEmbed';
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
	import { editorViewCtx, parserCtx, remarkStringifyOptionsCtx } from '@milkdown/kit/core';
	import { registerMarkdownParser } from '$lib/editor/blocks';
	import { block, configureBlockHandle } from '$lib/editor/blockHandle';
	import BlockMenu from './BlockMenu.svelte';
	import FindBar from './FindBar.svelte';
	import MobileToolbar from './MobileToolbar.svelte';
	import { matchShortcut } from '$lib/shortcuts';
	import { findReplacePlugin } from '$lib/editor/findReplace';
	import { noteEmbedPlugin } from '$lib/editor/noteEmbed';
	import { blockRefPlugin } from '$lib/editor/blockRef';
	import { headingFoldPlugin } from '$lib/editor/headingFold';
	import { vimPlugin, vimEnabled, onVimMode, type VimMode } from '$lib/editor/vim';
	import type { NoteAnchor } from '$lib/stores/anchor';
	import { pasteLinkPlugin } from '$lib/editor/pasteLink';
	import { pasteMarkdownPlugin } from '$lib/editor/pasteMarkdown';
	import { fileDropPlugin } from '$lib/editor/fileDrop';
	import { TextSelection } from '@milkdown/kit/prose/state';
	import { storeAttachment } from '$lib/attachments';
	import { storeBlob } from '$lib/db/blob-store';
	import { imageClickPlugin } from '$lib/editor/imageClick';
	import type { EditorView } from '@milkdown/kit/prose/view';
	import { getMarkdown } from '@milkdown/kit/utils';

	interface Props {
		content: string;
		onchange?: (markdown: string, noteId?: string) => void;
		onWikilinkClick?: (title: string, event?: MouseEvent, anchor?: NoteAnchor) => void;
		placeholder?: string;
		currentFolderId?: string | null;
		noteId?: string;
		// A second editor on screen (split view): ignores page-wide events
		// meant for the main note (insert image/camera) and only answers
		// Cmd+F while it has focus.
		secondary?: boolean;
	}

	let {
		content,
		onchange,
		onWikilinkClick,
		placeholder = 'Start writing...',
		currentFolderId = null,
		noteId,
		secondary = false
	}: Props = $props();

	/**
	 * Read the current document straight from the live editor and return it
	 * as storage markdown. Bypasses Milkdown's internal 200ms change-listener
	 * debounce, so callers can capture the very latest keystrokes (e.g. right
	 * before navigating away). Returns null if the editor isn't ready.
	 */
	export function getCurrentMarkdown(): string | null {
		if (!editor) return null;
		try {
			return toStorageMarkdown(editor.action(getMarkdown()));
		} catch {
			return null;
		}
	}

	let editorContainer: HTMLDivElement;
	let editor: Editor | null = null;

	// Wikilink autocomplete state
	let showAutocomplete = $state(false);
	let autocompletePosition = $state<{ x: number; y: number; top?: number }>({ x: 0, y: 0 });
	let autocompleteQuery = $state('');

	// Date/People/Tag autocomplete state
	let showDatePicker = $state(false);
	let showPersonInput = $state(false);
	let showTagAutocomplete = $state(false);
	let datePeoplePosition = $state<{ x: number; y: number; top?: number }>({ x: 0, y: 0 });
	let datePeopleQuery = $state('');

	// Camera capture state
	let showCamera = $state(false);

	// Cleanup references for onDestroy
	let stopCheckboxRenderer: (() => void) | undefined;
	let handleCameraEvent: () => void;
	let handleInsertText: (e: Event) => void;

	// Mobile formatting toolbar: touch devices, while the editor has focus.
	let isTouch = $state(false);
	let editorFocused = $state(false);
	let readyEditor = $state.raw<Editor | null>(null);

	function trackFocus() {
		// focusout fires before focus lands elsewhere; check on the next tick.
		setTimeout(() => {
			editorFocused = !!editorContainer?.contains(document.activeElement);
		}, 0);
	}

	// Find bar: Cmd+F (find) / Cmd+Option+F (find & replace)
	let findBar = $state<{ view: EditorView; replace: boolean } | null>(null);
	let findBarRef: { focusInput: () => void } | undefined = $state();

	function handleFindShortcut(e: KeyboardEvent) {
		const shortcut = matchShortcut(e)?.id;
		if ((shortcut !== 'find' && shortcut !== 'findReplace') || !editor) return;
		// With two editors on screen, the focused one answers; otherwise the main one.
		const focusedEditor = (document.activeElement as HTMLElement | null)?.closest('.milkdown-editor');
		if (focusedEditor ? focusedEditor !== editorContainer : secondary) return;
		e.preventDefault();
		const replace = shortcut === 'findReplace';
		if (findBar) {
			if (replace) findBar.replace = true;
			findBarRef?.focusInput();
			return;
		}
		editor.action((ctx) => {
			findBar = { view: ctx.get(editorViewCtx), replace };
		});
	}

	// Block handle menu (⋮⋮ click)
	let blockMenu = $state<{ view: EditorView; blockPos: number; anchor: DOMRect } | null>(null);

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

	// Escape: dismiss in the plugin too, so continuing to type in the same
	// `[[…` doesn't reopen the popup.
	function handleAutocompleteClose() {
		dismissWikilinkAutocomplete();
		showAutocomplete = false;
	}

	function handleDateSelect(date: string) {
		insertDate(date);
		showDatePicker = false;
	}

	function handleDateClose() {
		dismissDatePeopleAutocomplete();
		showDatePicker = false;
	}

	function handlePersonSelect(name: string) {
		insertPerson(name);
		showPersonInput = false;
	}

	function handlePersonClose() {
		dismissDatePeopleAutocomplete();
		showPersonInput = false;
	}

	function handleTagSelect(tag: string) {
		insertTag(tag);
		showTagAutocomplete = false;
	}

	function handleTagClose() {
		dismissDatePeopleAutocomplete();
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
	/**
	 * Insert `name` linked to an attachment ref, plus a space so typing
	 * continues outside the link. Returns the position after it (or null
	 * when inserting at the cursor).
	 */
	function insertAttachmentLink(ref: string, name: string, at: number | null): number | null {
		if (!editor) return at;
		const view = editor.ctx.get(editorViewCtx);
		const { state } = view;
		const link = state.schema.marks.link;
		if (!link) return at;
		const from = at !== null && at <= state.doc.content.size ? at : state.selection.from;
		const text = state.schema.text(name, [link.create({ href: ref, title: null })]);
		const tr = state.tr.insert(from, [text, state.schema.text(' ')]);
		const after = from + name.length + 1;
		// Pasted at the cursor: keep typing after the link, not before it.
		if (at === null) tr.setSelection(TextSelection.create(tr.doc, after));
		view.dispatch(tr);
		view.focus();
		return at === null ? null : after;
	}

	async function insertImageNode(blobRef: string, alt: string, at: number | null = null) {
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
			const from = at !== null && at <= state.doc.content.size ? at : state.selection.from;
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

	// Props are live getters into the parent, so `noteId`/`content` can already
	// read the *next* note's values while this instance starts up or is torn
	// down. Capture what this editor was mounted for, and ignore callbacks
	// after destroy.
	const mountedNoteId = untrack(() => noteId);
	const mountedContent = untrack(() => content);
	let destroyed = false;

	let blobResolver: MutationObserver | undefined;

	let vimMode = $state<VimMode | null>(null);

	onMount(async () => {
		// Plugin callbacks are registered under this editor's container, so
		// a second editor (split view) doesn't take them over or clear them.
		const root = editorContainer;

		// Set up wikilink click handler
		if (onWikilinkClick) {
			setWikilinkClickHandler(root, onWikilinkClick);
		}
		onVimMode(root, (mode) => (vimMode = mode));

		// Set up tag/person/date click handlers to navigate to references page
		setReferenceClickHandlers(root, {
			tag: (tag) => goto(`/references?tab=tags&item=${encodeURIComponent(tag)}`),
			person: (name) => goto(`/people/${encodeURIComponent(name)}`),
			date: (date) => goto(`/references?tab=dates&item=${encodeURIComponent(date)}`)
		});

		// Set up wikilink autocomplete callbacks
		setAutocompleteCallbacks(root, {
			onOpen: (state) => {
				if (state.position) {
					autocompletePosition = state.position;
					autocompleteQuery = state.query;
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
				autocompleteQuery = state.query;
			}
		});

		// Set up date/people/tag autocomplete callbacks
		setDatePeopleCallbacks(root, {
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
		setSlashCallbacks(root, {
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
		const displayContent = frontmatterToCodeBlock(mountedContent || '');

		editor = await Editor.make()
			.config((ctx) => {
				ctx.set(rootCtx, editorContainer);
				ctx.set(defaultValueCtx, displayContent);

				// Listen for changes - transform code block back to frontmatter for storage
				ctx.get(listenerCtx).markdownUpdated((_, markdown) => {
					if (onchange && !destroyed) {
						const storageContent = toStorageMarkdown(markdown);
						// Tag with the note id this editor was mounted for. Milkdown
						// debounces this callback 200ms, so it can fire after the user
						// has switched notes; the parent uses the id to drop stale
						// updates that would otherwise clobber the new note.
						onchange(storageContent, mountedNoteId);
					}
				});
			})
			.config(nord)
			.config((ctx) => {
				// Write "-" bullets (Obsidian/GitHub style) rather than remark's "*".
				ctx.update(remarkStringifyOptionsCtx, (options) => ({
					...options,
					bullet: '-' as const,
					// Milkdown gives lists `spread: "true" | "false"` (strings); the
					// markdown writer only reads booleans, so every list it wrote was
					// loose (a blank line between items) once a note was edited.
					join: [
						...((options as { join?: unknown[] }).join ?? []),
						(left: { type: string }, right: { type: string }, parent: { type: string; spread?: unknown }) => {
							if ((parent.type !== 'list' && parent.type !== 'listItem') || typeof parent.spread !== 'string') return undefined;
							if (left.type === 'paragraph' && right.type === 'paragraph') return undefined; // two paragraphs: always apart
							return parent.spread === 'true' ? 1 : 0;
						}
					]
				}) as typeof options);
				configureBlockHandle(ctx, (anchor, blockPos) => {
					blockMenu = { view: ctx.get(editorViewCtx), blockPos, anchor };
				});
			})
			.use(commonmark)
			.use(gfm)
			.use(mathPlugins)
			.use(columnsPlugins)
			.use(listener)
			.use(history)
			// Before clipboard: ProseMirror asks plugins in order and the
			// clipboard plugin handles every paste.
			.use(
				fileDropPlugin(async (files, at) => {
					// Images (converted to AVIF/WebP) inline, recordings as an
					// audio player, anything else as an attachment link; for
					// drops at the drop point, later ones after the earlier.
					let pos = at;
					for (const file of files) {
						try {
							const name = file.name.replace(/\.[^.]+$/, '');
							if (file.type.startsWith('image/')) {
								const alt = file.name && file.name !== 'image.png' ? name : 'pasted image';
								const result = await processAndStoreImage(file, alt);
								await insertImageNode(result.ref, alt, pos);
							} else if (file.type.startsWith('audio/')) {
								const ref = await storeBlob(file, file.type);
								await insertImageNode(ref, `audio:${name || 'recording'}`, pos);
							} else {
								const { ref, name: fileName } = await storeAttachment(file);
								pos = insertAttachmentLink(ref, fileName, pos);
								continue;
							}
							if (pos !== null) pos += 1;
						} catch (err) {
							console.error('File paste/drop failed:', err);
						}
					}
				})
			)
			.use(pasteLinkPlugin)
			.use(pasteMarkdownPlugin)
			.use(clipboard)
			.use(wikilinkPlugin)
			.use(wikilinkAutocompletePlugin)
			.use(datePeoplePlugin)
			.use(datePeopleAutocompletePlugin)
			.use(slashCommandPlugin)
			.use(taskListInputPlugin)
			.use(taskTogglePlugin)
			.use(codeBlockExitPlugin)
			.use(audioEmbedPlugin)
			.use(mermaidPlugin)
			.use(codeHighlightPlugin)
			.use(trailingPlugin)
			.use(block)
			.use(findReplacePlugin)
			.use(noteEmbedPlugin)
			.use(blockRefPlugin)
			.use(headingFoldPlugin)
			.use(vimPlugin)
			.use(imageClickPlugin)
			.create();

		// Unmounted while Milkdown was starting (e.g. quick note switch):
		// tear the editor down instead of wiring it to a detached container.
		if (destroyed || !editorContainer) {
			editor.destroy();
			editor = null;
			return;
		}

		editor.action((ctx) => registerMarkdownParser(ctx.get(editorViewCtx), ctx.get(parserCtx)));
		readyEditor = editor;

		isTouch = window.matchMedia('(hover: none) and (pointer: coarse)').matches;
		editorContainer.addEventListener('focusin', trackFocus);
		editorContainer.addEventListener('focusout', trackFocus);

		// Add mouseup listener to check for text selection
		editorContainer.addEventListener('mouseup', checkSelection);

		// Start the visual checkbox renderer that turns [ ] / [x] text
		// into styled interactive checkboxes.
		const stopCheckboxRenderer = startCheckboxRenderer(editorContainer);

		// Listen for the /camera slash command's custom event
		handleCameraEvent = () => { showCamera = true; };
		if (!secondary) window.addEventListener('kurumi-open-camera', handleCameraEvent);

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
		if (!secondary) window.addEventListener('kurumi-insert-text', handleInsertText);

		// Periodically resolve blob: image srcs in the editor's rendered
		// output. Milkdown renders <img src="blob:..."> which the browser
		// can't fetch; we swap in object URLs from the blob store.
		// Audio embeds are handled by the audioEmbedPlugin NodeView, so
		// we only need to resolve regular images here.
		const resolveBlobImages = async () => {
			const { resolveBlobUrl } = await import('$lib/utils/image');
			// The editor may have unmounted during the await (e.g. note switch)
			if (!editorContainer) return;
			// Resolve blob: refs on images (audio images are handled by NodeView)
			const imgs = editorContainer.querySelectorAll<HTMLImageElement>('img');
			for (const img of imgs) {
				const src = img.getAttribute('src') || '';
				if (src.startsWith('blob:') && !src.startsWith('blob:http')) {
					const url = await resolveBlobUrl(src);
					if (url) img.src = url;
				}
			}
		};
		blobResolver = new MutationObserver(() => void resolveBlobImages());
		blobResolver.observe(editorContainer, { childList: true, subtree: true });
		// The note is already rendered by now, so that won't fire for its images.
		void resolveBlobImages();

		// File paste/drop is handled by fileDropPlugin (see .use below).

		editorContainer.addEventListener('dragover', (e: DragEvent) => {
			if (e.dataTransfer?.types.includes('Files')) {
				e.preventDefault();
			}
		});
	});

	onDestroy(() => {
		destroyed = true;
		blobResolver?.disconnect();
		if (editorContainer) {
			editorContainer.removeEventListener('mouseup', checkSelection);
		}
		window.removeEventListener('kurumi-open-camera', handleCameraEvent);
		window.removeEventListener('kurumi-insert-text', handleInsertText);
		stopCheckboxRenderer?.();
		editor?.destroy();
		if (editorContainer) {
			setWikilinkClickHandler(editorContainer, null);
			setReferenceClickHandlers(editorContainer, null);
			setAutocompleteCallbacks(editorContainer, null);
			setDatePeopleCallbacks(editorContainer, null);
			setSlashCallbacks(editorContainer, null);
			onVimMode(editorContainer, null);
		}
	});
</script>

<svelte:window onkeydown={handleFindShortcut} />

<div class="milkdown-wrapper">
	<div bind:this={editorContainer} class="milkdown-editor" data-placeholder={placeholder} data-note-id={noteId}></div>
	{#if $vimEnabled && vimMode && editorFocused}
		<div class="vim-badge vim-badge-{vimMode}" aria-live="polite">{vimMode.toUpperCase()}</div>
	{/if}

	{#if showAutocomplete}
		<WikilinkAutocomplete
			{currentFolderId}
			position={autocompletePosition}
			query={autocompleteQuery}
			onSelect={handleAutocompleteSelect}
			onClose={handleAutocompleteClose}
		/>
	{/if}

	{#if showDatePicker}
		<DatePicker
			position={datePeoplePosition}
			query={datePeopleQuery}
			onSelect={handleDateSelect}
			onClose={handleDateClose}
		/>
	{/if}

	{#if showPersonInput}
		<PersonInput
			position={datePeoplePosition}
			query={datePeopleQuery}
			onSelect={handlePersonSelect}
			onClose={handlePersonClose}
		/>
	{/if}

	{#if showTagAutocomplete}
		<TagAutocomplete
			position={datePeoplePosition}
			query={datePeopleQuery}
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

	{#if isTouch && editorFocused && readyEditor}
		<MobileToolbar editor={readyEditor} />
	{/if}

	{#if findBar}
		<FindBar
			bind:this={findBarRef}
			view={findBar.view}
			{noteId}
			bind:showReplace={findBar.replace}
			onClose={() => (findBar = null)}
		/>
	{/if}

	{#if blockMenu}
		<BlockMenu
			view={blockMenu.view}
			blockPos={blockMenu.blockPos}
			anchor={blockMenu.anchor}
			{noteId}
			onClose={() => (blockMenu = null)}
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
		min-height: 12rem;
	}

	/* Find & replace matches (see $lib/editor/findReplace.ts) */
	.milkdown-editor :global(.find-match) {
		border-radius: 2px;
		background: color-mix(in srgb, #f5c542 35%, transparent);
	}

	.milkdown-editor :global(.find-current) {
		background: #f5c542;
		color: #1e1e2e;
	}

	/* ![[embed]] source line: keep it, but quiet (see $lib/editor/noteEmbed.ts) */
	.milkdown-editor :global(.note-embed-source) {
		margin-bottom: 0 !important;
		font-size: 0.8125em;
		color: var(--color-text-faint);
	}

	/* Images open in the viewer on click */
	.milkdown-editor :global(.ProseMirror img:not(.ProseMirror-separator)) {
		cursor: zoom-in;
	}

	/* A block selected via its handle */
	.milkdown-editor :global(.ProseMirror-selectednode) {
		outline: 2px solid var(--color-accent-soft, rgba(137, 180, 250, 0.35));
		outline-offset: 2px;
		border-radius: 4px;
	}

	/* Block handle (see $lib/editor/blockHandle.ts) */
	.milkdown-editor :global(.milkdown) {
		position: relative;
	}

	.milkdown-editor :global(.kurumi-block-handle) {
		position: absolute;
		display: flex;
		align-items: center;
		gap: 1px;
		transition: opacity 120ms ease;
	}

	.milkdown-editor :global(.kurumi-block-handle[data-show='false']) {
		opacity: 0;
		pointer-events: none;
	}

	.milkdown-editor :global(.bh-btn) {
		display: flex;
		height: 1.5rem;
		width: 1.25rem;
		align-items: center;
		justify-content: center;
		border-radius: 4px;
		color: var(--color-text-faint);
	}

	.milkdown-editor :global(.bh-btn:hover) {
		background: var(--color-hover);
		color: var(--color-text-muted);
	}

	.milkdown-editor :global(.bh-grip) {
		cursor: grab;
	}

	/* Hide the handle on touch screens: no hover, and dragging fights scrolling. */
	@media (hover: none) {
		.milkdown-editor :global(.kurumi-block-handle) {
			display: none;
		}
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
		min-height: 12rem;
		outline: none !important;
	}

	:global(.milkdown .ProseMirror:focus) {
		outline: none !important;
	}

	/* Wikilinks: read as links, not buttons */
	:global(.milkdown .wikilink) {
		color: var(--color-accent);
		border-radius: 3px;
		cursor: pointer;
		font-weight: 500;
		text-decoration: underline;
		text-decoration-color: color-mix(in srgb, var(--color-accent) 35%, transparent);
		text-underline-offset: 0.2em;
		text-decoration-thickness: 1px;
		transition: background-color 0.12s ease, text-decoration-color 0.12s ease;
	}

	/* [[Note|text]] reads [[text]] unless the cursor is in it (editor/wikilink.ts) */
	:global(.milkdown .wikilink-target-hidden) {
		display: none;
	}

	:global(.milkdown .wikilink:hover) {
		background: var(--color-accent-soft);
		text-decoration-color: var(--color-accent);
	}

	/* Inline references share one chip shape; each type sets --ref */
	:global(.milkdown .date-reference),
	:global(.milkdown .person-reference),
	:global(.milkdown .tag-reference),
	:global(.milkdown .url-reference) {
		display: inline-flex;
		align-items: center;
		gap: 0.25em;
		background: color-mix(in srgb, var(--ref) 12%, transparent);
		color: var(--ref);
		padding: 0.05em 0.4em;
		border-radius: 4px;
		font-weight: 500;
		font-size: 0.92em;
		line-height: 1.5;
		cursor: pointer;
		transition: background-color 0.12s ease;
	}

	:global(.milkdown .date-reference:hover),
	:global(.milkdown .person-reference:hover),
	:global(.milkdown .tag-reference:hover),
	:global(.milkdown .url-reference:hover) {
		background: color-mix(in srgb, var(--ref) 22%, transparent);
	}

	:global(.milkdown .date-reference::before),
	:global(.milkdown .person-reference::before),
	:global(.milkdown .url-reference::before) {
		content: '';
		display: inline-block;
		width: 0.85em;
		height: 0.85em;
		flex-shrink: 0;
		background-color: currentColor;
		-webkit-mask-size: contain;
		mask-size: contain;
		-webkit-mask-repeat: no-repeat;
		mask-repeat: no-repeat;
		opacity: 0.8;
	}

	:global(.milkdown .date-reference) {
		--ref: var(--color-ref-date);
	}

	:global(.milkdown .date-reference::before) {
		-webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20'%3E%3Cpath fill-rule='evenodd' d='M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z' clip-rule='evenodd'/%3E%3C/svg%3E");
		mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20'%3E%3Cpath fill-rule='evenodd' d='M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z' clip-rule='evenodd'/%3E%3C/svg%3E");
	}

	:global(.milkdown .person-reference) {
		--ref: var(--color-ref-person);
		border-radius: 1em;
	}

	:global(.milkdown .person-reference::before) {
		-webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20'%3E%3Cpath fill-rule='evenodd' d='M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z' clip-rule='evenodd'/%3E%3C/svg%3E");
		mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20'%3E%3Cpath fill-rule='evenodd' d='M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z' clip-rule='evenodd'/%3E%3C/svg%3E");
	}

	:global(.milkdown .tag-reference) {
		--ref: var(--color-ref-tag);
	}

	:global(.milkdown .url-reference) {
		--ref: var(--color-ref-url);
		word-break: break-all;
	}

	:global(.milkdown .url-reference::before) {
		-webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20'%3E%3Cpath fill-rule='evenodd' d='M12.586 4.586a2 2 0 112.828 2.828l-3 3a2 2 0 01-2.828 0 1 1 0 00-1.414 1.414 4 4 0 005.656 0l3-3a4 4 0 00-5.656-5.656l-1.5 1.5a1 1 0 101.414 1.414l1.5-1.5zm-5 5a2 2 0 012.828 0 1 1 0 101.414-1.414 4 4 0 00-5.656 0l-3 3a4 4 0 105.656 5.656l1.5-1.5a1 1 0 10-1.414-1.414l-1.5 1.5a2 2 0 11-2.828-2.828l3-3z' clip-rule='evenodd'/%3E%3C/svg%3E");
		mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20'%3E%3Cpath fill-rule='evenodd' d='M12.586 4.586a2 2 0 112.828 2.828l-3 3a2 2 0 01-2.828 0 1 1 0 00-1.414 1.414 4 4 0 005.656 0l3-3a4 4 0 00-5.656-5.656l-1.5 1.5a1 1 0 101.414 1.414l1.5-1.5zm-5 5a2 2 0 012.828 0 1 1 0 101.414-1.414 4 4 0 00-5.656 0l-3 3a4 4 0 105.656 5.656l1.5-1.5a1 1 0 10-1.414-1.414l-1.5 1.5a2 2 0 11-2.828-2.828l3-3z' clip-rule='evenodd'/%3E%3C/svg%3E");
	}

	/* Placeholder */
	:global(.milkdown .ProseMirror p.is-editor-empty:first-child::before) {
		content: attr(data-placeholder);
		color: var(--color-text-faint);
		pointer-events: none;
		float: left;
		height: 0;
	}

	/* Headings */
	:global(.milkdown h1),
	:global(.milkdown h2),
	:global(.milkdown h3),
	:global(.milkdown h4),
	:global(.milkdown h5),
	:global(.milkdown h6) {
		color: var(--color-text);
		line-height: 1.3;
		letter-spacing: -0.01em;
	}

	:global(.milkdown h1) {
		font-size: 1.75em;
		font-weight: 700;
		margin-top: 1.4em;
		margin-bottom: 0.4em;
	}

	:global(.milkdown h2) {
		font-size: 1.4em;
		font-weight: 650;
		margin-top: 1.3em;
		margin-bottom: 0.35em;
	}

	:global(.milkdown h3) {
		font-size: 1.18em;
		font-weight: 600;
		margin-top: 1.1em;
		margin-bottom: 0.3em;
	}

	:global(.milkdown h4),
	:global(.milkdown h5),
	:global(.milkdown h6) {
		font-size: 1em;
		font-weight: 600;
		margin-top: 1em;
		margin-bottom: 0.25em;
	}

	:global(.milkdown .ProseMirror > :first-child) {
		margin-top: 0;
	}

	/* Paragraphs */
	:global(.milkdown p) {
		margin-bottom: 0.6em;
		line-height: 1.7;
	}

	/* Links */
	:global(.milkdown a) {
		color: var(--color-accent);
		text-decoration: underline;
		text-decoration-color: color-mix(in srgb, var(--color-accent) 35%, transparent);
		text-underline-offset: 0.2em;
	}

	:global(.milkdown a:hover) {
		text-decoration-color: var(--color-accent);
	}

	/* Code */
	:global(.milkdown code) {
		background: color-mix(in srgb, var(--color-accent) 10%, transparent);
		color: var(--color-text);
		padding: 0.15em 0.35em;
		border-radius: 4px;
		font-family: var(--font-mono);
		font-size: 0.85em;
	}

	:global(.milkdown pre) {
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border);
		padding: 0.875em 1em;
		border-radius: var(--radius-md);
		overflow-x: auto;
		margin: 1em 0;
		font-size: 0.95em;
		line-height: 1.6;
	}

	:global(.milkdown pre code) {
		background: none;
		padding: 0;
	}

	/* The language of a code block, as a small label in its corner */
	:global(.milkdown pre[data-language]) {
		position: relative;
	}

	:global(.milkdown pre[data-language]:not(:first-child)::after) {
		content: attr(data-language);
		position: absolute;
		top: 0.5em;
		right: 0.75em;
		font-family: var(--font-sans);
		font-size: 0.65em;
		font-weight: 600;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: var(--color-accent);
		opacity: 0.8;
		pointer-events: none;
	}

	/* Code blocks: header with the language and a copy button (codeHighlight.ts) */
	:global(.milkdown .kurumi-code) {
		position: relative;
		margin: 1em 0;
	}

	:global(.milkdown .kurumi-code > pre) {
		margin: 0;
	}

	:global(.milkdown .kurumi-code > pre[data-language]::after) {
		display: none;
	}

	:global(.milkdown .kurumi-code-header) {
		position: absolute;
		top: 0.35em;
		right: 0.5em;
		z-index: 1;
		display: flex;
		align-items: center;
		gap: 0.25em;
		font-family: var(--font-sans);
		font-size: 0.72rem;
	}

	:global(.milkdown .kurumi-code-lang) {
		width: auto;
		padding: 0.15em 0.4em;
		border: 1px solid transparent;
		border-radius: var(--radius-sm, 4px);
		background: transparent;
		color: var(--color-accent);
		font: inherit;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		text-align: right;
		opacity: 0.8;
	}

	:global(.milkdown .kurumi-code-lang::placeholder) {
		color: transparent;
		text-transform: none;
		font-weight: 400;
	}

	:global(.milkdown .kurumi-code-lang:is(:hover, :focus)) {
		border-color: var(--color-border);
		background: var(--color-bg);
		text-align: left;
		text-transform: none;
		opacity: 1;
		outline: none;
	}

	:global(.milkdown .kurumi-code-copy) {
		padding: 0.15em 0.5em;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm, 4px);
		background: var(--color-bg);
		color: var(--color-text-muted);
		font: inherit;
		cursor: pointer;
		opacity: 0;
		transition: opacity 0.15s;
	}

	:global(.milkdown .kurumi-code:is(:hover, :focus-within) .kurumi-code-lang::placeholder) {
		color: var(--color-text-faint);
	}

	:global(.milkdown .kurumi-code:is(:hover, :focus-within) .kurumi-code-copy) {
		opacity: 1;
	}

	@media (hover: none) {
		:global(.milkdown .kurumi-code-copy) {
			opacity: 1;
		}
	}

	/* Mermaid: the diagram, and its source only while the cursor is in it */
	:global(.milkdown .kurumi-mermaid) {
		margin: 1em 0;
	}

	:global(.milkdown .kurumi-mermaid > pre) {
		display: none;
		margin-top: 0.5em;
	}

	:global(.milkdown .kurumi-mermaid.is-editing > pre) {
		display: block;
	}

	:global(.milkdown .kurumi-mermaid-preview) {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5em;
		padding: 1em;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-bg-secondary);
		cursor: pointer;
		overflow-x: auto;
		transition: border-color 0.15s ease;
	}

	:global(.milkdown .kurumi-mermaid-preview:hover),
	:global(.milkdown .kurumi-mermaid.is-editing .kurumi-mermaid-preview) {
		border-color: color-mix(in srgb, var(--color-accent) 50%, var(--color-border));
	}

	:global(.milkdown .kurumi-mermaid-preview svg) {
		max-width: 100%;
		height: auto;
	}

	/* Mermaid sizes its labels itself; the note's text styles mustn't reach them */
	:global(.milkdown .kurumi-mermaid-preview svg :is(p, span, div)) {
		margin: 0;
		line-height: 1.5;
		letter-spacing: normal;
		font-size: inherit;
	}

	:global(.milkdown .kurumi-mermaid-empty) {
		color: var(--color-text-faint);
		font-size: 0.9em;
	}

	:global(.milkdown .kurumi-mermaid-error) {
		color: var(--color-danger);
		font-family: var(--font-sans);
		font-size: 0.8em;
	}

	/* Columns (editor/columns.ts) */
	:global(.milkdown .kurumi-columns) {
		display: grid;
		grid-auto-columns: minmax(0, 1fr);
		grid-auto-flow: column;
		gap: 1.5rem;
		margin: 0.75em 0;
	}

	:global(.milkdown .kurumi-column) {
		min-width: 0;
		padding: 0.25rem 0.5rem;
		border-radius: var(--radius-md);
		outline: 1px dashed transparent;
		transition: outline-color 0.15s;
	}

	:global(.milkdown .kurumi-columns:hover .kurumi-column),
	:global(.milkdown .kurumi-column:focus-within) {
		outline-color: var(--color-border);
	}

	:global(.milkdown .kurumi-column > :first-child) {
		margin-top: 0;
	}

	@media (max-width: 640px) {
		:global(.milkdown .kurumi-columns) {
			grid-auto-flow: row;
		}
	}

	/* Toggle headings (editor/headingFold.ts): a caret in the margin folds the section */
	:global(.milkdown .ProseMirror :is(h1, h2, h3, h4, h5, h6)) {
		position: relative;
	}

	:global(.milkdown .foldable::before) {
		content: '';
		position: absolute;
		left: -1.5rem;
		top: calc(50% - 0.625rem);
		width: 1.25rem;
		height: 1.25rem;
		border-radius: var(--radius-sm);
		background-color: var(--color-text-faint);
		-webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='m9 6 6 6-6 6' fill='none' stroke='black' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center / 0.875rem no-repeat;
		mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='m9 6 6 6-6 6' fill='none' stroke='black' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center / 0.875rem no-repeat;
		opacity: 0;
		transform: rotate(90deg);
		transition: opacity 0.15s, transform 0.15s;
		cursor: pointer;
	}

	:global(.milkdown .foldable:hover::before),
	:global(.milkdown .foldable.is-folded-heading::before) {
		opacity: 1;
	}

	:global(.milkdown .foldable.is-folded-heading::before) {
		transform: none;
	}

	:global(.milkdown .fold-hidden) {
		display: none !important;
	}

	:global(.milkdown .is-folded-heading::after) {
		content: ' …';
		color: var(--color-text-faint);
		font-weight: 400;
	}

	/* Vim mode (editor/vim.ts): a block cursor outside Insert mode */
	:global(.milkdown .ProseMirror.vim-normal),
	:global(.milkdown .ProseMirror.vim-visual) {
		caret-color: transparent;
	}

	:global(.milkdown .ProseMirror.vim-normal .vim-cursor) {
		border-radius: 2px;
		background: color-mix(in srgb, var(--color-accent) 55%, transparent);
	}

	:global(.milkdown .ProseMirror:not(:focus) .vim-cursor) {
		background: none;
		outline: 1px solid color-mix(in srgb, var(--color-accent) 60%, transparent);
	}

	:global(.milkdown .vim-cursor-empty) {
		display: inline-block;
		width: 0.55em;
	}

	.vim-badge {
		position: fixed;
		right: 1rem;
		bottom: 1rem;
		z-index: 30;
		padding: 0.125rem 0.5rem;
		border-radius: var(--radius-sm);
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border);
		font-family: var(--font-mono);
		font-size: 0.6875rem;
		font-weight: 600;
		letter-spacing: 0.04em;
		color: var(--color-text-muted);
		pointer-events: none;
	}

	.vim-badge-insert {
		color: var(--color-accent);
	}

	.vim-badge-visual {
		color: var(--color-ref-tag);
	}

	/* Live queries and databases: the results, and the source only while editing
	   (editor/queryBlock.svelte.ts, editor/databaseBlock.svelte.ts) */
	:global(.milkdown :is(.kurumi-query, .kurumi-database) > pre) {
		display: none;
		margin-top: 0.25em;
	}

	:global(.milkdown :is(.kurumi-query, .kurumi-database).is-editing > pre) {
		display: block;
	}

	/* The note's typography mustn't reach an embedded database */
	:global(.milkdown .kurumi-database-preview) {
		font-family: var(--font-sans);
		font-size: 0.875rem;
		line-height: 1.45;
		white-space: normal;
	}

	:global(.milkdown .kurumi-database-preview :is(table, th, td, tr)) {
		margin: 0;
		box-shadow: none;
		background: none;
		font-size: inherit;
	}

	:global(.milkdown .kurumi-database .kurumi-database-preview :is(th, td)) {
		padding: 0.125rem 0.25rem !important;
		border: none;
		border-bottom: 1px solid var(--color-border);
		border-right: 1px solid var(--color-border);
	}

	:global(.milkdown .kurumi-database .kurumi-database-preview :is(h1, p, ul, li)) {
		margin: 0;
		padding: 0;
		font-size: inherit;
	}

	:global(.milkdown .kurumi-query-preview) {
		cursor: pointer;
	}

	/* The note's table styles (and the theme's) mustn't reach the results table */
	:global(.milkdown .kurumi-query .kurumi-query-preview table) {
		margin: 0;
		border: none;
		border-radius: 0;
		box-shadow: none;
		font-size: inherit;
	}

	:global(.milkdown .kurumi-query .kurumi-query-preview tr) {
		border: none;
	}

	:global(.milkdown .kurumi-query .kurumi-query-preview :is(th, td)) {
		padding: 0.375rem 0.75rem !important;
		border: none;
		border-bottom: 1px solid var(--color-border);
		background: none;
	}

	:global(.milkdown .kurumi-query .kurumi-query-preview th) {
		background: var(--color-bg-secondary);
		font-size: 0.75rem;
		font-weight: 500;
		color: var(--color-text-muted);
	}

	/* Math: KaTeX, and the source only while editing (editor/math.ts) */
	:global(.milkdown .kurumi-math-inline) {
		position: relative;
		padding: 0 0.1em;
		border-radius: 4px;
		cursor: pointer;
	}

	:global(.milkdown .kurumi-math-inline:hover),
	:global(.milkdown .kurumi-math-inline.is-selected) {
		background: var(--color-accent-soft);
	}

	:global(.milkdown .kurumi-math-input) {
		position: absolute;
		top: calc(100% + 4px);
		left: 0;
		z-index: 20;
		min-width: 14rem;
		padding: 0.3rem 0.5rem;
		border: 1px solid var(--color-accent);
		border-radius: var(--radius-md);
		background: var(--color-bg);
		color: var(--color-text);
		font-family: var(--font-mono, ui-monospace, monospace);
		font-size: 0.85rem;
		box-shadow: var(--shadow-md);
		outline: none;
	}

	:global(.milkdown .kurumi-math-block) {
		margin: 1em 0;
	}

	:global(.milkdown .kurumi-math-block > pre) {
		display: none;
		margin-top: 0.5em;
	}

	:global(.milkdown .kurumi-math-block.is-editing > pre) {
		display: block;
	}

	:global(.milkdown .kurumi-math-preview) {
		padding: 0.5em 1em;
		border: 1px solid transparent;
		border-radius: var(--radius-md);
		cursor: pointer;
		overflow-x: auto;
		text-align: center;
		transition: border-color 0.15s ease;
	}

	:global(.milkdown .kurumi-math-preview:hover),
	:global(.milkdown .kurumi-math-block.is-editing .kurumi-math-preview) {
		border-color: var(--color-border);
		background: var(--color-bg-secondary);
	}

	:global(.milkdown .kurumi-math-empty) {
		color: var(--color-text-faint);
		font-size: 0.9em;
	}

	/* Blockquotes: a band of the accent */
	:global(.milkdown blockquote) {
		border-left: 3px solid var(--color-accent);
		background: color-mix(in srgb, var(--color-accent) 6%, transparent);
		border-radius: 0 var(--radius-md) var(--radius-md) 0;
		padding: 0.5em 1em;
		margin: 0.75em 0;
		color: var(--color-text-muted);
	}

	:global(.milkdown blockquote > :last-child) {
		margin-bottom: 0;
	}

	:global(.milkdown ::selection) {
		background: color-mix(in srgb, var(--color-accent) 25%, transparent);
	}

	/* Lists */
	:global(.milkdown ul),
	:global(.milkdown ol) {
		padding-left: 1.5em;
		margin-bottom: 0.75em;
	}

	:global(.milkdown li) {
		margin-bottom: 0.15em;
	}

	:global(.milkdown li > p) {
		margin-bottom: 0.15em;
	}

	:global(.milkdown li::marker) {
		color: color-mix(in srgb, var(--color-accent) 70%, var(--color-text-faint));
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
		height: 1px;
		background: linear-gradient(
			to right,
			transparent,
			color-mix(in srgb, var(--color-accent) 55%, transparent) 50%,
			transparent
		);
		margin: 1.75em 0;
	}

	/* Frontmatter code block - styled as Properties panel */
	:global(.milkdown pre:first-child) {
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
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
		color: var(--color-text-faint);
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
		border-radius: var(--radius-md);
		margin: 1em 0;
	}

	/* Mobile: larger font for better readability */
	@media (max-width: 768px) {
		:global(.milkdown .ProseMirror) {
			font-size: 1.125rem;
			line-height: 1.75;
		}

		:global(.milkdown h1) {
			font-size: 1.55em;
		}

		:global(.milkdown h2) {
			font-size: 1.3em;
		}

		:global(.milkdown h3) {
			font-size: 1.12em;
		}

		:global(.milkdown p) {
			margin-bottom: 0.75em;
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

	/* ---- GFM task items (- [ ] / - [x]); clicks handled in taskToggle.ts ---- */
	:global(.milkdown li[data-item-type='task']) {
		position: relative;
		list-style: none;
		padding-left: 1.6em;
	}

	:global(.milkdown li[data-item-type='task']::before) {
		content: '';
		position: absolute;
		left: 0.05em;
		top: 0.3em;
		width: 1.05em;
		height: 1.05em;
		border: 2px solid var(--color-text-muted);
		border-radius: 0.3em;
		cursor: pointer;
		transition: background 0.15s, border-color 0.15s;
	}

	:global(.milkdown li[data-item-type='task']:hover::before) {
		border-color: var(--color-accent);
	}

	:global(.milkdown li[data-item-type='task'][data-checked='true']::before) {
		background: var(--color-accent);
		border-color: var(--color-accent);
	}

	:global(.milkdown li[data-item-type='task'][data-checked='true']::after) {
		content: '';
		position: absolute;
		left: 0.42em;
		top: 0.45em;
		width: 0.32em;
		height: 0.58em;
		border: solid white;
		border-width: 0 2.5px 2.5px 0;
		transform: rotate(45deg);
		pointer-events: none;
	}

	:global(.milkdown li[data-item-type='task'][data-checked='true'] > p) {
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
