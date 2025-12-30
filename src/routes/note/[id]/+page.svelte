<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { getNote, updateNote, deleteNote, findBacklinks, notes, addNote } from '$lib/db';
	import { get } from 'svelte/store';
	import Editor from '$lib/components/Editor.svelte';
	import { untrack } from 'svelte';

	let note = $state<ReturnType<typeof getNote>>(undefined);
	let title = $state('');
	let content = $state('');
	let backlinks = $state<ReturnType<typeof findBacklinks>>([]);
	let showDeleteConfirm = $state(false);
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
		return new Date(timestamp).toLocaleDateString('en-US', {
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}
</script>

{#if note}
	<div class="flex h-full flex-col">
		<!-- Header -->
		<header
			class="flex items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-4 py-2 md:px-6 md:py-3"
		>
			<div class="text-xs text-[var(--color-text-muted)] md:text-sm">
				{formatDate(note.modified)}
			</div>
			<div class="flex items-center gap-1">
				<button
					onclick={() => (showDeleteConfirm = true)}
					class="rounded-lg p-2 text-[var(--color-text-muted)] transition-colors hover:bg-red-100 hover:text-red-600 active:scale-95 dark:hover:bg-red-900/30"
					title="Delete note"
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						class="h-5 w-5"
						viewBox="0 0 20 20"
						fill="currentColor"
					>
						<path
							fill-rule="evenodd"
							d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z"
							clip-rule="evenodd"
						/>
					</svg>
				</button>
			</div>
		</header>

		<!-- Editor -->
		<div class="flex-1 overflow-y-auto overscroll-contain p-4 md:p-6">
			<div class="mx-auto max-w-3xl">
				<!-- Title -->
				<input
					type="text"
					value={title}
					oninput={handleTitleChange}
					placeholder="Untitled"
					class="mb-4 w-full border-none bg-transparent text-2xl font-bold text-[var(--color-text)] placeholder-[var(--color-text-muted)] outline-none md:mb-6 md:text-3xl"
				/>

				<!-- Milkdown Editor -->
				{#key note.id}
					<Editor
						content={content}
						onchange={handleContentChange}
						onWikilinkClick={handleWikilinkClick}
						placeholder="Start writing... Use [[Note Title]] to link to other notes."
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
