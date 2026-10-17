<script lang="ts">
	import { autofocus } from '$lib/actions/autofocus';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import {
		memoryObjects,
		updateMemoryObject,
		addMemoryObject,
		type MemoryObject
	} from '$lib/db';
	import { Plus, Link2, ZoomIn, ZoomOut, Search, X, LayoutDashboard } from 'lucide-svelte';

	// Canvas data model: stored as JSON in the canvas memory's bodyMarkdown.
	interface CanvasNode {
		id: string;
		memoryId: string; // the memory this card represents
		x: number;
		y: number;
		width: number;
		height: number;
	}

	interface CanvasEdge {
		id: string;
		from: string; // node id
		to: string; // node id
	}

	interface CanvasData {
		nodes: CanvasNode[];
		edges: CanvasEdge[];
	}

	function generateId(): string {
		return Math.random().toString(36).slice(2, 10);
	}

	let canvasId = $derived($page.params.id ?? '');
	let canvasMemory = $derived($memoryObjects.find((m) => m.id === canvasId));

	function parseCanvasData(memory: MemoryObject | undefined): CanvasData {
		if (!memory) return { nodes: [], edges: [] };
		try {
			const parsed = JSON.parse(memory.bodyMarkdown || '{}');
			return {
				nodes: Array.isArray(parsed.nodes) ? parsed.nodes : [],
				edges: Array.isArray(parsed.edges) ? parsed.edges : []
			};
		} catch {
			return { nodes: [], edges: [] };
		}
	}

	let data = $state<CanvasData>({ nodes: [], edges: [] });

	// Sync from store on first load + external updates.
	$effect(() => {
		const parsed = parseCanvasData(canvasMemory);
		data = parsed;
	});

	function saveCanvas() {
		if (!canvasId) return;
		updateMemoryObject(canvasId, {
			bodyMarkdown: JSON.stringify(data, null, 2)
		});
	}

	// Pan & zoom state
	let viewX = $state(0);
	let viewY = $state(0);
	let zoom = $state(1);
	let isPanning = $state(false);
	let panStartX = 0;
	let panStartY = 0;

	function handleWheel(e: WheelEvent) {
		e.preventDefault();
		if (e.ctrlKey || e.metaKey) {
			// Zoom
			const delta = e.deltaY > 0 ? -0.05 : 0.05;
			zoom = Math.max(0.2, Math.min(3, zoom + delta));
		} else {
			// Pan
			viewX -= e.deltaX / zoom;
			viewY -= e.deltaY / zoom;
		}
	}

	function startPan(e: PointerEvent) {
		if (e.target !== e.currentTarget) return;
		isPanning = true;
		panStartX = e.clientX - viewX * zoom;
		panStartY = e.clientY - viewY * zoom;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}

	function movePan(e: PointerEvent) {
		if (!isPanning) return;
		viewX = (e.clientX - panStartX) / zoom;
		viewY = (e.clientY - panStartY) / zoom;
	}

	function endPan() {
		isPanning = false;
	}

	// Node dragging
	let draggingNodeId = $state<string | null>(null);
	let dragOffsetX = 0;
	let dragOffsetY = 0;

	function startDragNode(e: PointerEvent, nodeId: string) {
		e.stopPropagation();
		// Let the card's buttons and title link receive their click: capturing
		// the pointer here would retarget the click to the card itself.
		if ((e.target as HTMLElement).closest('button, a')) return;
		const node = data.nodes.find((n) => n.id === nodeId);
		if (!node) return;
		draggingNodeId = nodeId;
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		dragOffsetX = e.clientX - rect.left;
		dragOffsetY = e.clientY - rect.top;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}

	function moveNode(e: PointerEvent) {
		if (!draggingNodeId) return;
		const container = document.querySelector('.canvas-viewport') as HTMLElement;
		if (!container) return;
		const rect = container.getBoundingClientRect();
		const x = (e.clientX - rect.left) / zoom - viewX - dragOffsetX / zoom;
		const y = (e.clientY - rect.top) / zoom - viewY - dragOffsetY / zoom;
		data = {
			...data,
			nodes: data.nodes.map((n) =>
				n.id === draggingNodeId ? { ...n, x: Math.round(x), y: Math.round(y) } : n
			)
		};
	}

	function endDragNode() {
		if (draggingNodeId) {
			draggingNodeId = null;
			saveCanvas();
		}
	}

	// Edge drawing
	let drawingEdgeFrom = $state<string | null>(null);

	function startEdge(nodeId: string) {
		if (drawingEdgeFrom === null) {
			drawingEdgeFrom = nodeId;
		} else if (drawingEdgeFrom !== nodeId) {
			// Complete the edge
			const exists = data.edges.some(
				(e) =>
					(e.from === drawingEdgeFrom && e.to === nodeId) ||
					(e.from === nodeId && e.to === drawingEdgeFrom)
			);
			if (!exists) {
				data = {
					...data,
					edges: [
						...data.edges,
						{ id: generateId(), from: drawingEdgeFrom, to: nodeId }
					]
				};
				saveCanvas();
			}
			drawingEdgeFrom = null;
		} else {
			drawingEdgeFrom = null;
		}
	}

	// Add node
	let showAddMenu = $state(false);
	let addSearch = $state('');

	let addCandidates = $derived.by(() => {
		if (!showAddMenu) return [];
		const existing = new Set(data.nodes.map((n) => n.memoryId));
		let pool = $memoryObjects.filter((m) => !existing.has(m.id) && m.type !== 'canvas');
		if (addSearch.trim()) {
			const q = addSearch.toLowerCase();
			pool = pool.filter((m) => (m.title || '').toLowerCase().includes(q));
		}
		return pool.slice(0, 20);
	});

	function addNodeFromMemory(memory: MemoryObject) {
		const node: CanvasNode = {
			id: generateId(),
			memoryId: memory.id,
			x: -viewX + 300 / zoom + Math.random() * 100,
			y: -viewY + 200 / zoom + Math.random() * 100,
			width: 240,
			height: 120
		};
		data = { ...data, nodes: [...data.nodes, node] };
		showAddMenu = false;
		addSearch = '';
		saveCanvas();
	}

	function removeNode(nodeId: string) {
		data = {
			nodes: data.nodes.filter((n) => n.id !== nodeId),
			edges: data.edges.filter((e) => e.from !== nodeId && e.to !== nodeId)
		};
		saveCanvas();
	}

	function handleAddKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && addCandidates.length > 0) {
			e.preventDefault();
			addNodeFromMemory(addCandidates[0]);
		}
	}

	// Escape closes the add panel first, then leaves connect mode.
	function handleKeydown(e: KeyboardEvent) {
		if (e.key !== 'Escape') return;
		if (showAddMenu) {
			showAddMenu = false;
			addSearch = '';
		} else if (drawingEdgeFrom !== null) {
			drawingEdgeFrom = null;
		}
	}

	function removeEdge(edgeId: string) {
		data = { ...data, edges: data.edges.filter((e) => e.id !== edgeId) };
		saveCanvas();
	}

	function getNodeCenter(nodeId: string): { x: number; y: number } | null {
		const node = data.nodes.find((n) => n.id === nodeId);
		if (!node) return null;
		return { x: node.x + node.width / 2, y: node.y + node.height / 2 };
	}

	function getMemoryForNode(nodeId: string): MemoryObject | undefined {
		const node = data.nodes.find((n) => n.id === nodeId);
		if (!node) return undefined;
		return $memoryObjects.find((m) => m.id === node.memoryId);
	}

	function memoryPreview(memory: MemoryObject): string {
		const text = memory.summaryShort || memory.bodyMarkdown || '';
		const clean = text.replace(/\s+/g, ' ').trim();
		return clean.length > 100 ? clean.slice(0, 100) + '...' : clean;
	}
