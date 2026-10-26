<script lang="ts">
	import { autofocus } from '$lib/actions/autofocus';
	import { portal } from '$lib/actions/portal';
	import VaultIcon from './VaultIcon.svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { currentRoutePath } from '$lib/hash-router';
	import {
		folders,
		memoryObjects,
		addFolder,
		addMemoryObject,
		deleteFolder,
		deleteMemoryObject,
		restoreMemoryObject,
		restoreFolder,
		updateFolder,
		updateMemoryObject,
		moveMemoryObjectToFolder,
		moveFolderToFolder,
		vaults,
		currentVaultId,
		moveMemoryObjectToVault,
		moveFolderToVault
	} from '$lib/db';
	import {
		ChevronRight,
		Folder,
		FolderOpen,
		FolderPlus,
		FilePlus,
		NotebookText,
		Pencil,
		Trash2,
		FolderInput,
		FolderSymlink,
		SquarePen,
		ArrowUpNarrowWide,
		AlignVerticalSpaceAround,
		ChevronsDownUp,
		MoreHorizontal,
		Plus,
		Link2
	} from 'lucide-svelte';
	import { pushUndo } from '$lib/stores/undo';

	type Props = {
		onNoteClick?: () => void;
		onNoteCreate?: () => void;
		onNewNoteInFolder?: (folderId: string | null) => void;
		onFolderCreate?: () => void;
		onNoteDelete?: (name: string) => void;
		onFolderDelete?: (name: string) => void;
	};

	let { onNoteClick, onNoteCreate, onNewNoteInFolder, onFolderCreate, onNoteDelete, onFolderDelete }: Props = $props();

	// Track which folders are expanded
	let expandedFolders = $state<Set<string>>(new Set());

	// Track currently selected folder (for creating notes/folders inside it)
	let selectedFolderId = $state<string | null>(null);

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

	// Sort function — works for both Folder ({name, modified}) and MemoryObject ({title, updatedAt})
	type Sortable = { name?: string; title?: string; modified?: number; updatedAt?: number };
	function sortItems<T extends Sortable>(items: T[]): T[] {
		const getName = (item: T): string => item.name ?? item.title ?? '';
		const getTime = (item: T): number => item.updatedAt ?? item.modified ?? 0;
		return [...items].sort((a, b) => {
			switch (sortOrder) {
				case 'name-asc':
					return getName(a).localeCompare(getName(b));
				case 'name-desc':
					return getName(b).localeCompare(getName(a));
				case 'modified-desc':
					return getTime(b) - getTime(a);
				case 'modified-asc':
					return getTime(a) - getTime(b);
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

	// Get root folders and memories (must depend on reactive stores)
	let rootFolders = $derived(sortItems($folders.filter((f) => f.parentId === null)));
	let rootMemories = $derived(sortItems($memoryObjects.filter((m) => m.folderId === null)));

	function toggleFolder(folderId: string) {
		const newSet = new Set(expandedFolders);
		if (newSet.has(folderId)) {
			newSet.delete(folderId);
			// Deselect if collapsing the selected folder
			if (selectedFolderId === folderId) {
				selectedFolderId = null;
			}
		} else {
			newSet.add(folderId);
			// Select the folder when expanding
			selectedFolderId = folderId;
		}
		expandedFolders = newSet;
	}

	function selectFolder(folderId: string) {
		selectedFolderId = folderId;
		// Also expand the folder
		if (!expandedFolders.has(folderId)) {
			expandedFolders = new Set([...expandedFolders, folderId]);
		}
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

	// Hover "⋯" buttons open the same menu as right-click, anchored below
	// the button instead of the pointer.
	function openRowMenu(e: MouseEvent, type: 'note' | 'folder', id: string) {
		e.preventDefault();
		e.stopPropagation();
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		contextMenuNote = type === 'note' ? id : null;
		contextMenuFolder = type === 'folder' ? id : null;
		showVaultSubmenu = false;
		contextMenuPosition = { x: rect.left, y: rect.bottom + 4 };
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
		// Delegate to the layout's template chooser if available;
		// otherwise fall back to creating a blank note directly.
		if (onNewNoteInFolder) {
			onNewNoteInFolder(folderId);
		} else {
			const memory = addMemoryObject(undefined, undefined, folderId);
			onNoteClick?.();
			goto(`/memory/${memory.id}`);
			onNoteCreate?.();
		}
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
		const memory = $memoryObjects.find((m) => m.id === noteId);
		if (memory) {
			renamingNote = noteId;
			renameValue = memory.title || '';
		}
	}

	function submitNoteRename() {
		if (renamingNote) {
			updateMemoryObject(renamingNote, { title: renameValue.trim() || 'Untitled' });
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

	// Keep popup menus fully on screen (e.g. when opened near the bottom).
	function keepInViewport(node: HTMLElement) {
		const rect = node.getBoundingClientRect();
		const margin = 8;
		if (rect.bottom > window.innerHeight - margin) {
			node.style.top = `${Math.max(margin, window.innerHeight - rect.height - margin)}px`;
		}
		if (rect.right > window.innerWidth - margin) {
			node.style.left = `${Math.max(margin, window.innerWidth - rect.width - margin)}px`;
		}
	}

	// Copy a [[wikilink]] to the note so it can be pasted into another note.
	function copyNoteLink(noteId: string) {
		const memory = $memoryObjects.find((m) => m.id === noteId);
		closeContextMenu();
		if (!memory) return;
		void navigator.clipboard?.writeText(`[[${memory.title || 'Untitled'}]]`);
	}

	function handleMoveNoteToRoot() {
		if (contextMenuNote) {
			moveMemoryObjectToFolder(contextMenuNote, null);
		}
		closeContextMenu();
	}

	let currentPath = $derived(currentRoutePath($page.route.id, $page.params, $page.url.pathname));

	function isNoteActive(noteId: string): boolean {
		return currentPath === `/memory/${noteId}`;
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
			moveMemoryObjectToFolder(draggedItem.id, targetFolderId);
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
				moveMemoryObjectToFolder(draggedItem.id, targetFolderId);
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
			const memory = $memoryObjects.find((m) => m.id === item.id);
			return memory?.title || 'Untitled';
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
			const memory = $memoryObjects.find((m) => m.id === id);
			name = memory?.title || 'Untitled';
		} else {
			const folder = $folders.find((f) => f.id === id);
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
				deleteMemoryObject(id);
				onNoteDelete?.(name);
				// Cmd+Z restores the memory from trash directly, without
				// needing to visit /trash.
				pushUndo({
					label: `Moved "${name}" to trash`,
					undo: () => restoreMemoryObject(id)
				});
			} else {
				deleteFolder(id, false);
				onFolderDelete?.(name);
				pushUndo({
					label: `Moved "${name}" folder to trash`,
					undo: () => restoreFolder(id, true)
				});
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
			return;
		}

		// Clicking a folder row toggles it open/closed
		if (type === 'folder') {
			toggleFolder(id);
		} else {
			// When clicking a memory, select its parent folder (or deselect if at root)
			const memory = $memoryObjects.find((m) => m.id === id);
			selectedFolderId = memory?.folderId ?? null;
		}
	}

	function closeSwipeDelete() {
		swipeOpenItem = null;
	}

	// Reveal current file in tree
	function revealCurrentFile() {
		const match = currentPath.match(/^\/memory\/(.+)$/);
		if (!match) return;

		const memoryId = match[1];
		const memory = $memoryObjects.find((m) => m.id === memoryId);
		if (!memory) return;

		// If memory is in a folder, expand all parent folders
		if (memory.folderId) {
			const foldersToExpand = new Set<string>();
			let currentFolderId: string | null = memory.folderId;

			while (currentFolderId) {
				foldersToExpand.add(currentFolderId);
				const folder = $folders.find((f) => f.id === currentFolderId);
				currentFolderId = folder?.parentId ?? null;
			}

			expandedFolders = new Set([...expandedFolders, ...foldersToExpand]);
		}

		// Scroll to the memory element
		setTimeout(() => {
			const noteElement = document.querySelector(`a[href="/memory/${memoryId}"]`);
			noteElement?.scrollIntoView({ behavior: 'smooth', block: 'center' });
		}, 100);
	}

	// Keep the open note visible in the tree: expand its ancestors whenever
	// the route changes (e.g. after opening a note from search or a link).
	let lastRevealedId: string | null = null;
	$effect(() => {
		const match = currentPath.match(/^\/memory\/(.+)$/);
		const memoryId = match?.[1] ?? null;
		if (!memoryId || memoryId === lastRevealedId) return;
		const memory = $memoryObjects.find((m) => m.id === memoryId);
		if (!memory) return;
		lastRevealedId = memoryId;
		const missing: string[] = [];
		let folderId: string | null = memory.folderId;
		while (folderId) {
			if (!expandedFolders.has(folderId)) missing.push(folderId);
			folderId = $folders.find((f) => f.id === folderId)?.parentId ?? null;
		}
		if (missing.length > 0) expandedFolders = new Set([...expandedFolders, ...missing]);
	});

	// Collapse all folders
	function collapseAll() {
		expandedFolders = new Set();
		selectedFolderId = null;
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
			const match = currentPath.match(/^\/memory\/(.+)$/);
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
	tabindex="-1"
>
	<!-- Section header -->
	<div class="group/tree mb-0.5 flex items-center gap-0.5 pl-2 pr-0.5">
		<span class="flex-1 text-[0.6875rem] font-semibold tracking-[0.02em] text-[var(--color-text-faint)]">Notes</span>
		<div class="flex items-center opacity-60 transition-opacity group-hover/tree:opacity-100 focus-within:opacity-100">
			<button
				onclick={() => handleCreateNote(selectedFolderId)}
				class="k-icon-btn !h-6 !w-6"
				title={selectedFolderId ? `New note in ${$folders.find(f => f.id === selectedFolderId)?.name}` : 'New note'}
				aria-label="New note"
			>
				<SquarePen class="h-3.5 w-3.5" />
			</button>
			<button
				onclick={() => handleCreateFolder(selectedFolderId)}
				class="k-icon-btn !h-6 !w-6"
				title={selectedFolderId ? `New folder in ${$folders.find(f => f.id === selectedFolderId)?.name}` : 'New folder'}
				aria-label="New folder"
			>
				<FolderPlus class="h-3.5 w-3.5" />
			</button>
			<button onclick={cycleSortOrder} class="k-icon-btn !h-6 !w-6" title={getSortTooltip()} aria-label={getSortTooltip()}>
				<ArrowUpNarrowWide class="h-3.5 w-3.5" />
			</button>
			<button onclick={revealCurrentFile} class="k-icon-btn !h-6 !w-6" title="Reveal current note" aria-label="Reveal current note">
				<AlignVerticalSpaceAround class="h-3.5 w-3.5" />
			</button>
			<button onclick={collapseAll} class="k-icon-btn !h-6 !w-6" title="Collapse all" aria-label="Collapse all folders">
				<ChevronsDownUp class="h-3.5 w-3.5" />
			</button>
		</div>
	</div>

	<!-- New folder input at root -->
	{#if creatingFolderIn === 'root'}
		<div class="tree-row bg-[var(--color-hover)]">
			<span class="tree-chevron"></span>
			<Folder class="tree-icon text-[var(--color-text-muted)]" />
						<input
				type="text"
				bind:value={newFolderName}
				onkeydown={(e) => {
					if (e.key === 'Enter') submitNewFolder();
					if (e.key === 'Escape') cancelNewFolder();
				}}
				onblur={submitNewFolder}
				placeholder="Folder name"
				class="w-full bg-transparent text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-faint)]"
				use:autofocus
			/>
		</div>
	{/if}

	<!-- Recursive folder snippet for unlimited nesting -->
	{#snippet renderFolder(folder: typeof $folders[0])}
		{@const subfolders = sortItems($folders.filter((f) => f.parentId === folder.id))}
		{@const folderMemories = sortItems($memoryObjects.filter((m) => m.folderId === folder.id))}
		{@const isExpanded = expandedFolders.has(folder.id)}
		{@const hasContents = subfolders.length > 0 || folderMemories.length > 0}
		{@const folderSwipeOffset = getSwipeOffset('folder', folder.id)}
		{@const isSelected = selectedFolderId === folder.id}

		<div class="folder-item" class:deleting={isDeleting('folder', folder.id)}>
			<!-- Folder header with swipe container -->
			<div class="swipe-container relative overflow-hidden rounded-[var(--radius-sm)]">
				<button
					onclick={() => requestDelete('folder', folder.id)}
					class="delete-action absolute right-0 top-0 flex h-full items-center justify-center bg-red-500 text-white transition-opacity"
					style="width: {DELETE_BUTTON_WIDTH}px; opacity: {folderSwipeOffset > 0 ? 1 : 0};"
					tabindex={folderSwipeOffset > 0 ? 0 : -1}
				>
					<Trash2 class="h-4 w-4" />
				</button>
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<div
					class="folder-row tree-row group"
					class:drop-target={isDraggedOver(folder.id)}
					class:dragging={draggedItem?.type === 'folder' && draggedItem.id === folder.id}
					class:selected={isSelected}
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
					aria-selected={isSelected}
					tabindex="-1"
				>
					<button
						onclick={(e) => { e.stopPropagation(); toggleFolder(folder.id); }}
						class="tree-chevron"
						aria-label={isExpanded ? 'Collapse folder' : 'Expand folder'}
						aria-expanded={isExpanded}
						tabindex="-1"
					>
						<ChevronRight class="h-3 w-3 transition-transform duration-150 {isExpanded ? 'rotate-90' : ''}" />
					</button>
					{#if isExpanded && hasContents}
						<FolderOpen class="tree-icon text-[var(--color-text-muted)]" />
					{:else}
						<Folder class="tree-icon text-[var(--color-text-muted)]" />
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
							class="min-w-0 flex-1 bg-transparent text-[var(--color-text)] outline-none"
							use:autofocus
							onclick={(e) => e.stopPropagation()}
						/>
					{:else}
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<span
							class="min-w-0 flex-1 truncate"
							ondblclick={(e) => handleDoubleClick(e, 'folder', folder.id)}
							role="button"
							tabindex="-1"
						>{folder.name}</span>
					{/if}
					<span class="row-actions">
						<button
							class="row-action"
							onclick={(e) => { e.stopPropagation(); handleCreateNote(folder.id); }}
							title="New note in {folder.name}"
							aria-label="New note in {folder.name}"
							tabindex="-1"
						>
							<Plus class="h-3.5 w-3.5" />
						</button>
						<button
							class="row-action"
							onclick={(e) => openRowMenu(e, 'folder', folder.id)}
							title="More"
							aria-label="Folder actions"
							tabindex="-1"
						>
							<MoreHorizontal class="h-3.5 w-3.5" />
						</button>
					</span>
				</div>
			</div>

			<!-- Folder contents -->
			{#if isExpanded}
				<div class="tree-children">
					<!-- New folder input inside this folder -->
					{#if creatingFolderIn === folder.id}
						<div class="tree-row bg-[var(--color-hover)]">
							<span class="tree-chevron"></span>
							<Folder class="tree-icon text-[var(--color-text-muted)]" />
														<input
								type="text"
								bind:value={newFolderName}
								onkeydown={(e) => {
									if (e.key === 'Enter') submitNewFolder();
									if (e.key === 'Escape') cancelNewFolder();
								}}
								onblur={submitNewFolder}
								placeholder="Folder name"
								class="w-full bg-transparent text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-faint)]"
								use:autofocus
							/>
						</div>
					{/if}

					<!-- Subfolders first (recursive) -->
					{#each subfolders as subfolder (subfolder.id)}
						{@render renderFolder(subfolder)}
					{/each}

					<!-- Memories in this folder (after subfolders) -->
					{#each folderMemories as memory (memory.id)}
						{@render renderNote(memory)}
					{/each}
				</div>
			{/if}
		</div>
	{/snippet}

	<!-- Memory snippet for reuse -->
	{#snippet renderNote(memory: typeof $memoryObjects[0])}
		{@const swipeOffset = getSwipeOffset('note', memory.id)}
		<div class="swipe-container relative overflow-hidden rounded-[var(--radius-sm)]" class:deleting={isDeleting('note', memory.id)}>
			<button
				onclick={() => requestDelete('note', memory.id)}
				class="delete-action absolute right-0 top-0 flex h-full items-center justify-center bg-red-500 text-white transition-opacity"
				style="width: {DELETE_BUTTON_WIDTH}px; opacity: {swipeOffset > 0 ? 1 : 0};"
				tabindex={swipeOffset > 0 ? 0 : -1}
			>
				<Trash2 class="h-5 w-5" />
			</button>
			<a
				href="/memory/{memory.id}"
				onclick={(e) => { handleRowClick(e, 'note', memory.id); if (!(swipeOpenItem?.type === 'note' && swipeOpenItem.id === memory.id)) handleNoteClick(); }}
				oncontextmenu={(e) => handleNoteContextMenu(e, memory.id)}
				ontouchstart={(e) => handleSwipeStart(e, { type: 'note', id: memory.id })}
				ontouchmove={handleSwipeMove}
				ontouchend={handleSwipeEnd}
				class="note-row tree-row"
				class:tree-row-active={isNoteActive(memory.id)}
				aria-current={isNoteActive(memory.id) ? 'page' : undefined}
				class:dragging={draggedItem?.type === 'note' && draggedItem.id === memory.id}
				style="transform: translateX(-{swipeOffset}px);"
				draggable="true"
				ondragstart={(e) => handleDragStart(e, { type: 'note', id: memory.id })}
				ondragend={handleDragEnd}
			>
				<span class="tree-chevron" aria-hidden="true"></span>
				<NotebookText class="tree-icon" />
				{#if renamingNote === memory.id}
										<input
						type="text"
						bind:value={renameValue}
						onkeydown={(e) => {
							if (e.key === 'Enter') submitNoteRename();
							if (e.key === 'Escape') cancelRename();
						}}
						onblur={submitNoteRename}
						onclick={(e) => e.preventDefault()}
						class="min-w-0 flex-1 bg-transparent text-[var(--color-text)] outline-none"
						use:autofocus
					/>
				{:else}
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<span
						class="min-w-0 flex-1 truncate"
						ondblclick={(e) => handleDoubleClick(e, 'note', memory.id)}
						role="button"
						tabindex="-1"
					>{memory.title || 'Untitled'}</span>
					<span class="row-actions">
						<button
							class="row-action"
							onclick={(e) => openRowMenu(e, 'note', memory.id)}
							title="More"
							aria-label="Note actions"
							tabindex="-1"
						>
							<MoreHorizontal class="h-3.5 w-3.5" />
						</button>
					</span>
				{/if}
			</a>
		</div>
	{/snippet}

	<!-- Root level: folders first, then memories -->
	{#each rootFolders as folder (folder.id)}
		{@render renderFolder(folder)}
	{/each}

	<!-- Root memories (not in any folder) - shown at root level after folders -->
	{#each rootMemories as memory (memory.id)}
		{@render renderNote(memory)}
	{/each}
</div>

<!-- Context Menu for Folders -->
{#if contextMenuFolder}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		use:portal
		class="k-menu fixed z-[100]"
		style="left: {contextMenuPosition.x}px; top: {contextMenuPosition.y}px;"
		use:keepInViewport
		onclick={(e) => e.stopPropagation()}
		role="menu"
		tabindex="-1"
	>
		<button
			onclick={() => handleCreateNote(contextMenuFolder)}
			class="k-menu-item"
		>
			<FilePlus class="h-4 w-4" />
			New Note
		</button>
		<button
			onclick={() => handleCreateFolder(contextMenuFolder)}
			class="k-menu-item"
		>
			<FolderPlus class="h-4 w-4" />
			New Subfolder
		</button>
		<div class="k-menu-sep"></div>
		<button
			onclick={() => handleRenameFolder(contextMenuFolder!)}
			class="k-menu-item"
		>
			<Pencil class="h-4 w-4" />
			Rename
		</button>
		<button
			onclick={() => handleDeleteFolder(contextMenuFolder!)}
			class="k-menu-item danger"
		>
			<Trash2 class="h-4 w-4" />
			Delete
		</button>
		{#if $vaults.length > 1}
			<div class="k-menu-sep"></div>
			<div class="relative">
				<button
					onclick={() => (showVaultSubmenu = !showVaultSubmenu)}
					class="k-menu-item justify-between"
				>
					<div class="flex items-center gap-2">
						<FolderInput class="h-4 w-4" />
						Move to Vault
					</div>
					<ChevronRight class="h-4 w-4" />
				</button>
				{#if showVaultSubmenu}
					<div class="k-menu absolute left-full top-0 ml-1 !min-w-[140px]">
						{#each $vaults.filter((v) => v.id !== $currentVaultId) as vault (vault.id)}
							<button
								onclick={() => {
									moveFolderToVault(contextMenuFolder!, vault.id);
									closeContextMenu();
								}}
								class="k-menu-item"
							>
								<VaultIcon {vault} class="h-4 w-4 text-[var(--color-text-muted)]" />
								<span class="truncate">{vault.name}</span>
							</button>
						{/each}
					</div>
				{/if}
			</div>
		{/if}
	</div>
{/if}

<!-- Context Menu for Memories -->
{#if contextMenuNote}
	{@const memory = $memoryObjects.find((m) => m.id === contextMenuNote)}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		use:portal
		class="k-menu fixed z-[100]"
		style="left: {contextMenuPosition.x}px; top: {contextMenuPosition.y}px;"
		use:keepInViewport
		onclick={(e) => e.stopPropagation()}
		role="menu"
		tabindex="-1"
	>
		<button onclick={() => handleRenameNote(contextMenuNote!)} class="k-menu-item">
			<Pencil class="h-4 w-4" />
			Rename
		</button>
		<button onclick={() => copyNoteLink(contextMenuNote!)} class="k-menu-item">
			<Link2 class="h-4 w-4" />
			Copy [[link]]
		</button>
		{#if memory?.folderId}
			<button
				onclick={handleMoveNoteToRoot}
				class="k-menu-item"
			>
				<FolderSymlink class="h-4 w-4" />
				Move to Root
			</button>
		{/if}
		{#if $vaults.length > 1}
			<div class="relative">
				<button
					onclick={() => (showVaultSubmenu = !showVaultSubmenu)}
					class="k-menu-item justify-between"
				>
					<div class="flex items-center gap-2">
						<FolderInput class="h-4 w-4" />
						Move to Vault
					</div>
					<ChevronRight class="h-4 w-4" />
				</button>
				{#if showVaultSubmenu}
					<div class="k-menu absolute left-full top-0 ml-1 !min-w-[140px]">
						{#each $vaults.filter((v) => v.id !== $currentVaultId) as vault (vault.id)}
							<button
								onclick={() => {
									moveMemoryObjectToVault(contextMenuNote!, vault.id);
									closeContextMenu();
								}}
								class="k-menu-item"
							>
								<VaultIcon {vault} class="h-4 w-4 text-[var(--color-text-muted)]" />
								<span class="truncate">{vault.name}</span>
							</button>
						{/each}
					</div>
				{/if}
			</div>
		{/if}
		<div class="k-menu-sep"></div>
		<button
			onclick={() => { const id = contextMenuNote!; closeContextMenu(); requestDelete('note', id); }}
			class="k-menu-item danger"
		>
			<Trash2 class="h-4 w-4" />
			Move to trash
		</button>
	</div>
{/if}

<!-- Delete Confirmation Dialog -->
{#if confirmDeleteItem}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		use:portal
		class="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 backdrop-blur-[2px] p-4"
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
		border-radius: var(--radius-sm);
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

	/* Selected folder indicator */
	.folder-row.selected {
		color: var(--color-text);
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

	.folder-item.deleting {
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

	/* Tree rows */
	.tree-row {
		position: relative;
		display: flex;
		align-items: center;
		gap: 0.25rem;
		min-height: 1.75rem;
		padding: 0 0.375rem 0 0.125rem;
		border-radius: var(--radius-sm);
		font-size: 0.8125rem;
		color: var(--color-text-muted);
		text-decoration: none;
		background: var(--color-bg-secondary);
	}

	.tree-row:hover {
		background: color-mix(in srgb, var(--color-text) 6%, var(--color-bg-secondary));
		color: var(--color-text);
	}

	.tree-row-active,
	.tree-row-active:hover {
		background: color-mix(in srgb, var(--color-text) 10%, var(--color-bg-secondary));
		color: var(--color-text);
		font-weight: 500;
	}

	.tree-row :global(.tree-icon) {
		width: 0.9375rem;
		height: 0.9375rem;
		flex-shrink: 0;
		margin-right: 0.25rem;
		opacity: 0.8;
	}

	.tree-chevron {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1rem;
		height: 1rem;
		flex-shrink: 0;
		border-radius: 0.25rem;
		color: var(--color-text-faint);
		min-width: 0;
		min-height: 0;
	}

	button.tree-chevron:hover {
		background: var(--color-active);
		color: var(--color-text);
	}

	/* Hover actions on rows (Notion-style); hidden on touch, where swipe and
	   long-press already cover them */
	.row-actions {
		display: none;
		align-items: center;
		gap: 0.0625rem;
		margin-left: auto;
		flex-shrink: 0;
	}

	@media (hover: hover) {
		.tree-row:hover .row-actions {
			display: flex;
		}
	}

	.row-action {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.25rem;
		height: 1.25rem;
		border-radius: 0.25rem;
		color: var(--color-text-muted);
	}

	.row-action:hover {
		background: var(--color-active);
		color: var(--color-text);
	}

	.tree-children {
		position: relative;
		margin-left: 0.625rem;
		padding-left: 0.375rem;
		border-left: 1px solid transparent;
	}

	.folder-tree:hover .tree-children {
		border-left-color: var(--color-border);
	}

	@media (hover: none) and (pointer: coarse) {
		.tree-row {
			min-height: 2.5rem;
			font-size: 0.9375rem;
		}
	}
</style>
