/**
 * Knowledge-graph walks for the agent's `explore_graph` tool: start at a
 * person, project, tag or note and follow what connects to it (wikilinks
 * and backlinks, @mentions and participants, projects, tags, and the to-dos,
 * decisions and questions attached to notes, people and projects). The
 * agent answers from the snippets; the chat draws the nodes and edges
 * (GraphFragment.svelte) as the path it took.
 *
 * Pure: takes the records, returns a small neighbourhood. Fan-out per node
 * and the total are capped so the result fits in a prompt.
 */

import { parseWikilink } from '$lib/wikilinks';

export type GraphNodeKind = 'note' | 'person' | 'project' | 'tag' | 'todo' | 'decision' | 'question';

export interface GraphNode {
	id: string; // kind:key, e.g. note:<id>, person:ana ruiz
	kind: GraphNodeKind;
	label: string;
	depth: number;
	snippet: string;
	/** Where it opens in the app. */
	href: string | null;
}

export interface GraphEdge {
	from: string;
	to: string;
	label: string;
}

export interface Neighbourhood {
	start: GraphNode | null;
	nodes: GraphNode[];
	edges: GraphEdge[];
}

export interface GraphData {
	notes: { id: string; title: string; bodyMarkdown: string; summaryShort?: string | null; participants?: string[]; projects?: string[]; tags?: string[]; updatedAt: number; deletedAt?: number | null }[];
	projects: { id: string; name: string; status: string; description: string }[];
	todos: { id: string; text: string; status: string; dueDate: string | null; assignee: string | null; memoryObjectId: string | null; projectId?: string | null }[];
	decisions: { id: string; text: string; rationale: string; decidedOn: string; decidedBy: string[]; memoryId: string | null; projectId: string | null }[];
	questions: { id: string; text: string; status: string; assignee: string | null; memoryId: string | null; projectId: string | null }[];
}

const MENTION = /@([A-Z][a-zA-Z]+(?: [A-Z][a-zA-Z]+)*)/g;
const LINK = /!?\[\[([^\]\n]+)\]\]/g;
const key = (s: string) => s.trim().toLowerCase();
const clip = (s: string, n = 220) => {
	const flat = s.replace(/\s+/g, ' ').trim();
	return flat.length > n ? `${flat.slice(0, n - 1)}…` : flat;
};

/** Index the records once for walking. */
function index(data: GraphData) {
	const notes = data.notes.filter((n) => !n.deletedAt);
	const byTitle = new Map<string, (typeof notes)[number]>();
	for (const n of notes) if (n.title) byTitle.set(key(n.title), n);
	const linksOut = new Map<string, string[]>();
	const linksIn = new Map<string, string[]>();
	const mentions = new Map<string, string[]>(); // note id → people
	for (const n of notes) {
		const targets = new Set<string>();
		for (const m of n.bodyMarkdown.matchAll(LINK)) {
			const target = byTitle.get(key(parseWikilink(m[1]).target));
			if (target && target.id !== n.id) targets.add(target.id);
		}
		linksOut.set(n.id, [...targets]);
		for (const t of targets) linksIn.set(t, [...(linksIn.get(t) ?? []), n.id]);
		const people = new Set<string>((n.participants ?? []).map((p) => p.trim()).filter(Boolean));
		for (const m of n.bodyMarkdown.matchAll(MENTION)) people.add(m[1]);
		mentions.set(n.id, [...people]);
	}
	return { notes, byId: new Map(notes.map((n) => [n.id, n])), byTitle, linksOut, linksIn, mentions };
}

type Index = ReturnType<typeof index>;

