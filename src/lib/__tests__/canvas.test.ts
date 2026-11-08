import { describe, it, expect } from 'vitest';
import { parseCanvas, serializeCanvas, canvasText, facingSides, nodesInGroup, nearestSide } from '$lib/canvas';

describe('canvas', () => {
	it('reads JSON Canvas and keeps unknown fields', () => {
		const json = JSON.stringify({
			nodes: [
				{ id: 'a', type: 'text', x: 0, y: 0, width: 200, height: 100, text: '# Idea', custom: 1 },
				{ id: 'b', type: 'file', x: 300, y: 0, width: 200, height: 100, file: 'Roadmap.md' }
			],
			edges: [{ id: 'e', fromNode: 'a', toNode: 'b', toEnd: 'arrow', label: 'leads to' }, { id: 'x', fromNode: 'a', toNode: 'gone' }]
		});
		const data = parseCanvas(json);
		expect(data.nodes).toHaveLength(2);
		expect((data.nodes[0] as unknown as { custom: number }).custom).toBe(1);
		expect(data.edges.map((e) => e.id)).toEqual(['e']);
		expect(parseCanvas(serializeCanvas(data))).toEqual(data);
	});

	it('upgrades the first canvas format', () => {
		const data = parseCanvas(JSON.stringify({ nodes: [{ id: 'a', memoryId: 'm1', x: 5, y: 6, width: 240, height: 120 }, { id: 'b', memoryId: 'm2', x: 0, y: 0 }], edges: [{ id: 'e', from: 'a', to: 'b' }] }));
		expect(data.nodes[0]).toMatchObject({ type: 'file', memoryId: 'm1', x: 5 });
		expect(data.edges[0]).toEqual({ id: 'e', fromNode: 'a', toNode: 'b' });
	});

	it('gives the text for search, and geometry', () => {
		const data = parseCanvas(JSON.stringify({
			nodes: [
				{ id: 'g', type: 'group', x: 0, y: 0, width: 600, height: 400, label: 'Q4' },
				{ id: 'a', type: 'text', x: 10, y: 10, width: 100, height: 50, text: 'Ship it' },
				{ id: 'b', type: 'file', x: 700, y: 10, width: 100, height: 50, memoryId: 'm1' }
			],
			edges: []
		}));
		expect(canvasText(data, (id) => (id === 'm1' ? 'Roadmap' : undefined))).toBe('Q4\n\nShip it\n\nRoadmap');
		expect(nodesInGroup(data.nodes[0], data.nodes).map((n) => n.id)).toEqual(['a']);
		expect(facingSides(data.nodes[1], data.nodes[2])).toEqual(['right', 'left']);
		expect(nearestSide(data.nodes[1], 60, 58)).toBe('bottom');
	});
});
