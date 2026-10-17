<script lang="ts">
	import { page } from '$app/stores';
	import { getFolder, getFolderPath, getMemoryObjectsInFolder, getSubfolders } from '$lib/db';
	import ReadNav from '$lib/components/ReadNav.svelte';
	import NoteCard from '$lib/components/NoteCard.svelte';
	import { Folder, FolderOpen, FolderX } from 'lucide-svelte';

	let folderId = $derived($page.params.id ?? '');
	let folder = $derived(getFolder(folderId));
	let folderPath = $derived(getFolderPath(folderId));
	let memories = $derived(getMemoryObjectsInFolder(folderId));
	let subfolders = $derived(getSubfolders(folderId));

	let breadcrumbs = $derived(
		folderPath.map((f) => ({ label: f.name, href: `/read/folder/${f.id}` }))
	);
</script>

<svelte:head>
	<title>{folder?.name || 'Folder'} - Kurumi</title>
</svelte:head>

<ReadNav {breadcrumbs} />

<div class="k-page">
	{#if folder}
		<header class="k-page-header">
			<div class="min-w-0">
				<p class="eyebrow"><Folder class="h-3.5 w-3.5" /> Folder</p>
				<h1 class="k-page-title break-words">{folder.name}</h1>
				<p class="k-page-subtitle">
					{memories.length} note{memories.length === 1 ? '' : 's'}{#if subfolders.length > 0}
						· {subfolders.length} subfolder{subfolders.length === 1 ? '' : 's'}{/if}
				</p>
			</div>
		</header>

		{#if subfolders.length > 0}
			<div class="subfolder-list">
				{#each subfolders as subfolder (subfolder.id)}
					<a href="/read/folder/{subfolder.id}" class="k-row">
						<Folder class="h-4 w-4 shrink-0 text-[var(--color-text-faint)]" />
						<span class="min-w-0 flex-1 truncate">{subfolder.name}</span>
					</a>
				{/each}
			</div>
		{/if}

		{#if memories.length > 0}
			{#if subfolders.length > 0}
				<h2 class="k-section-title">Notes</h2>
			{/if}
			<div class="note-list">
				{#each memories as memory (memory.id)}
					<NoteCard {memory} showFolder={false} />
				{/each}
			</div>
		{:else if subfolders.length === 0}
			<div class="k-empty">
				<FolderOpen />
				<p class="k-empty-title">This folder is empty</p>
				<p>Notes you move into {folder.name} will show up here.</p>
				<a href="/read" class="k-btn mt-2">All notes</a>
			</div>
		{/if}
	{:else}
		<div class="k-empty">
			<FolderX />
			<p class="k-empty-title">Folder not found</p>
			<p>It may have been renamed or deleted.</p>
			<a href="/read" class="k-btn mt-2">All notes</a>
		</div>
	{/if}
</div>

<style>
	.eyebrow {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		margin-bottom: 0.375rem;
		font-size: 0.75rem;
		font-weight: 500;
		color: var(--color-text-faint);
	}

	/* Bleed into the gutter so entry text aligns with the title */
	.note-list {
		display: flex;
		flex-direction: column;
		margin: 0 -0.75rem;
	}

	.subfolder-list {
		display: flex;
		flex-direction: column;
		margin: 0 -0.625rem 0.5rem;
	}
</style>
