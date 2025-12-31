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
		updateNote,
		moveNoteToFolder,
		moveFolderToFolder,
		vaults,
		currentVaultId,
		moveNoteToVault,
		moveFolderToVault
	} from '$lib/db';
	import {
		ChevronRight,
		Folder,
		FolderOpen,
		FolderPlus,
		FilePlus,
		FileText,
		Pencil,
		Trash2,
		FolderInput,
		FolderSymlink
	} from 'lucide-svelte';

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
	let showVaultSubmenu = $state(false);

	// New folder input state
	let creatingFolderIn = $state<string | null | 'root'>(null);
	let newFolderName = $state('');

	// Rename state
	let renamingFolder = $state<string | null>(null);
	let renamingNote = $state<string | null>(null);
	let renameValue = $state('');

	// Drag and drop state
	type DragItem = { type: 'note'; id: string } | { type: 'folder'; id: string };
	let draggedItem = $state<DragItem | null>(null);
	let dropTargetFolder = $state<string | null>(null);
	let dropTargetRoot = $state(false);

	// Touch drag state
	let touchDragPreview = $state<HTMLElement | null>(null);
	let touchStartPos = $state<{ x: number; y: number } | null>(null);
	let touchDragActive = $state(false);
	let longPressTimer: ReturnType<typeof setTimeout> | null = null;
	const LONG_PRESS_DURATION = 300; // ms to trigger drag
	const DRAG_THRESHOLD = 10; // pixels to move before canceling long press

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
		showVaultSubmenu = false;
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
		renamingNote = null;
		renameValue = '';
	}

	function handleRenameNote(noteId: string) {
		closeContextMenu();
		const note = $notes.find((n) => n.id === noteId);
		if (note) {
			renamingNote = noteId;
			renameValue = note.title || '';
		}
	}

	function submitNoteRename() {
		if (renamingNote) {
			updateNote(renamingNote, { title: renameValue.trim() || 'Untitled' });
		}
		renamingNote = null;
		renameValue = '';
	}

	function handleDoubleClick(e: MouseEvent, type: 'folder' | 'note', id: string) {
		e.preventDefault();
		e.stopPropagation();
		if (type === 'folder') {
			handleRenameFolder(id);
		} else {
			handleRenameNote(id);
		}
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

	// Drag and drop handlers
	function handleDragStart(e: DragEvent, item: DragItem) {
		draggedItem = item;
		if (e.dataTransfer) {
			e.dataTransfer.effectAllowed = 'move';
			e.dataTransfer.setData('text/plain', JSON.stringify(item));
		}
	}

	function handleDragEnd() {
		draggedItem = null;
		dropTargetFolder = null;
		dropTargetRoot = false;
	}

	function handleDragOver(e: DragEvent, targetFolderId: string | null) {
		e.preventDefault();
		if (!draggedItem) return;

		// Don't allow dropping a folder into itself or its descendants
		if (draggedItem.type === 'folder' && targetFolderId) {
			if (draggedItem.id === targetFolderId) return;
			if (isDescendant(draggedItem.id, targetFolderId)) return;
		}

		if (e.dataTransfer) {
			e.dataTransfer.dropEffect = 'move';
		}

		if (targetFolderId === null) {
			dropTargetRoot = true;
			dropTargetFolder = null;
		} else {
			dropTargetFolder = targetFolderId;
			dropTargetRoot = false;
		}
	}

	function handleDragLeave(e: DragEvent) {
		// Only clear if we're leaving the actual element, not entering a child
		const relatedTarget = e.relatedTarget as HTMLElement | null;
		if (!relatedTarget || !e.currentTarget || !(e.currentTarget as HTMLElement).contains(relatedTarget)) {
			dropTargetFolder = null;
			dropTargetRoot = false;
		}
	}

	function handleDrop(e: DragEvent, targetFolderId: string | null) {
		e.preventDefault();
		if (!draggedItem) return;

		// Don't allow dropping a folder into itself or its descendants
		if (draggedItem.type === 'folder' && targetFolderId) {
			if (draggedItem.id === targetFolderId) return;
			if (isDescendant(draggedItem.id, targetFolderId)) return;
		}

		if (draggedItem.type === 'note') {
			moveNoteToFolder(draggedItem.id, targetFolderId);
		} else if (draggedItem.type === 'folder') {
			moveFolderToFolder(draggedItem.id, targetFolderId);
		}

		// Expand the target folder so user sees the result
		if (targetFolderId) {
			expandedFolders = new Set([...expandedFolders, targetFolderId]);
		}

		handleDragEnd();
	}

	// Check if potentialDescendant is a descendant of folderId
	function isDescendant(folderId: string, potentialDescendant: string): boolean {
		let current = $folders.find((f) => f.id === potentialDescendant);
		while (current) {
			if (current.parentId === folderId) return true;
			current = $folders.find((f) => f.id === current!.parentId);
		}
		return false;
	}

	function isDraggedOver(folderId: string): boolean {
		return dropTargetFolder === folderId;
	}

	// Touch drag handlers
	function handleTouchStart(e: TouchEvent, item: DragItem, label: string) {
		const touch = e.touches[0];
		touchStartPos = { x: touch.clientX, y: touch.clientY };

		// Start long press timer
		longPressTimer = setTimeout(() => {
			if (touchStartPos) {
				startTouchDrag(item, label, touchStartPos.x, touchStartPos.y);
			}
		}, LONG_PRESS_DURATION);
	}

	function handleTouchMove(e: TouchEvent) {
		const touch = e.touches[0];

		// If we haven't started dragging yet, check if we moved too far (cancel long press)
		if (!touchDragActive && touchStartPos && longPressTimer) {
			const dx = touch.clientX - touchStartPos.x;
			const dy = touch.clientY - touchStartPos.y;
			if (Math.sqrt(dx * dx + dy * dy) > DRAG_THRESHOLD) {
				clearTimeout(longPressTimer);
				longPressTimer = null;
				touchStartPos = null;
			}
			return;
		}

		// If we're actively dragging, update preview position and detect drop targets
		if (touchDragActive && touchDragPreview) {
			e.preventDefault(); // Prevent scrolling while dragging

			// Move preview
			touchDragPreview.style.left = `${touch.clientX - 20}px`;
			touchDragPreview.style.top = `${touch.clientY - 20}px`;

			// Detect drop target using elementFromPoint
			// Temporarily hide preview to get element underneath
			touchDragPreview.style.pointerEvents = 'none';
			const elementBelow = document.elementFromPoint(touch.clientX, touch.clientY);
			touchDragPreview.style.pointerEvents = '';

			updateDropTarget(elementBelow);
		}
	}

	function handleTouchEnd() {
		// Clear long press timer
		if (longPressTimer) {
			clearTimeout(longPressTimer);
			longPressTimer = null;
		}

		// If we were dragging, complete the drop
		if (touchDragActive && draggedItem) {
			// Determine target
			let targetFolderId: string | null = null;
			if (dropTargetFolder) {
				targetFolderId = dropTargetFolder;
			} else if (dropTargetRoot) {
				targetFolderId = null;
			} else {
				// No valid target, cancel
				cleanupTouchDrag();
				return;
			}

			// Validate drop
			if (draggedItem.type === 'folder' && targetFolderId) {
				if (draggedItem.id === targetFolderId || isDescendant(draggedItem.id, targetFolderId)) {
					cleanupTouchDrag();
					return;
				}
			}

			// Perform the move
			if (draggedItem.type === 'note') {
				moveNoteToFolder(draggedItem.id, targetFolderId);
			} else if (draggedItem.type === 'folder') {
				moveFolderToFolder(draggedItem.id, targetFolderId);
			}

			// Expand target folder
			if (targetFolderId) {
				expandedFolders = new Set([...expandedFolders, targetFolderId]);
			}
		}

		cleanupTouchDrag();
	}

	function startTouchDrag(item: DragItem, label: string, x: number, y: number) {
		draggedItem = item;
		touchDragActive = true;

		// Create floating preview element
		const preview = document.createElement('div');
		preview.className = 'touch-drag-preview';
		preview.innerHTML = `
			<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
				${item.type === 'folder'
					? '<path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />'
					: '<path fill-rule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clip-rule="evenodd" />'
				}
			</svg>
			<span>${label}</span>
		`;
		preview.style.left = `${x - 20}px`;
		preview.style.top = `${y - 20}px`;
		document.body.appendChild(preview);
		touchDragPreview = preview;

		// Haptic feedback if available
		if (navigator.vibrate) {
			navigator.vibrate(50);
		}
	}

	function updateDropTarget(element: Element | null) {
		if (!element) {
			dropTargetFolder = null;
			dropTargetRoot = false;
			return;
		}

		// Walk up the DOM to find a drop target
		let current: Element | null = element;
		while (current) {
			// Check for folder drop target
			const folderId = current.getAttribute('data-folder-id');
			if (folderId) {
				// Validate it's not dropping into itself
				if (draggedItem?.type === 'folder' && (draggedItem.id === folderId || isDescendant(draggedItem.id, folderId))) {
					dropTargetFolder = null;
					dropTargetRoot = false;
				} else {
					dropTargetFolder = folderId;
					dropTargetRoot = false;
				}
				return;
			}

			// Check for folder tree (root drop)
			if (current.classList.contains('folder-tree')) {
				dropTargetFolder = null;
				dropTargetRoot = true;
				return;
			}

			current = current.parentElement;
		}

		dropTargetFolder = null;
		dropTargetRoot = false;
	}

	function cleanupTouchDrag() {
		if (touchDragPreview) {
			touchDragPreview.remove();
			touchDragPreview = null;
		}
		draggedItem = null;
		dropTargetFolder = null;
		dropTargetRoot = false;
		touchDragActive = false;
		touchStartPos = null;
	}

	function getItemLabel(item: DragItem): string {
		if (item.type === 'note') {
			const note = $notes.find((n) => n.id === item.id);
			return note?.title || 'Untitled';
		} else {
			const folder = $folders.find((f) => f.id === item.id);
			return folder?.name || 'Folder';
		}
	}
</script>

<svelte:window
	onclick={closeContextMenu}
	onkeydown={(e) => {
		if (e.key === 'F2' && !renamingFolder && !renamingNote) {
			e.preventDefault();
			// Get the currently active note from URL
			const match = $page.url.pathname.match(/^\/note\/(.+)$/);
			if (match) {
				const noteId = match[1];
				handleRenameNote(noteId);
			}
		}
	}}
/>

<div
	class="folder-tree"
	ondragover={(e) => handleDragOver(e, null)}
	ondragleave={handleDragLeave}
	ondrop={(e) => handleDrop(e, null)}
	class:drop-target-root={dropTargetRoot}
	role="tree"
>
	<!-- Create folder at root button -->
	<button
		onclick={() => handleCreateFolder(null)}
		class="mb-2 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-border)] hover:text-[var(--color-text)]"
	>
		<FolderPlus class="h-4 w-4" />
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

	<!-- Root level: folders first, then notes -->
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
				class:drop-target={isDraggedOver(folder.id)}
				class:dragging={draggedItem?.type === 'folder' && draggedItem.id === folder.id}
				data-folder-id={folder.id}
				draggable="true"
				ondragstart={(e) => handleDragStart(e, { type: 'folder', id: folder.id })}
				ondragend={handleDragEnd}
				ondragover={(e) => { e.stopPropagation(); handleDragOver(e, folder.id); }}
				ondragleave={handleDragLeave}
				ondrop={(e) => { e.stopPropagation(); handleDrop(e, folder.id); }}
				ontouchstart={(e) => handleTouchStart(e, { type: 'folder', id: folder.id }, folder.name)}
				ontouchmove={handleTouchMove}
				ontouchend={handleTouchEnd}
				oncontextmenu={(e) => handleFolderContextMenu(e, folder.id)}
				role="treeitem"
			>
				<button onclick={() => toggleFolder(folder.id)} class="mr-1 p-0.5 text-[var(--color-text-muted)]" aria-label="Toggle folder">
					<ChevronRight class="h-3 w-3 transition-transform {isExpanded ? 'rotate-90' : ''}" />
				</button>
				{#if isExpanded && hasContents}
					<FolderOpen class="mr-2 h-4 w-4 text-[var(--color-accent)]" />
				{:else}
					<Folder class="mr-2 h-4 w-4 text-[var(--color-accent)]" />
				{/if}
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
					<span
						class="flex-1 truncate text-sm text-[var(--color-text)]"
						ondblclick={(e) => handleDoubleClick(e, 'folder', folder.id)}
					>{folder.name}</span>
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

					<!-- Subfolders first -->
					{#each subfolders as subfolder (subfolder.id)}
						{@const subSubfolders = $folders.filter((f) => f.parentId === subfolder.id)}
						{@const subFolderNotes = $notes.filter((n) => n.folderId === subfolder.id)}
						{@const isSubExpanded = expandedFolders.has(subfolder.id)}
						{@const hasSubContents = subSubfolders.length > 0 || subFolderNotes.length > 0}

						<div class="subfolder-item">
							<!-- svelte-ignore a11y_no_static_element_interactions -->
							<div
								class="group flex items-center rounded-lg px-2 py-1.5 transition-colors hover:bg-[var(--color-border)]"
								class:drop-target={isDraggedOver(subfolder.id)}
								class:dragging={draggedItem?.type === 'folder' && draggedItem.id === subfolder.id}
								data-folder-id={subfolder.id}
								draggable="true"
								ondragstart={(e) => handleDragStart(e, { type: 'folder', id: subfolder.id })}
								ondragend={handleDragEnd}
								ondragover={(e) => { e.stopPropagation(); handleDragOver(e, subfolder.id); }}
								ondragleave={handleDragLeave}
								ondrop={(e) => { e.stopPropagation(); handleDrop(e, subfolder.id); }}
								ontouchstart={(e) => handleTouchStart(e, { type: 'folder', id: subfolder.id }, subfolder.name)}
								ontouchmove={handleTouchMove}
								ontouchend={handleTouchEnd}
								oncontextmenu={(e) => handleFolderContextMenu(e, subfolder.id)}
								role="treeitem"
							>
								<button onclick={() => toggleFolder(subfolder.id)} class="mr-1 p-0.5 text-[var(--color-text-muted)]" aria-label="Toggle folder">
									<ChevronRight class="h-3 w-3 transition-transform {isSubExpanded ? 'rotate-90' : ''}" />
								</button>
								{#if isSubExpanded && hasSubContents}
									<FolderOpen class="mr-2 h-4 w-4 text-[var(--color-accent)]" />
								{:else}
									<Folder class="mr-2 h-4 w-4 text-[var(--color-accent)]" />
								{/if}
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
									<span
										class="flex-1 truncate text-sm text-[var(--color-text)]"
										ondblclick={(e) => handleDoubleClick(e, 'folder', subfolder.id)}
									>{subfolder.name}</span>
								{/if}
								<span class="ml-1 text-xs text-[var(--color-text-muted)] opacity-0 group-hover:opacity-100">
									{subFolderNotes.length}
								</span>
							</div>

							<!-- Subfolder contents -->
							{#if isSubExpanded}
								<div class="ml-4 border-l border-[var(--color-border)] pl-2">
									<!-- Sub-subfolders -->
									{#each subSubfolders as subSubfolder (subSubfolder.id)}
										{@const subSubFolderNotes = $notes.filter((n) => n.folderId === subSubfolder.id)}
										{@const isSubSubExpanded = expandedFolders.has(subSubfolder.id)}
										<div class="subfolder-item">
											<!-- svelte-ignore a11y_no_static_element_interactions -->
											<div
												class="group flex items-center rounded-lg px-2 py-1.5 transition-colors hover:bg-[var(--color-border)]"
												class:drop-target={isDraggedOver(subSubfolder.id)}
												class:dragging={draggedItem?.type === 'folder' && draggedItem.id === subSubfolder.id}
												data-folder-id={subSubfolder.id}
												draggable="true"
												ondragstart={(e) => handleDragStart(e, { type: 'folder', id: subSubfolder.id })}
												ondragend={handleDragEnd}
												ondragover={(e) => { e.stopPropagation(); handleDragOver(e, subSubfolder.id); }}
												ondragleave={handleDragLeave}
												ondrop={(e) => { e.stopPropagation(); handleDrop(e, subSubfolder.id); }}
												ontouchstart={(e) => handleTouchStart(e, { type: 'folder', id: subSubfolder.id }, subSubfolder.name)}
												ontouchmove={handleTouchMove}
												ontouchend={handleTouchEnd}
												oncontextmenu={(e) => handleFolderContextMenu(e, subSubfolder.id)}
												role="treeitem"
											>
												<button onclick={() => toggleFolder(subSubfolder.id)} class="mr-1 p-0.5 text-[var(--color-text-muted)]" aria-label="Toggle folder">
													<ChevronRight class="h-3 w-3 transition-transform {isSubSubExpanded ? 'rotate-90' : ''}" />
												</button>
												<Folder class="mr-2 h-4 w-4 text-[var(--color-accent)]" />
												{#if renamingFolder === subSubfolder.id}
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
													<span
														class="flex-1 truncate text-sm text-[var(--color-text)]"
														ondblclick={(e) => handleDoubleClick(e, 'folder', subSubfolder.id)}
													>{subSubfolder.name}</span>
												{/if}
												<span class="ml-1 text-xs text-[var(--color-text-muted)] opacity-0 group-hover:opacity-100">
													{subSubFolderNotes.length}
												</span>
											</div>
											{#if isSubSubExpanded}
												<div class="ml-4 border-l border-[var(--color-border)] pl-2">
													{#each subSubFolderNotes as note (note.id)}
														<a
															href="/note/{note.id}"
															onclick={handleNoteClick}
															oncontextmenu={(e) => handleNoteContextMenu(e, note.id)}
															class="mb-0.5 flex items-center rounded-lg px-2 py-1.5 transition-colors hover:bg-[var(--color-border)]"
															class:bg-[var(--color-accent)]={isNoteActive(note.id)}
															class:text-white={isNoteActive(note.id)}
															class:dragging={draggedItem?.type === 'note' && draggedItem.id === note.id}
															draggable="true"
															ondragstart={(e) => handleDragStart(e, { type: 'note', id: note.id })}
															ondragend={handleDragEnd}
															ontouchstart={(e) => handleTouchStart(e, { type: 'note', id: note.id }, note.title || 'Untitled')}
															ontouchmove={handleTouchMove}
															ontouchend={handleTouchEnd}
														>
															<FileText class="mr-2 h-4 w-4 shrink-0 {!isNoteActive(note.id) ? 'text-[var(--color-text-muted)]' : ''}" />
															{#if renamingNote === note.id}
																<input
																	type="text"
																	bind:value={renameValue}
																	onkeydown={(e) => {
																		if (e.key === 'Enter') submitNoteRename();
																		if (e.key === 'Escape') cancelRename();
																	}}
																	onblur={submitNoteRename}
																	onclick={(e) => e.preventDefault()}
																	class="flex-1 rounded bg-[var(--color-bg)] px-1 text-sm text-[var(--color-text)] outline-none ring-1 ring-[var(--color-accent)]"
																	autofocus
																/>
															{:else}
																<span
																	class="truncate text-sm"
																	ondblclick={(e) => handleDoubleClick(e, 'note', note.id)}
																>{note.title || 'Untitled'}</span>
															{/if}
														</a>
													{/each}
												</div>
											{/if}
										</div>
									{/each}
									<!-- Notes in subfolder -->
									{#each subFolderNotes as note (note.id)}
										<a
											href="/note/{note.id}"
											onclick={handleNoteClick}
											oncontextmenu={(e) => handleNoteContextMenu(e, note.id)}
											class="mb-0.5 flex items-center rounded-lg px-2 py-1.5 transition-colors hover:bg-[var(--color-border)]"
											class:bg-[var(--color-accent)]={isNoteActive(note.id)}
											class:text-white={isNoteActive(note.id)}
											class:dragging={draggedItem?.type === 'note' && draggedItem.id === note.id}
											draggable="true"
											ondragstart={(e) => handleDragStart(e, { type: 'note', id: note.id })}
											ondragend={handleDragEnd}
											ontouchstart={(e) => handleTouchStart(e, { type: 'note', id: note.id }, note.title || 'Untitled')}
											ontouchmove={handleTouchMove}
											ontouchend={handleTouchEnd}
										>
											<FileText class="mr-2 h-4 w-4 shrink-0 {!isNoteActive(note.id) ? 'text-[var(--color-text-muted)]' : ''}" />
											{#if renamingNote === note.id}
												<input
													type="text"
													bind:value={renameValue}
													onkeydown={(e) => {
														if (e.key === 'Enter') submitNoteRename();
														if (e.key === 'Escape') cancelRename();
													}}
													onblur={submitNoteRename}
													onclick={(e) => e.preventDefault()}
													class="flex-1 rounded bg-[var(--color-bg)] px-1 text-sm text-[var(--color-text)] outline-none ring-1 ring-[var(--color-accent)]"
													autofocus
												/>
											{:else}
												<span
													class="truncate text-sm"
													ondblclick={(e) => handleDoubleClick(e, 'note', note.id)}
												>{note.title || 'Untitled'}</span>
											{/if}
										</a>
									{/each}
								</div>
							{/if}
						</div>
					{/each}

					<!-- Notes in this folder (after subfolders) -->
					{#each folderNotes as note (note.id)}
						<a
							href="/note/{note.id}"
							onclick={handleNoteClick}
							oncontextmenu={(e) => handleNoteContextMenu(e, note.id)}
							class="mb-0.5 flex items-center rounded-lg px-2 py-1.5 transition-colors hover:bg-[var(--color-border)]"
							class:bg-[var(--color-accent)]={isNoteActive(note.id)}
							class:text-white={isNoteActive(note.id)}
							class:dragging={draggedItem?.type === 'note' && draggedItem.id === note.id}
							draggable="true"
							ondragstart={(e) => handleDragStart(e, { type: 'note', id: note.id })}
							ondragend={handleDragEnd}
							ontouchstart={(e) => handleTouchStart(e, { type: 'note', id: note.id }, note.title || 'Untitled')}
							ontouchmove={handleTouchMove}
							ontouchend={handleTouchEnd}
						>
							<FileText class="mr-2 h-4 w-4 shrink-0 {!isNoteActive(note.id) ? 'text-[var(--color-text-muted)]' : ''}" />
							{#if renamingNote === note.id}
								<input
									type="text"
									bind:value={renameValue}
									onkeydown={(e) => {
										if (e.key === 'Enter') submitNoteRename();
										if (e.key === 'Escape') cancelRename();
									}}
									onblur={submitNoteRename}
									onclick={(e) => e.preventDefault()}
									class="flex-1 rounded bg-[var(--color-bg)] px-1 text-sm text-[var(--color-text)] outline-none ring-1 ring-[var(--color-accent)]"
									autofocus
								/>
							{:else}
								<span
									class="truncate text-sm"
									ondblclick={(e) => handleDoubleClick(e, 'note', note.id)}
								>{note.title || 'Untitled'}</span>
							{/if}
						</a>
					{/each}
				</div>
			{/if}
		</div>
	{/each}

	<!-- Root notes (not in any folder) - shown at root level after folders -->
	{#each rootNotes as note (note.id)}
		<a
			href="/note/{note.id}"
			onclick={handleNoteClick}
			oncontextmenu={(e) => handleNoteContextMenu(e, note.id)}
			class="mb-0.5 flex items-center rounded-lg px-2 py-1.5 transition-colors hover:bg-[var(--color-border)]"
			class:bg-[var(--color-accent)]={isNoteActive(note.id)}
			class:text-white={isNoteActive(note.id)}
			class:dragging={draggedItem?.type === 'note' && draggedItem.id === note.id}
			draggable="true"
			ondragstart={(e) => handleDragStart(e, { type: 'note', id: note.id })}
			ondragend={handleDragEnd}
			ontouchstart={(e) => handleTouchStart(e, { type: 'note', id: note.id }, note.title || 'Untitled')}
			ontouchmove={handleTouchMove}
			ontouchend={handleTouchEnd}
		>
			<FileText class="mr-2 h-4 w-4 shrink-0 {!isNoteActive(note.id) ? 'text-[var(--color-text-muted)]' : ''}" />
			{#if renamingNote === note.id}
				<input
					type="text"
					bind:value={renameValue}
					onkeydown={(e) => {
						if (e.key === 'Enter') submitNoteRename();
						if (e.key === 'Escape') cancelRename();
					}}
					onblur={submitNoteRename}
					onclick={(e) => e.preventDefault()}
					class="flex-1 rounded bg-[var(--color-bg)] px-1 text-sm text-[var(--color-text)] outline-none ring-1 ring-[var(--color-accent)]"
					autofocus
				/>
			{:else}
				<span
					class="truncate text-sm"
					ondblclick={(e) => handleDoubleClick(e, 'note', note.id)}
				>{note.title || 'Untitled'}</span>
			{/if}
		</a>
	{/each}
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
			<FilePlus class="h-4 w-4" />
			New Note
		</button>
		<button
			onclick={() => handleCreateFolder(contextMenuFolder)}
			class="flex w-full items-center gap-2 px-3 py-2 text-sm text-[var(--color-text)] hover:bg-[var(--color-border)]"
		>
			<FolderPlus class="h-4 w-4" />
			New Subfolder
		</button>
		<div class="my-1 border-t border-[var(--color-border)]"></div>
		<button
			onclick={() => handleRenameFolder(contextMenuFolder!)}
			class="flex w-full items-center gap-2 px-3 py-2 text-sm text-[var(--color-text)] hover:bg-[var(--color-border)]"
		>
			<Pencil class="h-4 w-4" />
			Rename
		</button>
		<button
			onclick={() => handleDeleteFolder(contextMenuFolder!)}
			class="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
		>
			<Trash2 class="h-4 w-4" />
			Delete
		</button>
		{#if $vaults.length > 1}
			<div class="my-1 border-t border-[var(--color-border)]"></div>
			<div class="relative">
				<button
					onclick={() => (showVaultSubmenu = !showVaultSubmenu)}
					class="flex w-full items-center justify-between gap-2 px-3 py-2 text-sm text-[var(--color-text)] hover:bg-[var(--color-border)]"
				>
					<div class="flex items-center gap-2">
						<FolderInput class="h-4 w-4" />
						Move to Vault
					</div>
					<ChevronRight class="h-4 w-4" />
				</button>
				{#if showVaultSubmenu}
					<div class="absolute left-full top-0 ml-1 min-w-[140px] rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] py-1 shadow-lg">
						{#each $vaults.filter((v) => v.id !== $currentVaultId) as vault (vault.id)}
							<button
								onclick={() => {
									moveFolderToVault(contextMenuFolder!, vault.id);
									closeContextMenu();
								}}
								class="flex w-full items-center gap-2 px-3 py-2 text-sm text-[var(--color-text)] hover:bg-[var(--color-border)]"
							>
								{#if vault.icon}
									<span>{vault.icon}</span>
								{/if}
								<span class="truncate">{vault.name}</span>
							</button>
						{/each}
					</div>
				{/if}
			</div>
		{/if}
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
				<FolderSymlink class="h-4 w-4" />
				Move to Root
			</button>
		{/if}
		{#if $vaults.length > 1}
			{#if note?.folderId}
				<div class="my-1 border-t border-[var(--color-border)]"></div>
			{/if}
			<div class="relative">
				<button
					onclick={() => (showVaultSubmenu = !showVaultSubmenu)}
					class="flex w-full items-center justify-between gap-2 px-3 py-2 text-sm text-[var(--color-text)] hover:bg-[var(--color-border)]"
				>
					<div class="flex items-center gap-2">
						<FolderInput class="h-4 w-4" />
						Move to Vault
					</div>
					<ChevronRight class="h-4 w-4" />
				</button>
				{#if showVaultSubmenu}
					<div class="absolute left-full top-0 ml-1 min-w-[140px] rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] py-1 shadow-lg">
						{#each $vaults.filter((v) => v.id !== $currentVaultId) as vault (vault.id)}
							<button
								onclick={() => {
									moveNoteToVault(contextMenuNote!, vault.id);
									closeContextMenu();
								}}
								class="flex w-full items-center gap-2 px-3 py-2 text-sm text-[var(--color-text)] hover:bg-[var(--color-border)]"
							>
								{#if vault.icon}
									<span>{vault.icon}</span>
								{/if}
								<span class="truncate">{vault.name}</span>
							</button>
						{/each}
					</div>
				{/if}
			</div>
		{/if}
	</div>
{/if}

<style>
	/* Drag and drop styles */
	.drop-target {
		background-color: color-mix(in srgb, var(--color-accent) 20%, transparent);
		outline: 2px dashed var(--color-accent);
		outline-offset: -2px;
		border-radius: 0.5rem;
	}

	.drop-target-root {
		background-color: color-mix(in srgb, var(--color-accent) 10%, transparent);
		outline: 2px dashed var(--color-accent);
		outline-offset: -2px;
		border-radius: 0.5rem;
		min-height: 100%;
	}

	.dragging {
		opacity: 0.5;
	}

	/* Make draggable elements show grab cursor (desktop only) */
	@media (hover: hover) {
		:global([draggable='true']) {
			cursor: grab;
		}

		:global([draggable='true']:active) {
			cursor: grabbing;
		}
	}

	/* Touch drag preview - floating element during touch drag */
	:global(.touch-drag-preview) {
		position: fixed;
		z-index: 9999;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.75rem;
		background: var(--color-bg);
		border: 2px solid var(--color-accent);
		border-radius: 0.5rem;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
		font-size: 0.875rem;
		color: var(--color-text);
		pointer-events: none;
		transform: translate(0, -50%);
		max-width: 200px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	:global(.touch-drag-preview svg) {
		flex-shrink: 0;
		width: 1rem;
		height: 1rem;
		color: var(--color-accent);
	}

	:global(.touch-drag-preview span) {
		overflow: hidden;
		text-overflow: ellipsis;
	}

	/* Prevent text selection during touch drag */
	.folder-tree {
		-webkit-user-select: none;
		user-select: none;
		-webkit-touch-callout: none;
	}
</style>