</script>

<svelte:head>
	<title>{canvasMemory?.title || 'Canvas'} - Kurumi</title>
</svelte:head>

<svelte:window onkeydown={handleKeydown} />

{#if canvasMemory}
	<div class="canvas-page">
		<!-- Toolbar -->
		<div class="toolbar">
			<h1 class="min-w-0 flex-1 truncate text-sm font-medium text-[var(--color-text)]">
				{canvasMemory.title || 'Canvas'}
			</h1>
			{#if drawingEdgeFrom !== null}
				<span class="hidden truncate text-xs text-[var(--color-text-muted)] sm:inline">
					{drawingEdgeFrom === '__waiting__' ? 'Pick the first card' : 'Pick a card to connect to'}
					· <kbd class="k-kbd">Esc</kbd> cancel
				</span>
			{/if}
			<div class="flex shrink-0 items-center gap-1">
				<button
					class="k-btn k-btn-sm"
					class:tool-active={showAddMenu}
					onclick={() => (showAddMenu = !showAddMenu)}
					aria-expanded={showAddMenu}
				>
					<Plus class="h-3.5 w-3.5" />
					<span class="hidden sm:inline">Add note</span>
				</button>
				<button
					class="k-btn k-btn-sm"
					class:tool-active={drawingEdgeFrom !== null}
					onclick={() => (drawingEdgeFrom = drawingEdgeFrom ? null : '__waiting__')}
					aria-pressed={drawingEdgeFrom !== null}
					title="Click two cards to connect them"
				>
					<Link2 class="h-3.5 w-3.5" />
					<span class="hidden sm:inline">Connect</span>
				</button>
				<span class="mx-1 h-4 w-px bg-[var(--color-border)]" aria-hidden="true"></span>
				<button
					class="k-icon-btn"
					onclick={() => (zoom = Math.max(0.2, zoom - 0.2))}
					aria-label="Zoom out"
					title="Zoom out"
				>
					<ZoomOut class="h-4 w-4" />
				</button>
				<button
					class="w-10 text-center text-xs tabular-nums text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
					onclick={() => (zoom = 1)}
					title="Reset zoom"
				>
					{Math.round(zoom * 100)}%
				</button>
				<button
					class="k-icon-btn"
					onclick={() => (zoom = Math.min(3, zoom + 0.2))}
					aria-label="Zoom in"
					title="Zoom in"
				>
					<ZoomIn class="h-4 w-4" />
				</button>
			</div>

			{#if showAddMenu}
				<div class="add-panel k-menu">
					<div class="relative mb-1">
						<Search class="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-text-faint)]" />
												<input
							type="text"
							bind:value={addSearch}
							onkeydown={handleAddKeydown}
							placeholder="Search memories…"
							aria-label="Search memories to add"
							class="k-input !h-8 !pl-8"
							use:autofocus
						/>
					</div>
					<ul class="max-h-60 overflow-y-auto">
						{#each addCandidates as memory (memory.id)}
							<li>
								<button class="k-menu-item" onclick={() => addNodeFromMemory(memory)}>
									<span class="truncate">{memory.title || 'Untitled'}</span>
								</button>
							</li>
						{/each}
						{#if addCandidates.length === 0}
							<li class="px-2 py-4 text-center text-xs text-[var(--color-text-faint)]">No matching memories</li>
						{/if}
					</ul>
				</div>
			{/if}
		</div>

		<!-- Canvas viewport -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="canvas-viewport"
			onwheel={handleWheel}
			onpointerdown={startPan}
			onpointermove={(e) => { movePan(e); moveNode(e); }}
			onpointerup={() => { endPan(); endDragNode(); }}
		>
			<div
				class="canvas-transform"
				style="transform: translate({viewX * zoom}px, {viewY * zoom}px) scale({zoom})"
			>
				<!-- Edges (SVG) -->
				<svg class="edge-layer">
					{#each data.edges as edge (edge.id)}
						{@const fromCenter = getNodeCenter(edge.from)}
						{@const toCenter = getNodeCenter(edge.to)}
						{#if fromCenter && toCenter}
							<!-- svelte-ignore a11y_click_events_have_key_events -->
							<!-- svelte-ignore a11y_no_static_element_interactions -->
							<line
								x1={fromCenter.x + 10000}
								y1={fromCenter.y + 10000}
								x2={toCenter.x + 10000}
								y2={toCenter.y + 10000}
								class="edge-line"
								onclick={() => removeEdge(edge.id)}
							>
								<title>Click to remove connection</title>
							</line>
						{/if}
					{/each}
				</svg>

				<!-- Nodes -->
				{#each data.nodes as node (node.id)}
					{@const memory = getMemoryForNode(node.id)}
					{#if memory}
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<div
							class="canvas-node"
							class:connecting={drawingEdgeFrom !== null}
							class:connect-source={drawingEdgeFrom === node.id}
							class:dragging={draggingNodeId === node.id}
							style="left: {node.x}px; top: {node.y}px; width: {node.width}px;"
							onpointerdown={(e) => startDragNode(e, node.id)}
						>
							<div class="flex items-center gap-1 px-3 pt-2">
								<a href="/memory/{memory.id}" class="node-title">
									{memory.title || 'Untitled'}
								</a>
								<div class="node-actions">
									{#if drawingEdgeFrom !== null && drawingEdgeFrom !== '__waiting__'}
										<button
											class="k-icon-btn !h-6 !w-6 hover:!text-[var(--color-accent)]"
											onclick={(e) => { e.stopPropagation(); startEdge(node.id); }}
											aria-label={drawingEdgeFrom === node.id ? 'Cancel connection' : 'Connect to this'}
											title={drawingEdgeFrom === node.id ? 'Cancel connection' : 'Connect to this'}
										>
											<Link2 class="h-3.5 w-3.5" />
										</button>
									{:else if drawingEdgeFrom === '__waiting__'}
										<button
											class="k-icon-btn !h-6 !w-6 hover:!text-[var(--color-accent)]"
											onclick={(e) => { e.stopPropagation(); drawingEdgeFrom = node.id; }}
											aria-label="Start connection from this"
											title="Start connection from this"
										>
											<Link2 class="h-3.5 w-3.5" />
										</button>
									{/if}
									<button
										class="k-icon-btn !h-6 !w-6 hover:!text-[var(--color-danger)]"
										onclick={(e) => { e.stopPropagation(); removeNode(node.id); }}
										aria-label="Remove from canvas"
										title="Remove from canvas"
									>
										<X class="h-3.5 w-3.5" />
									</button>
								</div>
							</div>
							<div class="node-body">
								{memoryPreview(memory)}
							</div>
							<div class="px-3 pb-2 text-[0.6875rem] capitalize text-[var(--color-text-faint)]">
								{memory.type}
							</div>
						</div>
					{/if}
				{/each}
			</div>

			{#if data.nodes.length === 0}
				<div class="k-empty pointer-events-none absolute inset-0 justify-center">
					<LayoutDashboard />
					<p class="k-empty-title">Empty canvas</p>
					<p>Add notes as cards, then connect them to map out an idea.</p>
				</div>
			{/if}
		</div>
	</div>
{:else}
	<div class="k-empty">
		<LayoutDashboard />
		<p class="k-empty-title">Canvas not found</p>
		<p>It may have been deleted or moved to another vault.</p>
		<a href="/" class="k-btn mt-2">Back to home</a>
	</div>
{/if}

<style>
	.canvas-page {
		display: flex;
		flex-direction: column;
		height: 100%;
		overflow: hidden;
	}

	.toolbar {
		position: relative;
		z-index: 10;
		display: flex;
		align-items: center;
		gap: 0.75rem;
		height: 2.75rem;
		padding: 0 0.75rem 0 1rem;
		border-bottom: 1px solid var(--color-border);
		background: var(--color-bg);
	}

	.tool-active {
		border-color: color-mix(in srgb, var(--color-accent) 50%, var(--color-border));
		background: var(--color-accent-soft);
		color: var(--color-accent);
	}

	.tool-active:hover {
		background: var(--color-accent-soft);
	}

	.add-panel {
		position: absolute;
		top: calc(100% + 0.25rem);
		right: 0.75rem;
		width: 18rem;
		max-width: calc(100vw - 1.5rem);
	}

	/* Canvas */
	.canvas-viewport {
		position: relative;
		flex: 1;
		overflow: hidden;
		background-color: var(--color-bg-secondary);
		background-image: radial-gradient(circle, var(--color-border) 1px, transparent 1px);
		background-size: 24px 24px;
		cursor: grab;
		touch-action: none;
	}

	.canvas-viewport:active {
		cursor: grabbing;
	}

	.canvas-transform {
		position: relative;
		width: 0;
		height: 0;
		transform-origin: 0 0;
	}

	.edge-layer {
		position: absolute;
		top: -10000px;
		left: -10000px;
		width: 20000px;
		height: 20000px;
		pointer-events: none;
		overflow: visible;
	}

	.edge-line {
		stroke: color-mix(in srgb, var(--color-text) 30%, transparent);
		stroke-width: 1.5;
		stroke-linecap: round;
		pointer-events: stroke;
		cursor: pointer;
	}

	.edge-line:hover {
		stroke: var(--color-danger);
		stroke-width: 3;
	}

	.canvas-node {
		position: absolute;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		background: var(--color-bg);
		box-shadow: var(--shadow-sm);
		cursor: move;
		user-select: none;
		overflow: hidden;
	}

	.canvas-node:hover {
		box-shadow: var(--shadow-md);
	}

	.canvas-node.dragging {
		z-index: 10;
		box-shadow: var(--shadow-lg);
	}

	.canvas-node.connecting {
		border-color: color-mix(in srgb, var(--color-accent) 40%, var(--color-border));
	}

	.canvas-node.connect-source {
		border-color: var(--color-accent);
		box-shadow: 0 0 0 3px var(--color-accent-soft);
	}

	.node-title {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--color-text);
		text-decoration: none;
	}

	.node-title:hover {
		text-decoration: underline;
		text-decoration-color: var(--color-text-faint);
		text-underline-offset: 2px;
	}

	.node-actions {
		display: flex;
		flex-shrink: 0;
		gap: 0.125rem;
		opacity: 0;
	}

	.canvas-node:hover .node-actions,
	.canvas-node.connecting .node-actions,
	.node-actions:focus-within {
		opacity: 1;
	}

	@media (hover: none) {
		.node-actions {
			opacity: 1;
		}
	}

	.node-body {
		max-height: 4.5rem;
		overflow: hidden;
		padding: 0.25rem 0.75rem 0.375rem;
		font-size: 0.75rem;
		line-height: 1.45;
		color: var(--color-text-muted);
	}
</style>
