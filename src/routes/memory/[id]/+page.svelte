<script lang="ts">
	import { page } from '$app/stores';
	import { goto, beforeNavigate } from '$app/navigation';
	import {
		updateMemoryObject,
		deleteMemoryObject,
		findBacklinks,
		findUnlinkedMentions,
		linkUnlinkedMention,
		memoryObjects,
		addMemoryObject,
		folders,
		retryMemoryProcessing,
		extractRemindersFromMemory,
		restoreMemoryObject,
		permanentlyDeleteMemoryObject,
		setMemoryIcon,
		setMemoryFavorite
	} from '$lib/db';
	import { pushUndo } from '$lib/stores/undo';
	import { openInSplit } from '$lib/stores/workspace';
	import { get } from 'svelte/store';
	import Editor from '$lib/components/Editor.svelte';
	import { stashEdit } from '$lib/unsaved';
	import InlineTemplateChooser from '$lib/components/InlineTemplateChooser.svelte';
	import LinkPreview from '$lib/components/LinkPreview.svelte';
	import NoteIcon from '$lib/components/NoteIcon.svelte';
	import IconPicker from '$lib/components/IconPicker.svelte';
	import NoteProjects from '$lib/components/NoteProjects.svelte';
	import NoteRecordDialog, { type RecordKind } from '$lib/components/NoteRecordDialog.svelte';
	import { untrack, tick } from 'svelte';
	import { downloadSingleMemory, type MarkdownExportFormat } from '$lib/utils/markdown-export';
	import { publishMemoryAsHtml, copyMemoryAsHtml, shareMemory } from '$lib/utils/publish';
	import { getBlob } from '$lib/db/blob-store';
	import { findSemanticBacklinks } from '$lib/digest';
	import type { MemoryObject } from '$lib/db/types';
	import {
		Trash2,
		Download,
		ChevronDown,
		Mic,
		RefreshCw,
		Users,
		CheckSquare,
		Lightbulb,
		HelpCircle,
		ArrowRight,
		Bell,
		ImagePlus,
		Camera,
		History,
		Link2,
		MoreHorizontal,
		FileText,
		ChevronRight,
		Sparkles,
		Share2,
		Copy,
		FileCode,
		X,
		Menu,
		Search,
		Star,
		Smile,
		FolderKanban,
		Gavel,
		ListChecks
	} from 'lucide-svelte';
	import { triggerSearch } from '$lib/stores/snackbar';
	import CameraCapture from '$lib/components/CameraCapture.svelte';
	import VersionHistoryModal from '$lib/components/VersionHistoryModal.svelte';
	import { processAndStoreImage } from '$lib/utils/image';

	let title = $state('');
	let content = $state('');
	let backlinks = $state<ReturnType<typeof findBacklinks>>([]);
	let unlinkedMentions = $state<ReturnType<typeof findUnlinkedMentions>>([]);
	let showHistory = $state(false);
	let relatedNotes = $state<Array<{ memory: MemoryObject; score: number }>>([]);
	let loadingRelated = $state(false);
	let showMoreMenu = $state(false);
	let iconPickerAnchor = $state<{ left: number; top: number; bottom: number } | null>(null);
	let projectPicker = $state<DOMRect | null>(null);
	let recordKind = $state<RecordKind | null>(null);

	function openIconPicker(e: MouseEvent) {
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		iconPickerAnchor = { left: rect.left, top: rect.top, bottom: rect.bottom };
	}
	let titleInput: HTMLInputElement | undefined = $state();
	let scrollArea: HTMLDivElement | undefined = $state();

	// Ticks every 30s so the "Edited …" label stays fresh.
	let now = $state(Date.now());
	$effect(() => {
		const timer = setInterval(() => (now = Date.now()), 30_000);
		return () => clearInterval(timer);
	});
	let initializedForId = $state('');
	// Bump to force Milkdown editor re-mount when content is appended
	// programmatically (audio embeds, etc). Milkdown doesn't re-parse
	// markdown from external content changes, so we destroy + re-create.
	let editorRevision = $state(0);

	// Inline template chooser: visible when the note body is empty and
	// the user hasn't dismissed it (by typing). Auto-hides on first
	// content change so it never blocks the writing flow.
	let showTemplateChooser = $state(false);
	let templateChooserDismissed = $state(false);

	// Show the chooser when a fresh empty note is opened.
	$effect(() => {
		const id = $page.params.id;
		if (id && id !== initializedForId) {
			// Will be set in the init effect below; reset the dismissed flag
			// so a new navigation to a different empty note shows it again.
			templateChooserDismissed = false;
		}
	});

	// shouldShowChooser is computed below after `memory` is declared.

	function handleTemplateSelect(body: string, templateTitle: string) {
		// If the user hasn't customized the title (still "Untitled"),
		// use the template's title. Otherwise keep theirs.
		const titleIsDefault = !title || title === 'Untitled';
		if (titleIsDefault) {
			title = templateTitle;
			if (memory) {
				updateMemoryObject(memory.id, { title: templateTitle });
			}
		}

		// Fill the body
		content = body;
		if (memory) {
			updateMemoryObject(memory.id, { bodyMarkdown: body });
		}
		templateChooserDismissed = true;
	}

	function handleTemplateDismiss() {
		templateChooserDismissed = true;
	}
	let extractingReminders = $state(false);
	let extractionResult = $state<string | null>(null);
	let showCameraCapture = $state(false);
	let imageInputRef: HTMLInputElement | undefined = $state();

	// Inline audio recording state
	let isRecording = $state(false);
	let recordingType = $state<'voice' | 'meeting'>('voice');
	let mediaRecorder: MediaRecorder | null = null;
	let audioChunks: Blob[] = [];
	let recordingStartTime = $state<number>(0);

	async function startInlineRecording(type: 'voice' | 'meeting') {
		if (isRecording) return;
		recordingType = type;
		try {
			const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
			const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
				? 'audio/webm;codecs=opus'
				: 'audio/webm';
			mediaRecorder = new MediaRecorder(stream, { mimeType });
			audioChunks = [];
			mediaRecorder.ondataavailable = (e) => {
				if (e.data.size > 0) audioChunks.push(e.data);
			};
			mediaRecorder.onstop = async () => {
				for (const track of stream.getTracks()) track.stop();
				const audioBlob = new Blob(audioChunks, { type: mimeType });
				await handleRecordingComplete(audioBlob);
			};
			mediaRecorder.start();
			recordingStartTime = Date.now();
			isRecording = true;
		} catch (err) {
			console.error('Recording failed:', err);
		}
	}

	function stopInlineRecording() {
		if (mediaRecorder && mediaRecorder.state !== 'inactive') {
			mediaRecorder.stop();
		}
		isRecording = false;
	}

	async function handleRecordingComplete(audioBlob: Blob) {
		const { storeBlob } = await import('$lib/db/blob-store');
		const audioRef = await storeBlob(audioBlob, audioBlob.type || 'audio/webm');

		// Format timestamp
		const now = new Date();
		const timeStr = now.toLocaleString('en-US', {
			month: 'short', day: 'numeric', year: 'numeric',
			hour: 'numeric', minute: '2-digit'
		});
		const icon = recordingType === 'meeting' ? '👥' : '🎙';
		const label = recordingType === 'meeting' ? 'Meeting recording' : 'Voice memo';

		// Build the embed markdown.
		// Use image syntax ![audio:label](blobRef) so Milkdown parses it
		// as a native image node. The Editor's MutationObserver swaps
		// <img> elements whose alt starts with "audio:" into real <audio>
		// players after render.
		const embed = [
			'',
			`#### ${icon} ${label} — ${timeStr}`,
			'',
			`![audio:${label}](${audioRef})`,
			'> **Transcript:** *Processing...*',
			''
		].join('\n');

		// Append to the note body, save, and re-render the editor
		content = (content || '') + embed;
		if (memory) {
			updateMemoryObject(memory.id, { bodyMarkdown: content });
		}
		// Bump revision to force Milkdown re-mount so the new markdown
		// is parsed properly (headings, HTML audio, blockquotes etc.)
		editorRevision++;

		// Kick off transcription in the background
		void transcribeAndInsert(audioRef, audioBlob);
	}

	async function transcribeAndInsert(audioRef: string, audioBlob: Blob) {
		try {
			const { inferenceRouter } = await import('$lib/inference');
			const provider = inferenceRouter.findProvider((c) => c.supportsTranscribe);
			if (!provider) return;

			const result = await provider.transcribe({
				audio: audioBlob,
				mimeType: audioBlob.type || 'audio/webm'
			});
			if (!result.ok || !result.value?.text) return;

			const transcript = result.value.text.trim();

			// Replace the "Processing..." placeholder with the actual transcript
			if (memory) {
				const currentBody = memory.bodyMarkdown || '';
				const updated = currentBody.replace(
					'> **Transcript:** *Processing...*',
					`> **Transcript:**\n> ${transcript.replace(/\n/g, '\n> ')}`
				);
				if (updated !== currentBody) {
					content = updated;
					updateMemoryObject(memory.id, { bodyMarkdown: updated });
					editorRevision++;
				}
			}
		} catch (err) {
			console.error('Transcription failed:', err);
		}
	}

	function handleImageUpload() {
		imageInputRef?.click();
	}

	/**
	 * Insert text into the Milkdown editor via a custom event.
	 * The Editor component listens for 'kurumi-insert-text' and
	 * inserts at the cursor position.
	 */
	function insertIntoEditor(text: string) {
		window.dispatchEvent(
			new CustomEvent('kurumi-insert-text', { detail: text })
		);
	}

	async function handleImageFileSelect(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		try {
			const result = await processAndStoreImage(file, file.name.replace(/\.[^.]+$/, ''));
			insertIntoEditor('\n' + result.markdown + '\n');
		} catch (err) {
			console.error('Image upload failed:', err);
		}
		if (imageInputRef) imageInputRef.value = '';
	}

	function handleCameraCapture(markdown: string) {
		insertIntoEditor('\n' + markdown + '\n');
		showCameraCapture = false;
	}

	// Refresh the editor + link panels after restoring an old version. The
	// id-change effect won't re-run (same note), so reset content explicitly
	// and bump the revision to force the Milkdown editor to re-parse.
	function handleVersionRestored() {
		const id = $page.params.id;
		if (!id) return;
		const restored = get(memoryObjects).find((m) => m.id === id);
		if (!restored) return;
		title = restored.title;
		content = restored.bodyMarkdown;
		syncedMemoryTitle = restored.title;
		editorRevision += 1;
		backlinks = findBacklinks(id);
		unlinkedMentions = findUnlinkedMentions(id);
	}

	// Promote an unlinked mention into a real [[wikilink]] in the other note.
	function handleLinkMention(sourceId: string) {
		if (!memory) return;
		if (linkUnlinkedMention(sourceId, memory.title)) {
			backlinks = findBacklinks(memory.id);
			unlinkedMentions = findUnlinkedMentions(memory.id);
		}
	}

	async function handleExtractReminders() {
		if (!memory || extractingReminders) return;
		extractingReminders = true;
		extractionResult = null;
		try {
			const { reminders, drafts } = await extractRemindersFromMemory(memory.id);
			if (reminders === -1 && drafts === -1) {
				extractionResult = 'Extraction unavailable — provider not configured';
			} else {
				const parts: string[] = [];
				if (reminders > 0)
					parts.push(`${reminders} reminder${reminders === 1 ? '' : 's'}`);
				if (drafts > 0) parts.push(`${drafts} draft${drafts === 1 ? '' : 's'}`);
				if (parts.length === 0) {
					extractionResult = 'No new proposals found';
				} else {
					extractionResult = `${parts.join(' + ')} added for review`;
				}
			}
		} catch (err) {
			extractionResult = err instanceof Error ? err.message : 'Extraction failed';
		} finally {
			extractingReminders = false;
		}
	}
	// Last memory.title we synced into the local `title` state. Used to
	// detect external title changes (e.g. LLM auto-rename) so we can pick
	// them up without clobbering live user typing.
	let syncedMemoryTitle = $state('');

	// Audio playback for voice memos
	let audioUrl = $state<string | null>(null);
	let loadedAudioRef = $state<string | null>(null);

	// Debounce timer for auto-save. The pending payload captures the target
	// memory id + values at schedule time so a save can never be misdirected
	// to (or clobbered by) a different note if the user switches mid-debounce.
	let saveTimeout: ReturnType<typeof setTimeout>;
	// True once the user has changed this note's title or body since it was
	// opened. Saves on navigation only run when set, so an editor that failed
	// to render (and reports an empty document) can never overwrite a note.
	let hasLocalEdits = false;

	// A note that was created moments before it was opened (Cmd+N, "New
	// note"). If it's still untitled and empty when the user leaves, it's
	// discarded instead of littering the tree — like Notion's blank pages.
	let freshNoteId: string | null = null;

	function discardIfUntouched(id: string) {
		if (freshNoteId !== id) return;
		freshNoteId = null;
		const note = get(memoryObjects).find((m) => m.id === id);
		if (note && note.type === 'note' && isDefaultTitle(note.title) && !note.bodyMarkdown.trim()) {
			permanentlyDeleteMemoryObject(id);
		}
	}
	let pendingSave: { id: string; title: string; content: string } | null = null;

	// Bound Editor instance — lets us read the live document synchronously,
	// bypassing Milkdown's internal 200ms change debounce. Critical for not
	// losing the last keystrokes when switching notes quickly.
	let editorRef: { getCurrentMarkdown: () => string | null } | undefined = $state();

	// Reactive memory object — stays in sync with the store so async updates
	// (transcription, sync) propagate to the UI without a manual refresh.
	let memory = $derived($memoryObjects.find((m) => m.id === $page.params.id));

	// Rough word count for the header (ignores markdown punctuation).
	let wordCount = $derived(
		content.replace(/[#>*_`~\[\]()!|-]+/g, ' ').split(/\s+/).filter(Boolean).length
	);

	// Folder path for the header breadcrumb.
	let folderPath = $derived.by(() => {
		const path: Array<{ id: string; name: string }> = [];
		let folderId = memory?.folderId ?? null;
		while (folderId) {
			const folder = $folders.find((f) => f.id === folderId);
			if (!folder) break;
			path.unshift({ id: folder.id, name: folder.name });
			folderId = folder.parentId;
		}
		return path;
	});

	// Derived: show template chooser when body is empty AND not dismissed.
	let shouldShowChooser = $derived(
		!templateChooserDismissed &&
		!content.trim() &&
		memory?.type === 'note'
	);

	// Initialize the editor fields once per memory id change. Subsequent store
	// updates do NOT clobber title/content (otherwise typing would be lost).
	$effect(() => {
		const id = $page.params.id;
		if (memory && id && id !== initializedForId) {
			untrack(() => {
				// Persist any debounced edit from the previous note before its
				// state is overwritten, otherwise the pending edit is lost.
				flushPendingSave();
				if (initializedForId) discardIfUntouched(initializedForId);
				hasLocalEdits = false;
				freshNoteId =
					memory!.type === 'note' &&
					Date.now() - memory!.createdAt < 5000 &&
					isDefaultTitle(memory!.title) &&
					!memory!.bodyMarkdown.trim()
						? id
						: null;
				title = memory!.title;
				content = memory!.bodyMarkdown;
				backlinks = findBacklinks(id);
				unlinkedMentions = findUnlinkedMentions(id);
				relatedNotes = [];
				loadingRelated = true;
				findSemanticBacklinks(id, 5).then((results) => {
					relatedNotes = results;
					loadingRelated = false;
				}).catch(() => { loadingRelated = false; });
				initializedForId = id;
				syncedMemoryTitle = memory!.title;
				// A brand-new note: put the cursor in the title, ready to type.
				if (isDefaultTitle(memory!.title) && !memory!.bodyMarkdown.trim()) {
					tick().then(() => titleInput?.focus());
				}
			});
		}
	});

	// React to external title changes (e.g. LLM auto-rename after summarization).
	// Only adopt the new title if the user hasn't typed since the last sync —
	// detected by `title` still matching the previously synced value.
	$effect(() => {
		if (!memory) return;
		const externalTitle = memory.title;
		if (externalTitle !== syncedMemoryTitle) {
			untrack(() => {
				if (title === syncedMemoryTitle) {
					title = externalTitle;
				}
				syncedMemoryTitle = externalTitle;
			});
		}
	});

	// Load audio when the memory's audio ref changes (covers id change and the
	// rare case of an audio ref being attached after the page loads).
	$effect(() => {
		const ref = memory?.rawAudioRef ?? null;
		if (ref !== loadedAudioRef) {
			untrack(() => {
				loadAudioForRef(ref);
				loadedAudioRef = ref;
			});
		}
	});

	async function loadAudioForRef(ref: string | null) {
		// Revoke any previous audio URL
		if (audioUrl) {
			URL.revokeObjectURL(audioUrl);
			audioUrl = null;
		}
		if (!ref) return;
		const stored = await getBlob(ref);
		if (!stored) return;
		audioUrl = URL.createObjectURL(stored.blob);
	}

	// Cleanup the object URL when the component is destroyed, and flush any
	// debounced edit so navigating away (not just between notes) never drops it.
	$effect(() => {
		return () => {
			flushPendingSave();
			if (initializedForId) discardIfUntouched(initializedForId);
			if (audioUrl) URL.revokeObjectURL(audioUrl);
		};
	});

	// Auto-retry processing for voice memos / meetings stuck in 'pending'
	// (e.g. created with an older app version, or crashed mid-pipeline).
	// Fires once per page visit per memory.
	let autoRetriedForId = $state('');
	$effect(() => {
		if (!memory) return;
		if (memory.id === autoRetriedForId) return;
		const isStuck =
			(memory.type === 'voice-memo' || memory.type === 'meeting') &&
			memory.processingState === 'pending' &&
			memory.rawAudioRef !== null &&
			!memory.transcript;
		if (isStuck) {
			untrack(() => {
				autoRetriedForId = memory!.id;
				void retryMemoryProcessing(memory!.id);
			});
		}
	});

	let retrying = $state(false);
	async function handleRetryProcessing() {
		if (!memory || retrying) return;
		retrying = true;
		try {
			await retryMemoryProcessing(memory.id);
		} finally {
			retrying = false;
		}
	}

	function isDefaultTitle(value: string): boolean {
		return !value || value === 'Untitled';
	}

	function handleTitleChange(e: Event) {
		const target = e.target as HTMLInputElement;
		// Keep the stored default so links, sync and exports still have a name;
		// the input shows an empty field with an "Untitled" placeholder instead.
		title = target.value || 'Untitled';
		hasLocalEdits = true;
		debouncedSave();
	}

	// Pick up body changes made elsewhere while this note is open (sync
	// pulls, "replace in all notes", the split pane). Skipped while an edit
	// of ours is unsaved or the user is mid-typing (Milkdown reports changes
	// 200ms late), so typing is never overwritten.
	let lastKeyAt = 0;
	$effect(() => {
		const body = memory?.bodyMarkdown;
		if (body === undefined) return;
		untrack(() => {
			if (!memory || memory.id !== initializedForId) return;
			if (pendingSave || body === content || Date.now() - lastKeyAt < 1500) return;
			content = body;
			editorRevision++;
		});
	});

	function handleContentChange(markdown: string, changedId?: string) {
		// Milkdown debounces this callback 200ms, so it can arrive after the
		// user switched notes. Drop updates tagged for a different note,
		// otherwise the previous note's text would overwrite the current one.
		if (changedId && memory && changedId !== memory.id) return;
		if (markdown === content) return;
		content = markdown;
		hasLocalEdits = true;
		// Auto-dismiss the template chooser as soon as the user types
		// anything into the body — writing should never be blocked.
		if (markdown.trim() && !templateChooserDismissed) {
			templateChooserDismissed = true;
		}
		debouncedSave();
	}

	function debouncedSave() {
		if (!memory) return;
		// Capture the target id + values now; the timer must not read the
		// reactive `memory`/`content` later, since navigation may have swapped
		// them to a different note by the time it fires.
		pendingSave = { id: memory.id, title, content };
		clearTimeout(saveTimeout);
		saveTimeout = setTimeout(flushPendingSave, 300);
	}

	// Persist any pending save immediately. Called before switching notes and
	// on teardown so debounced edits are never dropped.
	function flushPendingSave() {
		clearTimeout(saveTimeout);
		if (pendingSave) {
			updateMemoryObject(pendingSave.id, {
				title: pendingSave.title,
				bodyMarkdown: pendingSave.content
			});
			pendingSave = null;
		}
	}

	// Save the live editor content to the current note right now. Reads the
	// document directly from Milkdown (skipping its 200ms change debounce), so
	// even the most recent keystrokes are persisted before we leave the note.
	function saveLiveContent() {
		clearTimeout(saveTimeout);
		pendingSave = null;
		if (!memory || !hasLocalEdits) return;
		const live = editorRef?.getCurrentMarkdown();
		const body = live ?? content;
		content = body;
		updateMemoryObject(memory.id, { title, bodyMarkdown: body });
	}

	// Flush before any client-side navigation. beforeNavigate fires while we're
	// still on the current note (before $page updates), so `memory` and the
	// bound editor still point at the note being left.
	beforeNavigate(() => {
		saveLiveContent();
	});

	// Full page loads skip beforeNavigate (reload, a file or share opening in
	// this window, closing the tab): save the live content then too.
	// The editor reports changes 200ms late, so also note typing as it
	// happens; otherwise a reload right after a keystroke skips the save.
	$effect(() => {
		const save = () => {
			saveLiveContent();
			if (memory && hasLocalEdits) stashEdit(memory.id, title, content);
		};
		const typed = (e: Event) => {
			if ((e.target as HTMLElement | null)?.closest?.('main .ProseMirror')) hasLocalEdits = true;
		};
		window.addEventListener('pagehide', save);
		window.addEventListener('input', typed, true);
		return () => {
			window.removeEventListener('pagehide', save);
			window.removeEventListener('input', typed, true);
		};
	});

	// Deleting is a soft delete into Trash, so skip the confirmation and offer
	// undo instead (Cmd+Z or the toast).
	function handleDelete() {
		if (!memory) return;
		const { id } = memory;
		const name = memory.title || 'Untitled';
		showMoreMenu = false;
		deleteMemoryObject(id);
		pushUndo({
			label: `Moved "${name}" to trash`,
			undo: () => {
				restoreMemoryObject(id);
				goto(`/memory/${id}`);
			}
		});
		goto('/');
	}

	// Alt+click (or "Open to the side" in the preview) opens the link in
	// the split pane instead.
	function handleWikilinkClick(linkTitle: string, event?: MouseEvent | { altKey: boolean }) {
		// Find memory by title (case-insensitive)
		const all = get(memoryObjects);
		const target = all.find((m) => m.title.toLowerCase() === linkTitle.toLowerCase());

		if (event?.altKey) {
			const id = target ? target.id : addMemoryObject(linkTitle, '').id;
			if (id !== memory?.id) openInSplit(id);
			return;
		}

		if (target) {
			// Navigate to existing memory
			goto(`/memory/${target.id}`);
		} else {
			// Create new memory with this title
			const created = addMemoryObject(linkTitle, '');
			goto(`/memory/${created.id}`);
		}
	}

	function formatEdited(timestamp: number, reference: number): string {
		const seconds = Math.max(0, Math.round((reference - timestamp) / 1000));
		if (seconds < 45) return 'Edited just now';
		const minutes = Math.round(seconds / 60);
		if (minutes < 60) return `Edited ${minutes}m ago`;
		const hours = Math.round(minutes / 60);
		if (hours < 24) return `Edited ${hours}h ago`;
		const date = new Date(timestamp);
		const sameYear = date.getFullYear() === new Date(reference).getFullYear();
		return `Edited ${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: sameYear ? undefined : 'numeric' })}`;
	}

	function formatDate(timestamp: number): string {
		const date = new Date(timestamp);
		const year = date.getFullYear();
		const month = String(date.getMonth() + 1).padStart(2, '0');
		const day = String(date.getDate()).padStart(2, '0');
		const hours = String(date.getHours()).padStart(2, '0');
		const minutes = String(date.getMinutes()).padStart(2, '0');
		return `${year}-${month}-${day} ${hours}:${minutes}`;
	}

	function handleTitleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' || e.key === 'ArrowDown') {
			e.preventDefault();
			// Focus the editor
			const editor = document.querySelector('.ProseMirror') as HTMLElement;
			if (editor) {
				editor.focus();
			}
		}
	}

	function handleExport(format: MarkdownExportFormat) {
		if (!memory) return;
		const all = get(memoryObjects);
		const allFolders = get(folders);
		downloadSingleMemory(memory, all, allFolders, { format });
		showMoreMenu = false;
	}
