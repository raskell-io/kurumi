<script lang="ts">
	import {
		trashedNotes,
		trashedFolders,
		restoreNote,
		restoreFolder,
		permanentlyDeleteNote,
		permanentlyDeleteFolder,
		emptyTrash,
		type Note,
		type Folder
	} from '$lib/db';
	import { Trash2, FolderOpen, FileText, RotateCcw, X, AlertTriangle } from 'lucide-svelte';

	// Store subscriptions
	let notesData = $state<Note[]>([]);
	let foldersData = $state<Folder[]>([]);

	$effect(() => {
		const unsub1 = trashedNotes.subscribe((n) => {
			notesData = n;
		});
		const unsub2 = trashedFolders.subscribe((f) => {
			foldersData = f;
		});
		return () => {
			unsub1();
			unsub2();
		};
	});

	// Confirmation modal state
	let showDeleteConfirm = $state(false);
	let itemToDelete = $state<{ type: 'note' | 'folder'; item: Note | Folder } | null>(null);

	let showEmptyConfirm = $state(false);

	function formatDeletedDate(timestamp: number | null): string {
		if (!timestamp) return '';
		const date = new Date(timestamp);
		const now = new Date();
		const diffMs = now.getTime() - date.getTime();
		const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

		if (diffDays === 0) {
			return 'Today';
		} else if (diffDays === 1) {
			return 'Yesterday';
		} else if (diffDays < 7) {
			return `${diffDays} days ago`;
		} else if (diffDays < 30) {
			const weeks = Math.floor(diffDays / 7);
			return `${weeks} week${weeks > 1 ? 's' : ''} ago`;
		} else {
			return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
		}
	}

	function getDaysUntilPermanentDelete(timestamp: number | null): number {
		if (!timestamp) return 30;
		const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
		const deleteAt = timestamp + thirtyDaysMs;
		const remaining = deleteAt - Date.now();
		return Math.max(0, Math.ceil(remaining / (1000 * 60 * 60 * 24)));
	}

	function handleRestore(type: 'note' | 'folder', id: string) {
		if (type === 'note') {
			restoreNote(id);
		} else {
			restoreFolder(id);
		}
	}

	function confirmDelete(type: 'note' | 'folder', item: Note | Folder) {
		itemToDelete = { type, item };
		showDeleteConfirm = true;
	}

	function handlePermanentDelete() {
		if (!itemToDelete) return;

		if (itemToDelete.type === 'note') {
			permanentlyDeleteNote(itemToDelete.item.id);
		} else {
			permanentlyDeleteFolder(itemToDelete.item.id);
		}

		showDeleteConfirm = false;
		itemToDelete = null;
	}

	function handleEmptyTrash() {
		emptyTrash();
		showEmptyConfirm = false;
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			if (showDeleteConfirm) {
				showDeleteConfirm = false;
				itemToDelete = null;
			} else if (showEmptyConfirm) {
				showEmptyConfirm = false;
			}
		}
	}

	let totalItems = $derived(notesData.length + foldersData.length);
</script>

<svelte:window on:keydown={handleKeydown} />

