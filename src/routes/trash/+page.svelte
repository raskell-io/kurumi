<script lang="ts">
	import { autofocus } from '$lib/actions/autofocus';
	import {
		trashedMemoryObjects,
		trashedFolders,
		restoreMemoryObject,
		restoreFolder,
		permanentlyDeleteMemoryObject,
		permanentlyDeleteFolder,
		emptyTrash,
		type MemoryObject,
		type Folder
	} from '$lib/db';
	import { Trash2, FolderOpen, FileText, RotateCcw, X } from 'lucide-svelte';

	// Store subscriptions
	let memoriesData = $state<MemoryObject[]>([]);
	let foldersData = $state<Folder[]>([]);

	$effect(() => {
		const unsub1 = trashedMemoryObjects.subscribe((m) => {
			memoriesData = m;
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
	let itemToDelete = $state<{ type: 'note' | 'folder'; item: MemoryObject | Folder } | null>(null);

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
			restoreMemoryObject(id);
		} else {
			restoreFolder(id);
		}
	}

	function confirmDelete(type: 'note' | 'folder', item: MemoryObject | Folder) {
		itemToDelete = { type, item };
		showDeleteConfirm = true;
	}

	function handlePermanentDelete() {
		if (!itemToDelete) return;

		if (itemToDelete.type === 'note') {
			permanentlyDeleteMemoryObject(itemToDelete.item.id);
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

	let totalItems = $derived(memoriesData.length + foldersData.length);
</script>

<svelte:window onkeydown={handleKeydown} />

<svelte:head>
	<title>Trash - Kurumi</title>
</svelte:head>

{#snippet trashRow(type: 'note' | 'folder', id: string, label: string, deletedAt: number | null, item: MemoryObject | Folder)}
	{@const daysLeft = getDaysUntilPermanentDelete(deletedAt)}
	<li class="k-row group">
		{#if type === 'folder'}
			<FolderOpen class="h-4 w-4 shrink-0 text-[var(--color-text-faint)]" />
		{:else}
			<FileText class="h-4 w-4 shrink-0 text-[var(--color-text-faint)]" />
		{/if}
		<span class="min-w-0 flex-1 truncate">{label || 'Untitled'}</span>
		<span class="shrink-0 text-xs text-[var(--color-text-faint)] max-sm:hidden">
			{formatDeletedDate(deletedAt)}
		</span>
		<span
			class="k-badge shrink-0 {daysLeft <= 3 ? 'k-badge-danger' : ''}"
			title="Permanently deleted in {daysLeft} day{daysLeft === 1 ? '' : 's'}"
		>
			{daysLeft}d left
		</span>
		<div class="row-actions flex shrink-0 items-center gap-0.5">
			<button
				onclick={() => handleRestore(type, id)}
				class="k-icon-btn"
				title="Restore {type}"
				aria-label="Restore {label || 'Untitled'}"
			>
				<RotateCcw class="h-4 w-4" />
			</button>
			<button
				onclick={() => confirmDelete(type, item)}
				class="k-icon-btn hover:!text-[var(--color-danger)]"
				title="Delete permanently"
				aria-label="Delete {label || 'Untitled'} permanently"
			>
				<X class="h-4 w-4" />
			</button>
		</div>
	</li>
{/snippet}

<div class="k-page">
	<header class="k-page-header max-sm:flex-col">
		<div class="min-w-0">
			<h1 class="k-page-title">Trash</h1>
			<p class="k-page-subtitle">
				{#if totalItems > 0}
					{totalItems} item{totalItems === 1 ? '' : 's'} · permanently deleted after 30 days
				{:else}
					Deleted notes and folders are kept here for 30 days
				{/if}
			</p>
		</div>
		{#if totalItems > 0}
			<button onclick={() => (showEmptyConfirm = true)} class="k-btn k-btn-danger shrink-0">
				<Trash2 class="h-4 w-4" />
				Empty trash
			</button>
		{/if}
	</header>

	{#if totalItems === 0}
		<div class="k-empty">
			<Trash2 />
			<p class="k-empty-title">Trash is empty</p>
			<p>Deleted notes and folders will appear here.</p>
		</div>
	{:else}
		{#if foldersData.length > 0}
			<h2 class="k-section-title">Folders</h2>
			<ul>
				{#each foldersData as folder (folder.id)}
					{@render trashRow('folder', folder.id, folder.name, folder.deletedAt, folder)}
				{/each}
			</ul>
		{/if}

		{#if memoriesData.length > 0}
			<h2 class="k-section-title">Notes</h2>
			<ul>
				{#each memoriesData as memory (memory.id)}
					{@render trashRow('note', memory.id, memory.title, memory.deletedAt, memory)}
				{/each}
			</ul>
		{/if}
	{/if}
</div>

<!-- Delete confirmation modal -->
{#if showDeleteConfirm && itemToDelete}
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div
		class="k-dialog-backdrop"
		onclick={() => (showDeleteConfirm = false)}
		onkeydown={(e) => e.key === 'Escape' && (showDeleteConfirm = false)}
		role="dialog"
		aria-modal="true"
		aria-labelledby="trash-delete-title"
		tabindex="-1"
	>
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="k-dialog !max-w-sm p-5" onclick={(e) => e.stopPropagation()}>
			<h2 id="trash-delete-title" class="text-base font-semibold text-[var(--color-text)]">Delete permanently?</h2>
			<p class="mt-2 text-sm text-[var(--color-text-muted)]">
				"{itemToDelete.type === 'note'
					? (itemToDelete.item as MemoryObject).title
					: (itemToDelete.item as Folder).name}" will be deleted forever. This can't be undone.
			</p>
			<div class="mt-5 flex justify-end gap-2">
				<button onclick={() => (showDeleteConfirm = false)} class="k-btn k-btn-ghost">Cancel</button>
				<button onclick={handlePermanentDelete} class="k-btn k-btn-danger" use:autofocus>Delete forever</button>
			</div>
		</div>
	</div>
{/if}

<!-- Empty trash confirmation modal -->
{#if showEmptyConfirm}
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div
		class="k-dialog-backdrop"
		onclick={() => (showEmptyConfirm = false)}
		onkeydown={(e) => e.key === 'Escape' && (showEmptyConfirm = false)}
		role="dialog"
		aria-modal="true"
		aria-labelledby="trash-empty-title"
		tabindex="-1"
	>
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="k-dialog !max-w-sm p-5" onclick={(e) => e.stopPropagation()}>
			<h2 id="trash-empty-title" class="text-base font-semibold text-[var(--color-text)]">Empty trash?</h2>
			<p class="mt-2 text-sm text-[var(--color-text-muted)]">
				All {totalItems} item{totalItems !== 1 ? 's' : ''} in the trash will be deleted forever. This can't be undone.
			</p>
			<div class="mt-5 flex justify-end gap-2">
				<button onclick={() => (showEmptyConfirm = false)} class="k-btn k-btn-ghost">Cancel</button>
				<button onclick={handleEmptyTrash} class="k-btn k-btn-danger" use:autofocus>Empty trash</button>
			</div>
		</div>
	</div>
{/if}

<style>
	/* Row actions reveal on hover/focus; always visible on touch */
	.row-actions {
		opacity: 0;
	}

	:global(.k-row:hover) > .row-actions,
	.row-actions:focus-within {
		opacity: 1;
	}

	@media (hover: none) {
		.row-actions {
			opacity: 1;
		}
	}
</style>
