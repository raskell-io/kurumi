<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import {
		updateMemoryObject,
		deleteMemoryObject,
		findBacklinks,
		memoryObjects,
		addMemoryObject,
		folders
	} from '$lib/db';
	import { get } from 'svelte/store';
	import Editor from '$lib/components/Editor.svelte';
	import { untrack } from 'svelte';
	import { downloadSingleMemory, type MarkdownExportFormat } from '$lib/utils/markdown-export';
	import { getBlob } from '$lib/db/blob-store';
	import { Trash2, Download, ChevronDown, Mic } from 'lucide-svelte';

	let title = $state('');
	let content = $state('');
	let backlinks = $state<ReturnType<typeof findBacklinks>>([]);
	let showDeleteConfirm = $state(false);
	let showExportMenu = $state(false);
	let initializedForId = $state('');
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

	function handleTitleChange(e: Event) {
		const target = e.target as HTMLInputElement;
		title = target.value;
		debouncedSave();
	}

	function handleContentChange(markdown: string) {
		content = markdown;
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
					</div>
				{/if}
			</div>

			<!-- Delete button -->
			<button
				onclick={() => (showDeleteConfirm = true)}
				class="rounded-lg p-2 text-[var(--color-text-muted)] transition-all hover:bg-red-100 hover:text-red-600 active:scale-95 dark:hover:bg-red-900/30"
				title="Delete note"
			>
				<Trash2 class="h-5 w-5" />
			</button>
		</div>

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

				<!-- Audio playback for voice memos -->
				{#if memory.type === 'voice-memo'}
					<div class="mb-4 flex items-center gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3 md:mb-6">
						<Mic class="h-5 w-5 shrink-0 text-[var(--color-accent)]" />
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
					{:else if memory.processingState === 'failed'}
						<div class="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-500 md:mb-6">
							Processing failed{memory.processingError ? `: ${memory.processingError}` : ''}
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

				<!-- Milkdown Editor -->
				{#key memory.id}
					<Editor
						content={content}
						onchange={handleContentChange}
						onWikilinkClick={handleWikilinkClick}
						placeholder="Start writing... Use [[Note Title]] to link to other notes."
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