</script>

<svelte:head>
	<title>{memory && !isDefaultTitle(title) ? title : 'Untitled'} - Kurumi</title>
</svelte:head>

<svelte:window
	onkeydown={(e) => {
		if (e.key === 'Escape' && showMoreMenu) {
			e.stopPropagation();
			showMoreMenu = false;
		}
	}}
/>

{#if memory}
	<div class="relative flex h-full flex-col">
		<!-- Note header: location, freshness, actions -->
		<div class="note-header flex min-h-11 shrink-0 items-center gap-1 border-b border-[var(--color-border)] px-2 safe-top md:border-b-0 md:px-4 md:pt-0">
			<!-- Mobile: this bar replaces the global top bar -->
			<button
				onclick={() => window.dispatchEvent(new Event('kurumi-open-sidebar'))}
				class="rounded-lg p-2 text-[var(--color-text-muted)] hover:bg-[var(--color-hover)] md:hidden"
				aria-label="Open sidebar"
			>
				<Menu class="h-5 w-5" />
			</button>
			<span class="min-w-0 flex-1 truncate text-sm font-medium text-[var(--color-text)] md:hidden">
				{folderPath.length > 0 ? `${folderPath[folderPath.length - 1].name} / ` : ''}{isDefaultTitle(title) ? 'Untitled' : title}
			</span>
			<nav class="hidden min-w-0 flex-1 items-center gap-1 text-[0.8125rem] text-[var(--color-text-muted)] md:flex" aria-label="Breadcrumb">
				{#each folderPath as folder (folder.id)}
					<a href="/read/folder/{folder.id}" class="max-w-40 truncate rounded px-1 py-0.5 hover:bg-[var(--color-hover)] hover:text-[var(--color-text)]">{folder.name}</a>
					<span class="text-[var(--color-text-faint)]">/</span>
				{/each}
				<span class="flex min-w-0 items-center gap-1.5 px-1 text-[var(--color-text)]">
					{#if memory.icon}<NoteIcon icon={memory.icon} class="h-3.5 w-3.5" />{/if}
					<span class="truncate">{title && title !== 'Untitled' ? title : 'Untitled'}</span>
				</span>
			</nav>

			{#if isRecording}
				<button
					onclick={stopInlineRecording}
					class="recording-pill inline-flex items-center gap-1.5 rounded-full bg-red-500/10 px-2.5 py-1 text-xs font-medium text-red-500 hover:bg-red-500/20"
					title="Stop recording"
				>
					<span class="h-1.5 w-1.5 rounded-full bg-red-500"></span>
					Recording {recordingType === 'meeting' ? 'meeting' : 'memo'} · Stop
				</button>
			{/if}

			{#if wordCount > 0}
				<span class="hidden shrink-0 px-1 text-xs tabular-nums text-[var(--color-text-faint)] lg:inline">
					{wordCount.toLocaleString()} {wordCount === 1 ? 'word' : 'words'}
				</span>
			{/if}
			<span class="hidden shrink-0 px-1 text-xs text-[var(--color-text-faint)] sm:inline" title="Last modified {formatDate(memory.updatedAt)}">
				{formatEdited(memory.updatedAt, now)}
			</span>

			<button onclick={() => triggerSearch.set(true)} class="k-icon-btn md:hidden" aria-label="Search">
				<Search class="h-4 w-4" />
			</button>
			<button
				onclick={() => setMemoryFavorite(memory!.id, !memory!.favoritedAt)}
				class="k-icon-btn"
				class:favorite-on={!!memory.favoritedAt}
				title={memory.favoritedAt ? 'Remove from favorites' : 'Add to favorites'}
				aria-label={memory.favoritedAt ? 'Remove from favorites' : 'Add to favorites'}
				aria-pressed={!!memory.favoritedAt}
			>
				<Star class="h-4 w-4" fill={memory.favoritedAt ? 'currentColor' : 'none'} />
			</button>
			<button onclick={() => (showHistory = true)} class="k-icon-btn" title="Version history" aria-label="Version history">
				<History class="h-4 w-4" />
			</button>

			<div class="relative">
				<button
					onclick={() => (showMoreMenu = !showMoreMenu)}
					class="k-icon-btn"
					class:bg-[var(--color-hover)]={showMoreMenu}
					title="More actions"
					aria-label="More actions"
					aria-haspopup="menu"
					aria-expanded={showMoreMenu}
				>
					<MoreHorizontal class="h-4 w-4" />
				</button>

				{#if showMoreMenu}
					<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
					<div class="fixed inset-0 z-40" onclick={() => (showMoreMenu = false)}></div>
					<div class="k-menu absolute right-0 top-full z-50 mt-1 w-60" role="menu">
						<div class="k-menu-label">Insert</div>
						<button class="k-menu-item" role="menuitem" onclick={() => { showMoreMenu = false; handleImageUpload(); }}>
							<ImagePlus class="h-4 w-4 text-[var(--color-text-muted)]" /> Image
						</button>
						<button class="k-menu-item" role="menuitem" onclick={() => { showMoreMenu = false; showCameraCapture = true; }}>
							<Camera class="h-4 w-4 text-[var(--color-text-muted)]" /> Photo
						</button>
						<button class="k-menu-item" role="menuitem" disabled={isRecording} onclick={() => { showMoreMenu = false; startInlineRecording('voice'); }}>
							<Mic class="h-4 w-4 text-[var(--color-text-muted)]" /> Voice memo
						</button>
						<button class="k-menu-item" role="menuitem" disabled={isRecording} onclick={() => { showMoreMenu = false; startInlineRecording('meeting'); }}>
							<Users class="h-4 w-4 text-[var(--color-text-muted)]" /> Meeting recording
						</button>
						<div class="k-menu-sep"></div>
						<button class="k-menu-item" role="menuitem" disabled={extractingReminders} onclick={() => { showMoreMenu = false; handleExtractReminders(); }}>
							<Bell class="h-4 w-4 text-[var(--color-text-muted)]" /> Find reminders & drafts
						</button>
						<button class="k-menu-item" role="menuitem" onclick={() => { showMoreMenu = false; recordKind = 'decision'; }}>
							<Gavel class="h-4 w-4 text-[var(--color-text-muted)]" /> Log a decision…
						</button>
						<button class="k-menu-item" role="menuitem" onclick={() => { showMoreMenu = false; recordKind = 'question'; }}>
							<HelpCircle class="h-4 w-4 text-[var(--color-text-muted)]" /> Add an open question…
						</button>
						<button class="k-menu-item" role="menuitem" onclick={() => { showMoreMenu = false; recordKind = 'agenda'; }}>
							<ListChecks class="h-4 w-4 text-[var(--color-text-muted)]" /> Add to a meeting agenda…
						</button>
						<button class="k-menu-item" role="menuitem" onclick={() => { showMoreMenu = false; showHistory = true; }}>
							<History class="h-4 w-4 text-[var(--color-text-muted)]" /> Version history
						</button>
						<button class="k-menu-item" role="menuitem" onclick={() => { showMoreMenu = false; if (memory) setMemoryFavorite(memory.id, !memory.favoritedAt); }}>
							<Star class="h-4 w-4 text-[var(--color-text-muted)]" /> {memory.favoritedAt ? 'Remove from favorites' : 'Add to favorites'}
						</button>
						<div class="k-menu-sep"></div>
						<div class="k-menu-label">Export</div>
						<button class="k-menu-item" role="menuitem" onclick={() => handleExport('vanilla')}>
							<Download class="h-4 w-4 text-[var(--color-text-muted)]" /> Markdown
						</button>
						<button class="k-menu-item" role="menuitem" onclick={() => handleExport('hugo')}>
							<FileCode class="h-4 w-4 text-[var(--color-text-muted)]" /> Markdown for Hugo
						</button>
						<button class="k-menu-item" role="menuitem" onclick={() => handleExport('zola')}>
							<FileCode class="h-4 w-4 text-[var(--color-text-muted)]" /> Markdown for Zola
						</button>
						<button class="k-menu-item" role="menuitem" onclick={() => { if (memory) publishMemoryAsHtml(memory); showMoreMenu = false; }}>
							<FileText class="h-4 w-4 text-[var(--color-text-muted)]" /> HTML file
						</button>
						<button class="k-menu-item" role="menuitem" onclick={() => { if (memory) copyMemoryAsHtml(memory); showMoreMenu = false; }}>
							<Copy class="h-4 w-4 text-[var(--color-text-muted)]" /> Copy as rich text
						</button>
						<button class="k-menu-item" role="menuitem" onclick={() => { if (memory) shareMemory(memory); showMoreMenu = false; }}>
							<Share2 class="h-4 w-4 text-[var(--color-text-muted)]" /> Share…
						</button>
						<div class="k-menu-sep"></div>
						<button class="k-menu-item danger" role="menuitem" onclick={handleDelete}>
							<Trash2 class="h-4 w-4" /> Move to trash
						</button>
					</div>
				{/if}
			</div>
		</div>

		{#if extractingReminders || extractionResult}
			<div class="animate-dropdown absolute right-4 top-12 z-30 flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-xs text-[var(--color-text)] shadow-[var(--shadow-md)]" role="status">
				{#if extractingReminders}
					<RefreshCw class="h-3.5 w-3.5 animate-spin text-[var(--color-accent)]" />
					Looking for reminders and drafts…
				{:else}
					<Bell class="h-3.5 w-3.5 text-[var(--color-accent)]" />
					{extractionResult}
					<button
						onclick={() => (extractionResult = null)}
						class="ml-1 rounded p-0.5 text-[var(--color-text-muted)] hover:bg-[var(--color-hover)] hover:text-[var(--color-text)]"
						aria-label="Dismiss"
					><X class="h-3 w-3" /></button>
				{/if}
			</div>
		{/if}

		<!-- Editor -->
		<div
			bind:this={scrollArea}
			onkeydowncapture={() => (lastKeyAt = Date.now())}
			class="flex-1 overflow-y-auto overscroll-contain px-5 pb-6 md:px-12"
		>
			<div class="mx-auto flex min-h-full max-w-[46rem] flex-col pt-6 md:pt-12">
				<!-- Hover-revealed insert bar (always shown on touch devices) -->
				<div class="group/title">
					{#if memory.icon}
						<button
							onclick={openIconPicker}
							class="page-icon -ml-1 mb-2 flex h-[4.5rem] w-[4.5rem] items-center justify-center rounded-lg"
							title="Change icon"
							aria-label="Change icon"
						>
							<NoteIcon icon={memory.icon} class="h-16 w-16 text-[3.5rem]" />
						</button>
					{/if}
					<div class="insert-bar -ml-1.5 mb-1 flex items-center gap-0.5">
						{#if !memory.icon}
							<button onclick={openIconPicker} class="insert-btn" title="Add icon">
								<Smile class="h-3.5 w-3.5" /> Icon
							</button>
						{/if}
						<button onclick={(e) => (projectPicker = (e.currentTarget as HTMLElement).getBoundingClientRect())} class="insert-btn" title="Add to a project">
							<FolderKanban class="h-3.5 w-3.5" /> Project
						</button>
						<button onclick={handleImageUpload} class="insert-btn" title="Insert image">
							<ImagePlus class="h-3.5 w-3.5" /> Image
						</button>
						<button onclick={() => (showCameraCapture = true)} class="insert-btn" title="Take photo">
							<Camera class="h-3.5 w-3.5" /> Photo
						</button>
						{#if !isRecording}
							<button onclick={() => startInlineRecording('voice')} class="insert-btn" title="Record voice memo">
								<Mic class="h-3.5 w-3.5" /> Voice
							</button>
							<button onclick={() => startInlineRecording('meeting')} class="insert-btn" title="Record meeting">
								<Users class="h-3.5 w-3.5" /> Meeting
							</button>
						{/if}
						<span class="ml-1 hidden text-xs text-[var(--color-text-faint)] md:inline">Type / in the editor for more</span>
					</div>

					<!-- Title -->
					<input
						bind:this={titleInput}
						type="text"
						value={isDefaultTitle(title) ? '' : title}
						oninput={handleTitleChange}
						onkeydown={handleTitleKeydown}
						placeholder="Untitled"
						aria-label="Note title"
						class="title-input mb-3 w-full bg-transparent font-bold text-[var(--color-text)] md:mb-5"
						style="font-family: var(--font-editor);"
					/>
					<NoteProjects {memory} bind:picker={projectPicker} />
				</div>

				<!-- Audio playback for voice memos and meetings -->
				{#if memory.type === 'voice-memo' || memory.type === 'meeting'}
					<div class="mb-4 flex items-center gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3 md:mb-6">
						{#if memory.type === 'meeting'}
							<Users class="h-5 w-5 shrink-0 text-[var(--color-accent)]" />
						{:else}
							<Mic class="h-5 w-5 shrink-0 text-[var(--color-accent)]" />
						{/if}
						{#if audioUrl}
							<audio controls src={audioUrl} class="w-full">
								Your browser does not support audio playback.
							</audio>
						{:else}
							<span class="text-sm text-[var(--color-text-muted)]">Audio unavailable</span>
						{/if}
					</div>

					<!-- Processing state -->
					{#if memory.processingState === 'transcribing'}
						<div class="mb-4 flex items-center gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3 text-sm text-[var(--color-text-muted)] md:mb-6">
							<div class="h-4 w-4 animate-spin rounded-full border-2 border-[var(--color-accent)] border-t-transparent"></div>
							Transcribing…
						</div>
					{:else if memory.processingState === 'summarizing'}
						<div class="mb-4 flex items-center gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3 text-sm text-[var(--color-text-muted)] md:mb-6">
							<div class="h-4 w-4 animate-spin rounded-full border-2 border-[var(--color-accent)] border-t-transparent"></div>
							Summarizing…
						</div>
					{:else if memory.processingState === 'pending' && audioUrl}
						<div class="mb-4 flex items-center justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3 text-sm md:mb-6">
							<div class="text-[var(--color-text-muted)]">
								This recording hasn't been transcribed yet.
							</div>
							<button
								type="button"
								onclick={handleRetryProcessing}
								disabled={retrying}
								class="flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-1.5 text-xs text-[var(--color-text)] hover:bg-[var(--color-hover)] disabled:opacity-50"
							>
								<RefreshCw class="h-3 w-3 {retrying ? 'animate-spin' : ''}" />
								Transcribe
							</button>
						</div>
					{:else if memory.processingState === 'failed'}
						<div class="mb-4 flex items-start justify-between gap-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-500 md:mb-6">
							<div>
								Processing failed{memory.processingError ? `: ${memory.processingError}` : ''}
							</div>
							<button
								type="button"
								onclick={handleRetryProcessing}
								disabled={retrying}
								class="flex shrink-0 items-center gap-2 rounded-lg border border-red-500/30 bg-[var(--color-bg)] px-3 py-1.5 text-xs text-[var(--color-text)] hover:bg-red-500/10 disabled:opacity-50"
							>
								<RefreshCw class="h-3 w-3 {retrying ? 'animate-spin' : ''}" />
								Retry
							</button>
						</div>
					{/if}

					<!-- Summary (renders separately so it shows alongside any in-flight state) -->
					{#if memory.summaryShort}
						<div class="mb-4 rounded-lg border border-[var(--color-accent)]/30 bg-[var(--color-accent)]/5 p-3 text-sm text-[var(--color-text)] md:mb-6">
							<div class="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-accent)]">
								Summary
							</div>
							<div class="whitespace-pre-wrap">{memory.summaryShort}</div>
						</div>
					{/if}

					<!-- People + Topics (extracted entities, applies to voice memos AND meetings) -->
					{#if memory.participants.length > 0 || memory.topics.length > 0}
						<div class="mb-4 flex flex-wrap items-center gap-2 md:mb-6">
							{#each memory.participants as person}
								<a
									href="/people/{encodeURIComponent(person)}"
									class="inline-flex items-center gap-1 rounded-full bg-[var(--color-bg-secondary)] px-3 py-1 text-xs text-[var(--color-text)] hover:bg-[var(--color-hover)]"
								>
									<span class="text-[var(--color-text-muted)]">@</span>{person}
								</a>
							{/each}
							{#each memory.topics as topic}
								<a
									href="/read/topic/{encodeURIComponent(topic)}"
									class="inline-flex items-center gap-1 rounded-full bg-[var(--color-bg-secondary)] px-3 py-1 text-xs text-[var(--color-text-muted)] hover:bg-[var(--color-hover)] hover:text-[var(--color-text)]"
								>
									{topic}
								</a>
							{/each}
						</div>
					{/if}

					<!-- Meeting structured output -->
					{#if memory.type === 'meeting' && memory.meetingExtras}
						{@const extras = memory.meetingExtras}

						{#if extras.actionItems.length > 0}
							<div class="mb-4 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3 md:mb-6">
								<div class="mb-2 flex items-center justify-between gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
									<span class="flex items-center gap-2">
										<CheckSquare class="h-3 w-3" />
										To-dos
									</span>
									<a href="/actions" class="text-[var(--color-accent)] hover:underline normal-case tracking-normal">
										View dashboard →
									</a>
								</div>
								<ul class="space-y-1 text-sm text-[var(--color-text)]">
									{#each extras.actionItems as item}
										<li class="flex items-start gap-2">
											<span class="mt-1 h-1 w-1 shrink-0 rounded-full bg-[var(--color-accent)]"></span>
											<div>
												<span>{item.text}</span>
												{#if item.assignee}
													<span class="ml-1 text-[var(--color-text-muted)]">— {item.assignee}</span>
												{/if}
												{#if item.dueDate}
													<span class="ml-1 text-[var(--color-text-muted)]">({item.dueDate})</span>
												{/if}
											</div>
										</li>
									{/each}
								</ul>
							</div>
						{/if}

						{#if memory.decisions.length > 0}
							<div class="mb-4 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3 md:mb-6">
								<div class="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
									<Lightbulb class="h-3 w-3" />
									Decisions
								</div>
								<ul class="space-y-1 text-sm text-[var(--color-text)]">
									{#each memory.decisions as decision}
										<li class="flex items-start gap-2">
											<span class="mt-1 h-1 w-1 shrink-0 rounded-full bg-[var(--color-accent)]"></span>
											<span>{decision}</span>
										</li>
									{/each}
								</ul>
							</div>
						{/if}

						{#if extras.unresolvedQuestions.length > 0}
							<div class="mb-4 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3 md:mb-6">
								<div class="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
									<HelpCircle class="h-3 w-3" />
									Open questions
								</div>
								<ul class="space-y-1 text-sm text-[var(--color-text)]">
									{#each extras.unresolvedQuestions as q}
										<li class="flex items-start gap-2">
											<span class="mt-1 h-1 w-1 shrink-0 rounded-full bg-[var(--color-accent)]"></span>
											<span>{q}</span>
										</li>
									{/each}
								</ul>
							</div>
						{/if}

						{#if extras.followUpSuggestions.length > 0}
							<div class="mb-4 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3 md:mb-6">
								<div class="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
									<ArrowRight class="h-3 w-3" />
									Follow-ups
								</div>
								<ul class="space-y-1 text-sm text-[var(--color-text)]">
									{#each extras.followUpSuggestions as f}
										<li class="flex items-start gap-2">
											<span class="mt-1 h-1 w-1 shrink-0 rounded-full bg-[var(--color-accent)]"></span>
											<span>{f}</span>
										</li>
									{/each}
								</ul>
							</div>
						{/if}
					{/if}

					<!-- Transcript -->
					{#if memory.transcript}
						<details class="mb-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] md:mb-6">
							<summary class="cursor-pointer px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
								Transcript
							</summary>
							<div class="whitespace-pre-wrap px-3 pb-3 text-sm text-[var(--color-text)]">
								{memory.transcript}
							</div>
						</details>
					{/if}
				{/if}

				<!-- Inline template chooser (shows when body is empty, vanishes on typing) -->
				{#if shouldShowChooser}
					<InlineTemplateChooser
						onSelect={handleTemplateSelect}
						onDismiss={handleTemplateDismiss}
					/>
				{/if}

				<!-- Milkdown Editor -->
				{#key `${memory.id}-${editorRevision}`}
					<!-- The keyed editor mounts before the init effect copies the new
					     note's body into `content`, so read straight from the note
					     until that has happened; otherwise the previous note's body
					     would load (and then save) into this one. -->
					<Editor
						bind:this={editorRef}
						content={initializedForId === memory.id ? content : memory.bodyMarkdown}
						noteId={memory.id}
						onchange={handleContentChange}
						onWikilinkClick={handleWikilinkClick}
						placeholder={shouldShowChooser
							? 'Start typing, or pick a template…'
							: 'Start writing… Type [[ to link a note, / for commands'}
						currentFolderId={memory.folderId}
					/>
				{/key}


				{#if backlinks.length > 0 || unlinkedMentions.length > 0 || relatedNotes.length > 0}
					<div class="mt-8 space-y-1 border-t border-[var(--color-border)] pt-4">
						<!-- Backlinks -->
						{#if backlinks.length > 0}
							<details class="link-section" open>
								<summary>
									<ChevronRight class="chev h-3.5 w-3.5" />
									Linked mentions
									<span class="count">{backlinks.length}</span>
								</summary>
								<div class="pb-2">
									{#each backlinks as backlink (backlink.id)}
										<a href="/memory/{backlink.id}" class="link-row">
											<FileText class="h-3.5 w-3.5 shrink-0 text-[var(--color-text-faint)]" />
											<span class="shrink-0 font-medium text-[var(--color-text)]">{backlink.title || 'Untitled'}</span>
											<span class="min-w-0 truncate text-[var(--color-text-faint)]">{backlink.bodyMarkdown.slice(0, 120)}</span>
										</a>
									{/each}
								</div>
							</details>
						{/if}

						<!-- Unlinked mentions: notes that name this one without linking -->
						{#if unlinkedMentions.length > 0}
							<details class="link-section">
								<summary>
									<ChevronRight class="chev h-3.5 w-3.5" />
									Unlinked mentions
									<span class="count">{unlinkedMentions.length}</span>
								</summary>
								<div class="pb-2">
									{#each unlinkedMentions as mention (mention.id)}
										<div class="link-row group/mention">
											<FileText class="h-3.5 w-3.5 shrink-0 text-[var(--color-text-faint)]" />
											<a href="/memory/{mention.id}" class="flex min-w-0 flex-1 items-center gap-2">
												<span class="shrink-0 font-medium text-[var(--color-text)]">{mention.title || 'Untitled'}</span>
												<span class="min-w-0 truncate text-[var(--color-text-faint)]">{mention.bodyMarkdown.slice(0, 120)}</span>
											</a>
											<button
												onclick={() => handleLinkMention(mention.id)}
												class="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-xs text-[var(--color-text-muted)] opacity-0 hover:bg-[var(--color-active)] hover:text-[var(--color-text)] focus:opacity-100 group-hover/mention:opacity-100"
												title="Insert a [[wikilink]] to this note"
											>
												<Link2 class="h-3 w-3" />
												Link
											</button>
										</div>
									{/each}
								</div>
							</details>
						{/if}

						<!-- Related notes (semantic) -->
						{#if relatedNotes.length > 0}
							<details class="link-section" open>
								<summary>
									<ChevronRight class="chev h-3.5 w-3.5" />
									Related
									<span class="count">{relatedNotes.length}</span>
								</summary>
								<div class="pb-2">
									{#each relatedNotes as { memory: related, score } (related.id)}
										<a href="/memory/{related.id}" class="link-row">
											<Sparkles class="h-3.5 w-3.5 shrink-0 text-[var(--color-text-faint)]" />
											<span class="shrink-0 font-medium text-[var(--color-text)]">{related.title || 'Untitled'}</span>
											<span class="min-w-0 flex-1 truncate text-[var(--color-text-faint)]">{(related.summaryShort || related.bodyMarkdown || '').slice(0, 120)}</span>
											<span class="shrink-0 text-[0.6875rem] tabular-nums text-[var(--color-text-faint)]">{Math.round(score * 100)}%</span>
										</a>
									{/each}
								</div>
							</details>
						{/if}
					</div>
				{/if}

				<!-- Bottom safe area spacer -->
				<div class="h-16 safe-bottom"></div>
			</div>
		</div>
	</div>

	<LinkPreview
		container={scrollArea}
		onOpen={handleWikilinkClick}
		onOpenSide={(t) => handleWikilinkClick(t, { altKey: true })}
	/>

	{#if recordKind && memory}
		<NoteRecordDialog
			{memory}
			kind={recordKind}
			onDone={(message) => {
				recordKind = null;
				if (message) extractionResult = message;
			}}
		/>
	{/if}

	{#if iconPickerAnchor && memory}
		<IconPicker
			anchor={iconPickerAnchor}
			hasIcon={!!memory.icon}
			onSelect={(icon) => setMemoryIcon(memory!.id, icon)}
			onRemove={() => setMemoryIcon(memory!.id, null)}
			onClose={() => (iconPickerAnchor = null)}
		/>
	{/if}

	<!-- Version History Modal -->
	{#if showHistory && memory}
		<VersionHistoryModal
			memoryId={memory.id}
			onClose={() => (showHistory = false)}
			onRestored={handleVersionRestored}
		/>
	{/if}

	<!-- Hidden image file input -->
	<input
		bind:this={imageInputRef}
		type="file"
		accept="image/*"
		onchange={handleImageFileSelect}
		class="hidden"
	/>

	<!-- Camera capture modal -->
	{#if showCameraCapture}
		<CameraCapture
			onCapture={handleCameraCapture}
			onClose={() => (showCameraCapture = false)}
		/>
	{/if}
{:else}
	<div class="flex h-full items-center justify-center p-4">
		<div class="text-center">
			<p class="text-lg text-[var(--color-text-muted)]">Note not found</p>
			<a href="/" class="mt-4 inline-block text-[var(--color-accent)] hover:underline">
				Go back home
			</a>
		</div>
	</div>
{/if}

<style>
	.page-icon:hover {
		background: var(--color-hover);
	}

	.favorite-on {
		color: #d99a16;
	}

	.title-input {
		border: none !important;
		outline: none !important;
		box-shadow: none !important;
		-webkit-appearance: none;
		appearance: none;
		font-size: 2rem !important;
		line-height: 1.2;
		letter-spacing: -0.015em;
	}

	.title-input::placeholder {
		color: var(--color-text-faint);
		opacity: 0.7;
	}

	.title-input:focus,
	.title-input:focus-visible {
		border: none !important;
		outline: none !important;
		box-shadow: none !important;
	}

	@media (min-width: 768px) {
		.title-input {
			font-size: 2.375rem !important;
		}
	}

	/* Insert bar: quiet until you hover the title area (always on touch) */
	.insert-bar {
		min-height: 1.75rem;
	}

	@media (hover: hover) {
		.insert-bar {
			opacity: 0;
			transition: opacity 150ms var(--ease-out);
		}

		:global(.group\/title:hover) .insert-bar,
		.insert-bar:focus-within {
			opacity: 1;
		}
	}

	.insert-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.3125rem;
		padding: 0.1875rem 0.4375rem;
		border-radius: var(--radius-sm);
		font-size: 0.75rem;
		color: var(--color-text-faint);
	}

	.insert-btn:hover {
		background: var(--color-hover);
		color: var(--color-text-muted);
	}

	.note-header {
		background: var(--color-bg);
	}

	.recording-pill span {
		animation: rec-pulse 1.2s ease-in-out infinite;
	}

	@keyframes rec-pulse {
		50% { opacity: 0.3; }
	}

	/* Linked / unlinked / related sections */
	.link-section summary {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.375rem 0.25rem;
		margin: 0 -0.25rem;
		border-radius: var(--radius-sm);
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--color-text-muted);
		cursor: pointer;
		list-style: none;
		user-select: none;
	}

	.link-section summary::-webkit-details-marker {
		display: none;
	}

	.link-section summary:hover {
		background: var(--color-hover);
		color: var(--color-text);
	}

	.link-section summary :global(.chev) {
		color: var(--color-text-faint);
		transition: transform 150ms var(--ease-out);
	}

	.link-section[open] summary :global(.chev) {
		transform: rotate(90deg);
	}

	.link-section .count {
		font-size: 0.75rem;
		font-weight: 400;
		color: var(--color-text-faint);
		font-variant-numeric: tabular-nums;
	}

	.link-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-height: 2rem;
		padding: 0 0.5rem 0 1.375rem;
		margin: 0 -0.25rem;
		border-radius: var(--radius-sm);
		font-size: 0.8125rem;
		text-decoration: none;
	}

	.link-row:hover {
		background: var(--color-hover);
	}
</style>
