<script lang="ts">
	/**
	 * A canvas: cards (text, notes, links, groups) on an endless board, with
	 * connections. Stored as JSON Canvas in the canvas memory's body ($lib/canvas).
	 *
	 * Drag the board to pan, scroll to pan, Cmd/Ctrl+scroll (or pinch) to
	 * zoom. Double-click the board for a text card. Select a card to resize
	 * it, colour it, or drag one of its side dots onto another card to
	 * connect them.
	 */
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { untrack } from 'svelte';
	import { memoryObjects, updateMemoryObject, type MemoryObject } from '$lib/db';
	import {
		parseCanvas,
		serializeCanvas,
		newCanvasId,
		anchor,
		facingSides,
		nearestSide,
		edgePath,
		nodesInGroup,
		bounds,
		colorValue,
		CANVAS_COLORS,
		type CanvasData,
		type CanvasNode,
		type CanvasEdge,
		type CanvasSide
	} from '$lib/canvas';
	import { markdownExcerpt } from '$lib/utils/excerpt';
	import { pushUndo } from '$lib/stores/undo';
	import MarkdownRenderer from '$lib/components/MarkdownRenderer.svelte';
	import NoteIcon from '$lib/components/NoteIcon.svelte';
	import Popover from '$lib/components/Popover.svelte';
	import {
		StickyNote,
		NotebookText,
		Link2,
		SquareDashed,
		ZoomIn,
		ZoomOut,
		Maximize,
		Trash2,
		ArrowUpRight,
		LayoutDashboard,
		Search,
		Palette,
		MoveRight,
		Minus
	} from 'lucide-svelte';

	let canvasId = $derived($page.params.id ?? '');
	let canvasMemory = $derived($memoryObjects.find((m) => m.id === canvasId));
	let byId = $derived(new Map($memoryObjects.map((m) => [m.id, m])));

	let data = $state<CanvasData>({ nodes: [], edges: [] });
	let lastSaved = '';
	let loadedId = '';

	// Load, and follow changes from elsewhere (sync) unless we're mid-gesture.
	$effect(() => {
		const body = canvasMemory?.bodyMarkdown ?? '';
		const id = canvasMemory?.id ?? '';
		untrack(() => {
			if (id !== loadedId) {
				loadedId = id;
				lastSaved = body;
				data = parseCanvas(body);
				requestAnimationFrame(fit);
			} else if (body !== lastSaved && !gesture) {
				lastSaved = body;
				data = parseCanvas(body);
			}
		});
	});

	let saveTimer: ReturnType<typeof setTimeout> | undefined;
	function save() {
		clearTimeout(saveTimer);
		saveTimer = setTimeout(() => {
			if (!canvasId) return;
			lastSaved = serializeCanvas(data);
			updateMemoryObject(canvasId, { bodyMarkdown: lastSaved });
		}, 300);
	}

	function change(fn: (d: CanvasData) => void) {
		fn(data);
		data = { nodes: [...data.nodes], edges: [...data.edges] };
		save();
	}

	const nodeById = (id: string) => data.nodes.find((n) => n.id === id);

	// ---- View -----------------------------------------------------------------

	let viewport: HTMLDivElement | undefined = $state();
	let panX = $state(0);
	let panY = $state(0);
	let zoom = $state(1);

	function toWorld(clientX: number, clientY: number) {
		const r = viewport!.getBoundingClientRect();
		return { x: (clientX - r.left - panX) / zoom, y: (clientY - r.top - panY) / zoom };
	}

	function zoomAt(next: number, clientX?: number, clientY?: number) {
		if (!viewport) return;
		const r = viewport.getBoundingClientRect();
		const cx = (clientX ?? r.left + r.width / 2) - r.left;
		const cy = (clientY ?? r.top + r.height / 2) - r.top;
		const z = Math.max(0.15, Math.min(3, next));
		panX = cx - ((cx - panX) / zoom) * z;
		panY = cy - ((cy - panY) / zoom) * z;
		zoom = z;
	}

	function fit() {
		if (!viewport) return;
		const box = bounds(data.nodes);
		const r = viewport.getBoundingClientRect();
		if (!box) {
			zoom = 1;
			panX = r.width / 2;
			panY = r.height / 3;
			return;
		}
		const z = Math.max(0.15, Math.min(1.25, Math.min((r.width - 80) / box.width, (r.height - 80) / box.height)));
		zoom = z;
		panX = (r.width - box.width * z) / 2 - box.x * z;
		panY = (r.height - box.height * z) / 2 - box.y * z;
	}

	function onWheel(e: WheelEvent) {
		e.preventDefault();
		if (e.ctrlKey || e.metaKey) zoomAt(zoom * Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY);
		else {
			panX -= e.deltaX;
			panY -= e.deltaY;
		}
	}

	// ---- Gestures: pan, move, resize, connect -------------------------------------

	type Gesture =
		| { kind: 'pan'; startX: number; startY: number; panX: number; panY: number }
		| { kind: 'move'; id: string; startX: number; startY: number; origin: { id: string; x: number; y: number }[]; moved: boolean }
		| { kind: 'resize'; id: string; startX: number; startY: number; width: number; height: number }
		| { kind: 'connect'; from: string; side: CanvasSide; x: number; y: number };
	let gesture = $state<Gesture | null>(null);
	let selected = $state<{ kind: 'node' | 'edge'; id: string } | null>(null);
	let editing = $state<string | null>(null);

	function onBoardDown(e: PointerEvent) {
		if (e.button !== 0 || e.target !== e.currentTarget) return;
		selected = null;
		editing = null;
		gesture = { kind: 'pan', startX: e.clientX, startY: e.clientY, panX, panY };
		viewport?.setPointerCapture(e.pointerId);
	}

	function onCardDown(e: PointerEvent, node: CanvasNode) {
		if (e.button !== 0 || editing === node.id) return;
		if ((e.target as HTMLElement).closest('button, a, input, textarea, .canvas-handle')) return;
		e.stopPropagation();
		selected = { kind: 'node', id: node.id };
		const group = node.type === 'group' ? nodesInGroup(node, data.nodes) : [];
		gesture = {
			kind: 'move',
			id: node.id,
			startX: e.clientX,
			startY: e.clientY,
			origin: [node, ...group].map((n) => ({ id: n.id, x: n.x, y: n.y })),
			moved: false
		};
		viewport?.setPointerCapture(e.pointerId);
	}

	function onResizeDown(e: PointerEvent, node: CanvasNode) {
		e.stopPropagation();
		gesture = { kind: 'resize', id: node.id, startX: e.clientX, startY: e.clientY, width: node.width, height: node.height };
		viewport?.setPointerCapture(e.pointerId);
	}

	function onHandleDown(e: PointerEvent, node: CanvasNode, side: CanvasSide) {
		e.stopPropagation();
		const p = toWorld(e.clientX, e.clientY);
		gesture = { kind: 'connect', from: node.id, side, x: p.x, y: p.y };
		viewport?.setPointerCapture(e.pointerId);
	}

	function onMove(e: PointerEvent) {
		const g = gesture;
		if (!g) return;
		if (g.kind === 'pan') {
			panX = g.panX + e.clientX - g.startX;
			panY = g.panY + e.clientY - g.startY;
		} else if (g.kind === 'move') {
			const dx = (e.clientX - g.startX) / zoom;
			const dy = (e.clientY - g.startY) / zoom;
			if (!g.moved && Math.hypot(dx, dy) < 3) return;
			g.moved = true;
			for (const o of g.origin) {
				const n = nodeById(o.id);
				if (n) {
					n.x = Math.round(o.x + dx);
					n.y = Math.round(o.y + dy);
				}
			}
			data = { ...data, nodes: [...data.nodes] };
		} else if (g.kind === 'resize') {
			const n = nodeById(g.id);
			if (!n) return;
			n.width = Math.max(120, Math.round(g.width + (e.clientX - g.startX) / zoom));
			n.height = Math.max(60, Math.round(g.height + (e.clientY - g.startY) / zoom));
			data = { ...data, nodes: [...data.nodes] };
		} else if (g.kind === 'connect') {
			const p = toWorld(e.clientX, e.clientY);
			gesture = { ...g, x: p.x, y: p.y };
		}
	}

	function onUp(e: PointerEvent) {
		const g = gesture;
		gesture = null;
		if (!g) return;
		if (g.kind === 'move' && g.moved) save();
		if (g.kind === 'resize') save();
		if (g.kind === 'connect') {
			const p = toWorld(e.clientX, e.clientY);
			const target = [...data.nodes]
				.reverse()
				.find((n) => n.id !== g.from && p.x >= n.x && p.x <= n.x + n.width && p.y >= n.y && p.y <= n.y + n.height);
			if (target) {
				// No sides stored: the line joins the facing sides, also after cards move.
				const edge: CanvasEdge = { id: newCanvasId(), fromNode: g.from, toNode: target.id, toEnd: 'arrow' };
				change((d) => d.edges.push(edge));
				selected = { kind: 'edge', id: edge.id };
			}
		}
	}

	// ---- Adding cards ---------------------------------------------------------------

	function centre() {
		const r = viewport!.getBoundingClientRect();
		return toWorld(r.left + r.width / 2, r.top + r.height / 2);
	}

	function addNode(node: Omit<CanvasNode, 'id' | 'x' | 'y'> & { x?: number; y?: number }, edit = false) {
		const c = centre();
		const n: CanvasNode = { id: newCanvasId(), x: Math.round(c.x - node.width / 2), y: Math.round(c.y - node.height / 2), ...node } as CanvasNode;
		change((d) => (n.type === 'group' ? d.nodes.unshift(n) : d.nodes.push(n)));
		selected = { kind: 'node', id: n.id };
		if (edit) editing = n.id;
		return n;
	}

	function onBoardDoubleClick(e: MouseEvent) {
		if (e.target !== e.currentTarget) return;
		const p = toWorld(e.clientX, e.clientY);
		addNode({ type: 'text', text: '', width: 260, height: 120, x: Math.round(p.x - 130), y: Math.round(p.y - 60) }, true);
	}

	let pickNoteOpen = $state(false);
	let pickNoteBtn: HTMLButtonElement | undefined = $state();
	let noteQuery = $state('');
	let noteCandidates = $derived(
		$memoryObjects
			.filter((m) => m.type !== 'canvas' && m.id !== canvasId && (m.title || 'Untitled').toLowerCase().includes(noteQuery.trim().toLowerCase()))
			.slice(0, 12)
	);

	function addNote(m: MemoryObject) {
		addNode({ type: 'file', memoryId: m.id, file: `${m.title || 'Untitled'}.md`, width: 300, height: 180 });
		pickNoteOpen = false;
		noteQuery = '';
	}

	let linkOpen = $state(false);
	let linkBtn: HTMLButtonElement | undefined = $state();
	let linkUrl = $state('');

	function addLink() {
		let url = linkUrl.trim();
		if (!url) return;
		if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = `https://${url}`;
		addNode({ type: 'link', url, width: 300, height: 90 });
		linkOpen = false;
		linkUrl = '';
	}

	// ---- Selected item ----------------------------------------------------------------

	let selectedNode = $derived(selected?.kind === 'node' ? nodeById(selected.id) : undefined);
	let selectedEdge = $derived(selected?.kind === 'edge' ? data.edges.find((e) => e.id === selected!.id) : undefined);

	function deleteSelected() {
		if (!selected) return;
		const before = serializeCanvas(data);
		if (selected.kind === 'node') {
			const id = selected.id;
			change((d) => {
				d.nodes = d.nodes.filter((n) => n.id !== id);
				d.edges = d.edges.filter((e) => e.fromNode !== id && e.toNode !== id);
			});
		} else {
			const id = selected.id;
			change((d) => (d.edges = d.edges.filter((e) => e.id !== id)));
		}
		selected = null;
		pushUndo({
			label: 'Removed from the canvas',
			undo: () => {
				data = parseCanvas(before);
				save();
			}
		});
	}

	function setColor(color: string | undefined) {
		const target = selectedNode ?? selectedEdge;
		if (!target) return;
		change(() => {
			if (color) target.color = color;
			else delete target.color;
		});
	}

	function toggleArrow() {
		const e = selectedEdge;
		if (!e) return;
		change(() => (e.toEnd = e.toEnd === 'none' ? 'arrow' : 'none'));
	}

	function onKey(e: KeyboardEvent) {
		const target = e.target as HTMLElement;
		if (target.closest('input, textarea, [contenteditable="true"]')) return;
		if ((e.key === 'Delete' || e.key === 'Backspace') && selected) {
			e.preventDefault();
			deleteSelected();
		} else if (e.key === 'Escape') {
			selected = null;
			editing = null;
		} else if (e.key === 'Enter' && selectedNode && (selectedNode.type === 'text' || selectedNode.type === 'group')) {
			e.preventDefault();
			editing = selectedNode.id;
		}
	}

	function finishEdit(node: CanvasNode, value: string) {
		change(() => {
			if (node.type === 'group') node.label = value;
			else node.text = value;
		});
		editing = null;
		// An empty new text card goes away.
		if (node.type === 'text' && !value.trim()) change((d) => (d.nodes = d.nodes.filter((n) => n.id !== node.id)));
	}

	function openNote(node: CanvasNode) {
		const m = node.memoryId ? byId.get(node.memoryId) : $memoryObjects.find((x) => `${x.title}.md` === node.file);
		if (m) goto(`/memory/${m.id}`);
	}

	const focusEnd = (el: HTMLTextAreaElement | HTMLInputElement) => {
		requestAnimationFrame(() => {
			el.focus();
			el.setSelectionRange(el.value.length, el.value.length);
		});
	};

	function edgeGeometry(e: CanvasEdge) {
		const a = nodeById(e.fromNode);
		const b = nodeById(e.toNode);
		if (!a || !b) return null;
		const [fs, ts] = facingSides(a, b);
		const from = anchor(a, e.fromSide ?? fs);
		const to = anchor(b, e.toSide ?? ts);
		return { d: edgePath(from, e.fromSide ?? fs, to, e.toSide ?? ts), mid: { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 } };
	}

	const SIDES: CanvasSide[] = ['top', 'right', 'bottom', 'left'];