/** Find where to start: a person, project, tag (#x) or note named like `query`. */
export function resolveStart(query: string, data: GraphData, idx: Index = index(data)): GraphNode | null {
	const q = key(query.replace(/^[@#]/, ''));
	if (!q) return null;
	if (query.trim().startsWith('#')) return tagNode(q, 0, idx);
	const people = new Set<string>();
	for (const list of idx.mentions.values()) for (const p of list) people.add(p);
	for (const t of data.todos) if (t.assignee) people.add(t.assignee);
	const exact = <T>(items: T[], name: (t: T) => string) => items.find((i) => key(name(i)) === q);
	const partial = <T>(items: T[], name: (t: T) => string) => items.find((i) => key(name(i)).includes(q));
	const person = exact([...people], (p) => p);
	if (person) return personNode(person, 0, data, idx);
	const project = exact(data.projects, (p) => p.name);
	if (project) return projectNode(project, 0);
	const note = idx.byTitle.get(q);
	if (note) return noteNode(note, 0);
	const tags = new Set(idx.notes.flatMap((n) => (n.tags ?? []).map(key)));
	if (tags.has(q)) return tagNode(q, 0, idx);
	const p2 = partial([...people], (p) => p);
	if (p2) return personNode(p2, 0, data, idx);
	const pr2 = partial(data.projects, (p) => p.name);
	if (pr2) return projectNode(pr2, 0);
	const n2 = partial(idx.notes, (n) => n.title);
	return n2 ? noteNode(n2, 0) : null;
}

function noteNode(n: GraphData['notes'][number], depth: number): GraphNode {
	return { id: `note:${n.id}`, kind: 'note', label: n.title || 'Untitled', depth, snippet: clip(n.summaryShort || n.bodyMarkdown), href: `/memory/${n.id}` };
}
function personNode(name: string, depth: number, data: GraphData, idx: Index): GraphNode {
	const notes = [...idx.mentions.entries()].filter(([, ps]) => ps.some((p) => key(p) === key(name))).length;
	const open = data.todos.filter((t) => t.assignee && key(t.assignee) === key(name) && (t.status === 'open' || t.status === 'in_progress')).length;
	return { id: `person:${key(name)}`, kind: 'person', label: name, depth, snippet: `Mentioned in ${notes} note${notes === 1 ? '' : 's'}; ${open} open to-do${open === 1 ? '' : 's'} assigned.`, href: `/people/${encodeURIComponent(name)}` };
}
function projectNode(p: GraphData['projects'][number], depth: number): GraphNode {
	return { id: `project:${p.id}`, kind: 'project', label: p.name, depth, snippet: clip(`${p.status}. ${p.description}`), href: `/projects/${p.id}` };
}
function tagNode(tag: string, depth: number, idx: Index): GraphNode {
	const count = idx.notes.filter((n) => (n.tags ?? []).some((t) => key(t) === tag)).length;
	return { id: `tag:${tag}`, kind: 'tag', label: `#${tag}`, depth, snippet: `${count} note${count === 1 ? '' : 's'}.`, href: `/read/tag/${encodeURIComponent(tag)}` };
}
const todoNode = (t: GraphData['todos'][number], depth: number): GraphNode => ({
	id: `todo:${t.id}`,
	kind: 'todo',
	label: t.text,
	depth,
	snippet: `To-do, ${t.status.replace('_', ' ')}${t.dueDate ? `, due ${t.dueDate}` : ''}${t.assignee ? `, assigned to ${t.assignee}` : ''}.`,
	href: '/actions'
});
const decisionNode = (d: GraphData['decisions'][number], depth: number): GraphNode => ({
	id: `decision:${d.id}`,
	kind: 'decision',
	label: d.text,
	depth,
	snippet: clip(`Decided${d.decidedOn ? ` ${d.decidedOn}` : ''}${d.decidedBy.length ? ` by ${d.decidedBy.join(', ')}` : ''}. ${d.rationale}`),
	href: '/decisions'
});
const questionNode = (q: GraphData['questions'][number], depth: number): GraphNode => ({
	id: `question:${q.id}`,
	kind: 'question',
	label: q.text,
	depth,
	snippet: `Question, ${q.status}${q.assignee ? `, for ${q.assignee}` : ''}.`,
	href: '/questions'
});

/** What a node connects to, most relevant first, with the edge label. */
function neighbours(node: GraphNode, data: GraphData, idx: Index, perNode: number): { node: GraphNode; label: string }[] {
	const d = node.depth + 1;
	const out: { node: GraphNode; label: string }[] = [];
	const [kind, ...rest] = node.id.split(':');
	const id = rest.join(':');
	const recent = <T extends { updatedAt: number }>(items: T[]) => [...items].sort((a, b) => b.updatedAt - a.updatedAt);
	switch (kind) {
		case 'note': {
			const n = idx.byId.get(id);
			if (!n) break;
			for (const t of idx.linksOut.get(id) ?? []) out.push({ node: noteNode(idx.byId.get(t)!, d), label: 'links to' });
			for (const t of idx.linksIn.get(id) ?? []) out.push({ node: noteNode(idx.byId.get(t)!, d), label: 'linked from' });
			for (const p of idx.mentions.get(id) ?? []) out.push({ node: personNode(p, d, data, idx), label: 'mentions' });
			for (const name of n.projects ?? []) {
				const p = data.projects.find((x) => key(x.name) === key(name));
				if (p) out.push({ node: projectNode(p, d), label: 'in project' });
			}
			for (const t of data.todos.filter((t) => t.memoryObjectId === id)) out.push({ node: todoNode(t, d), label: 'to-do' });
			for (const x of data.decisions.filter((x) => x.memoryId === id)) out.push({ node: decisionNode(x, d), label: 'decided' });
			for (const x of data.questions.filter((x) => x.memoryId === id)) out.push({ node: questionNode(x, d), label: 'asks' });
			for (const tag of n.tags ?? []) out.push({ node: tagNode(key(tag), d, idx), label: 'tagged' });
			break;
		}
		case 'person': {
			const same = (s: string | null | undefined) => !!s && key(s) === id;
			for (const t of data.todos.filter((t) => same(t.assignee) && (t.status === 'open' || t.status === 'in_progress'))) out.push({ node: todoNode(t, d), label: 'assigned' });
			for (const q of data.questions.filter((q) => same(q.assignee) && q.status === 'open')) out.push({ node: questionNode(q, d), label: 'asked to answer' });
			for (const x of data.decisions.filter((x) => x.decidedBy.some(same))) out.push({ node: decisionNode(x, d), label: 'decided' });
			const notes = recent(idx.notes.filter((n) => (idx.mentions.get(n.id) ?? []).some(same)));
			for (const n of notes) out.push({ node: noteNode(n, d), label: 'mentioned in' });
			break;
		}
		case 'project': {
			const p = data.projects.find((x) => x.id === id);
			if (!p) break;
			const notes = recent(idx.notes.filter((n) => (n.projects ?? []).some((x) => key(x) === key(p.name))));
			const noteIds = new Set(notes.map((n) => n.id));
			for (const x of data.decisions.filter((x) => x.projectId === id || (x.memoryId && noteIds.has(x.memoryId)))) out.push({ node: decisionNode(x, d), label: 'decided' });
			for (const t of data.todos.filter((t) => (t.status === 'open' || t.status === 'in_progress') && (t.projectId === id || (t.memoryObjectId && noteIds.has(t.memoryObjectId))))) out.push({ node: todoNode(t, d), label: 'to-do' });
			for (const q of data.questions.filter((q) => q.status === 'open' && (q.projectId === id || (q.memoryId && noteIds.has(q.memoryId))))) out.push({ node: questionNode(q, d), label: 'open question' });
			for (const n of notes) out.push({ node: noteNode(n, d), label: 'note' });
			break;
		}
		case 'tag':
			for (const n of recent(idx.notes.filter((n) => (n.tags ?? []).some((t) => key(t) === id)))) out.push({ node: noteNode(n, d), label: 'tagged' });
			break;
		case 'todo':
		case 'decision':
		case 'question': {
			const rec =
				kind === 'todo' ? data.todos.find((x) => x.id === id) : kind === 'decision' ? data.decisions.find((x) => x.id === id) : data.questions.find((x) => x.id === id);
			if (!rec) break;
			const noteId = 'memoryObjectId' in rec ? rec.memoryObjectId : rec.memoryId;
			const source = noteId ? idx.byId.get(noteId) : undefined;
			if (source) out.push({ node: noteNode(source, d), label: 'from' });
			const project = rec.projectId ? data.projects.find((p) => p.id === rec.projectId) : undefined;
			if (project) out.push({ node: projectNode(project, d), label: 'in project' });
			const people = 'decidedBy' in rec ? rec.decidedBy : rec.assignee ? [rec.assignee] : [];
			for (const p of people) out.push({ node: personNode(p, d, data, idx), label: kind === 'decision' ? 'decided by' : 'assigned to' });
			break;
		}
	}
	return out.slice(0, perNode);
}

/** Breadth-first walk from `query` up to `depth` steps, at most `limit` nodes. */
export function exploreGraph(query: string, data: GraphData, options: { depth?: number; limit?: number; perNode?: number } = {}): Neighbourhood {
	const depth = Math.min(Math.max(options.depth ?? 2, 1), 3);
	const limit = options.limit ?? 30;
	const perNode = options.perNode ?? 8;
	const idx = index(data);
	const start = resolveStart(query, data, idx);
	if (!start) return { start: null, nodes: [], edges: [] };
	const nodes = new Map<string, GraphNode>([[start.id, start]]);
	const edges: GraphEdge[] = [];
	const seenEdge = new Set<string>();
	let frontier = [start];
	while (frontier.length && nodes.size < limit) {
		const next: GraphNode[] = [];
		for (const node of frontier) {
			if (node.depth >= depth) continue;
			for (const { node: n, label } of neighbours(node, data, idx, perNode)) {
				const edgeKey = [node.id, n.id].sort().join('→');
				if (!nodes.has(n.id)) {
					if (nodes.size >= limit) break;
					nodes.set(n.id, n);
					next.push(n);
				}
				if (!seenEdge.has(edgeKey)) {
					seenEdge.add(edgeKey);
					edges.push({ from: node.id, to: n.id, label });
				}
			}
		}
		frontier = next;
	}
	return { start, nodes: [...nodes.values()], edges: edges.filter((e) => nodes.has(e.from) && nodes.has(e.to)) };
}
