/**
 * Canvases: a board of cards and connections, stored in a memory of type
 * 'canvas' as JSON Canvas (https://jsoncanvas.org, Obsidian's `.canvas`
 * format) in its body, so they import and export as is. Kurumi adds
 * `memoryId` to note cards, so they follow a renamed note; `file` keeps the
 * note's title as `Title.md` for other apps.
 */

export type CanvasSide = 'top' | 'right' | 'bottom' | 'left';
export type CanvasColor = '1' | '2' | '3' | '4' | '5' | '6';

export interface CanvasNode {
	id: string;
	type: 'text' | 'file' | 'link' | 'group';
	x: number;
	y: number;
	width: number;
	height: number;
	color?: CanvasColor | string;
	text?: string; // text cards (markdown)
	file?: string; // note cards: "Title.md"
	memoryId?: string; // note cards, Kurumi
	url?: string; // link cards
	label?: string; // groups
}

export interface CanvasEdge {
	id: string;
	fromNode: string;
	fromSide?: CanvasSide;
	toNode: string;
	toSide?: CanvasSide;
	toEnd?: 'none' | 'arrow';
	label?: string;
	color?: CanvasColor | string;
}

export interface CanvasData {
	nodes: CanvasNode[];
	edges: CanvasEdge[];
}

/** JSON Canvas's preset colours: red, orange, yellow, green, cyan, purple. */
export const CANVAS_COLORS: { id: CanvasColor; label: string; value: string }[] = [
	{ id: '1', label: 'Red', value: '#e5484d' },
	{ id: '2', label: 'Orange', value: '#f76b15' },
	{ id: '3', label: 'Yellow', value: '#e2b100' },
	{ id: '4', label: 'Green', value: '#30a46c' },
	{ id: '5', label: 'Cyan', value: '#0d9fbe' },
	{ id: '6', label: 'Purple', value: '#8e4ec6' }
];

