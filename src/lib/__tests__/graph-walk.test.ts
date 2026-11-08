import { describe, expect, it } from 'vitest';
import { exploreGraph, resolveStart, type GraphData } from '$lib/graph-walk';

const data: GraphData = {
	notes: [
		{ id: 'n1', title: 'Q4 planning', bodyMarkdown: 'With @Alice Chen. See [[Roadmap|the roadmap]].', participants: [], projects: ['Falcon'], tags: ['planning'], updatedAt: 3 },
		{ id: 'n2', title: 'Roadmap', bodyMarkdown: 'Ship in March.', updatedAt: 2 },
		{ id: 'n3', title: '1:1 Alice', bodyMarkdown: 'Priorities: hiring.', participants: ['Alice Chen'], updatedAt: 5 },
		{ id: 'n4', title: 'Groceries', bodyMarkdown: 'Milk.', updatedAt: 9 },
		{ id: 'gone', title: 'Old', bodyMarkdown: '@Alice Chen', updatedAt: 1, deletedAt: 5 }
	],
	projects: [{ id: 'p1', name: 'Falcon', status: 'active', description: 'Launch.' }],
	todos: [
		{ id: 't1', text: 'Draft hiring plan', status: 'open', dueDate: '2026-11-20', assignee: 'Alice Chen', memoryObjectId: 'n3' },
		{ id: 't2', text: 'Done thing', status: 'done', dueDate: null, assignee: 'Alice Chen', memoryObjectId: null }
	],
	decisions: [{ id: 'd1', text: 'Hire two engineers', rationale: 'Backlog', decidedOn: '2026-11-01', decidedBy: ['Alice Chen'], memoryId: 'n3', projectId: 'p1' }],
	questions: []
};

describe('graph walk', () => {
	it('resolves people, projects, tags and notes, exact before partial', () => {
		expect(resolveStart('Alice Chen', data)?.id).toBe('person:alice chen');
		expect(resolveStart('@alice', data)?.id).toBe('person:alice chen');
		expect(resolveStart('Falcon', data)?.id).toBe('project:p1');
		expect(resolveStart('#planning', data)?.id).toBe('tag:planning');
		expect(resolveStart('roadmap', data)?.id).toBe('note:n2');
		expect(resolveStart('nothing like it', data)).toBeNull();
	});

	it("walks from a person to their to-dos, decisions and notes, then what those link to", () => {
		const g = exploreGraph('Alice Chen', data, { depth: 2 });
		const ids = g.nodes.map((n) => n.id);
		expect(ids[0]).toBe('person:alice chen');
		expect(ids).toEqual(expect.arrayContaining(['todo:t1', 'decision:d1', 'note:n3', 'note:n1', 'note:n2', 'project:p1']));
		expect(ids).not.toContain('todo:t2'); // done
		expect(ids).not.toContain('note:n4'); // unrelated
		expect(ids).not.toContain('note:gone'); // deleted
		expect(g.edges).toContainEqual({ from: 'note:n1', to: 'note:n2', label: 'links to' });
		expect(g.nodes.find((n) => n.id === 'todo:t1')?.snippet).toBe('To-do, open, due 2026-11-20, assigned to Alice Chen.');
		// Every edge joins nodes that are in the result.
		for (const e of g.edges) expect(ids).toEqual(expect.arrayContaining([e.from, e.to]));
	});

	it('respects depth and limits', () => {
		expect(exploreGraph('Roadmap', data, { depth: 1 }).nodes.map((n) => n.id)).toEqual(['note:n2', 'note:n1']);
		expect(exploreGraph('Alice Chen', data, { limit: 3 }).nodes).toHaveLength(3);
	});
});
