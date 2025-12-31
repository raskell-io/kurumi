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

	// Hover popup state
	let hoveredNode = $state<GraphNode | null>(null);
	let hoverPosition = $state<{ x: number; y: number }>({ x: 0, y: 0 });
	let isHoveringPopup = $state(false);
	let hidePopupTimeout: ReturnType<typeof setTimeout> | null = null;

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
		const noteMap = new Map(allNotes.map((n) => [n.title.toLowerCase(), n.id]));

		// Calculate backlinks for each note
		const backlinkCounts = new Map<string, number>();
		for (const note of allNotes) {
			const wikilinks = extractWikilinks(note.content);
			for (const link of wikilinks) {
				const targetId = noteMap.get(link.toLowerCase());
				if (targetId) {
					backlinkCounts.set(targetId, (backlinkCounts.get(targetId) || 0) + 1);
				}
			}
		}

		const nodes: GraphNode[] = allNotes.map((note) => {
			const linkCount = extractWikilinks(note.content).length;
			const backlinkCount = backlinkCounts.get(note.id) || 0;
			return {
				id: note.id,
				name: note.title || 'Untitled',
				val: Math.max(2, linkCount + backlinkCount + 1),
				color: note.id === highlightNoteId ? '#818cf8' : undefined,
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
				const targetId = noteMap.get(link.toLowerCase());
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
			// Links - use rgba for opacity
			.linkColor(isDark ? 'rgba(129, 140, 248, 0.8)' : 'rgba(99, 102, 241, 0.8)')
			.linkWidth(2)
			.linkDirectionalParticles(2)
			.linkDirectionalParticleWidth(3)
			.linkDirectionalParticleSpeed(0.005)
			.linkDirectionalParticleColor(() => accentColor)
			// Curved links for better visibility when overlapping
			.linkCurvature(0.2)
			.backgroundColor('transparent')
			.onNodeClick((node: GraphNode) => {
				goto(`/note/${node.id}`);
			})
			.onNodeHover((node: GraphNode | null, prevNode: GraphNode | null) => {
				containerRef.style.cursor = node ? 'pointer' : 'default';

				// Clear any pending hide timeout
				if (hidePopupTimeout) {
					clearTimeout(hidePopupTimeout);
					hidePopupTimeout = null;
				}

				if (node) {
					// Show popup immediately when hovering a node
					hoveredNode = node;
					// Set initial position using node's screen coordinates
					if (node.x !== undefined && node.y !== undefined) {
						const screenCoords = graph?.graph2ScreenCoords(node.x, node.y);
						if (screenCoords) {
							hoverPosition = { x: screenCoords.x, y: screenCoords.y };
						}
					}
				} else if (!isHoveringPopup) {
					// Delay hiding popup to allow mouse to move to it
					hidePopupTimeout = setTimeout(() => {
						if (!isHoveringPopup) {
							hoveredNode = null;
						}
					}, 300);
				}

				// Highlight connected links on hover
				if (graph) {
					const defaultColor = isDark ? 'rgba(129, 140, 248, 0.8)' : 'rgba(99, 102, 241, 0.8)';
					graph
						.linkWidth((link: any) => {
							if (!node) return 2;
							const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
							const targetId = typeof link.target === 'object' ? link.target.id : link.target;
							return sourceId === node.id || targetId === node.id ? 4 : 1;
						})
						.linkColor((link: any) => {
							if (!node) return defaultColor;
							const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
							const targetId = typeof link.target === 'object' ? link.target.id : link.target;
							if (sourceId === node.id || targetId === node.id) {
								return '#f59e0b'; // Highlight color (amber)
							}
							return isDark ? 'rgba(129, 140, 248, 0.3)' : 'rgba(99, 102, 241, 0.3)';
						});
				}
			})
			.onNodeDrag((node: GraphNode) => {
				// Update hover position during drag
				if (hoveredNode && hoveredNode.id === node.id) {
					const screenCoords = graph?.graph2ScreenCoords(node.x!, node.y!);
					if (screenCoords) {
						hoverPosition = { x: screenCoords.x, y: screenCoords.y };
					}
				}
			})
			.cooldownTicks(100)
			.onEngineStop(() => {
				graph?.zoomToFit(400, 50);
			});

		// Track mouse position for hover popup - always update so it's ready when needed
		containerRef.addEventListener('mousemove', (e) => {
			hoverPosition = { x: e.clientX, y: e.clientY };
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
		// Only proceed after mount and when we have a container
		if (!mounted || !containerRef) return;

		// Initialize graph if not yet created and we have data
		if (!graph && notesData.length > 0) {
			initGraph();
		}
		// Update existing graph when data changes
		else if (graph) {
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
		if (hoveredNode) {
			goto(`/note/${hoveredNode.id}`);
		}
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
		if (!graph) return;

		const q = searchQuery.toLowerCase().trim();
		const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
		const accentColor = getComputedStyle(document.documentElement)
			.getPropertyValue('--color-accent')
			.trim() || '#818cf8';

		if (filterMode === 'filter' && q) {
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

			// Color matching nodes differently
			filteredNodes.forEach(n => {
				if (matchingIds.has(n.id)) {
					n.color = accentColor;
				} else {
					n.color = isDark ? 'rgba(156, 163, 175, 0.5)' : 'rgba(107, 114, 128, 0.5)';
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
					n.color = isDark ? 'rgba(156, 163, 175, 0.3)' : 'rgba(107, 114, 128, 0.3)';
				} else {
					n.color = isDark ? '#9ca3af' : '#6b7280';
				}
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
		// "/" to open search (when not already in an input)
		if (e.key === '/' && !showSearch && document.activeElement?.tagName !== 'INPUT') {
			e.preventDefault();
			toggleSearch();
		}
	}
</script>

<svelte:window onkeydown={handleGlobalKeydown} />

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

	{#if hoveredNode}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="hover-popup"
			style="left: {hoverPosition.x + 15}px; top: {hoverPosition.y + 15}px;"
			onmouseenter={() => {
				isHoveringPopup = true;
				if (hidePopupTimeout) {
					clearTimeout(hidePopupTimeout);
					hidePopupTimeout = null;
				}
			}}
			onmouseleave={() => {
				isHoveringPopup = false;
				hidePopupTimeout = setTimeout(() => {
					hoveredNode = null;
				}, 200);
			}}
		>
			<div class="popup-header">
				<h3 class="popup-title">{hoveredNode.name}</h3>
				<span class="popup-folder">{getFolderName(hoveredNode.folderId)}</span>
			</div>

			<div class="popup-stats">
				<div class="stat">
					<span class="stat-value">{getWordCount(hoveredNode.content)}</span>
					<span class="stat-label">words</span>
				</div>
				<div class="stat">
					<span class="stat-value">{hoveredNode.linkCount}</span>
					<span class="stat-label">links</span>
				</div>
				<div class="stat">
					<span class="stat-value">{hoveredNode.backlinkCount}</span>
					<span class="stat-label">backlinks</span>
				</div>
			</div>

			<div class="popup-preview">
				{hoveredNode.content.slice(0, 120).trim() || 'No content'}{hoveredNode.content.length > 120 ? '...' : ''}
			</div>

			<div class="popup-footer">
				<span class="popup-date">Modified {formatDate(hoveredNode.modified)}</span>
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

	.hover-popup {
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
		margin-bottom: 0.75rem;
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
