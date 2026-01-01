<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { get } from 'svelte/store';
	import { notes, folders, extractWikilinks, type Note, type Folder } from '$lib/db';
	import { goto } from '$app/navigation';
	import ForceGraph from 'force-graph';
	import { Search, X, XCircle, ArrowRight } from 'lucide-svelte';

	interface Props {
		highlightNoteId?: string;
	}

	let { highlightNoteId }: Props = $props();

	let containerRef: HTMLDivElement;
	let graph: ReturnType<typeof ForceGraph> | null = null;

	// Store subscriptions for Svelte 5 runes mode
	let notesData = $state<Note[]>([]);
	let foldersData = $state<Folder[]>([]);
	let mounted = $state(false);

	// Subscribe to stores and update state
	$effect(() => {
		const unsubNotes = notes.subscribe((n) => {
			notesData = n;
		});
		const unsubFolders = folders.subscribe((f) => {
			foldersData = f;
		});
		return () => {
			unsubNotes();
			unsubFolders();
		};
	});

	// Popup state (only shown on click)
	let selectedNode = $state<GraphNode | null>(null);
	let popupPosition = $state<{ x: number; y: number }>({ x: 0, y: 0 });

	// Popup drag state
	let isDraggingPopup = $state(false);
	let dragOffset = $state<{ x: number; y: number }>({ x: 0, y: 0 });

	function handlePopupDragStart(e: MouseEvent) {
		if ((e.target as HTMLElement).closest('button')) return; // Don't drag when clicking buttons
		isDraggingPopup = true;
		dragOffset = {
			x: e.clientX - popupPosition.x,
			y: e.clientY - popupPosition.y
		};
		e.preventDefault();
	}

	function handlePopupTouchStart(e: TouchEvent) {
		if ((e.target as HTMLElement).closest('button')) return;
		if (e.touches.length !== 1) return;
		isDraggingPopup = true;
		const touch = e.touches[0];
		dragOffset = {
			x: touch.clientX - popupPosition.x,
			y: touch.clientY - popupPosition.y
		};
	}

	function handlePopupDrag(e: MouseEvent) {
		if (!isDraggingPopup) return;
		popupPosition = {
			x: e.clientX - dragOffset.x,
			y: e.clientY - dragOffset.y
		};
	}

	function handlePopupTouchMove(e: TouchEvent) {
		if (!isDraggingPopup) return;
		if (e.touches.length !== 1) return;
		const touch = e.touches[0];
		popupPosition = {
			x: touch.clientX - dragOffset.x,
			y: touch.clientY - dragOffset.y
		};
		e.preventDefault(); // Prevent scrolling while dragging
	}

	function handlePopupDragEnd() {
		isDraggingPopup = false;
	}

	// Search/filter state
	let searchQuery = $state('');
	let filterMode = $state<'highlight' | 'filter'>('highlight');
	let showSearch = $state(false);
	let searchInputRef: HTMLInputElement;

	interface GraphNode {
		id: string;
		name: string;
		val: number;
		color?: string;
		// Extended metadata
		content: string;
		folderId: string | null;
		created: number;
		modified: number;
		linkCount: number;
		backlinkCount: number;
		// Added by force-graph dynamically
		x?: number;
		y?: number;
	}

	interface GraphLink {
		source: string;
		target: string;
	}

	function buildGraphData(): { nodes: GraphNode[]; links: GraphLink[] } {
		const allNotes = notesData;
		// Map note titles (trimmed and lowercased) to their IDs for link matching
		const noteMap = new Map(allNotes.map((n) => [n.title.trim().toLowerCase(), n.id]));
		const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

		// Calculate backlinks for each note
		const backlinkCounts = new Map<string, number>();
		for (const note of allNotes) {
			const wikilinks = extractWikilinks(note.content);
			for (const link of wikilinks) {
				const targetId = noteMap.get(link.trim().toLowerCase());
				if (targetId) {
					backlinkCounts.set(targetId, (backlinkCounts.get(targetId) || 0) + 1);
				}
			}
		}

		const nodes: GraphNode[] = allNotes.map((note) => {
			const linkCount = extractWikilinks(note.content).length;
			const backlinkCount = backlinkCounts.get(note.id) || 0;
			// Color by folder, with special highlight for the current note
			const folderColor = getFolderColor(note.folderId, isDark);
			return {
				id: note.id,
				name: note.title || 'Untitled',
				val: Math.max(2, linkCount + backlinkCount + 1),
				color: note.id === highlightNoteId ? '#818cf8' : folderColor,
				content: note.content,
				folderId: note.folderId,
				created: note.created,
				modified: note.modified,
				linkCount,
				backlinkCount
			};
		});

		const links: GraphLink[] = [];
		for (const note of allNotes) {
			const wikilinks = extractWikilinks(note.content);
			for (const link of wikilinks) {
				// Trim and lowercase to match against noteMap
				const targetId = noteMap.get(link.trim().toLowerCase());
				if (targetId && targetId !== note.id) {
					links.push({ source: note.id, target: targetId });
				}
			}
		}

		return { nodes, links };
	}

	function getFolderName(folderId: string | null): string {
		if (!folderId) return 'No folder';
		const folder = foldersData.find((f) => f.id === folderId);
		return folder?.name || 'Unknown';
	}

	// Generate a consistent color for a folder based on its ID
	const folderColorCache = new Map<string, { h: number; s: number; l: number }>();
	function getFolderHSL(folderId: string | null, isDark: boolean): { h: number; s: number; l: number } {
		if (!folderId) {
			// Notes without folder get a neutral gray
			return { h: 220, s: 10, l: isDark ? 50 : 55 };
		}

		const cacheKey = `${folderId}-${isDark}`;
		if (folderColorCache.has(cacheKey)) {
			return folderColorCache.get(cacheKey)!;
		}

		// Hash the folder ID to get a consistent hue (0-360)
		let hash = 0;
		for (let i = 0; i < folderId.length; i++) {
			hash = folderId.charCodeAt(i) + ((hash << 5) - hash);
		}
		const hue = Math.abs(hash) % 360;

		const hsl = {
			h: hue,
			s: isDark ? 65 : 55,
			l: isDark ? 65 : 45
		};

		folderColorCache.set(cacheKey, hsl);
		return hsl;
	}

	function getFolderColor(folderId: string | null, isDark: boolean, alpha: number = 1): string {
		const { h, s, l } = getFolderHSL(folderId, isDark);
		if (alpha < 1) {
			return `hsla(${h}, ${s}%, ${l}%, ${alpha})`;
		}
		return `hsl(${h}, ${s}%, ${l}%)`;
	}

	function formatDate(timestamp: number): string {
		return new Date(timestamp).toLocaleDateString('en-US', {
			month: 'short',
			day: 'numeric',
			year: 'numeric'
		});
	}

	function getWordCount(content: string): number {
		return content.trim().split(/\s+/).filter(Boolean).length;
	}

	function getPreviewText(content: string, maxLength: number = 120): string {
		let text = content
			// Remove HTML tags
			.replace(/<[^>]+>/g, ' ')
			// Remove markdown headings (# ## ### etc)
			.replace(/^#{1,6}\s+/gm, '')
			// Remove markdown links [text](url)
			.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
			// Remove raw URLs
			.replace(/https?:\/\/[^\s]+/g, '')
			// Remove wikilinks [[text]]
			.replace(/\[\[([^\]]+)\]\]/g, '$1')
			// Clean up @mentions (keep the name)
			.replace(/@(\w+)/g, '@$1')
			// Clean up //dates (keep the date)
			.replace(/\/\/(\d{4}-\d{2}-\d{2})/g, '$1')
			// Remove standalone # that aren't tags
			.replace(/(?<!\S)#+(?!\w)/g, '')
			// Collapse multiple whitespace/newlines
			.replace(/\s+/g, ' ')
			.trim();

		if (text.length > maxLength) {
			text = text.slice(0, maxLength).trim() + '...';
		}

		return text || 'No content';
	}

	function initGraph() {
		if (!containerRef || graph) return;

		const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
		const accentColor = getComputedStyle(document.documentElement)
			.getPropertyValue('--color-accent')
			.trim() || '#818cf8';
		const { nodes, links } = buildGraphData();

		graph = ForceGraph()(containerRef)
			.graphData({ nodes, links })
			.nodeLabel(() => '') // Disable default tooltip, we use custom
			.nodeColor((node: GraphNode) => node.color || (isDark ? '#9ca3af' : '#6b7280'))
			.nodeVal((node: GraphNode) => node.val)
			// Links - solid lines with theme-appropriate colors
			.linkColor(isDark ? 'rgba(148, 163, 184, 0.5)' : 'rgba(100, 116, 139, 0.5)')
			.linkWidth(2.5)
			// Curved links for better visibility when overlapping
			.linkCurvature(0.15)
			.backgroundColor('transparent')
			.onNodeClick((node: GraphNode) => {
				// Show popup - never navigate directly from node click
				selectedNode = node;

				// Set position using node's screen coordinates
				if (node.x !== undefined && node.y !== undefined) {
					const screenCoords = graph?.graph2ScreenCoords(node.x, node.y);
					if (screenCoords) {
						popupPosition = { x: screenCoords.x, y: screenCoords.y };
					}
				}
			})
			.onNodeHover((node: GraphNode | null, prevNode: GraphNode | null) => {
				containerRef.style.cursor = node ? 'pointer' : 'default';
				// Popup only shows on click, not hover

				// Highlight connected links on hover
				if (graph) {
					const defaultColor = isDark ? 'rgba(148, 163, 184, 0.5)' : 'rgba(100, 116, 139, 0.5)';
					graph
						.linkWidth((link: any) => {
							if (!node) return 2.5;
							const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
							const targetId = typeof link.target === 'object' ? link.target.id : link.target;
							return sourceId === node.id || targetId === node.id ? 4 : 1.5;
						})
						.linkColor((link: any) => {
							if (!node) return defaultColor;
							const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
							const targetId = typeof link.target === 'object' ? link.target.id : link.target;
							if (sourceId === node.id || targetId === node.id) {
								return isDark ? '#fbbf24' : '#f59e0b'; // Highlight color (amber)
							}
							return isDark ? 'rgba(148, 163, 184, 0.2)' : 'rgba(100, 116, 139, 0.2)';
						});
				}
			})
			.onNodeDrag((node: GraphNode) => {
				// Update popup position during drag
				if (selectedNode && selectedNode.id === node.id) {
					const screenCoords = graph?.graph2ScreenCoords(node.x!, node.y!);
					if (screenCoords) {
						popupPosition = { x: screenCoords.x, y: screenCoords.y };
					}
				}
			})
			.cooldownTicks(100)
			.onEngineStop(() => {
				graph?.zoomToFit(400, 50);
			})
			.onBackgroundClick(() => {
				// Dismiss popup when clicking on empty space
				selectedNode = null;
			});

		// Handle resize
		const resizeObserver = new ResizeObserver(() => {
			if (graph && containerRef) {
				graph.width(containerRef.clientWidth);
				graph.height(containerRef.clientHeight);
			}
		});
		resizeObserver.observe(containerRef);

		return () => resizeObserver.disconnect();
	}

	// Initialize or update graph when data changes
	$effect(() => {
		// Explicitly read notesData to establish dependency
		const currentNotes = notesData;

		// Only proceed after mount and when we have a container
		if (!mounted || !containerRef) return;

		// Initialize graph if not yet created and we have data
		if (!graph && currentNotes.length > 0) {
			initGraph();
		}
		// Update existing graph when data changes
		else if (graph && currentNotes.length > 0) {
			const { nodes, links } = buildGraphData();
			graph.graphData({ nodes, links });
		}
	});

	onMount(() => {
		mounted = true;
		// Small delay to ensure container is ready
		requestAnimationFrame(() => {
			if (notesData.length > 0 && containerRef && !graph) {
				initGraph();
			}
		});
	});

	onDestroy(() => {
		if (graph) {
			graph._destructor?.();
			graph = null;
		}
	});

	function handleOpenNote() {
		if (selectedNode) {
			goto(`/note/${selectedNode.id}`);
		}
	}

	function closePopup() {
		selectedNode = null;
	}

	// Check if a node matches the search query
	function nodeMatchesSearch(node: GraphNode): boolean {
		if (!searchQuery.trim()) return true;
		const q = searchQuery.toLowerCase();
		return (
			node.name.toLowerCase().includes(q) ||
			node.content.toLowerCase().includes(q)
		);
	}

	// Get connected node IDs for a given node
	function getConnectedNodeIds(nodeId: string, links: GraphLink[]): Set<string> {
		const connected = new Set<string>();
		for (const link of links) {
			const sourceId = typeof link.source === 'object' ? (link.source as any).id : link.source;
			const targetId = typeof link.target === 'object' ? (link.target as any).id : link.target;
			if (sourceId === nodeId) connected.add(targetId);
			if (targetId === nodeId) connected.add(sourceId);
		}
		return connected;
	}

	// Update graph based on search
	$effect(() => {
		// Read reactive values at top level to establish dependencies
		const currentQuery = searchQuery;
		const currentFilterMode = filterMode;

		if (!graph) return;

		const q = currentQuery.toLowerCase().trim();
		const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
		const accentColor = getComputedStyle(document.documentElement)
			.getPropertyValue('--color-accent')
			.trim() || '#818cf8';

		if (currentFilterMode === 'filter' && q) {
			// Filter mode: only show matching nodes and their connections
			const { nodes, links } = buildGraphData();
			const matchingIds = new Set(nodes.filter(n => nodeMatchesSearch(n)).map(n => n.id));

			// Also include nodes connected to matching nodes
			const connectedIds = new Set<string>();
			for (const id of matchingIds) {
				const connected = getConnectedNodeIds(id, links);
				connected.forEach(cid => connectedIds.add(cid));
			}

			const visibleIds = new Set([...matchingIds, ...connectedIds]);
			const filteredNodes = nodes.filter(n => visibleIds.has(n.id));
			const filteredLinks = links.filter(l => {
				const sourceId = typeof l.source === 'object' ? (l.source as any).id : l.source;
				const targetId = typeof l.target === 'object' ? (l.target as any).id : l.target;
				return visibleIds.has(sourceId) && visibleIds.has(targetId);
			});

			// Matching nodes get accent color, connected nodes get dimmed folder color
			filteredNodes.forEach(n => {
				if (matchingIds.has(n.id)) {
					n.color = accentColor;
				} else {
					// Dim the folder color for connected but non-matching nodes
					n.color = getFolderColor(n.folderId, isDark, 0.5);
				}
			});

			graph.graphData({ nodes: filteredNodes, links: filteredLinks });

			// Zoom to fit after filter
			setTimeout(() => graph?.zoomToFit(400, 50), 100);
		} else {
			// Highlight mode or no query: show all, highlight matches
			const { nodes, links } = buildGraphData();

			nodes.forEach(n => {
				if (n.id === highlightNoteId) {
					n.color = accentColor;
				} else if (q && nodeMatchesSearch(n)) {
					n.color = accentColor;
				} else if (q) {
					// Dim non-matching nodes but keep folder color
					n.color = getFolderColor(n.folderId, isDark, 0.3);
				}
				// else: keep the folder color already set by buildGraphData
			});

			graph.graphData({ nodes, links });
		}
	});

	function toggleSearch() {
		showSearch = !showSearch;
		if (showSearch) {
			setTimeout(() => searchInputRef?.focus(), 50);
		} else {
			searchQuery = '';
		}
	}

	function handleSearchKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			showSearch = false;
			searchQuery = '';
		}
	}

	// Count matching nodes
	let matchCount = $derived.by(() => {
		if (!searchQuery.trim()) return 0;
		return notesData.filter(n => {
			const q = searchQuery.toLowerCase();
			return n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q);
		}).length;
	});

	// Global keyboard shortcut
	function handleGlobalKeydown(e: KeyboardEvent) {
		// Escape to close popup or search
		if (e.key === 'Escape') {
			if (selectedNode) {
				closePopup();
				return;
			}
			if (showSearch) {
				showSearch = false;
				searchQuery = '';
				return;
			}
		}
		// "/" to open search (when not already in an input)
		if (e.key === '/' && !showSearch && document.activeElement?.tagName !== 'INPUT') {
			e.preventDefault();
			toggleSearch();
		}
	}
