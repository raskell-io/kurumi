<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import {
		memoryObjects,
		updateMemoryObject,
		addMemoryObject,
		type MemoryObject
	} from '$lib/db';
	import { Plus, Link2, ZoomIn, ZoomOut, Trash2, Search } from 'lucide-svelte';

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

{#if canvasMemory}
	<div class="canvas-page">
		<!-- Toolbar -->
		<div class="toolbar">
			<h2 class="toolbar-title">{canvasMemory.title || 'Canvas'}</h2>
			<div class="toolbar-actions">
				<button class="tool-btn" onclick={() => (showAddMenu = !showAddMenu)}>
					<Plus class="h-4 w-4" />
					Add note
				</button>
				<button
					class="tool-btn"
					class:active={drawingEdgeFrom !== null}
					onclick={() => (drawingEdgeFrom = drawingEdgeFrom ? null : '__waiting__')}
					title="Click two nodes to connect them"
				>
					<Link2 class="h-4 w-4" />
					Connect
				</button>
				<button class="tool-btn" onclick={() => (zoom = Math.min(3, zoom + 0.2))}>
					<ZoomIn class="h-4 w-4" />
				</button>
				<button class="tool-btn" onclick={() => (zoom = Math.max(0.2, zoom - 0.2))}>
					<ZoomOut class="h-4 w-4" />
				</button>
				<span class="zoom-label">{Math.round(zoom * 100)}%</span>
			</div>

			{#if showAddMenu}
				<div class="add-panel">
					<div class="add-search">
						<Search class="h-3.5 w-3.5 text-[var(--color-text-muted)]" />
						<!-- svelte-ignore a11y_autofocus -->
						<input
							type="text"
							bind:value={addSearch}
							placeholder="Search memories..."
							class="add-input"
							autofocus
						/>
					</div>
					<ul class="add-results">
						{#each addCandidates as memory (memory.id)}
							<li>
								<button class="add-result" onclick={() => addNodeFromMemory(memory)}>
									{memory.title || 'Untitled'}
								</button>
							</li>
						{/each}
						{#if addCandidates.length === 0}
							<li class="add-empty">No matching memories</li>
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
								x1={fromCenter.x}
								y1={fromCenter.y}
								x2={toCenter.x}
								y2={toCenter.y}
								class="edge-line"
								onclick={() => removeEdge(edge.id)}
							/>
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
							class:dragging={draggingNodeId === node.id}
							style="left: {node.x}px; top: {node.y}px; width: {node.width}px;"
							onpointerdown={(e) => startDragNode(e, node.id)}
						>
							<div class="node-header">
								<a href="/memory/{memory.id}" class="node-title">
									{memory.title || 'Untitled'}
								</a>
								<div class="node-actions">
									{#if drawingEdgeFrom !== null && drawingEdgeFrom !== '__waiting__'}
										<button
											class="node-btn connect"
											onclick={(e) => { e.stopPropagation(); startEdge(node.id); }}
											title="Connect to this"
										>
											<Link2 class="h-3 w-3" />
										</button>
									{:else if drawingEdgeFrom === '__waiting__'}
										<button
											class="node-btn connect"
											onclick={(e) => { e.stopPropagation(); drawingEdgeFrom = node.id; }}
											title="Start connection from this"
										>
											<Link2 class="h-3 w-3" />
										</button>
									{/if}
									<button
										class="node-btn danger"
										onclick={(e) => { e.stopPropagation(); removeNode(node.id); }}
										title="Remove from canvas"
									>
										<Trash2 class="h-3 w-3" />
									</button>
								</div>
							</div>
							<div class="node-body">
								{memoryPreview(memory)}
							</div>
							<div class="node-footer">
								<span class="node-type">{memory.type}</span>
							</div>
						</div>
					{/if}
				{/each}
			</div>
		</div>
	</div>
{:else}
	<div class="not-found">
		<h1>Canvas not found</h1>
		<a href="/">Back to home</a>
	</div>
{/if}

<style>
	.canvas-page {
		display: flex;
		flex-direction: column;
		height: 100vh;
		overflow: hidden;
	}

	.toolbar {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.5rem 1rem;
		background: var(--color-bg-secondary);
		border-bottom: 1px solid var(--color-border);
		z-index: 10;
	}

	.toolbar-title {
		font-size: 1rem;
		font-weight: 600;
		color: var(--color-text);
	}

	.toolbar-actions {
		display: flex;
		align-items: center;
		gap: 0.375rem;
	}

	.tool-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.375rem 0.625rem;
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 0.375rem;
		color: var(--color-text);
		font-size: 0.75rem;
		cursor: pointer;
		transition: all 0.15s;
	}

	.tool-btn:hover {
		border-color: var(--color-accent);
	}

	.tool-btn.active {
		background: var(--color-accent);
		border-color: var(--color-accent);
		color: white;
	}

	.zoom-label {
		font-size: 0.6875rem;
		color: var(--color-text-muted);
		min-width: 3rem;
		text-align: center;
	}

	.add-panel {
		position: absolute;
		top: 100%;
		right: 1rem;
		width: 280px;
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 0.5rem;
		box-shadow: 0 8px 30px rgba(0, 0, 0, 0.2);
		z-index: 20;
	}

	.add-search {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.75rem;
		border-bottom: 1px solid var(--color-border);
	}

	.add-input {
		flex: 1;
		background: transparent;
		border: none;
		color: var(--color-text);
		font-size: 0.8125rem;
		outline: none;
	}

	.add-results {
		list-style: none;
		padding: 0.25rem;
		margin: 0;
		max-height: 240px;
		overflow-y: auto;
	}

	.add-result {
		display: block;
		width: 100%;
		padding: 0.375rem 0.625rem;
		background: transparent;
		border: none;
		border-radius: 0.25rem;
		color: var(--color-text);
		font-size: 0.8125rem;
		text-align: left;
		cursor: pointer;
	}

	.add-result:hover {
		background: var(--color-bg-secondary);
	}

	.add-empty {
		padding: 1rem;
		text-align: center;
		color: var(--color-text-muted);
		font-size: 0.8125rem;
	}

	/* Canvas */
	.canvas-viewport {
		flex: 1;
		overflow: hidden;
		background:
			radial-gradient(circle, var(--color-border) 1px, transparent 1px);
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
	}

	.edge-line {
		stroke: var(--color-accent);
		stroke-width: 2;
		stroke-linecap: round;
		pointer-events: stroke;
		cursor: pointer;
	}

	.edge-line:hover {
		stroke-width: 4;
		stroke: #ef4444;
	}

	.canvas-node {
		position: absolute;
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 0.5rem;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
		cursor: move;
		user-select: none;
		overflow: hidden;
		transition: box-shadow 0.1s;
	}

	.canvas-node:hover {
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
	}

	.canvas-node.dragging {
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
		z-index: 10;
	}

	.canvas-node.connecting {
		border-color: var(--color-accent);
	}

	.node-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.375rem 0.5rem;
		border-bottom: 1px solid var(--color-border);
		background: var(--color-bg-secondary);
	}

	.node-title {
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--color-text);
		text-decoration: none;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		flex: 1;
		min-width: 0;
	}

	.node-title:hover {
		color: var(--color-accent);
	}

	.node-actions {
		display: flex;
		gap: 0.125rem;
		flex-shrink: 0;
	}

	.node-btn {
		background: none;
		border: none;
		padding: 0.25rem;
		border-radius: 0.25rem;
		cursor: pointer;
		color: var(--color-text-muted);
	}

	.node-btn:hover {
		background: var(--color-border);
		color: var(--color-text);
	}

	.node-btn.danger:hover {
		background: rgba(239, 68, 68, 0.15);
		color: #ef4444;
	}

	.node-btn.connect:hover {
		background: color-mix(in srgb, var(--color-accent) 15%, transparent);
		color: var(--color-accent);
	}

	.node-body {
		padding: 0.375rem 0.5rem;
		font-size: 0.6875rem;
		color: var(--color-text-muted);
		line-height: 1.4;
		max-height: 4rem;
		overflow: hidden;
	}

	.node-footer {
		padding: 0.25rem 0.5rem;
		border-top: 1px solid var(--color-border);
	}

	.node-type {
		font-size: 0.625rem;
		color: var(--color-text-muted);
		text-transform: capitalize;
	}

	.not-found {
		text-align: center;
		padding: 4rem 2rem;
		color: var(--color-text-muted);
	}

	.not-found h1 {
		color: var(--color-text);
		margin-bottom: 1rem;
	}

	.not-found a {
		color: var(--color-accent);
	}
</style>
