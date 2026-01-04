<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { getNote, updateNote, deleteNote, findBacklinks, notes, addNote, folders } from '$lib/db';
	import { get } from 'svelte/store';
	import Editor from '$lib/components/Editor.svelte';
	import { untrack } from 'svelte';
	import { downloadSingleNote, type MarkdownExportFormat } from '$lib/utils/markdown-export';
	import { Trash2, Download, ChevronDown } from 'lucide-svelte';

	let note = $state<ReturnType<typeof getNote>>(undefined);
	let title = $state('');
	let content = $state('');
	let backlinks = $state<ReturnType<typeof findBacklinks>>([]);
	let showDeleteConfirm = $state(false);
	let showExportMenu = $state(false);
	let currentId = $state('');

	// Debounce timer for auto-save
	let saveTimeout: ReturnType<typeof setTimeout>;

	// Load note when page ID changes
	$effect(() => {
		const id = $page.params.id;
		if (id && id !== currentId) {
			untrack(() => {
				currentId = id;
				note = getNote(id);
				if (note) {
					title = note.title;
					content = note.content;
					backlinks = findBacklinks(id);
				}
			});
		}
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
			if (note) {
				updateNote(note.id, { title, content });
			}
		}, 300);
	}

	function handleDelete() {
		if (note) {
			deleteNote(note.id);
			goto('/');
		}
	}

	function handleWikilinkClick(linkTitle: string) {
		// Find note by title (case-insensitive)
		const allNotes = get(notes);
		const targetNote = allNotes.find((n) => n.title.toLowerCase() === linkTitle.toLowerCase());

		if (targetNote) {
			// Navigate to existing note
			goto(`/note/${targetNote.id}`);
		} else {
			// Create new note with this title
			const newNote = addNote(linkTitle, '');
			goto(`/note/${newNote.id}`);
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
		if (!note) return;
		const allNotes = get(notes);
		const allFolders = get(folders);
		downloadSingleNote(note, allNotes, allFolders, { format });
		showExportMenu = false;
	}
</script>

{#if note}
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
							Vanilla
						</button>
						<button
							onclick={() => handleExport('hugo')}
							class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[var(--color-text)] hover:bg-[var(--color-bg-secondary)]"
						>
							Hugo
						</button>
						<button
							onclick={() => handleExport('zola')}
							class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[var(--color-text)] hover:bg-[var(--color-bg-secondary)]"
						>
							Zola
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

				<!-- Milkdown Editor -->
				{#key note.id}
					<Editor
						content={content}
						onchange={handleContentChange}
						onWikilinkClick={handleWikilinkClick}
						placeholder="Start writing... Use [[Note Title]] to link to other notes."
						currentFolderId={note.folderId}
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
									href="/note/{backlink.id}"
									class="block rounded-lg border border-[var(--color-border)] p-3 transition-colors hover:border-[var(--color-accent)] active:scale-[0.99]"
								>
									<div class="font-medium text-[var(--color-text)]">
										{backlink.title || 'Untitled'}
									</div>
									<div class="mt-1 truncate text-sm text-[var(--color-text-muted)]">
										{backlink.content.slice(0, 80)}...
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
					Last modified: {formatDate(note.modified)}
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