export function colorValue(color: string | undefined): string | null {
	if (!color) return null;
	return CANVAS_COLORS.find((c) => c.id === color)?.value ?? (/^#[0-9a-f]{3,8}$/i.test(color) ? color : null);
}

export function newCanvasId(): string {
	return Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('');
}

const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/**
 * A canvas from a memory's body: JSON Canvas, or Kurumi's first canvas
 * format (`{ nodes: [{ memoryId, x, y, … }], edges: [{ from, to }] }`).
 */
export function parseCanvas(body: string | null | undefined): CanvasData {
	let raw: { nodes?: unknown; edges?: unknown };
	try {
		raw = JSON.parse(body || '{}');
	} catch {
		return { nodes: [], edges: [] };
	}
	const nodes: CanvasNode[] = [];
	for (const n of Array.isArray(raw.nodes) ? raw.nodes : []) {
		if (!n || typeof n !== 'object' || typeof n.id !== 'string') continue;
		const type = ['text', 'file', 'link', 'group'].includes(n.type) ? n.type : n.memoryId ? 'file' : 'text';
		nodes.push({
			...n,
			type,
			x: num(n.x, 0),
			y: num(n.y, 0),
			width: num(n.width, 260),
			height: num(n.height, type === 'group' ? 300 : 140)
		});
	}
	const ids = new Set(nodes.map((n) => n.id));
	const edges: CanvasEdge[] = [];
	for (const e of Array.isArray(raw.edges) ? raw.edges : []) {
		if (!e || typeof e !== 'object' || typeof e.id !== 'string') continue;
		const fromNode = e.fromNode ?? e.from;
		const toNode = e.toNode ?? e.to;
		if (!ids.has(fromNode) || !ids.has(toNode)) continue;
		const { from: _f, to: _t, ...rest } = e;
		edges.push({ ...rest, fromNode, toNode });
	}
	return { nodes, edges };
}

export function serializeCanvas(data: CanvasData): string {
	return JSON.stringify(data, null, '\t');
}

/** The text of a canvas, for search and previews: text cards, labels, note titles, links. */
export function canvasText(data: CanvasData, titleOf: (memoryId: string) => string | undefined = () => undefined): string {
	const parts: string[] = [];
	for (const n of data.nodes) {
		if (n.type === 'text' && n.text) parts.push(n.text);
		else if (n.type === 'group' && n.label) parts.push(n.label);
		else if (n.type === 'file') parts.push((n.memoryId && titleOf(n.memoryId)) || (n.file ?? '').replace(/\.md$/i, ''));
		else if (n.type === 'link' && n.url) parts.push(n.url);
	}
	for (const e of data.edges) if (e.label) parts.push(e.label);
	return parts.filter(Boolean).join('\n\n');
}

/** Where an edge meets a card's side. */
export function anchor(node: CanvasNode, side: CanvasSide): { x: number; y: number } {
	switch (side) {
		case 'top':
			return { x: node.x + node.width / 2, y: node.y };
		case 'bottom':
			return { x: node.x + node.width / 2, y: node.y + node.height };
		case 'left':
			return { x: node.x, y: node.y + node.height / 2 };
		case 'right':
			return { x: node.x + node.width, y: node.y + node.height / 2 };
	}
}

/** The sides two cards face each other on (for edges without sides). */
export function facingSides(a: CanvasNode, b: CanvasNode): [CanvasSide, CanvasSide] {
	const dx = b.x + b.width / 2 - (a.x + a.width / 2);
	const dy = b.y + b.height / 2 - (a.y + a.height / 2);
	if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? ['right', 'left'] : ['left', 'right'];
	return dy > 0 ? ['bottom', 'top'] : ['top', 'bottom'];
}

/** The side of `node` nearest to a point. */
export function nearestSide(node: CanvasNode, x: number, y: number): CanvasSide {
	const d: [CanvasSide, number][] = [
		['top', Math.abs(y - node.y)],
		['bottom', Math.abs(y - (node.y + node.height))],
		['left', Math.abs(x - node.x)],
		['right', Math.abs(x - (node.x + node.width))]
	];
	return d.sort((a, b) => a[1] - b[1])[0][0];
}

const OUT: Record<CanvasSide, [number, number]> = { top: [0, -1], bottom: [0, 1], left: [-1, 0], right: [1, 0] };

/** An SVG path for an edge: a curve leaving and entering square to the sides. */
export function edgePath(from: { x: number; y: number }, fromSide: CanvasSide, to: { x: number; y: number }, toSide: CanvasSide): string {
	const dist = Math.max(40, Math.hypot(to.x - from.x, to.y - from.y) / 2.5);
	const [fx, fy] = OUT[fromSide];
	const [tx, ty] = OUT[toSide];
	return `M ${from.x} ${from.y} C ${from.x + fx * dist} ${from.y + fy * dist}, ${to.x + tx * dist} ${to.y + ty * dist}, ${to.x} ${to.y}`;
}

/** Cards inside a group (their centre within it), which move with it. */
export function nodesInGroup(group: CanvasNode, nodes: CanvasNode[]): CanvasNode[] {
	return nodes.filter((n) => {
		if (n.id === group.id) return false;
		const cx = n.x + n.width / 2;
		const cy = n.y + n.height / 2;
		return cx > group.x && cx < group.x + group.width && cy > group.y && cy < group.y + group.height;
	});
}

/** The box around every card (for "fit to content"). */
export function bounds(nodes: CanvasNode[]): { x: number; y: number; width: number; height: number } | null {
	if (nodes.length === 0) return null;
	const x1 = Math.min(...nodes.map((n) => n.x));
	const y1 = Math.min(...nodes.map((n) => n.y));
	const x2 = Math.max(...nodes.map((n) => n.x + n.width));
	const y2 = Math.max(...nodes.map((n) => n.y + n.height));
	return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}