<div class="flex h-full flex-col">
	<!-- Header -->
	<header
		class="flex items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-4 py-3 md:px-6"
	>
		<div class="flex items-center gap-2">
			<Trash2 class="h-5 w-5 text-[var(--color-text-muted)]" />
			<h1 class="text-lg font-semibold text-[var(--color-text)]">Trash</h1>
			{#if totalItems > 0}
				<span class="rounded-full bg-[var(--color-border)] px-2 py-0.5 text-xs text-[var(--color-text-muted)]">
					{totalItems}
				</span>
			{/if}
		</div>
		{#if totalItems > 0}
			<button
				onclick={() => (showEmptyConfirm = true)}
				class="flex items-center gap-2 rounded-lg border border-red-500/30 px-3 py-2 text-sm font-medium text-red-500 transition-colors hover:bg-red-500/10"
			>
				<Trash2 class="h-4 w-4" />
				Empty Trash
			</button>
		{/if}
	</header>

	<!-- Content -->
	<div class="flex-1 overflow-y-auto bg-[var(--color-bg)] p-4 md:p-6">
		{#if totalItems === 0}
			<!-- Empty state -->
			<div class="flex h-full items-center justify-center">
				<div class="text-center">
					<Trash2 class="mx-auto mb-4 h-16 w-16 text-[var(--color-text-muted)]" />
					<p class="text-lg text-[var(--color-text-muted)]">Trash is empty</p>
					<p class="mt-2 text-sm text-[var(--color-text-muted)]">
						Deleted notes and folders will appear here
					</p>
				</div>
			</div>
		{:else}
			<div class="mx-auto max-w-3xl space-y-4">
				<!-- Info banner -->
				<div class="flex items-start gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4">
					<AlertTriangle class="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-500" />
					<div class="text-sm text-[var(--color-text-muted)]">
						Items in trash will be permanently deleted after 30 days. You can restore them at any time before then.
					</div>
				</div>

				<!-- Folders section -->
				{#if foldersData.length > 0}
					<div>
						<h2 class="mb-2 text-sm font-medium text-[var(--color-text-muted)]">Folders</h2>
						<div class="space-y-2">
							{#each foldersData as folder (folder.id)}
								<div
									class="group flex items-center justify-between rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3 transition-colors hover:border-[var(--color-accent)]/50"
								>
									<div class="flex items-center gap-3">
										<FolderOpen class="h-5 w-5 text-[var(--color-accent)]" />
										<div>
											<div class="font-medium text-[var(--color-text)]">{folder.name}</div>
											<div class="text-xs text-[var(--color-text-muted)]">
												Deleted {formatDeletedDate(folder.deletedAt)} · {getDaysUntilPermanentDelete(folder.deletedAt)} days left
											</div>
										</div>
									</div>
									<div class="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
										<button
											onclick={() => handleRestore('folder', folder.id)}
											class="rounded p-2 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-accent)]/10 hover:text-[var(--color-accent)]"
											title="Restore folder"
										>
											<RotateCcw class="h-4 w-4" />
										</button>
										<button
											onclick={() => confirmDelete('folder', folder)}
											class="rounded p-2 text-[var(--color-text-muted)] transition-colors hover:bg-red-500/10 hover:text-red-500"
											title="Delete permanently"
										>
											<X class="h-4 w-4" />
										</button>
									</div>
								</div>
							{/each}
						</div>
					</div>
				{/if}

				<!-- Notes section -->
				{#if notesData.length > 0}
					<div>
						<h2 class="mb-2 text-sm font-medium text-[var(--color-text-muted)]">Notes</h2>
						<div class="space-y-2">
							{#each notesData as note (note.id)}
								<div
									class="group flex items-center justify-between rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3 transition-colors hover:border-[var(--color-accent)]/50"
								>
									<div class="flex items-center gap-3">
										<FileText class="h-5 w-5 text-[var(--color-accent)]" />
										<div>
											<div class="font-medium text-[var(--color-text)]">{note.title}</div>
											<div class="text-xs text-[var(--color-text-muted)]">
												Deleted {formatDeletedDate(note.deletedAt)} · {getDaysUntilPermanentDelete(note.deletedAt)} days left
											</div>
										</div>
									</div>
									<div class="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
										<button
											onclick={() => handleRestore('note', note.id)}
											class="rounded p-2 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-accent)]/10 hover:text-[var(--color-accent)]"
											title="Restore note"
										>
											<RotateCcw class="h-4 w-4" />
										</button>
										<button
											onclick={() => confirmDelete('note', note)}
											class="rounded p-2 text-[var(--color-text-muted)] transition-colors hover:bg-red-500/10 hover:text-red-500"
											title="Delete permanently"
										>
											<X class="h-4 w-4" />
										</button>
									</div>
								</div>
							{/each}
						</div>
					</div>
				{/if}
			</div>
		{/if}
	</div>
</div>

<!-- Delete confirmation modal -->
{#if showDeleteConfirm && itemToDelete}
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
		onclick={() => (showDeleteConfirm = false)}
		onkeydown={(e) => e.key === 'Escape' && (showDeleteConfirm = false)}
		role="dialog"
		aria-modal="true"
		tabindex="-1"
	>
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="w-full max-w-sm rounded-xl bg-[var(--color-bg)] p-6 shadow-2xl"
			onclick={(e) => e.stopPropagation()}
		>
			<div class="mb-4 flex items-center gap-3">
				<div class="flex h-10 w-10 items-center justify-center rounded-full bg-red-500/10">
					<AlertTriangle class="h-5 w-5 text-red-500" />
				</div>
				<h2 class="text-lg font-semibold text-[var(--color-text)]">Delete Permanently?</h2>
			</div>
			<p class="mb-4 text-sm text-[var(--color-text-muted)]">
				Are you sure you want to permanently delete "{itemToDelete.type === 'note'
					? (itemToDelete.item as Note).title
					: (itemToDelete.item as Folder).name}"? This action cannot be undone.
			</p>
			<div class="flex justify-end gap-3">
				<button
					onclick={() => (showDeleteConfirm = false)}
					class="rounded-lg px-4 py-2 text-sm font-medium text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-border)]"
				>
					Cancel
				</button>
				<button
					onclick={handlePermanentDelete}
					class="rounded-lg bg-red-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-600"
				>
					Delete Permanently
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- Empty trash confirmation modal -->
{#if showEmptyConfirm}
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
		onclick={() => (showEmptyConfirm = false)}
		onkeydown={(e) => e.key === 'Escape' && (showEmptyConfirm = false)}
		role="dialog"
		aria-modal="true"
		tabindex="-1"
	>
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="w-full max-w-sm rounded-xl bg-[var(--color-bg)] p-6 shadow-2xl"
			onclick={(e) => e.stopPropagation()}
		>
			<div class="mb-4 flex items-center gap-3">
				<div class="flex h-10 w-10 items-center justify-center rounded-full bg-red-500/10">
					<Trash2 class="h-5 w-5 text-red-500" />
				</div>
				<h2 class="text-lg font-semibold text-[var(--color-text)]">Empty Trash?</h2>
			</div>
			<p class="mb-4 text-sm text-[var(--color-text-muted)]">
				Are you sure you want to permanently delete all {totalItems} item{totalItems !== 1
					? 's'
					: ''} in the trash? This action cannot be undone.
			</p>
			<div class="flex justify-end gap-3">
				<button
					onclick={() => (showEmptyConfirm = false)}
					class="rounded-lg px-4 py-2 text-sm font-medium text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-border)]"
				>
					Cancel
				</button>
				<button
					onclick={handleEmptyTrash}
					class="rounded-lg bg-red-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-600"
				>
					Empty Trash
				</button>
			</div>
		</div>
	</div>
{/if}
