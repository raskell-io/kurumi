<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import {
		folders,
		notes,
		addFolder,
		addNote,
		deleteFolder,
		updateFolder,
		moveNoteToFolder
	} from '$lib/db';

	type Props = {
		onNoteClick?: () => void;
	};

	let { onNoteClick }: Props = $props();

	// Track which folders are expanded
	let expandedFolders = $state<Set<string>>(new Set());

	// Track which folder has context menu open
	let contextMenuFolder = $state<string | null>(null);
	let contextMenuNote = $state<string | null>(null);
	let contextMenuPosition = $state<{ x: number; y: number }>({ x: 0, y: 0 });

	// New folder input state
	let creatingFolderIn = $state<string | null | 'root'>(null);
	let newFolderName = $state('');

	// Rename state
	let renamingFolder = $state<string | null>(null);
	let renameValue = $state('');

	// Get root folders and notes (must depend on reactive stores)
	let rootFolders = $derived($folders.filter((f) => f.parentId === null));
	let rootNotes = $derived($notes.filter((n) => n.folderId === null));

	function toggleFolder(folderId: string) {
		const newSet = new Set(expandedFolders);
		if (newSet.has(folderId)) {
			newSet.delete(folderId);
		} else {
			newSet.add(folderId);
		}
		expandedFolders = newSet;
	}

	function handleFolderContextMenu(e: MouseEvent, folderId: string) {
		e.preventDefault();
		contextMenuFolder = folderId;
		contextMenuNote = null;
		contextMenuPosition = { x: e.clientX, y: e.clientY };
	}

	function handleNoteContextMenu(e: MouseEvent, noteId: string) {
		e.preventDefault();
		contextMenuNote = noteId;
		contextMenuFolder = null;
		contextMenuPosition = { x: e.clientX, y: e.clientY };
	}

	function closeContextMenu() {
		contextMenuFolder = null;
		contextMenuNote = null;
	}

	function handleCreateFolder(parentId: string | null) {
		closeContextMenu();
		creatingFolderIn = parentId ?? 'root';
		newFolderName = '';
		// Expand parent if creating inside a folder
		if (parentId) {
			expandedFolders = new Set([...expandedFolders, parentId]);
		}
	}

	function handleCreateNote(folderId: string | null) {
		closeContextMenu();
		const note = addNote(undefined, undefined, folderId);
		goto(`/note/${note.id}`);
		onNoteClick?.();
	}

	function submitNewFolder() {
		if (newFolderName.trim()) {
			const parentId = creatingFolderIn === 'root' ? null : creatingFolderIn;
			addFolder(newFolderName.trim(), parentId);
		}
		creatingFolderIn = null;
		newFolderName = '';
	}

	function cancelNewFolder() {
		creatingFolderIn = null;
		newFolderName = '';
	}

	function handleRenameFolder(folderId: string) {
		closeContextMenu();
		const folder = $folders.find((f) => f.id === folderId);
		if (folder) {
			renamingFolder = folderId;
			renameValue = folder.name;
		}
	}

	function submitRename() {
		if (renamingFolder && renameValue.trim()) {
			updateFolder(renamingFolder, { name: renameValue.trim() });
		}
		renamingFolder = null;
		renameValue = '';
	}

	function cancelRename() {
		renamingFolder = null;
		renameValue = '';
	}

	function handleDeleteFolder(folderId: string) {
		closeContextMenu();
		// For now, move contents to root when deleting
		deleteFolder(folderId, false);
	}

	function handleMoveNoteToRoot() {
		if (contextMenuNote) {
			moveNoteToFolder(contextMenuNote, null);
		}
		closeContextMenu();
	}

	function isNoteActive(noteId: string): boolean {
		return $page.url.pathname === `/note/${noteId}`;
	}

	function handleNoteClick() {
		onNoteClick?.();
	}
</script>

<svelte:window onclick={closeContextMenu} />

