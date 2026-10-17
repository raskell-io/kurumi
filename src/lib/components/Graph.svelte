<script lang="ts">
	import { onMount, onDestroy, tick, untrack } from 'svelte';
	import { memoryObjects, folders, extractWikilinks, type MemoryObject, type Folder } from '$lib/db';
	import { goto } from '$app/navigation';
	import ForceGraph from 'force-graph';
	import { Search, X, ArrowRight, ZoomIn, ZoomOut, Maximize } from 'lucide-svelte';

	interface Props {
		highlightNoteId?: string;
	}

	let { highlightNoteId }: Props = $props();

	let containerRef: HTMLDivElement;
	let graph: ForceGraph<GraphNode, GraphLink> | null = null;

	// Store subscriptions for Svelte 5 runes mode
	let memoriesData = $state<MemoryObject[]>([]);
	let foldersData = $state<Folder[]>([]);
	let mounted = $state(false);

	// Subscribe to stores and update state
	$effect(() => {
		const unsubMemories = memoryObjects.subscribe((m) => {
			memoriesData = m;
		});
		const unsubFolders = folders.subscribe((f) => {
			foldersData = f;
		});
		return () => {
			unsubMemories();
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
	let searchInputRef: HTMLInputElement | undefined = $state();

	interface GraphNode {
		id: string;
		name: string;
		val: number;
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

	// ---- Theme ----
	// force-graph paints on a canvas, so CSS variables have to be resolved
	// in JS. readTheme() snapshots the tokens; a MutationObserver on <html>
	// (light/dark class) and the system color-scheme query refresh it.
	interface GraphTheme {
		isDark: boolean;
		accent: string;
		text: string;
		muted: string;
		faint: string;
		bg: string;
		fontSans: string;
	}

	let theme: GraphTheme = {
		isDark: false,
		accent: '#7287fd',
		text: '#4c4f69',
		muted: '#6c6f85',
		faint: '#9ca0b0',
		bg: '#ffffff',
		fontSans: 'sans-serif'
	};

	function readTheme(): GraphTheme {
		const root = document.documentElement;
		const css = getComputedStyle(root);
		const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
		const isDark =
			root.classList.contains('dark') ||
			(!root.classList.contains('light') &&
				window.matchMedia('(prefers-color-scheme: dark)').matches);
		return {
			isDark,
			accent: v('--color-accent', theme.accent),
			text: v('--color-text', theme.text),
			muted: v('--color-text-muted', theme.muted),
			faint: v('--color-text-faint', theme.faint),
			bg: v('--color-bg', theme.bg),
			fontSans: v('--font-sans', theme.fontSans)
		};
	}

	/** '#rrggbb' (or '#rgb') → rgba(); other color syntaxes pass through. */
	function withAlpha(color: string, alpha: number): string {
		const m = color.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
		if (!m) return color;
		let hex = m[1];
		if (hex.length === 3) hex = [...hex].map((c) => c + c).join('');
		const n = parseInt(hex, 16);
		return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
	}

	function linkId(end: unknown): string {
		return typeof end === 'object' && end !== null ? (end as GraphNode).id : (end as string);
	}

	function buildGraphData(): { nodes: GraphNode[]; links: GraphLink[] } {
		const all = memoriesData;
		// Map memory titles (trimmed and lowercased) to their IDs for link matching
		const memoryMap = new Map(all.map((m) => [m.title.trim().toLowerCase(), m.id]));

		// Calculate backlinks for each memory
		const backlinkCounts = new Map<string, number>();
		for (const memory of all) {
			const wikilinks = extractWikilinks(memory.bodyMarkdown);
			for (const link of wikilinks) {
				const targetId = memoryMap.get(link.trim().toLowerCase());
				if (targetId) {
					backlinkCounts.set(targetId, (backlinkCounts.get(targetId) || 0) + 1);
				}
			}
		}

		const nodes: GraphNode[] = all.map((memory) => {
			const linkCount = extractWikilinks(memory.bodyMarkdown).length;
			const backlinkCount = backlinkCounts.get(memory.id) || 0;
			return {
				id: memory.id,
				name: memory.title || 'Untitled',
				val: Math.max(2, linkCount + backlinkCount + 1),
				content: memory.bodyMarkdown,
				folderId: memory.folderId,
				created: memory.createdAt,
				modified: memory.updatedAt,
				linkCount,
				backlinkCount
			};
		});

		const links: GraphLink[] = [];
		for (const memory of all) {
			const wikilinks = extractWikilinks(memory.bodyMarkdown);
			for (const link of wikilinks) {
				// Trim and lowercase to match against memoryMap
				const targetId = memoryMap.get(link.trim().toLowerCase());
				if (targetId && targetId !== memory.id) {
					links.push({ source: memory.id, target: targetId });
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
	function getFolderHSL(folderId: string, isDark: boolean): { h: number; s: number; l: number } {
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

	function getFolderColor(folderId: string | null, alpha: number = 1): string {
		// Notes without a folder use the theme's faint text color
		if (!folderId) return withAlpha(theme.faint, alpha);
		const { h, s, l } = getFolderHSL(folderId, theme.isDark);
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

	// ---- Rendering state (read by canvas accessors each frame) ----
	let hoveredNode: GraphNode | null = null;
	// Ids matching the current search, or null when there is no query.
	let matchingIds: Set<string> | null = null;
	// Whether the graph currently shows a filtered subset.
	let isFiltered = false;

	function nodeColor(node: GraphNode): string {
		if (node.id === highlightNoteId) return theme.accent;
		if (matchingIds) {
			if (matchingIds.has(node.id)) return theme.accent;
			// Filter mode keeps connected neighbours a bit brighter than
			// highlight mode's non-matches.
			return getFolderColor(node.folderId, isFiltered ? 0.5 : 0.3);
		}
		return getFolderColor(node.folderId);
	}

	function isHoverLink(link: GraphLink): boolean {
		return (
			!!hoveredNode &&
			(linkId(link.source) === hoveredNode.id || linkId(link.target) === hoveredNode.id)
		);
	}

	function linkColor(link: GraphLink): string {
		if (!hoveredNode) return withAlpha(theme.faint, 0.45);
		return isHoverLink(link) ? theme.accent : withAlpha(theme.faint, 0.15);
	}

	function linkWidth(link: GraphLink): number {
		if (!hoveredNode) return 1.5;
		return isHoverLink(link) ? 2.5 : 1;
	}

	// Labels under nodes: always for hovered/selected/highlighted/matching
	// nodes, and for everything once zoomed in far enough to be legible.
	function drawLabel(node: GraphNode, ctx: CanvasRenderingContext2D, globalScale: number) {
		if (node.x === undefined || node.y === undefined) return;
		const emphasized =
			node === hoveredNode ||
			node.id === selectedNode?.id ||
			node.id === highlightNoteId ||
			(matchingIds?.has(node.id) ?? false);
		if (!emphasized && (globalScale < 1.6 || matchingIds)) return;

		const fontSize = 11 / globalScale;
		const radius = Math.sqrt(Math.max(0, node.val)) * 4; // force-graph default nodeRelSize
		const label = node.name.length > 40 ? node.name.slice(0, 39) + '…' : node.name;
		ctx.font = `${emphasized ? 500 : 400} ${fontSize}px ${theme.fontSans}`;
		ctx.textAlign = 'center';
		ctx.textBaseline = 'top';
		// Soft halo in the background color keeps labels readable over links
		ctx.lineWidth = 3 / globalScale;
		ctx.strokeStyle = withAlpha(theme.bg, 0.85);
		ctx.strokeText(label, node.x, node.y + radius + 2 / globalScale);
		ctx.fillStyle = emphasized ? theme.text : theme.muted;
		ctx.fillText(label, node.x, node.y + radius + 2 / globalScale);
	}

	/** Re-assign accessors so force-graph repaints with current state. */
	function repaint() {
		graph?.nodeColor(nodeColor).linkColor(linkColor).linkWidth(linkWidth);
	}

	/**
	 * Rebuild graph data from the store, applying the search filter when
	 * active. Positions of nodes that already exist are carried over so
	 * edits and filter toggles don't re-run the whole layout from scratch.
	 */
	function refreshGraphData() {
		if (!graph) return;
		const { nodes, links } = buildGraphData();
		const q = searchQuery.toLowerCase().trim();

		matchingIds = q ? new Set(nodes.filter((n) => nodeMatchesSearch(n)).map((n) => n.id)) : null;
		isFiltered = filterMode === 'filter' && !!matchingIds;

		let nextNodes = nodes;
		let nextLinks = links;
		if (isFiltered && matchingIds) {
			// Filter mode: only show matching nodes and their connections
			const visibleIds = new Set(matchingIds);
			for (const id of matchingIds) {
				getConnectedNodeIds(id, links).forEach((cid) => visibleIds.add(cid));
			}
			nextNodes = nodes.filter((n) => visibleIds.has(n.id));
			nextLinks = links.filter(
				(l) => visibleIds.has(linkId(l.source)) && visibleIds.has(linkId(l.target))
			);
		}

		const previous = new Map(graph.graphData().nodes.map((n) => [n.id, n]));
		for (const n of nextNodes) {
			const prev = previous.get(n.id);
			if (prev) {
				n.x = prev.x;
				n.y = prev.y;
			}
		}

		graph.graphData({ nodes: nextNodes, links: nextLinks });
	}

	function initGraph() {
		if (!containerRef || graph) return;

		theme = readTheme();

		graph = new ForceGraph<GraphNode, GraphLink>(containerRef)
			.nodeLabel(() => '') // Disable default tooltip, we use custom
			.nodeVal((node: GraphNode) => node.val)
			.nodeColor(nodeColor)
			.nodeCanvasObjectMode(() => 'after')
			.nodeCanvasObject(drawLabel)
			.linkColor(linkColor)
			.linkWidth(linkWidth)
			// Curved links for better visibility when overlapping
			.linkCurvature(0.15)
			.backgroundColor('transparent')
			.onNodeClick((node: GraphNode) => {
				// Show popup - never navigate directly from node click
				selectedNode = node;
				repaint(); // show the selected node's label

				// Set position using node's screen coordinates
				if (node.x !== undefined && node.y !== undefined) {
					const screenCoords = graph?.graph2ScreenCoords(node.x, node.y);
					if (screenCoords) {
						popupPosition = { x: screenCoords.x, y: screenCoords.y };
					}
				}
			})
			.onNodeHover((node: GraphNode | null) => {
				containerRef.style.cursor = node ? 'pointer' : 'default';
				// Popup only shows on click, not hover; hover highlights the
				// node's links and label.
				hoveredNode = node;
				repaint();
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

		refreshGraphData();

		// Handle resize
		resizeObserver = new ResizeObserver(() => {
			if (graph && containerRef) {
				graph.width(containerRef.clientWidth);
				graph.height(containerRef.clientHeight);
			}
		});
		resizeObserver.observe(containerRef);
	}

	let resizeObserver: ResizeObserver | null = null;

	// Initialize or update graph when data changes
	$effect(() => {
		// Explicitly read memoriesData to establish dependency
		const current = memoriesData;

		// Only proceed after mount and when we have a container
		if (!mounted || !containerRef) return;

		// Initialize graph if not yet created and we have data
		if (!graph && current.length > 0) {
			initGraph();
		}
		// Update existing graph when data changes
		else if (graph && current.length > 0) {
			untrack(refreshGraphData);
		}
	});

	onMount(() => {
		mounted = true;
		// Small delay to ensure container is ready
		requestAnimationFrame(() => {
			if (memoriesData.length > 0 && containerRef && !graph) {
				initGraph();
			}
		});

		// Repaint with fresh tokens when the theme changes
		const onThemeChange = () => {
			theme = readTheme();
			repaint();
		};
		const themeObserver = new MutationObserver(onThemeChange);
		themeObserver.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ['class']
		});
		const colorScheme = window.matchMedia('(prefers-color-scheme: dark)');
		colorScheme.addEventListener('change', onThemeChange);

		return () => {
			themeObserver.disconnect();
			colorScheme.removeEventListener('change', onThemeChange);
		};
	});

	onDestroy(() => {
		resizeObserver?.disconnect();
		if (graph) {
			graph._destructor?.();
			graph = null;
		}
	});

	function handleOpenNote() {
		if (selectedNode) {
			goto(`/memory/${selectedNode.id}`);
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
			const sourceId = linkId(link.source);
			const targetId = linkId(link.target);
			if (sourceId === nodeId) connected.add(targetId);
			if (targetId === nodeId) connected.add(sourceId);
		}
		return connected;
	}

	// Update graph based on search. Highlight mode only recolors (no
	// re-layout per keystroke); filter mode swaps the visible subset.
	$effect(() => {
		// Read reactive values at top level to establish dependencies
		const q = searchQuery.toLowerCase().trim();
		const currentFilterMode = filterMode;

		if (!graph) return;

		untrack(() => {
			const wasFiltered = isFiltered;
			const willFilter = currentFilterMode === 'filter' && !!q;
			if (wasFiltered || willFilter) {
				refreshGraphData();
				// Zoom to fit after filter
				if (willFilter) setTimeout(() => graph?.zoomToFit(400, 50), 100);
			} else {
				const nodes = graph!.graphData().nodes;
				matchingIds = q ? new Set(nodes.filter((n) => nodeMatchesSearch(n)).map((n) => n.id)) : null;
				repaint();
			}
		});
	});

	function zoomBy(factor: number) {
		if (!graph) return;
		graph.zoom(graph.zoom() * factor, 200);
	}

	function zoomToFit() {
		graph?.zoomToFit(300, 50);
	}

	function toggleSearch() {
		showSearch = !showSearch;
		if (showSearch) {
			tick().then(() => searchInputRef?.focus());
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
		return memoriesData.filter((m) => {
			const q = searchQuery.toLowerCase();
			return m.title.toLowerCase().includes(q) || m.bodyMarkdown.toLowerCase().includes(q);
		}).length;
	});

	// Keep the popup inside the graph area (it is positioned relative to
	// the container, matching graph2ScreenCoords).
	const POPUP_WIDTH = 280;
	let popupStyle = $derived.by(() => {
		const maxX = (containerRef?.clientWidth ?? Infinity) - POPUP_WIDTH - 8;
		const maxY = (containerRef?.clientHeight ?? Infinity) - 200;
		const x = Math.max(8, Math.min(popupPosition.x + 15, maxX));
		const y = Math.max(8, Math.min(popupPosition.y + 15, maxY));
		return `left: ${x}px; top: ${y}px; width: ${POPUP_WIDTH}px;`;
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
		// "/" to open search (when not already typing somewhere)
		const active = document.activeElement as HTMLElement | null;
		if (
			e.key === '/' &&
			!showSearch &&
			!e.metaKey &&
			!e.ctrlKey &&
			active?.tagName !== 'INPUT' &&
			active?.tagName !== 'TEXTAREA' &&
			!active?.isContentEditable
		) {
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

	<!-- Floating toolbar: search + zoom -->
	<div class="graph-toolbar k-card">
		<div class="flex items-center gap-0.5 p-1">
			<button
				class="k-icon-btn"
				class:toolbar-active={showSearch}
				onclick={toggleSearch}
				aria-pressed={showSearch}
				aria-label="Search graph"
				title="Search graph (/)"
			>
				<Search class="h-4 w-4" />
			</button>
			<span class="mx-0.5 h-4 w-px bg-[var(--color-border)]" aria-hidden="true"></span>
			<button class="k-icon-btn" onclick={() => zoomBy(1.4)} aria-label="Zoom in" title="Zoom in">
				<ZoomIn class="h-4 w-4" />
			</button>
			<button class="k-icon-btn" onclick={() => zoomBy(1 / 1.4)} aria-label="Zoom out" title="Zoom out">
				<ZoomOut class="h-4 w-4" />
			</button>
			<button class="k-icon-btn" onclick={zoomToFit} aria-label="Fit to screen" title="Fit to screen">
				<Maximize class="h-4 w-4" />
			</button>
		</div>

		{#if showSearch}
			<div class="search-panel">
				<div class="relative">
					<Search class="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-text-faint)]" />
					<input
						bind:this={searchInputRef}
						bind:value={searchQuery}
						type="text"
						placeholder="Search notes…"
						class="k-input !h-8 !pr-8 !pl-8"
						aria-label="Search notes in graph"
						onkeydown={handleSearchKeydown}
					/>
					{#if searchQuery}
						<button
							class="k-icon-btn absolute top-1/2 right-1 !h-6 !w-6 -translate-y-1/2"
							onclick={() => (searchQuery = '')}
							aria-label="Clear search"
						>
							<X class="h-3.5 w-3.5" />
						</button>
					{/if}
				</div>

				<div class="flex items-center justify-between gap-2">
					<div class="k-segmented" role="group" aria-label="Search mode">
						<button aria-pressed={filterMode === 'highlight'} onclick={() => (filterMode = 'highlight')}>
							Highlight
						</button>
						<button aria-pressed={filterMode === 'filter'} onclick={() => (filterMode = 'filter')}>
							Filter
						</button>
					</div>
					{#if searchQuery.trim()}
						<span class="text-xs tabular-nums text-[var(--color-text-faint)]">
							{matchCount} {matchCount === 1 ? 'match' : 'matches'}
						</span>
					{/if}
				</div>
			</div>
		{/if}
	</div>

	{#if selectedNode}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="node-popup"
			class:dragging={isDraggingPopup}
			style={popupStyle}
			onmousedown={handlePopupDragStart}
			ontouchstart={handlePopupTouchStart}
		>
			<div class="flex items-start justify-between gap-2">
				<div class="min-w-0 flex-1">
					<h3 class="truncate text-sm font-semibold text-[var(--color-text)]">{selectedNode.name}</h3>
					<p class="mt-0.5 truncate text-xs text-[var(--color-text-faint)]">{getFolderName(selectedNode.folderId)}</p>
				</div>
				<button class="k-icon-btn -mt-1 -mr-1" onclick={closePopup} aria-label="Close">
					<X class="h-4 w-4" />
				</button>
			</div>

			<p class="popup-preview">
				{getPreviewText(selectedNode.content)}
			</p>

			<div class="flex items-center justify-between gap-2">
				<span class="truncate text-xs tabular-nums text-[var(--color-text-faint)]">
					{getWordCount(selectedNode.content)} words · {selectedNode.linkCount} links · {selectedNode.backlinkCount} backlinks
					<br />
					Modified {formatDate(selectedNode.modified)}
				</span>
				<button class="k-btn k-btn-primary k-btn-sm shrink-0" onclick={handleOpenNote}>
					Open
					<ArrowRight class="h-3.5 w-3.5" />
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
		overflow: hidden;
	}

	.graph-toolbar {
		position: absolute;
		top: 0.75rem;
		right: 0.75rem;
		z-index: 20;
		box-shadow: var(--shadow-md);
	}

	.toolbar-active {
		background: var(--color-active);
		color: var(--color-text);
	}

	.search-panel {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		width: 16rem;
		max-width: calc(100vw - 2.5rem);
		padding: 0.5rem;
		border-top: 1px solid var(--color-border);
	}

	.node-popup {
		position: absolute;
		z-index: 30;
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
		max-width: calc(100% - 1rem);
		padding: 0.75rem 0.875rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		background: var(--color-bg);
		box-shadow: var(--shadow-lg);
		animation: fadeIn 120ms var(--ease-out);
		cursor: grab;
		user-select: none;
		touch-action: none; /* Enable custom touch handling */
	}

	.node-popup.dragging {
		cursor: grabbing;
	}

	.popup-preview {
		font-size: 0.8125rem;
		line-height: 1.5;
		color: var(--color-text-muted);
		display: -webkit-box;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
</style>