</script>

<svelte:window
	onkeydown={handleGlobalKeydown}
	onmousemove={handlePopupDrag}
	onmouseup={handlePopupDragEnd}
	ontouchmove={handlePopupTouchMove}
	ontouchend={handlePopupDragEnd}
/>

<div class="graph-container">
	<div bind:this={containerRef} class="h-full w-full"></div>

	<!-- Search controls -->
	<div class="search-controls">
		{#if showSearch}
			<div class="search-panel">
				<div class="search-input-wrapper">
					<Search class="search-icon" />
					<input
						bind:this={searchInputRef}
						bind:value={searchQuery}
						type="text"
						placeholder="Search notes..."
						class="search-input"
						onkeydown={handleSearchKeydown}
					/>
					{#if searchQuery}
						<button class="clear-btn" onclick={() => searchQuery = ''}>
							<XCircle class="h-4 w-4" />
						</button>
					{/if}
				</div>

				<div class="filter-mode">
					<button
						class="mode-btn"
						class:active={filterMode === 'highlight'}
						onclick={() => filterMode = 'highlight'}
					>
						Highlight
					</button>
					<button
						class="mode-btn"
						class:active={filterMode === 'filter'}
						onclick={() => filterMode = 'filter'}
					>
						Filter
					</button>
				</div>

				{#if searchQuery.trim()}
					<div class="match-count">
						{matchCount} {matchCount === 1 ? 'match' : 'matches'}
					</div>
				{/if}
			</div>
		{/if}

		<button class="search-toggle" onclick={toggleSearch} title="Search graph (/)">
			{#if showSearch}
				<X class="h-5 w-5" />
			{:else}
				<Search class="h-5 w-5" />
			{/if}
		</button>
	</div>

	{#if selectedNode}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="node-popup"
			class:dragging={isDraggingPopup}
			style="left: {popupPosition.x + 15}px; top: {popupPosition.y + 15}px;"
			onmousedown={handlePopupDragStart}
			ontouchstart={handlePopupTouchStart}
		>
			<div class="popup-header">
				<div class="popup-header-content">
					<h3 class="popup-title">{selectedNode.name}</h3>
					<span class="popup-folder">{getFolderName(selectedNode.folderId)}</span>
				</div>
				<button class="popup-close" onclick={closePopup} aria-label="Close">
					<X class="h-4 w-4" />
				</button>
			</div>

			<div class="popup-stats">
				<div class="stat">
					<span class="stat-value">{getWordCount(selectedNode.content)}</span>
					<span class="stat-label">words</span>
				</div>
				<div class="stat">
					<span class="stat-value">{selectedNode.linkCount}</span>
					<span class="stat-label">links</span>
				</div>
				<div class="stat">
					<span class="stat-value">{selectedNode.backlinkCount}</span>
					<span class="stat-label">backlinks</span>
				</div>
			</div>

			<div class="popup-preview">
				{getPreviewText(selectedNode.content)}
			</div>

			<div class="popup-footer">
				<span class="popup-date">Modified {formatDate(selectedNode.modified)}</span>
				<button class="popup-open" onclick={handleOpenNote}>
					Open
					<ArrowRight class="h-3 w-3" />
				</button>
			</div>
		</div>
	{/if}
</div>

<style>
	.graph-container {
		position: relative;
		height: 100%;
		width: 100%;
	}

	.node-popup {
		position: fixed;
		z-index: 100;
		width: 280px;
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 0.75rem;
		box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
		padding: 0.875rem;
		pointer-events: auto;
		animation: fadeIn 0.15s ease-out;
		cursor: grab;
		user-select: none;
		touch-action: none; /* Enable custom touch handling */
	}

	.node-popup.dragging {
		cursor: grabbing;
		box-shadow: 0 15px 50px rgba(0, 0, 0, 0.3);
	}

	@keyframes fadeIn {
		from {
			opacity: 0;
			transform: translateY(4px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	.popup-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.5rem;
		margin-bottom: 0.75rem;
	}

	.popup-header-content {
		flex: 1;
		min-width: 0;
	}

	.popup-title {
		font-size: 1rem;
		font-weight: 600;
		color: var(--color-text);
		margin: 0 0 0.25rem 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.popup-folder {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		display: flex;
		align-items: center;
		gap: 0.25rem;
	}

	.popup-close {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.75rem;
		height: 1.75rem;
		background: var(--color-bg-secondary);
		border: none;
		border-radius: 0.375rem;
		color: var(--color-text-muted);
		cursor: pointer;
		flex-shrink: 0;
		transition: all 0.15s;
	}

	.popup-close:hover {
		background: var(--color-border);
		color: var(--color-text);
	}

	.popup-stats {
		display: flex;
		gap: 1rem;
		margin-bottom: 0.75rem;
		padding: 0.5rem 0;
		border-top: 1px solid var(--color-border);
		border-bottom: 1px solid var(--color-border);
	}

	.stat {
		display: flex;
		flex-direction: column;
		align-items: center;
	}

	.stat-value {
		font-size: 1rem;
		font-weight: 600;
		color: var(--color-accent);
	}

	.stat-label {
		font-size: 0.625rem;
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.popup-preview {
		font-size: 0.8125rem;
		color: var(--color-text-muted);
		line-height: 1.5;
		margin-bottom: 0.75rem;
		display: -webkit-box;
		-webkit-line-clamp: 3;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.popup-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.popup-date {
		font-size: 0.6875rem;
		color: var(--color-text-muted);
	}

	.popup-open {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		font-size: 0.75rem;
		font-weight: 500;
		color: var(--color-accent);
		background: color-mix(in srgb, var(--color-accent) 15%, transparent);
		border: none;
		border-radius: 0.375rem;
		padding: 0.375rem 0.625rem;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.popup-open:hover {
		background: color-mix(in srgb, var(--color-accent) 25%, transparent);
	}

	/* Search controls */
	.search-controls {
		position: absolute;
		top: 1rem;
		right: 1rem;
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 0.5rem;
		z-index: 50;
	}

	.search-toggle {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2.5rem;
		height: 2.5rem;
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 0.5rem;
		color: var(--color-text-muted);
		cursor: pointer;
		transition: all 0.15s ease;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
	}

	.search-toggle:hover {
		color: var(--color-text);
		border-color: var(--color-accent);
	}

	.search-panel {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 0.75rem;
		padding: 0.75rem;
		box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
		min-width: 240px;
		animation: slideIn 0.15s ease-out;
	}

	@keyframes slideIn {
		from {
			opacity: 0;
			transform: translateY(-8px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	.search-input-wrapper {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		background: var(--color-bg-secondary);
		border-radius: 0.5rem;
		padding: 0.5rem 0.75rem;
	}

	.search-icon {
		width: 1rem;
		height: 1rem;
		color: var(--color-text-muted);
		flex-shrink: 0;
	}

	.search-input {
		flex: 1;
		background: transparent;
		border: none;
		outline: none;
		font-size: 0.875rem;
		color: var(--color-text);
		min-width: 0;
	}

	.search-input::placeholder {
		color: var(--color-text-muted);
	}

	.clear-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		background: transparent;
		border: none;
		color: var(--color-text-muted);
		cursor: pointer;
		padding: 0;
		flex-shrink: 0;
	}

	.clear-btn:hover {
		color: var(--color-text);
	}

	.filter-mode {
		display: flex;
		gap: 0.25rem;
		background: var(--color-bg-secondary);
		border-radius: 0.375rem;
		padding: 0.25rem;
	}

	.mode-btn {
		flex: 1;
		padding: 0.375rem 0.75rem;
		font-size: 0.75rem;
		font-weight: 500;
		background: transparent;
		border: none;
		border-radius: 0.25rem;
		color: var(--color-text-muted);
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.mode-btn:hover {
		color: var(--color-text);
	}

	.mode-btn.active {
		background: var(--color-bg);
		color: var(--color-accent);
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
	}

	.match-count {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		text-align: center;
		padding-top: 0.25rem;
		border-top: 1px solid var(--color-border);
	}
</style>