</script>

<svelte:head>
	<title>{canvasMemory?.title || 'Canvas'} - Kurumi</title>
</svelte:head>

<svelte:window onkeydown={onKey} />

{#if canvasMemory}
	<div class="canvas-page">
		<div class="canvas-toolbar">
			<LayoutDashboard class="h-4 w-4 shrink-0 text-[var(--color-text-faint)]" />
			<input
				class="canvas-title"
				value={canvasMemory.title}
				placeholder="Untitled canvas"
				aria-label="Canvas name"
				onchange={(e) => updateMemoryObject(canvasMemory!.id, { title: e.currentTarget.value.trim() })}
			/>
			<span class="flex-1"></span>
			<button type="button" class="k-btn k-btn-ghost" onclick={() => addNode({ type: 'text', text: '', width: 260, height: 120 }, true)} title="Text card (or double-click the board)">
				<StickyNote class="h-3.5 w-3.5" /><span class="hidden sm:inline">Text</span>
			</button>
			<button type="button" class="k-btn k-btn-ghost" bind:this={pickNoteBtn} onclick={() => (pickNoteOpen = !pickNoteOpen)}>
				<NotebookText class="h-3.5 w-3.5" /><span class="hidden sm:inline">Note</span>
			</button>
			<button type="button" class="k-btn k-btn-ghost" bind:this={linkBtn} onclick={() => (linkOpen = !linkOpen)}>
				<Link2 class="h-3.5 w-3.5" /><span class="hidden sm:inline">Link</span>
			</button>
			<button type="button" class="k-btn k-btn-ghost" onclick={() => addNode({ type: 'group', label: 'Group', width: 640, height: 400 }, true)}>
				<SquareDashed class="h-3.5 w-3.5" /><span class="hidden sm:inline">Group</span>
			</button>
			<span class="mx-1 h-4 w-px bg-[var(--color-border)]" aria-hidden="true"></span>
			<button type="button" class="k-icon-btn" onclick={() => zoomAt(zoom / 1.25)} aria-label="Zoom out" title="Zoom out"><ZoomOut class="h-4 w-4" /></button>
			<span class="w-10 text-center text-xs tabular-nums text-[var(--color-text-muted)]">{Math.round(zoom * 100)}%</span>
			<button type="button" class="k-icon-btn" onclick={() => zoomAt(zoom * 1.25)} aria-label="Zoom in" title="Zoom in"><ZoomIn class="h-4 w-4" /></button>
			<button type="button" class="k-icon-btn" onclick={fit} aria-label="Fit to content" title="Fit to content"><Maximize class="h-4 w-4" /></button>
		</div>

		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="canvas-viewport"
			class:is-panning={gesture?.kind === 'pan'}
			bind:this={viewport}
			onwheel={onWheel}
			onpointerdown={onBoardDown}
			onpointermove={onMove}
			onpointerup={onUp}
			ondblclick={onBoardDoubleClick}
			style="background-size: {24 * zoom}px {24 * zoom}px; background-position: {panX}px {panY}px"
		>
			<div class="canvas-world" style="transform: translate({panX}px, {panY}px) scale({zoom})">
				<svg class="canvas-edges" aria-hidden="true">
					<defs>
						<marker id="canvas-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
							<path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" />
						</marker>
					</defs>
					{#each data.edges as edge (edge.id)}
						{@const geo = edgeGeometry(edge)}
						{#if geo}
							<g class="canvas-edge" class:is-selected={selected?.id === edge.id} style="--edge: {colorValue(edge.color) ?? 'var(--color-text-faint)'}">
								<path d={geo.d} class="edge-hit" onpointerdown={(e) => { e.stopPropagation(); selected = { kind: 'edge', id: edge.id }; }} />
								<path d={geo.d} class="edge-line" marker-end={edge.toEnd === 'none' ? undefined : 'url(#canvas-arrow)'} />
							</g>
						{/if}
					{/each}
					{#if gesture?.kind === 'connect'}
						{@const from = nodeById(gesture.from)}
						{#if from}
							{@const a = anchor(from, gesture.side)}
							<path d={edgePath(a, gesture.side, { x: gesture.x, y: gesture.y }, gesture.side === 'left' ? 'right' : gesture.side === 'right' ? 'left' : gesture.side === 'top' ? 'bottom' : 'top')} class="edge-line edge-draft" />
						{/if}
					{/if}
				</svg>

				<!-- Edge labels -->
				{#each data.edges as edge (edge.id)}
					{@const geo = edgeGeometry(edge)}
					{#if geo && edge.label}
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<div class="edge-label" style="left: {geo.mid.x}px; top: {geo.mid.y}px" onpointerdown={(e) => { e.stopPropagation(); selected = { kind: 'edge', id: edge.id }; }}>{edge.label}</div>
					{/if}
				{/each}

				{#each data.nodes as node (node.id)}
					{@const color = colorValue(node.color)}
					{@const memory = node.type === 'file' ? (node.memoryId ? byId.get(node.memoryId) : $memoryObjects.find((m) => `${m.title}.md` === node.file)) : undefined}
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div
						class="canvas-card card-{node.type}"
						class:is-selected={selected?.id === node.id}
						class:is-colored={!!color}
						style="left: {node.x}px; top: {node.y}px; width: {node.width}px; height: {node.height}px; --card: {color ?? 'var(--color-border)'}"
						onpointerdown={(e) => onCardDown(e, node)}
						ondblclick={(e) => {
							e.stopPropagation();
							if (node.type === 'text' || node.type === 'group') editing = node.id;
							else if (node.type === 'file') openNote(node);
						}}
					>
						{#if node.type === 'group'}
							{#if editing === node.id}
								<input class="group-label-input" value={node.label ?? ''} onblur={(e) => finishEdit(node, e.currentTarget.value)} onkeydown={(e) => e.key === 'Enter' && e.currentTarget.blur()} aria-label="Group name" use:focusEnd />
							{:else}
								<span class="group-label">{node.label || 'Group'}</span>
							{/if}
						{:else if node.type === 'text'}
							{#if editing === node.id}
								<textarea
									class="card-editor"
									value={node.text ?? ''}
									placeholder="Write in Markdown…"
									onblur={(e) => finishEdit(node, e.currentTarget.value)}
									onkeydown={(e) => {
										if (e.key === 'Escape') e.currentTarget.blur();
									}}
									aria-label="Card text"
									use:focusEnd
								></textarea>
							{:else}
								<div class="card-body">
									{#if node.text?.trim()}<MarkdownRenderer content={node.text} />{:else}<span class="card-empty">Double-click to write</span>{/if}
								</div>
							{/if}
						{:else if node.type === 'file'}
							{#if memory}
								<div class="card-note-head">
									<NoteIcon icon={memory.icon} class="h-4 w-4 text-[var(--color-text-faint)]" />
									<span class="truncate">{memory.title || 'Untitled'}</span>
									<button type="button" class="card-open" onclick={() => openNote(node)} aria-label="Open note" title="Open note"><ArrowUpRight class="h-3.5 w-3.5" /></button>
								</div>
								<p class="card-note-body">{markdownExcerpt(memory.summaryShort || memory.bodyMarkdown || '', 400)}</p>
							{:else}
								<span class="card-empty">{node.file?.replace(/\.md$/i, '') || 'Note'} isn’t here</span>
							{/if}
						{:else if node.type === 'link'}
							<a class="card-link" href={node.url} target="_blank" rel="noopener noreferrer">
								<span class="card-link-host">{(() => { try { return new URL(node.url ?? '').hostname; } catch { return node.url; } })()}</span>
								<span class="card-link-url">{node.url}</span>
							</a>
						{/if}

						{#if selected?.id === node.id && editing !== node.id}
							{#each SIDES as side (side)}
								<!-- svelte-ignore a11y_no_static_element_interactions -->
								<div class="canvas-handle handle-{side}" onpointerdown={(e) => onHandleDown(e, node, side)} title="Drag to another card to connect"></div>
							{/each}
							<!-- svelte-ignore a11y_no_static_element_interactions -->
							<div class="canvas-resize" onpointerdown={(e) => onResizeDown(e, node)} title="Resize"></div>
						{/if}
					</div>
				{/each}
			</div>

			{#if data.nodes.length === 0}
				<div class="canvas-empty">
					<p>Double-click anywhere for a text card, or add a note, link or group from the toolbar.</p>
				</div>
			{/if}
		</div>

		{#if selectedNode || selectedEdge}
			<div class="canvas-inspector" role="toolbar" aria-label="Selected item">
				<Palette class="h-3.5 w-3.5 text-[var(--color-text-faint)]" />
				<button type="button" class="swatch swatch-none" class:is-on={!(selectedNode ?? selectedEdge)?.color} onclick={() => setColor(undefined)} aria-label="No colour" title="No colour"></button>
				{#each CANVAS_COLORS as c (c.id)}
					<button type="button" class="swatch" class:is-on={(selectedNode ?? selectedEdge)?.color === c.id} style="background: {c.value}" onclick={() => setColor(c.id)} aria-label={c.label} title={c.label}></button>
				{/each}
				{#if selectedEdge}
					<span class="mx-1 h-4 w-px bg-[var(--color-border)]" aria-hidden="true"></span>
					<input
						class="edge-label-input"
						placeholder="Label"
						value={selectedEdge.label ?? ''}
						onchange={(e) => {
							const edge = selectedEdge!;
							const v = e.currentTarget.value.trim();
							change(() => (v ? (edge.label = v) : delete edge.label));
						}}
						aria-label="Connection label"
					/>
					<button type="button" class="k-icon-btn" onclick={toggleArrow} aria-label="Arrow" title="Arrow on or off">
						{#if selectedEdge.toEnd === 'none'}<Minus class="h-4 w-4" />{:else}<MoveRight class="h-4 w-4" />{/if}
					</button>
				{/if}
				<span class="mx-1 h-4 w-px bg-[var(--color-border)]" aria-hidden="true"></span>
				<button type="button" class="k-icon-btn hover:!text-[var(--color-danger)]" onclick={deleteSelected} aria-label="Delete" title="Delete (Backspace)"><Trash2 class="h-4 w-4" /></button>
			</div>
		{/if}
	</div>

	{#if pickNoteOpen && pickNoteBtn}
		<Popover anchor={pickNoteBtn} onClose={() => (pickNoteOpen = false)} width="18rem" label="Add a note">
			<label class="relative mb-1 block">
				<Search class="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-text-faint)]" />
				<input
					class="k-input !h-8 !pl-8 text-sm"
					placeholder="Find a note"
					bind:value={noteQuery}
					onkeydown={(e) => e.key === 'Enter' && noteCandidates[0] && addNote(noteCandidates[0])}
					use:focusEnd
				/>
			</label>
			<div class="max-h-64 overflow-y-auto">
				{#each noteCandidates as m (m.id)}
					<button type="button" class="k-menu-item" onclick={() => addNote(m)}>
						<NoteIcon icon={m.icon} class="h-4 w-4 text-[var(--color-text-faint)]" /><span class="truncate">{m.title || 'Untitled'}</span>
					</button>
				{:else}
					<p class="k-menu-label">No notes match.</p>
				{/each}
			</div>
		</Popover>
	{/if}

	{#if linkOpen && linkBtn}
		<Popover anchor={linkBtn} onClose={() => (linkOpen = false)} width="18rem" label="Add a link">
			<form class="flex gap-1.5 p-1" onsubmit={(e) => { e.preventDefault(); addLink(); }}>
				<input class="k-input !h-8 text-sm" placeholder="https://…" bind:value={linkUrl} aria-label="Link" use:focusEnd />
				<button type="submit" class="k-btn k-btn-primary">Add</button>
			</form>
		</Popover>
	{/if}
{:else}
	<div class="k-empty">
		<LayoutDashboard />
		<p class="k-empty-title">Canvas not found</p>
		<p>It may have been deleted, or be in another vault.</p>
	</div>
{/if}

<style>
	.canvas-page {
		position: relative;
		display: flex;
		height: 100%;
		flex-direction: column;
	}

	.canvas-toolbar {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.375rem 0.75rem;
		border-bottom: 1px solid var(--color-border);
		background: var(--color-bg);
	}

	.canvas-title {
		min-width: 6rem;
		max-width: 22rem;
		flex: 0 1 auto;
		padding: 0.25rem 0.375rem;
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
		background: transparent;
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--color-text);
	}

	.canvas-title:hover,
	.canvas-title:focus {
		border-color: var(--color-border);
		outline: none;
	}

	.canvas-viewport {
		position: relative;
		flex: 1;
		overflow: hidden;
		background-color: var(--color-bg-secondary);
		background-image: radial-gradient(circle, color-mix(in srgb, var(--color-text) 14%, transparent) 1px, transparent 1px);
		cursor: grab;
		touch-action: none;
		user-select: none;
	}

	.canvas-viewport.is-panning {
		cursor: grabbing;
	}

	.canvas-world {
		position: absolute;
		top: 0;
		left: 0;
		transform-origin: 0 0;
	}

	.canvas-edges {
		position: absolute;
		top: 0;
		left: 0;
		width: 1px;
		height: 1px;
		overflow: visible;
		pointer-events: none;
	}

	.canvas-edge .edge-hit {
		fill: none;
		stroke: transparent;
		stroke-width: 14;
		pointer-events: stroke;
		cursor: pointer;
	}

	.edge-line {
		fill: none;
		stroke: var(--edge, var(--color-text-faint));
		stroke-width: 2;
	}

	.canvas-edge.is-selected .edge-line {
		stroke: var(--color-accent);
		stroke-width: 3;
	}

	.edge-draft {
		stroke: var(--color-accent);
		stroke-dasharray: 6 4;
	}

	.edge-label {
		position: absolute;
		z-index: 3;
		padding: 0.125rem 0.375rem;
		border-radius: var(--radius-sm);
		background: var(--color-bg);
		font-size: 0.75rem;
		color: var(--color-text-muted);
		transform: translate(-50%, -50%);
		white-space: nowrap;
		cursor: pointer;
	}

	.canvas-card {
		position: absolute;
		display: flex;
		flex-direction: column;
		border: 1.5px solid var(--card);
		border-radius: var(--radius-lg);
		background: var(--color-bg);
		box-shadow: var(--shadow-sm);
		cursor: default;
		user-select: text;
	}

	.canvas-card.is-colored:not(.card-group) {
		background: color-mix(in srgb, var(--card) 8%, var(--color-bg));
	}

	.canvas-card.is-selected {
		outline: 2px solid var(--color-accent);
		outline-offset: 2px;
		z-index: 4;
	}

	.card-group {
		z-index: 0;
		background: color-mix(in srgb, var(--card) 6%, transparent);
		border-style: dashed;
		box-shadow: none;
	}

	.card-group.is-colored {
		background: color-mix(in srgb, var(--card) 10%, transparent);
	}

	.group-label,
	.group-label-input {
		position: absolute;
		bottom: 100%;
		left: 0;
		margin-bottom: 0.375rem;
		font-size: 1rem;
		font-weight: 600;
		color: var(--color-text-muted);
	}

	.group-label-input {
		padding: 0.125rem 0.25rem;
		border: 1px solid var(--color-accent);
		border-radius: var(--radius-sm);
		background: var(--color-bg);
		color: var(--color-text);
	}

	.card-body {
		flex: 1;
		overflow: auto;
		padding: 0.625rem 0.875rem;
		font-size: 0.875rem;
	}

	.card-body :global(.markdown-content) {
		font-size: 0.875rem;
	}

	.card-body :global(.markdown-content > :first-child) {
		margin-top: 0;
	}

	.card-editor {
		flex: 1;
		width: 100%;
		padding: 0.625rem 0.875rem;
		border: none;
		border-radius: var(--radius-lg);
		background: transparent;
		font-family: var(--font-mono);
		font-size: 0.8125rem;
		line-height: 1.5;
		color: var(--color-text);
		resize: none;
		outline: none;
	}

	.card-empty {
		padding: 0.625rem 0.875rem;
		font-size: 0.8125rem;
		color: var(--color-text-faint);
	}

	.card-note-head {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.5rem 0.75rem;
		border-bottom: 1px solid var(--color-border);
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--color-text);
	}

	.card-open {
		margin-left: auto;
		display: inline-flex;
		padding: 0.125rem;
		border-radius: var(--radius-sm);
		color: var(--color-text-faint);
	}

	.card-open:hover {
		background: var(--color-hover);
		color: var(--color-accent);
	}

	.card-note-body {
		flex: 1;
		overflow: hidden;
		padding: 0.5rem 0.75rem;
		font-size: 0.8125rem;
		line-height: 1.5;
		color: var(--color-text-muted);
	}

	.card-link {
		display: flex;
		flex: 1;
		flex-direction: column;
		justify-content: center;
		gap: 0.125rem;
		padding: 0.5rem 0.875rem;
		text-decoration: none;
		overflow: hidden;
	}

	.card-link-host {
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--color-text);
	}

	.card-link-url {
		overflow: hidden;
		font-size: 0.75rem;
		color: var(--color-accent);
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.canvas-handle {
		position: absolute;
		z-index: 5;
		width: 12px;
		height: 12px;
		border: 2px solid var(--color-accent);
		border-radius: 999px;
		background: var(--color-bg);
		cursor: crosshair;
	}

	.handle-top {
		top: -7px;
		left: calc(50% - 6px);
	}
	.handle-bottom {
		bottom: -7px;
		left: calc(50% - 6px);
	}
	.handle-left {
		left: -7px;
		top: calc(50% - 6px);
	}
	.handle-right {
		right: -7px;
		top: calc(50% - 6px);
	}

	.canvas-resize {
		position: absolute;
		right: -5px;
		bottom: -5px;
		z-index: 5;
		width: 12px;
		height: 12px;
		border-right: 3px solid var(--color-accent);
		border-bottom: 3px solid var(--color-accent);
		cursor: nwse-resize;
	}

	.canvas-empty {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		pointer-events: none;
		font-size: 0.875rem;
		color: var(--color-text-faint);
	}

	.canvas-inspector {
		position: absolute;
		bottom: 1rem;
		left: 50%;
		z-index: 10;
		display: flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.375rem 0.625rem;
		border: 1px solid var(--color-border);
		border-radius: 999px;
		background: var(--color-bg);
		box-shadow: var(--shadow-lg);
		transform: translateX(-50%);
	}

	.swatch {
		width: 1.125rem;
		height: 1.125rem;
		border: 2px solid transparent;
		border-radius: 999px;
	}

	.swatch.is-on {
		border-color: var(--color-text);
	}

	.swatch-none {
		background: linear-gradient(135deg, transparent 45%, var(--color-danger) 45% 55%, transparent 55%), var(--color-bg);
		border-color: var(--color-border);
	}

	.edge-label-input {
		width: 9rem;
		height: 1.75rem;
		padding: 0 0.5rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-bg);
		font-size: 0.8125rem;
		color: var(--color-text);
	}
</style>
