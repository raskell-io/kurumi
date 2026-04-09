<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import {
		updateMemoryObject,
		deleteMemoryObject,
		findBacklinks,
		memoryObjects,
		addMemoryObject,
		folders,
		retryMemoryProcessing,
		extractRemindersFromMemory
	} from '$lib/db';
	import { get } from 'svelte/store';
	import Editor from '$lib/components/Editor.svelte';
	import InlineTemplateChooser from '$lib/components/InlineTemplateChooser.svelte';
	import { untrack } from 'svelte';
	import { downloadSingleMemory, type MarkdownExportFormat } from '$lib/utils/markdown-export';
	import { publishMemoryAsHtml } from '$lib/utils/publish';
	import { getBlob } from '$lib/db/blob-store';
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
		Camera
	} from 'lucide-svelte';
	import CameraCapture from '$lib/components/CameraCapture.svelte';
	import { processAndStoreImage } from '$lib/utils/image';

	let title = $state('');
	let content = $state('');
	let backlinks = $state<ReturnType<typeof findBacklinks>>([]);
	let showDeleteConfirm = $state(false);
	let showExportMenu = $state(false);
	let initializedForId = $state('');

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

		// Build the embed markdown with HTML audio tag
		const embed = [
			'',
			`#### ${icon} ${label} — ${timeStr}`,
			'',
			`<audio controls src="${audioRef}"></audio>`,
			'',
			'> **Transcript:** *Processing...*',
			''
		].join('\n');

		// Insert into the editor
		window.dispatchEvent(new CustomEvent('kurumi-insert-text', { detail: embed }));

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

	// Debounce timer for auto-save
	let saveTimeout: ReturnType<typeof setTimeout>;

	// Reactive memory object — stays in sync with the store so async updates
	// (transcription, sync) propagate to the UI without a manual refresh.
	let memory = $derived($memoryObjects.find((m) => m.id === $page.params.id));

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
				title = memory!.title;
				content = memory!.bodyMarkdown;
				backlinks = findBacklinks(id);
				initializedForId = id;
				syncedMemoryTitle = memory!.title;
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

	// Cleanup the object URL when the component is destroyed
	$effect(() => {
		return () => {
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

	function handleTitleChange(e: Event) {
		const target = e.target as HTMLInputElement;
		title = target.value;
		debouncedSave();
	}

	function handleContentChange(markdown: string) {
		content = markdown;
		// Auto-dismiss the template chooser as soon as the user types
		// anything into the body — writing should never be blocked.
		if (markdown.trim() && !templateChooserDismissed) {
			templateChooserDismissed = true;
		}
		debouncedSave();
	}

	function debouncedSave() {
		clearTimeout(saveTimeout);
		saveTimeout = setTimeout(() => {
			if (memory) {
				updateMemoryObject(memory.id, { title, bodyMarkdown: content });
			}
		}, 300);
	}

	function handleDelete() {
		if (memory) {
			deleteMemoryObject(memory.id);
			goto('/');
		}
	}

	function handleWikilinkClick(linkTitle: string) {
		// Find memory by title (case-insensitive)
		const all = get(memoryObjects);
		const target = all.find((m) => m.title.toLowerCase() === linkTitle.toLowerCase());

		if (target) {
			// Navigate to existing memory
			goto(`/memory/${target.id}`);
		} else {
			// Create new memory with this title
			const created = addMemoryObject(linkTitle, '');
			goto(`/memory/${created.id}`);
		}
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
		if (e.key === 'Enter') {
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
		showExportMenu = false;
	}
</script>

{#if memory}
	<div class="group/note relative flex h-full flex-col">
		<!-- Action buttons (appear on hover) -->
		<div class="absolute bottom-4 right-4 z-10 flex items-center gap-2 opacity-0 transition-all group-hover/note:opacity-100 md:bottom-6 md:right-6">
			<!-- Export button -->
			<div class="relative">
				<button
					onclick={() => (showExportMenu = !showExportMenu)}
					class="flex items-center gap-1 rounded-lg p-2 text-[var(--color-text-muted)] transition-all hover:bg-[var(--color-bg-secondary)] hover:text-[var(--color-text)] active:scale-95"
					title="Export note"
				>
					<Download class="h-5 w-5" />
					<ChevronDown class="h-3 w-3" />
				</button>

				{#if showExportMenu}
					<div
						class="absolute bottom-full right-0 mb-2 w-40 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] py-1 shadow-lg"
					>
						<button
							onclick={() => handleExport('vanilla')}
							class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[var(--color-text)] hover:bg-[var(--color-bg-secondary)]"
						>
							Markdown
						</button>
						<button
							onclick={() => handleExport('hugo')}
							class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[var(--color-text)] hover:bg-[var(--color-bg-secondary)]"
						>
							Hugo-flavoured
						</button>
						<button
							onclick={() => handleExport('zola')}
							class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[var(--color-text)] hover:bg-[var(--color-bg-secondary)]"
						>
							Zola-flavoured
						</button>
						<div class="my-1 border-t border-[var(--color-border)]"></div>
						<button
							onclick={() => { if (memory) publishMemoryAsHtml(memory); showExportMenu = false; }}
							class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[var(--color-text)] hover:bg-[var(--color-bg-secondary)]"
						>
							Publish as HTML
						</button>
					</div>
				{/if}
			</div>

			<!-- Image upload button -->
			<button
				onclick={handleImageUpload}
				class="rounded-lg p-2 text-[var(--color-text-muted)] transition-all hover:bg-[var(--color-bg-secondary)] hover:text-[var(--color-accent)] active:scale-95"
				title="Upload an image"
			>
				<ImagePlus class="h-5 w-5" />
			</button>

			<!-- Camera button -->
			<button
				onclick={() => (showCameraCapture = true)}
				class="rounded-lg p-2 text-[var(--color-text-muted)] transition-all hover:bg-[var(--color-bg-secondary)] hover:text-[var(--color-accent)] active:scale-95"
				title="Take a photo"
			>
				<Camera class="h-5 w-5" />
			</button>

			<!-- Extract reminders button -->
			<button
				onclick={handleExtractReminders}
				disabled={extractingReminders}
				class="rounded-lg p-2 text-[var(--color-text-muted)] transition-all hover:bg-[var(--color-bg-secondary)] hover:text-[var(--color-accent)] active:scale-95 disabled:opacity-50"
				title="Extract reminder proposals from this note"
			>
				{#if extractingReminders}
					<RefreshCw class="h-5 w-5 animate-spin" />
				{:else}
					<Bell class="h-5 w-5" />
				{/if}
			</button>

			<!-- Delete button -->
			<button
				onclick={() => (showDeleteConfirm = true)}
				class="rounded-lg p-2 text-[var(--color-text-muted)] transition-all hover:bg-red-100 hover:text-red-600 active:scale-95 dark:hover:bg-red-900/30"
				title="Delete note"
			>
				<Trash2 class="h-5 w-5" />
			</button>
		</div>

		{#if extractionResult}
			<div class="absolute bottom-20 right-4 z-10 flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-xs text-[var(--color-text)] shadow-lg md:right-6">
				<Bell class="h-3 w-3 text-[var(--color-accent)]" />
				{extractionResult}
				<button
					onclick={() => (extractionResult = null)}
					class="ml-1 text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
					aria-label="Dismiss"
				>×</button>
			</div>
		{/if}

		<!-- Editor -->
		<div class="flex-1 overflow-y-auto overscroll-contain p-4 md:p-6">
			<div class="mx-auto flex min-h-full max-w-3xl flex-col">
				<!-- Title -->
				<input
					type="text"
					value={title}
					oninput={handleTitleChange}
					onkeydown={handleTitleKeydown}
					placeholder="Untitled"
					class="title-input mb-4 w-full bg-transparent text-[2.5rem] font-bold leading-tight text-[var(--color-text)] placeholder-[var(--color-text-muted)] md:mb-6 md:text-[3rem]"
					style="font-family: var(--font-editor);"
				/>

				<!-- Audio playback for voice memos and meetings -->
				{#if memory.type === 'voice-memo' || memory.type === 'meeting'}
					<div class="mb-4 flex items-center gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3 md:mb-6">
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
						<div class="mb-4 flex items-center gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3 text-sm text-[var(--color-text-muted)] md:mb-6">
							<div class="h-4 w-4 animate-spin rounded-full border-2 border-[var(--color-accent)] border-t-transparent"></div>
							Transcribing…
						</div>
					{:else if memory.processingState === 'summarizing'}
						<div class="mb-4 flex items-center gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3 text-sm text-[var(--color-text-muted)] md:mb-6">
							<div class="h-4 w-4 animate-spin rounded-full border-2 border-[var(--color-accent)] border-t-transparent"></div>
							Summarizing…
						</div>
					{:else if memory.processingState === 'pending' && audioUrl}
						<div class="mb-4 flex items-center justify-between gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3 text-sm md:mb-6">
							<div class="text-[var(--color-text-muted)]">
								This recording hasn't been transcribed yet.
							</div>
							<button
								type="button"
								onclick={handleRetryProcessing}
								disabled={retrying}
								class="flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-1.5 text-xs text-[var(--color-text)] hover:bg-[var(--color-border)] disabled:opacity-50"
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
									href="/read/person/{encodeURIComponent(person)}"
									class="inline-flex items-center gap-1 rounded-full bg-[var(--color-bg-secondary)] px-3 py-1 text-xs text-[var(--color-text)] hover:bg-[var(--color-border)]"
								>
									<span class="text-[var(--color-text-muted)]">@</span>{person}
								</a>
							{/each}
							{#each memory.topics as topic}
								<a
									href="/read/topic/{encodeURIComponent(topic)}"
									class="inline-flex items-center gap-1 rounded-full bg-[var(--color-bg-secondary)] px-3 py-1 text-xs text-[var(--color-text-muted)] hover:bg-[var(--color-border)] hover:text-[var(--color-text)]"
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
							<div class="mb-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3 md:mb-6">
								<div class="mb-2 flex items-center justify-between gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
									<span class="flex items-center gap-2">
										<CheckSquare class="h-3 w-3" />
										Action items
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
							<div class="mb-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3 md:mb-6">
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
							<div class="mb-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3 md:mb-6">
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
							<div class="mb-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3 md:mb-6">
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

				<!-- Quick insert toolbar (always visible) -->
				<div class="mb-2 flex items-center gap-1">
					<button
						onclick={handleImageUpload}
						class="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-bg-secondary)] hover:text-[var(--color-text)]"
						title="Upload image"
					>
						<ImagePlus class="h-3.5 w-3.5" />
						<span class="hidden sm:inline">Image</span>
					</button>
					<button
						onclick={() => (showCameraCapture = true)}
						class="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-bg-secondary)] hover:text-[var(--color-text)]"
						title="Take photo"
					>
						<Camera class="h-3.5 w-3.5" />
						<span class="hidden sm:inline">Photo</span>
					</button>
					{#if isRecording}
						<button
							onclick={stopInlineRecording}
							class="inline-flex items-center gap-1 rounded-md bg-red-500 px-2.5 py-1 text-xs text-white animate-pulse"
							title="Stop recording"
						>
							<span class="h-2 w-2 rounded-full bg-white"></span>
							<span>Stop {recordingType === 'meeting' ? 'meeting' : 'voice'}</span>
						</button>
					{:else}
						<button
							onclick={() => startInlineRecording('voice')}
							class="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-bg-secondary)] hover:text-[var(--color-text)]"
							title="Record voice memo"
						>
							<Mic class="h-3.5 w-3.5" />
							<span class="hidden sm:inline">Voice</span>
						</button>
						<button
							onclick={() => startInlineRecording('meeting')}
							class="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-bg-secondary)] hover:text-[var(--color-text)]"
							title="Record meeting"
						>
							<Users class="h-3.5 w-3.5" />
							<span class="hidden sm:inline">Meeting</span>
						</button>
					{/if}
					<span class="mx-1 text-xs text-[var(--color-text-muted)] opacity-50">|</span>
					<span class="text-xs text-[var(--color-text-muted)] opacity-50">
						Type / for more
					</span>
				</div>

				<!-- Inline template chooser (shows when body is empty, vanishes on typing) -->
				{#if shouldShowChooser}
					<InlineTemplateChooser
						onSelect={handleTemplateSelect}
						onDismiss={handleTemplateDismiss}
					/>
				{/if}

				<!-- Milkdown Editor -->
				{#key memory.id}
					<Editor
						content={content}
						onchange={handleContentChange}
						onWikilinkClick={handleWikilinkClick}
						placeholder={shouldShowChooser
							? 'Start typing to dismiss templates...'
							: 'Start writing... Use [[Note Title]] to link to other notes.'}
						currentFolderId={memory.folderId}
					/>
				{/key}

				<!-- Backlinks -->
				{#if backlinks.length > 0}
					<div class="mt-6 border-t border-[var(--color-border)] pt-4 md:mt-8 md:pt-6">
						<h3 class="mb-3 text-xs font-semibold uppercase text-[var(--color-text-muted)] md:text-sm">
							Backlinks ({backlinks.length})
						</h3>
						<div class="space-y-2">
							{#each backlinks as backlink}
								<a
									href="/memory/{backlink.id}"
									class="block rounded-lg border border-[var(--color-border)] p-3 transition-colors hover:border-[var(--color-accent)] active:scale-[0.99]"
								>
									<div class="font-medium text-[var(--color-text)]">
										{backlink.title || 'Untitled'}
									</div>
									<div class="mt-1 truncate text-sm text-[var(--color-text-muted)]">
										{backlink.bodyMarkdown.slice(0, 80)}...
									</div>
								</a>
							{/each}
						</div>
					</div>
				{/if}

				<!-- Spacer to push footer to bottom -->
				<div class="min-h-12 flex-1"></div>

				<!-- Last modified -->
				<div class="mt-8 text-xs text-[var(--color-text-muted)] opacity-40">
					Last modified: {formatDate(memory.updatedAt)}
				</div>

				<!-- Bottom safe area spacer -->
				<div class="h-8 md:h-0 safe-bottom"></div>
			</div>
		</div>
	</div>

	<!-- Delete Confirmation Modal -->
	{#if showDeleteConfirm}
		<div
			class="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 md:items-center"
			onclick={() => (showDeleteConfirm = false)}
			onkeydown={(e) => e.key === 'Escape' && (showDeleteConfirm = false)}
			role="dialog"
			aria-modal="true"
			tabindex="-1"
		>
			<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
			<div
				class="w-full max-w-md rounded-xl bg-[var(--color-bg)] p-6 shadow-xl safe-bottom"
				onclick={(e) => e.stopPropagation()}
				onkeydown={(e) => e.stopPropagation()}
				role="document"
			>
				<h2 class="mb-2 text-xl font-bold text-[var(--color-text)]">Delete Note?</h2>
				<p class="mb-6 text-[var(--color-text-muted)]">
					Are you sure you want to delete "{title || 'Untitled'}"? This action cannot be undone.
				</p>
				<div class="flex flex-col-reverse gap-2 md:flex-row md:justify-end md:gap-3">
					<button
						onclick={() => (showDeleteConfirm = false)}
						class="w-full rounded-lg px-4 py-3 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-border)] md:w-auto md:py-2"
					>
						Cancel
					</button>
					<button
						onclick={handleDelete}
						class="w-full rounded-lg bg-red-600 px-4 py-3 text-white transition-colors hover:bg-red-700 active:scale-[0.98] md:w-auto md:py-2"
					>
						Delete
					</button>
				</div>
			</div>
		</div>
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
	.title-input {
		border: none !important;
		outline: none !important;
		box-shadow: none !important;
		-webkit-appearance: none;
		appearance: none;
		font-size: 2.5rem !important;
	}

	.title-input:focus,
	.title-input:focus-visible {
		border: none !important;
		outline: none !important;
		box-shadow: none !important;
	}

	@media (min-width: 768px) {
		.title-input {
			font-size: 3rem !important;
		}
	}
</style>