<div class="folder-tree">
	<!-- Create folder at root button -->
	<button
		onclick={() => handleCreateFolder(null)}
		class="mb-2 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-border)] hover:text-[var(--color-text)]"
	>
		<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
			<path
				fill-rule="evenodd"
				d="M4 4a2 2 0 00-2 2v8a2 2 0 002 2h12a2 2 0 002-2V8a2 2 0 00-2-2h-5L9 4H4zm7 5a1 1 0 10-2 0v1H8a1 1 0 100 2h1v1a1 1 0 102 0v-1h1a1 1 0 100-2h-1V9z"
				clip-rule="evenodd"
			/>
		</svg>
		New Folder
	</button>

	<!-- New folder input at root -->
	{#if creatingFolderIn === 'root'}
		<div class="mb-2 px-1">
			<input
				type="text"
				bind:value={newFolderName}
				onkeydown={(e) => {
					if (e.key === 'Enter') submitNewFolder();
					if (e.key === 'Escape') cancelNewFolder();
				}}
				onblur={submitNewFolder}
				placeholder="Folder name"
				class="w-full rounded border border-[var(--color-accent)] bg-[var(--color-bg)] px-2 py-1 text-sm text-[var(--color-text)] outline-none"
				autofocus
			/>
		</div>
	{/if}

	<!-- Root folders -->
	{#each rootFolders as folder (folder.id)}
		{@const subfolders = $folders.filter((f) => f.parentId === folder.id)}
		{@const folderNotes = $notes.filter((n) => n.folderId === folder.id)}
		{@const isExpanded = expandedFolders.has(folder.id)}
		{@const hasContents = subfolders.length > 0 || folderNotes.length > 0}

		<div class="folder-item">
			<!-- Folder header -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="group flex items-center rounded-lg px-2 py-1.5 transition-colors hover:bg-[var(--color-border)]"
				oncontextmenu={(e) => handleFolderContextMenu(e, folder.id)}
				role="treeitem"
			>
				<button onclick={() => toggleFolder(folder.id)} class="mr-1 p-0.5 text-[var(--color-text-muted)]" aria-label="Toggle folder">
					<svg
						xmlns="http://www.w3.org/2000/svg"
						class="h-3 w-3 transition-transform"
						class:rotate-90={isExpanded}
						viewBox="0 0 20 20"
						fill="currentColor"
					>
						<path
							fill-rule="evenodd"
							d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
							clip-rule="evenodd"
						/>
					</svg>
				</button>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					class="mr-2 h-4 w-4 text-[var(--color-accent)]"
					viewBox="0 0 20 20"
					fill="currentColor"
				>
					{#if isExpanded && hasContents}
						<path
							fill-rule="evenodd"
							d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z"
							clip-rule="evenodd"
						/>
					{:else}
						<path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
					{/if}
				</svg>
				{#if renamingFolder === folder.id}
					<input
						type="text"
						bind:value={renameValue}
						onkeydown={(e) => {
							if (e.key === 'Enter') submitRename();
							if (e.key === 'Escape') cancelRename();
						}}
						onblur={submitRename}
						class="flex-1 rounded bg-[var(--color-bg)] px-1 text-sm text-[var(--color-text)] outline-none ring-1 ring-[var(--color-accent)]"
						autofocus
						onclick={(e) => e.stopPropagation()}
					/>
				{:else}
					<span class="flex-1 truncate text-sm text-[var(--color-text)]">{folder.name}</span>
				{/if}
				<span class="ml-1 text-xs text-[var(--color-text-muted)] opacity-0 group-hover:opacity-100">
					{folderNotes.length}
				</span>
			</div>

			<!-- Folder contents -->
			{#if isExpanded}
				<div class="ml-4 border-l border-[var(--color-border)] pl-2">
					<!-- New folder input inside this folder -->
					{#if creatingFolderIn === folder.id}
						<div class="mb-1 px-1">
							<input
								type="text"
								bind:value={newFolderName}
								onkeydown={(e) => {
									if (e.key === 'Enter') submitNewFolder();
									if (e.key === 'Escape') cancelNewFolder();
								}}
								onblur={submitNewFolder}
								placeholder="Folder name"
								class="w-full rounded border border-[var(--color-accent)] bg-[var(--color-bg)] px-2 py-1 text-sm text-[var(--color-text)] outline-none"
								autofocus
							/>
						</div>
					{/if}

					<!-- Subfolders (recursive) -->
					{#each subfolders as subfolder (subfolder.id)}
						{@const subSubfolders = $folders.filter((f) => f.parentId === subfolder.id)}
						{@const subFolderNotes = $notes.filter((n) => n.folderId === subfolder.id)}
						{@const isSubExpanded = expandedFolders.has(subfolder.id)}
						{@const hasSubContents = subSubfolders.length > 0 || subFolderNotes.length > 0}

						<div class="subfolder-item">
							<!-- svelte-ignore a11y_no_static_element_interactions -->
							<div
								class="group flex items-center rounded-lg px-2 py-1.5 transition-colors hover:bg-[var(--color-border)]"
								oncontextmenu={(e) => handleFolderContextMenu(e, subfolder.id)}
								role="treeitem"
							>
								<button onclick={() => toggleFolder(subfolder.id)} class="mr-1 p-0.5 text-[var(--color-text-muted)]" aria-label="Toggle folder">
									<svg
										xmlns="http://www.w3.org/2000/svg"
										class="h-3 w-3 transition-transform"
										class:rotate-90={isSubExpanded}
										viewBox="0 0 20 20"
										fill="currentColor"
									>
										<path
											fill-rule="evenodd"
											d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
											clip-rule="evenodd"
										/>
									</svg>
								</button>
								<svg
									xmlns="http://www.w3.org/2000/svg"
									class="mr-2 h-4 w-4 text-[var(--color-accent)]"
									viewBox="0 0 20 20"
									fill="currentColor"
								>
									{#if isSubExpanded && hasSubContents}
										<path
											fill-rule="evenodd"
											d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z"
											clip-rule="evenodd"
										/>
									{:else}
										<path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
									{/if}
								</svg>
								{#if renamingFolder === subfolder.id}
									<input
										type="text"
										bind:value={renameValue}
										onkeydown={(e) => {
											if (e.key === 'Enter') submitRename();
											if (e.key === 'Escape') cancelRename();
										}}
										onblur={submitRename}
										class="flex-1 rounded bg-[var(--color-bg)] px-1 text-sm text-[var(--color-text)] outline-none ring-1 ring-[var(--color-accent)]"
										autofocus
										onclick={(e) => e.stopPropagation()}
									/>
								{:else}
									<span class="flex-1 truncate text-sm text-[var(--color-text)]">{subfolder.name}</span>
								{/if}
								<span class="ml-1 text-xs text-[var(--color-text-muted)] opacity-0 group-hover:opacity-100">
									{subFolderNotes.length}
								</span>
							</div>

							<!-- Subfolder contents -->
							{#if isSubExpanded}
								<div class="ml-4 border-l border-[var(--color-border)] pl-2">
									{#each subFolderNotes as note (note.id)}
										<a
											href="/note/{note.id}"
											onclick={handleNoteClick}
											oncontextmenu={(e) => handleNoteContextMenu(e, note.id)}
											class="mb-0.5 flex items-center rounded-lg px-2 py-1.5 transition-colors hover:bg-[var(--color-border)]"
											class:bg-[var(--color-accent)]={isNoteActive(note.id)}
											class:text-white={isNoteActive(note.id)}
										>
											<svg
												xmlns="http://www.w3.org/2000/svg"
												class="mr-2 h-4 w-4"
												class:text-[var(--color-text-muted)]={!isNoteActive(note.id)}
												viewBox="0 0 20 20"
												fill="currentColor"
											>
												<path
													fill-rule="evenodd"
													d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z"
													clip-rule="evenodd"
												/>
											</svg>
											<span class="truncate text-sm">{note.title || 'Untitled'}</span>
										</a>
									{/each}
								</div>
							{/if}
						</div>
					{/each}

					<!-- Notes in this folder -->
					{#each folderNotes as note (note.id)}
						<a
							href="/note/{note.id}"
							onclick={handleNoteClick}
							oncontextmenu={(e) => handleNoteContextMenu(e, note.id)}
							class="mb-0.5 flex items-center rounded-lg px-2 py-1.5 transition-colors hover:bg-[var(--color-border)]"
							class:bg-[var(--color-accent)]={isNoteActive(note.id)}
							class:text-white={isNoteActive(note.id)}
						>
							<svg
								xmlns="http://www.w3.org/2000/svg"
								class="mr-2 h-4 w-4"
								class:text-[var(--color-text-muted)]={!isNoteActive(note.id)}
								viewBox="0 0 20 20"
								fill="currentColor"
							>
								<path
									fill-rule="evenodd"
									d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z"
									clip-rule="evenodd"
								/>
							</svg>
							<span class="truncate text-sm">{note.title || 'Untitled'}</span>
						</a>
					{/each}
				</div>
			{/if}
		</div>
	{/each}

	<!-- Root notes (not in any folder) -->
	{#if rootNotes.length > 0}
		<div class="mt-2 border-t border-[var(--color-border)] pt-2">
			<div class="mb-1 px-2 text-xs font-medium uppercase text-[var(--color-text-muted)]">Notes</div>
			{#each rootNotes as note (note.id)}
				<a
					href="/note/{note.id}"
					onclick={handleNoteClick}
					oncontextmenu={(e) => handleNoteContextMenu(e, note.id)}
					class="mb-0.5 flex items-center rounded-lg px-2 py-1.5 transition-colors hover:bg-[var(--color-border)]"
					class:bg-[var(--color-accent)]={isNoteActive(note.id)}
					class:text-white={isNoteActive(note.id)}
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						class="mr-2 h-4 w-4"
						class:text-[var(--color-text-muted)]={!isNoteActive(note.id)}
						viewBox="0 0 20 20"
						fill="currentColor"
					>
						<path
							fill-rule="evenodd"
							d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z"
							clip-rule="evenodd"
						/>
					</svg>
					<span class="truncate text-sm">{note.title || 'Untitled'}</span>
				</a>
			{/each}
		</div>
	{/if}
</div>

<!-- Context Menu for Folders -->
{#if contextMenuFolder}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="fixed z-[100] min-w-[160px] rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] py-1 shadow-lg"
		style="left: {contextMenuPosition.x}px; top: {contextMenuPosition.y}px;"
		onclick={(e) => e.stopPropagation()}
		role="menu"
	>
		<button
			onclick={() => handleCreateNote(contextMenuFolder)}
			class="flex w-full items-center gap-2 px-3 py-2 text-sm text-[var(--color-text)] hover:bg-[var(--color-border)]"
		>
			<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
				<path
					fill-rule="evenodd"
					d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z"
					clip-rule="evenodd"
				/>
			</svg>
			New Note
		</button>
		<button
			onclick={() => handleCreateFolder(contextMenuFolder)}
			class="flex w-full items-center gap-2 px-3 py-2 text-sm text-[var(--color-text)] hover:bg-[var(--color-border)]"
		>
			<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
				<path
					fill-rule="evenodd"
					d="M4 4a2 2 0 00-2 2v8a2 2 0 002 2h12a2 2 0 002-2V8a2 2 0 00-2-2h-5L9 4H4zm7 5a1 1 0 10-2 0v1H8a1 1 0 100 2h1v1a1 1 0 102 0v-1h1a1 1 0 100-2h-1V9z"
					clip-rule="evenodd"
				/>
			</svg>
			New Subfolder
		</button>
		<div class="my-1 border-t border-[var(--color-border)]"></div>
		<button
			onclick={() => handleRenameFolder(contextMenuFolder!)}
			class="flex w-full items-center gap-2 px-3 py-2 text-sm text-[var(--color-text)] hover:bg-[var(--color-border)]"
		>
			<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
				<path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
			</svg>
			Rename
		</button>
		<button
			onclick={() => handleDeleteFolder(contextMenuFolder!)}
			class="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
		>
			<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
				<path
					fill-rule="evenodd"
					d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z"
					clip-rule="evenodd"
				/>
			</svg>
			Delete
		</button>
	</div>
{/if}

<!-- Context Menu for Notes -->
{#if contextMenuNote}
	{@const note = $notes.find((n) => n.id === contextMenuNote)}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="fixed z-[100] min-w-[160px] rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] py-1 shadow-lg"
		style="left: {contextMenuPosition.x}px; top: {contextMenuPosition.y}px;"
		onclick={(e) => e.stopPropagation()}
		role="menu"
	>
		{#if note?.folderId}
			<button
				onclick={handleMoveNoteToRoot}
				class="flex w-full items-center gap-2 px-3 py-2 text-sm text-[var(--color-text)] hover:bg-[var(--color-border)]"
			>
				<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
					<path
						fill-rule="evenodd"
						d="M3 3a1 1 0 00-1 1v12a1 1 0 001 1h14a1 1 0 001-1V7.414A2 2 0 0017.414 6L14 2.586A2 2 0 0012.586 2H4a2 2 0 00-2 2v11z"
						clip-rule="evenodd"
					/>
				</svg>
				Move to Root
			</button>
		{/if}
		<!-- Move to folder submenu could go here -->
	</div>
{/if}
