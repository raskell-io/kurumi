<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import {
		folders,
		notes,
		addFolder,
		addNote,
		deleteFolder,
		deleteNote,
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
		FolderSymlink,
		SquarePen,
		ArrowUpNarrowWide,
		AlignVerticalSpaceAround,
		ChevronsDownUp
	} from 'lucide-svelte';

	type Props = {
		onNoteClick?: () => void;
		onNoteCreate?: () => void;
		onFolderCreate?: () => void;
		onNoteDelete?: (name: string) => void;
		onFolderDelete?: (name: string) => void;
	};

	let { onNoteClick, onNoteCreate, onFolderCreate, onNoteDelete, onFolderDelete }: Props = $props();

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

	// Swipe-to-delete state (supports both notes and folders)
	type SwipeItem = { type: 'note' | 'folder'; id: string } | null;
	let swipeOpenItem = $state<SwipeItem>(null);
	let swipeStartX = $state<number | null>(null);
	let swipeCurrentX = $state<number | null>(null);
	let swipingItem = $state<SwipeItem>(null);
	const SWIPE_THRESHOLD = 60; // pixels to trigger delete reveal
	const DELETE_BUTTON_WIDTH = 80; // width of delete button

	// Delete animation state
	let deletingItem = $state<SwipeItem>(null);
	const DELETE_ANIMATION_DURATION = 250; // ms

	// Confirmation dialog state
	let confirmDeleteItem = $state<SwipeItem>(null);
	let confirmDeleteName = $state<string>('');

	// Sort order state
	type SortOrder = 'name-asc' | 'name-desc' | 'modified-desc' | 'modified-asc';
	let sortOrder = $state<SortOrder>('name-asc');

	// Sort function
	function sortItems<T extends { name?: string; title?: string; modified: number }>(items: T[]): T[] {
		return [...items].sort((a, b) => {
			const nameA = ('name' in a ? a.name : a.title) || '';
			const nameB = ('name' in b ? b.name : b.title) || '';
			switch (sortOrder) {
				case 'name-asc':
					return nameA.localeCompare(nameB);
				case 'name-desc':
					return nameB.localeCompare(nameA);
				case 'modified-desc':
					return b.modified - a.modified;
				case 'modified-asc':
					return a.modified - b.modified;
				default:
					return 0;
			}
		});
	}

	function cycleSortOrder() {
		const orders: SortOrder[] = ['name-asc', 'name-desc', 'modified-desc', 'modified-asc'];
		const currentIndex = orders.indexOf(sortOrder);
		sortOrder = orders[(currentIndex + 1) % orders.length];
	}

	// Get root folders and notes (must depend on reactive stores)
	let rootFolders = $derived(sortItems($folders.filter((f) => f.parentId === null)));
	let rootNotes = $derived(sortItems($notes.filter((n) => n.folderId === null)));

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

	async function handleCreateNote(folderId: string | null) {
		closeContextMenu();
		const note = addNote(undefined, undefined, folderId);
		onNoteClick?.();
		await goto(`/note/${note.id}`);
		onNoteCreate?.();
	}

	function submitNewFolder() {
		if (newFolderName.trim()) {
			const parentId = creatingFolderIn === 'root' ? null : creatingFolderIn;
			addFolder(newFolderName.trim(), parentId);
			onFolderCreate?.();
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

	// Swipe-to-delete handlers (unified for notes and folders)
	// Also supports long-press to initiate drag mode
	let swipeStartY = $state<number | null>(null);
	let swipeLongPressTimer: ReturnType<typeof setTimeout> | null = null;

	function handleSwipeStart(e: TouchEvent, item: SwipeItem) {
		// Don't start swipe if we're in drag mode
		if (touchDragActive || !item) return;

		const touch = e.touches[0];
		swipeStartX = touch.clientX;
		swipeStartY = touch.clientY;
		swipingItem = item;
		swipeCurrentX = touch.clientX;

		// Start long-press timer for drag mode
		swipeLongPressTimer = setTimeout(() => {
			if (swipingItem && swipeStartX !== null && swipeStartY !== null) {
				// Initiate drag mode
				const label = getItemLabel(swipingItem);
				startTouchDrag(
					{ type: swipingItem.type, id: swipingItem.id },
					label,
					swipeStartX,
					swipeStartY
				);
				// Don't reset swipe state - handleSwipeMove/End will check touchDragActive
				swipeLongPressTimer = null;
			}
		}, LONG_PRESS_DURATION);
	}

	function handleSwipeMove(e: TouchEvent) {
		// If in drag mode, handle drag movement
		if (touchDragActive) {
			handleTouchMove(e);
			return;
		}

		// For swipe mode, we need the start position and item
		if (swipeStartX === null || !swipingItem) return;

		const touch = e.touches[0];
		const deltaX = swipeStartX - touch.clientX;
		const deltaY = swipeStartY !== null ? Math.abs(touch.clientY - swipeStartY) : 0;

		// If moved too much, cancel long-press timer
		if (swipeLongPressTimer && (Math.abs(deltaX) > DRAG_THRESHOLD || deltaY > DRAG_THRESHOLD)) {
			clearTimeout(swipeLongPressTimer);
			swipeLongPressTimer = null;
		}

		// Only allow swiping left (deltaX > 0)
		if (deltaX > 0) {
			swipeCurrentX = touch.clientX;
			// Prevent scrolling while swiping
			e.preventDefault();
		}
	}

	function handleSwipeEnd() {
		// Clear long-press timer
		if (swipeLongPressTimer) {
			clearTimeout(swipeLongPressTimer);
			swipeLongPressTimer = null;
		}

		// If in drag mode, handle drag end
		if (touchDragActive) {
			handleTouchEnd();
			return;
		}

		if (swipeStartX === null || swipeCurrentX === null || !swipingItem) {
			resetSwipe();
			return;
		}

		const deltaX = swipeStartX - swipeCurrentX;

		// If swiped past threshold, reveal delete button
		if (deltaX >= SWIPE_THRESHOLD) {
			swipeOpenItem = swipingItem;
		} else {
			swipeOpenItem = null;
		}

		resetSwipe();
	}

	function resetSwipe() {
		swipeStartX = null;
		swipeStartY = null;
		swipeCurrentX = null;
		swipingItem = null;
	}

	function getSwipeOffset(type: 'note' | 'folder', id: string): number {
		// If this item is actively being swiped
		if (swipingItem?.type === type && swipingItem.id === id && swipeStartX !== null && swipeCurrentX !== null) {
			const deltaX = swipeStartX - swipeCurrentX;
			// Clamp between 0 and DELETE_BUTTON_WIDTH
			return Math.max(0, Math.min(deltaX, DELETE_BUTTON_WIDTH));
		}
		// If this item has delete revealed
		if (swipeOpenItem?.type === type && swipeOpenItem.id === id) {
			return DELETE_BUTTON_WIDTH;
		}
		return 0;
	}

	function isDeleting(type: 'note' | 'folder', id: string): boolean {
		return deletingItem?.type === type && deletingItem.id === id;
	}

	function requestDelete(type: 'note' | 'folder', id: string) {
		// Get the name for notification/confirmation
		let name = '';
		if (type === 'note') {
			const note = $notes.find(n => n.id === id);
			name = note?.title || 'Untitled';
		} else {
			const folder = $folders.find(f => f.id === id);
			name = folder?.name || 'Folder';
		}

		if (type === 'note') {
			// Notes don't need confirmation - delete immediately
			performDelete('note', id, name);
		} else {
			// Folders need confirmation
			confirmDeleteItem = { type, id };
			confirmDeleteName = name;
		}
	}

	function performDelete(type: 'note' | 'folder', id: string, name: string) {
		// Start the delete animation
		deletingItem = { type, id };
		swipeOpenItem = null;

		// After animation, actually delete
		setTimeout(() => {
			if (type === 'note') {
				// Navigate away if we're deleting the current note
				if (isNoteActive(id)) {
					goto('/');
				}
				deleteNote(id);
				onNoteDelete?.(name);
			} else {
				deleteFolder(id, false);
				onFolderDelete?.(name);
			}
			deletingItem = null;
		}, DELETE_ANIMATION_DURATION);
	}

	function cancelDelete() {
		confirmDeleteItem = null;
		confirmDeleteName = '';
	}

	function confirmDelete() {
		if (!confirmDeleteItem) return;

		const { type, id } = confirmDeleteItem;
		const name = confirmDeleteName;

		confirmDeleteItem = null;
		confirmDeleteName = '';

		performDelete(type, id, name);
	}

	function handleRowClick(e: MouseEvent, type: 'note' | 'folder', id: string) {
		// On desktop, clicking the right edge (last 40px) toggles delete
		const target = e.currentTarget as HTMLElement;
		const rect = target.getBoundingClientRect();
		const clickX = e.clientX - rect.left;
		const isRightEdge = clickX > rect.width - 40;

		// If delete is open for another item, close it
		if (swipeOpenItem && (swipeOpenItem.type !== type || swipeOpenItem.id !== id)) {
			swipeOpenItem = null;
		}

		// If clicking right edge on desktop, toggle delete
		if (isRightEdge && !('ontouchstart' in window)) {
			e.preventDefault();
			e.stopPropagation();
			if (swipeOpenItem?.type === type && swipeOpenItem.id === id) {
				swipeOpenItem = null;
			} else {
				swipeOpenItem = { type, id };
			}
		}
	}

	function closeSwipeDelete() {
		swipeOpenItem = null;
	}

	// Reveal current file in tree
	function revealCurrentFile() {
		const match = $page.url.pathname.match(/^\/note\/(.+)$/);
		if (!match) return;

		const noteId = match[1];
		const note = $notes.find((n) => n.id === noteId);
		if (!note) return;

		// If note is in a folder, expand all parent folders
		if (note.folderId) {
			const foldersToExpand = new Set<string>();
			let currentFolderId: string | null = note.folderId;

			while (currentFolderId) {
				foldersToExpand.add(currentFolderId);
				const folder = $folders.find((f) => f.id === currentFolderId);
				currentFolderId = folder?.parentId ?? null;
			}

			expandedFolders = new Set([...expandedFolders, ...foldersToExpand]);
		}

		// Scroll to the note element
		setTimeout(() => {
			const noteElement = document.querySelector(`a[href="/note/${noteId}"]`);
			noteElement?.scrollIntoView({ behavior: 'smooth', block: 'center' });
		}, 100);
	}

	// Collapse all folders
	function collapseAll() {
		expandedFolders = new Set();
	}

	// Get sort order tooltip
	function getSortTooltip(): string {
		switch (sortOrder) {
			case 'name-asc':
				return 'Sort: Name A-Z';
			case 'name-desc':
				return 'Sort: Name Z-A';
			case 'modified-desc':
				return 'Sort: Newest first';
			case 'modified-asc':
				return 'Sort: Oldest first';
			default:
				return 'Change sort order';
		}
	}
</script>

<svelte:window
	onclick={(e) => {
		closeContextMenu();
		// Close swipe delete if clicking outside
		if (swipeOpenItem) {
			const target = e.target as HTMLElement;
			if (!target.closest('.swipe-container')) {
				closeSwipeDelete();
			}
		}
	}}
	onkeydown={(e) => {
		// Close confirmation dialog on Escape
		if (e.key === 'Escape' && confirmDeleteItem) {
			cancelDelete();
			return;
		}
		if (e.key === 'Escape' && swipeOpenItem) {
			closeSwipeDelete();
			return;
		}
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
	<!-- Toolbar -->
	<div class="mb-3 flex items-center justify-center gap-3">
		<button
			onclick={() => handleCreateNote(null)}
			class="rounded-lg p-3 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-border)] hover:text-[var(--color-text)]"
			title="Add note"
		>
			<SquarePen class="h-6 w-6" />
		</button>
		<button
			onclick={() => handleCreateFolder(null)}
			class="rounded-lg p-3 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-border)] hover:text-[var(--color-text)]"
			title="New folder"
		>
			<FolderPlus class="h-6 w-6" />
		</button>
		<button
			onclick={cycleSortOrder}
			class="rounded-lg p-3 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-border)] hover:text-[var(--color-text)]"
			title={getSortTooltip()}
		>
			<ArrowUpNarrowWide class="h-6 w-6" />
		</button>
		<button
			onclick={revealCurrentFile}
			class="rounded-lg p-3 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-border)] hover:text-[var(--color-text)]"
			title="Reveal current file"
		>
			<AlignVerticalSpaceAround class="h-6 w-6" />
		</button>
		<button
			onclick={collapseAll}
			class="rounded-lg p-3 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-border)] hover:text-[var(--color-text)]"
			title="Collapse all"
		>
			<ChevronsDownUp class="h-6 w-6" />
		</button>
	</div>

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
		{@const folderSwipeOffset = getSwipeOffset('folder', folder.id)}

		<div class="folder-item" class:deleting={isDeleting('folder', folder.id)}>
			<!-- Folder header with swipe container -->
			<div class="swipe-container relative mb-0.5 overflow-hidden rounded-lg">
				<button
					onclick={() => requestDelete('folder', folder.id)}
					class="delete-action absolute right-0 top-0 flex h-full items-center justify-center bg-red-500 text-white transition-opacity"
					style="width: {DELETE_BUTTON_WIDTH}px; opacity: {folderSwipeOffset > 0 ? 1 : 0};"
					tabindex={folderSwipeOffset > 0 ? 0 : -1}
				>
					<Trash2 class="h-5 w-5" />
				</button>
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					class="folder-row group relative flex items-center rounded-lg bg-[var(--color-bg-secondary)] px-2 py-2 transition-transform hover:bg-[var(--color-border)]"
					class:drop-target={isDraggedOver(folder.id)}
					class:dragging={draggedItem?.type === 'folder' && draggedItem.id === folder.id}
					style="transform: translateX(-{folderSwipeOffset}px);"
					data-folder-id={folder.id}
					draggable="true"
					ondragstart={(e) => handleDragStart(e, { type: 'folder', id: folder.id })}
					ondragend={handleDragEnd}
					ondragover={(e) => { e.stopPropagation(); handleDragOver(e, folder.id); }}
					ondragleave={handleDragLeave}
					ondrop={(e) => { e.stopPropagation(); handleDrop(e, folder.id); }}
					ontouchstart={(e) => handleSwipeStart(e, { type: 'folder', id: folder.id })}
					ontouchmove={handleSwipeMove}
					ontouchend={handleSwipeEnd}
					onclick={(e) => handleRowClick(e, 'folder', folder.id)}
					oncontextmenu={(e) => handleFolderContextMenu(e, folder.id)}
					role="treeitem"
				>
					<button onclick={(e) => { e.stopPropagation(); toggleFolder(folder.id); }} class="mr-1 p-0.5 text-[var(--color-text-muted)]" aria-label="Toggle folder">
						<ChevronRight class="h-4 w-4 transition-transform {isExpanded ? 'rotate-90' : ''}" />
					</button>
					{#if isExpanded && hasContents}
						<FolderOpen class="mr-2 h-5 w-5 shrink-0 text-[var(--color-accent)]" />
					{:else}
						<Folder class="mr-2 h-5 w-5 shrink-0 text-[var(--color-accent)]" />
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
							class="flex-1 rounded bg-[var(--color-bg)] px-1 text-base text-[var(--color-text)] outline-none ring-1 ring-[var(--color-accent)]"
							autofocus
							onclick={(e) => e.stopPropagation()}
						/>
					{:else}
						<span
							class="flex-1 truncate text-base text-[var(--color-text)]"
							ondblclick={(e) => handleDoubleClick(e, 'folder', folder.id)}
						>{folder.name}</span>
					{/if}
					<span class="ml-1 text-xs text-[var(--color-text-muted)] opacity-0 group-hover:opacity-100">
						{folderNotes.length}
					</span>
				</div>
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
						{@const subfolderSwipeOffset = getSwipeOffset('folder', subfolder.id)}

						<div class="subfolder-item" class:deleting={isDeleting('folder', subfolder.id)}>
							<div class="swipe-container relative mb-0.5 overflow-hidden rounded-lg">
								<button
									onclick={() => requestDelete('folder', subfolder.id)}
									class="delete-action absolute right-0 top-0 flex h-full items-center justify-center bg-red-500 text-white transition-opacity"
									style="width: {DELETE_BUTTON_WIDTH}px; opacity: {subfolderSwipeOffset > 0 ? 1 : 0};"
									tabindex={subfolderSwipeOffset > 0 ? 0 : -1}
								>
									<Trash2 class="h-5 w-5" />
								</button>
								<!-- svelte-ignore a11y_no_static_element_interactions -->
								<div
									class="folder-row group relative flex items-center rounded-lg bg-[var(--color-bg-secondary)] px-2 py-2 transition-transform hover:bg-[var(--color-border)]"
									class:drop-target={isDraggedOver(subfolder.id)}
									class:dragging={draggedItem?.type === 'folder' && draggedItem.id === subfolder.id}
									style="transform: translateX(-{subfolderSwipeOffset}px);"
									data-folder-id={subfolder.id}
									draggable="true"
									ondragstart={(e) => handleDragStart(e, { type: 'folder', id: subfolder.id })}
									ondragend={handleDragEnd}
									ondragover={(e) => { e.stopPropagation(); handleDragOver(e, subfolder.id); }}
									ondragleave={handleDragLeave}
									ondrop={(e) => { e.stopPropagation(); handleDrop(e, subfolder.id); }}
									ontouchstart={(e) => handleSwipeStart(e, { type: 'folder', id: subfolder.id })}
									ontouchmove={handleSwipeMove}
									ontouchend={handleSwipeEnd}
									onclick={(e) => handleRowClick(e, 'folder', subfolder.id)}
									oncontextmenu={(e) => handleFolderContextMenu(e, subfolder.id)}
									role="treeitem"
								>
									<button onclick={(e) => { e.stopPropagation(); toggleFolder(subfolder.id); }} class="mr-1 p-0.5 text-[var(--color-text-muted)]" aria-label="Toggle folder">
										<ChevronRight class="h-4 w-4 transition-transform {isSubExpanded ? 'rotate-90' : ''}" />
									</button>
									{#if isSubExpanded && hasSubContents}
										<FolderOpen class="mr-2 h-5 w-5 shrink-0 text-[var(--color-accent)]" />
									{:else}
										<Folder class="mr-2 h-5 w-5 shrink-0 text-[var(--color-accent)]" />
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
											class="flex-1 rounded bg-[var(--color-bg)] px-1 text-base text-[var(--color-text)] outline-none ring-1 ring-[var(--color-accent)]"
											autofocus
											onclick={(e) => e.stopPropagation()}
										/>
									{:else}
										<span
											class="flex-1 truncate text-base text-[var(--color-text)]"
											ondblclick={(e) => handleDoubleClick(e, 'folder', subfolder.id)}
										>{subfolder.name}</span>
									{/if}
									<span class="ml-1 text-xs text-[var(--color-text-muted)] opacity-0 group-hover:opacity-100">
										{subFolderNotes.length}
									</span>
								</div>
							</div>

							<!-- Subfolder contents -->
							{#if isSubExpanded}
								<div class="ml-4 border-l border-[var(--color-border)] pl-2">
									<!-- Sub-subfolders -->
									{#each subSubfolders as subSubfolder (subSubfolder.id)}
										{@const subSubFolderNotes = $notes.filter((n) => n.folderId === subSubfolder.id)}
										{@const isSubSubExpanded = expandedFolders.has(subSubfolder.id)}
										{@const subSubfolderSwipeOffset = getSwipeOffset('folder', subSubfolder.id)}
										<div class="subfolder-item" class:deleting={isDeleting('folder', subSubfolder.id)}>
											<div class="swipe-container relative mb-0.5 overflow-hidden rounded-lg">
												<button
													onclick={() => requestDelete('folder', subSubfolder.id)}
													class="delete-action absolute right-0 top-0 flex h-full items-center justify-center bg-red-500 text-white transition-opacity"
													style="width: {DELETE_BUTTON_WIDTH}px; opacity: {subSubfolderSwipeOffset > 0 ? 1 : 0};"
													tabindex={subSubfolderSwipeOffset > 0 ? 0 : -1}
												>
													<Trash2 class="h-5 w-5" />
												</button>
												<!-- svelte-ignore a11y_no_static_element_interactions -->
												<div
													class="folder-row group relative flex items-center rounded-lg bg-[var(--color-bg-secondary)] px-2 py-2 transition-transform hover:bg-[var(--color-border)]"
													class:drop-target={isDraggedOver(subSubfolder.id)}
													class:dragging={draggedItem?.type === 'folder' && draggedItem.id === subSubfolder.id}
													style="transform: translateX(-{subSubfolderSwipeOffset}px);"
													data-folder-id={subSubfolder.id}
													draggable="true"
													ondragstart={(e) => handleDragStart(e, { type: 'folder', id: subSubfolder.id })}
													ondragend={handleDragEnd}
													ondragover={(e) => { e.stopPropagation(); handleDragOver(e, subSubfolder.id); }}
													ondragleave={handleDragLeave}
													ondrop={(e) => { e.stopPropagation(); handleDrop(e, subSubfolder.id); }}
													ontouchstart={(e) => handleSwipeStart(e, { type: 'folder', id: subSubfolder.id })}
													ontouchmove={handleSwipeMove}
													ontouchend={handleSwipeEnd}
													onclick={(e) => handleRowClick(e, 'folder', subSubfolder.id)}
													oncontextmenu={(e) => handleFolderContextMenu(e, subSubfolder.id)}
													role="treeitem"
												>
													<button onclick={(e) => { e.stopPropagation(); toggleFolder(subSubfolder.id); }} class="mr-1 p-0.5 text-[var(--color-text-muted)]" aria-label="Toggle folder">
														<ChevronRight class="h-4 w-4 transition-transform {isSubSubExpanded ? 'rotate-90' : ''}" />
													</button>
													{#if isSubSubExpanded && subSubFolderNotes.length > 0}
														<FolderOpen class="mr-2 h-5 w-5 shrink-0 text-[var(--color-accent)]" />
													{:else}
														<Folder class="mr-2 h-5 w-5 shrink-0 text-[var(--color-accent)]" />
													{/if}
													{#if renamingFolder === subSubfolder.id}
														<input
															type="text"
															bind:value={renameValue}
															onkeydown={(e) => {
																if (e.key === 'Enter') submitRename();
																if (e.key === 'Escape') cancelRename();
															}}
															onblur={submitRename}
															class="flex-1 rounded bg-[var(--color-bg)] px-1 text-base text-[var(--color-text)] outline-none ring-1 ring-[var(--color-accent)]"
															autofocus
															onclick={(e) => e.stopPropagation()}
														/>
													{:else}
														<span
															class="flex-1 truncate text-base text-[var(--color-text)]"
															ondblclick={(e) => handleDoubleClick(e, 'folder', subSubfolder.id)}
														>{subSubfolder.name}</span>
													{/if}
													<span class="ml-1 text-xs text-[var(--color-text-muted)] opacity-0 group-hover:opacity-100">
														{subSubFolderNotes.length}
													</span>
												</div>
											</div>
											{#if isSubSubExpanded}
												<div class="ml-4 border-l border-[var(--color-border)] pl-2">
													{#each subSubFolderNotes as note (note.id)}
														{@const swipeOffset = getSwipeOffset('note', note.id)}
														<div class="swipe-container relative mb-0.5 overflow-hidden rounded-lg" class:deleting={isDeleting('note', note.id)}>
															<button
																onclick={() => requestDelete('note', note.id)}
																class="delete-action absolute right-0 top-0 flex h-full items-center justify-center bg-red-500 text-white transition-opacity"
																style="width: {DELETE_BUTTON_WIDTH}px; opacity: {swipeOffset > 0 ? 1 : 0};"
																tabindex={swipeOffset > 0 ? 0 : -1}
															>
																<Trash2 class="h-5 w-5" />
															</button>
															<a
																href="/note/{note.id}"
																onclick={(e) => { handleRowClick(e, 'note', note.id); if (!(swipeOpenItem?.type === 'note' && swipeOpenItem.id === note.id)) handleNoteClick(); }}
																oncontextmenu={(e) => handleNoteContextMenu(e, note.id)}
																ontouchstart={(e) => handleSwipeStart(e, { type: 'note', id: note.id })}
																ontouchmove={handleSwipeMove}
																ontouchend={handleSwipeEnd}
																class="note-row relative flex items-center rounded-lg bg-[var(--color-bg-secondary)] px-2 py-2 transition-transform hover:bg-[var(--color-border)]"
																class:bg-[var(--color-accent)]={isNoteActive(note.id)}
																class:text-white={isNoteActive(note.id)}
																class:dragging={draggedItem?.type === 'note' && draggedItem.id === note.id}
																style="transform: translateX(-{swipeOffset}px);"
																draggable="true"
																ondragstart={(e) => handleDragStart(e, { type: 'note', id: note.id })}
																ondragend={handleDragEnd}
															>
																<FileText class="mr-2 h-5 w-5 shrink-0 {!isNoteActive(note.id) ? 'text-[var(--color-text-muted)]' : ''}" />
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
																		class="flex-1 rounded bg-[var(--color-bg)] px-1 text-base text-[var(--color-text)] outline-none ring-1 ring-[var(--color-accent)]"
																		autofocus
																	/>
																{:else}
																	<span
																		class="truncate text-base"
																		ondblclick={(e) => handleDoubleClick(e, 'note', note.id)}
																	>{note.title || 'Untitled'}</span>
																{/if}
															</a>
														</div>
													{/each}
												</div>
											{/if}
										</div>
									{/each}
									<!-- Notes in subfolder -->
									{#each subFolderNotes as note (note.id)}
										{@const swipeOffset = getSwipeOffset('note', note.id)}
										<div class="swipe-container relative mb-0.5 overflow-hidden rounded-lg" class:deleting={isDeleting('note', note.id)}>
											<button
												onclick={() => requestDelete('note', note.id)}
												class="delete-action absolute right-0 top-0 flex h-full items-center justify-center bg-red-500 text-white transition-opacity"
												style="width: {DELETE_BUTTON_WIDTH}px; opacity: {swipeOffset > 0 ? 1 : 0};"
												tabindex={swipeOffset > 0 ? 0 : -1}
											>
												<Trash2 class="h-5 w-5" />
											</button>
											<a
												href="/note/{note.id}"
												onclick={(e) => { handleRowClick(e, 'note', note.id); if (!(swipeOpenItem?.type === 'note' && swipeOpenItem.id === note.id)) handleNoteClick(); }}
												oncontextmenu={(e) => handleNoteContextMenu(e, note.id)}
												ontouchstart={(e) => handleSwipeStart(e, { type: 'note', id: note.id })}
												ontouchmove={handleSwipeMove}
												ontouchend={handleSwipeEnd}
												class="note-row relative flex items-center rounded-lg bg-[var(--color-bg-secondary)] px-2 py-2 transition-transform hover:bg-[var(--color-border)]"
												class:bg-[var(--color-accent)]={isNoteActive(note.id)}
												class:text-white={isNoteActive(note.id)}
												class:dragging={draggedItem?.type === 'note' && draggedItem.id === note.id}
												style="transform: translateX(-{swipeOffset}px);"
												draggable="true"
												ondragstart={(e) => handleDragStart(e, { type: 'note', id: note.id })}
												ondragend={handleDragEnd}
											>
												<FileText class="mr-2 h-5 w-5 shrink-0 {!isNoteActive(note.id) ? 'text-[var(--color-text-muted)]' : ''}" />
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
														class="flex-1 rounded bg-[var(--color-bg)] px-1 text-base text-[var(--color-text)] outline-none ring-1 ring-[var(--color-accent)]"
														autofocus
													/>
												{:else}
													<span
														class="truncate text-base"
														ondblclick={(e) => handleDoubleClick(e, 'note', note.id)}
													>{note.title || 'Untitled'}</span>
												{/if}
											</a>
										</div>
									{/each}
								</div>
							{/if}
						</div>
					{/each}

					<!-- Notes in this folder (after subfolders) -->
					{#each folderNotes as note (note.id)}
						{@const swipeOffset = getSwipeOffset('note', note.id)}
						<div class="swipe-container relative mb-0.5 overflow-hidden rounded-lg" class:deleting={isDeleting('note', note.id)}>
							<button
								onclick={() => requestDelete('note', note.id)}
								class="delete-action absolute right-0 top-0 flex h-full items-center justify-center bg-red-500 text-white transition-opacity"
								style="width: {DELETE_BUTTON_WIDTH}px; opacity: {swipeOffset > 0 ? 1 : 0};"
								tabindex={swipeOffset > 0 ? 0 : -1}
							>
								<Trash2 class="h-5 w-5" />
							</button>
							<a
								href="/note/{note.id}"
								onclick={(e) => { handleRowClick(e, 'note', note.id); if (!(swipeOpenItem?.type === 'note' && swipeOpenItem.id === note.id)) handleNoteClick(); }}
								oncontextmenu={(e) => handleNoteContextMenu(e, note.id)}
								ontouchstart={(e) => handleSwipeStart(e, { type: 'note', id: note.id })}
								ontouchmove={handleSwipeMove}
								ontouchend={handleSwipeEnd}
								class="note-row relative flex items-center rounded-lg bg-[var(--color-bg-secondary)] px-2 py-2 transition-transform hover:bg-[var(--color-border)]"
								class:bg-[var(--color-accent)]={isNoteActive(note.id)}
								class:text-white={isNoteActive(note.id)}
								class:dragging={draggedItem?.type === 'note' && draggedItem.id === note.id}
								style="transform: translateX(-{swipeOffset}px);"
								draggable="true"
								ondragstart={(e) => handleDragStart(e, { type: 'note', id: note.id })}
								ondragend={handleDragEnd}
							>
								<FileText class="mr-2 h-5 w-5 shrink-0 {!isNoteActive(note.id) ? 'text-[var(--color-text-muted)]' : ''}" />
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
										class="flex-1 rounded bg-[var(--color-bg)] px-1 text-base text-[var(--color-text)] outline-none ring-1 ring-[var(--color-accent)]"
										autofocus
									/>
								{:else}
									<span
										class="truncate text-base"
										ondblclick={(e) => handleDoubleClick(e, 'note', note.id)}
									>{note.title || 'Untitled'}</span>
								{/if}
							</a>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	{/each}

	<!-- Root notes (not in any folder) - shown at root level after folders -->
	{#each rootNotes as note (note.id)}
		{@const swipeOffset = getSwipeOffset('note', note.id)}
		<div class="swipe-container relative mb-0.5 overflow-hidden rounded-lg" class:deleting={isDeleting('note', note.id)}>
			<!-- Delete button (revealed on swipe) -->
			<button
				onclick={() => requestDelete('note', note.id)}
				class="delete-action absolute right-0 top-0 flex h-full items-center justify-center bg-red-500 text-white transition-opacity"
				style="width: {DELETE_BUTTON_WIDTH}px; opacity: {swipeOffset > 0 ? 1 : 0};"
				tabindex={swipeOffset > 0 ? 0 : -1}
			>
				<Trash2 class="h-5 w-5" />
			</button>
			<!-- Note row -->
			<a
				href="/note/{note.id}"
				onclick={(e) => { handleRowClick(e, 'note', note.id); if (!(swipeOpenItem?.type === 'note' && swipeOpenItem.id === note.id)) handleNoteClick(); }}
				oncontextmenu={(e) => handleNoteContextMenu(e, note.id)}
				ontouchstart={(e) => handleSwipeStart(e, { type: 'note', id: note.id })}
				ontouchmove={handleSwipeMove}
				ontouchend={handleSwipeEnd}
				class="note-row relative flex items-center rounded-lg bg-[var(--color-bg-secondary)] px-2 py-2 transition-transform hover:bg-[var(--color-border)]"
				class:bg-[var(--color-accent)]={isNoteActive(note.id)}
				class:text-white={isNoteActive(note.id)}
				class:dragging={draggedItem?.type === 'note' && draggedItem.id === note.id}
				style="transform: translateX(-{swipeOffset}px);"
				draggable="true"
				ondragstart={(e) => handleDragStart(e, { type: 'note', id: note.id })}
				ondragend={handleDragEnd}
			>
				<FileText class="mr-2 h-5 w-5 shrink-0 {!isNoteActive(note.id) ? 'text-[var(--color-text-muted)]' : ''}" />
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
						class="flex-1 rounded bg-[var(--color-bg)] px-1 text-base text-[var(--color-text)] outline-none ring-1 ring-[var(--color-accent)]"
						autofocus
					/>
				{:else}
					<span
						class="truncate text-base"
						ondblclick={(e) => handleDoubleClick(e, 'note', note.id)}
					>{note.title || 'Untitled'}</span>
				{/if}
			</a>
		</div>
	{/each}
</div>

<!-- Context Menu for Folders -->
{#if contextMenuFolder}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="animate-menu fixed z-[100] min-w-[160px] rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] py-1 shadow-lg"
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
		class="animate-menu fixed z-[100] min-w-[160px] rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] py-1 shadow-lg"
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

<!-- Delete Confirmation Dialog -->
{#if confirmDeleteItem}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4"
		onclick={cancelDelete}
	>
		<div
			class="w-full max-w-sm rounded-xl bg-[var(--color-bg)] p-5 shadow-xl"
			onclick={(e) => e.stopPropagation()}
		>
			<div class="mb-4 flex items-center gap-3">
				<div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-500/10">
					<Trash2 class="h-5 w-5 text-red-500" />
				</div>
				<div>
					<h3 class="text-base font-semibold text-[var(--color-text)]">
						Delete {confirmDeleteItem.type === 'folder' ? 'folder' : 'note'}?
					</h3>
					<p class="text-sm text-[var(--color-text-muted)]">This action cannot be undone</p>
				</div>
			</div>

			<p class="mb-4 rounded-lg bg-[var(--color-bg-secondary)] px-3 py-2 text-sm text-[var(--color-text)]">
				"{confirmDeleteName}"
			</p>

			{#if confirmDeleteItem.type === 'folder'}
				<p class="mb-4 text-xs text-[var(--color-text-muted)]">
					Contents will be moved to the parent folder.
				</p>
			{/if}

			<div class="flex gap-3">
				<button
					onclick={cancelDelete}
					class="flex-1 rounded-lg border border-[var(--color-border)] px-4 py-2.5 text-sm font-medium text-[var(--color-text)] transition-colors hover:bg-[var(--color-bg-secondary)]"
				>
					Cancel
				</button>
				<button
					onclick={confirmDelete}
					class="flex-1 rounded-lg bg-red-500 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-red-600"
				>
					Delete
				</button>
			</div>
		</div>
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

	/* Swipe-to-delete styles */
	.swipe-container {
		touch-action: pan-y;
	}

	.note-row,
	.folder-row {
		will-change: transform;
		transition: transform 0.2s ease-out;
	}

	.delete-action {
		transition: opacity 0.15s ease-out;
	}

	/* Delete animation */
	.deleting {
		animation: deleteSlide 0.25s ease-out forwards;
	}

	.folder-item.deleting,
	.subfolder-item.deleting {
		animation: deleteSlide 0.25s ease-out forwards;
	}

	@keyframes deleteSlide {
		0% {
			opacity: 1;
			max-height: 100px;
			margin-bottom: 0.125rem;
			transform: translateX(0);
		}
		50% {
			opacity: 0;
			transform: translateX(-20px);
		}
		100% {
			opacity: 0;
			max-height: 0;
			margin-bottom: 0;
			padding: 0;
			overflow: hidden;
		}
	}

	/* Desktop: show a subtle hint on the right edge */
	@media (hover: hover) {
		.swipe-container:hover .note-row::after,
		.swipe-container:hover .folder-row::after {
			content: '';
			position: absolute;
			right: 0;
			top: 0;
			bottom: 0;
			width: 4px;
			background: linear-gradient(to left, rgba(239, 68, 68, 0.3), transparent);
			border-radius: 0 0.5rem 0.5rem 0;
			pointer-events: none;
		}
	}
</style>
