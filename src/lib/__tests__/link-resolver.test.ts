import { describe, expect, it } from 'vitest';
import { buildLinkIndex, extractLinkTargets, type LinkableNote } from '$lib/linked/links';
import { exploreGraph, type GraphData } from '$lib/graph-walk';

interface Note extends LinkableNote {
	bodyMarkdown: string;
}
const note = (id: string, title: string, bodyMarkdown = ''): Note => ({ id, title, bodyMarkdown });

// The rules as the call sites had them before the resolver, written out again
// here so title mode can be checked against them.
const oldFindByTitle = (notes: Note[], title: string) => notes.find((m) => m.title.toLowerCase() === title.toLowerCase());
const oldMapByTitle = (notes: Note[], title: string) =>
	new Map(notes.map((m) => [m.title.trim().toLowerCase(), m])).get(title.trim().toLowerCase());
const oldBacklinks = (notes: Note[], id: string) => {
	const title = notes.find((m) => m.id === id)!.title.toLowerCase();
	return notes.filter((m) => m.id !== id && extractLinkTargets(m.bodyMarkdown).some((link) => link.toLowerCase() === title));
};

const vault: Note[] = [
	note('a', 'Alpha', 'See [[beta]], [[Beta|the second]] and [[Gamma#Plan]].'),
	note('b', 'Beta', 'Back to [[ALPHA]]. A block: [[Alpha#^a1b2c3]]. Itself: [[Beta#Notes]].'),
	note('c', 'Gamma', '| t |\n| - |\n| [[Alpha\\|first]] |\n\nEscaped: \\[\\[Delta]]. Nothing: [[Nowhere]]. Here: [[#Plan]].'),
	note('d', 'Delta', '[[Twin]] and ![[Gamma#^blk]]'),
	note('t1', 'Twin', ''),
	note('t2', 'twin', '[[delta]]'),
	note('u', '', '[[Alpha]]'),
	note('p', ' Padded ', '[[Padded]]')
];
const ids = (notes: { id: string }[]) => notes.map((n) => n.id);

describe('link targets', () => {
	it('reads the target only: no alias, heading or block', () => {
		expect(extractLinkTargets(vault[0].bodyMarkdown)).toEqual(['beta', 'Beta', 'Gamma']);
		expect(extractLinkTargets(vault[1].bodyMarkdown)).toEqual(['ALPHA', 'Alpha', 'Beta']);
		// A table's escaped bar, Milkdown's escaped brackets; [[#Plan]] has no target.
		expect(extractLinkTargets(vault[2].bodyMarkdown)).toEqual(['Alpha', 'Delta', 'Nowhere']);
		expect(extractLinkTargets(null)).toEqual([]);
	});
});

describe('link resolver, title mode', () => {
	const links = buildLinkIndex(vault);

	it('resolves like the old case-insensitive title search', () => {
		for (const target of ['Alpha', 'alpha', 'ALPHA', 'Beta', 'twin', 'TWIN', 'Nowhere', '', 'Padded', ' Padded ', ' padded ']) {
			expect(links.resolve(target)?.id, target).toBe(oldFindByTitle(vault, target)?.id);
		}
		// The first of two notes with one title; an untitled note answers the empty target.
		expect(links.resolve('TWIN')?.id).toBe('t1');
		expect(links.resolve('')?.id).toBe('u');
		// Spaces count unless asked otherwise.
		expect(links.resolve('Padded')).toBeUndefined();
	});

	it('resolves like the old title map with trim and last-wins (the graph)', () => {
		const graph = buildLinkIndex(vault, { trim: true, prefer: 'last' });
		for (const target of ['Alpha', ' alpha ', 'Twin', 'twin', 'Padded', ' padded', 'Nowhere']) {
			expect(graph.resolve(target)?.id, target).toBe(oldMapByTitle(vault, target)?.id);
		}
		expect(graph.resolve('Twin')?.id).toBe('t2');
		expect(graph.resolve('padded')?.id).toBe('p');
	});

	it('finds backlinks like the old scan, through aliases, headings and block refs', () => {
		for (const n of vault) expect(ids(links.backlinks(n.id)), n.id).toEqual(ids(oldBacklinks(vault, n.id)));
		expect(ids(links.backlinks('a'))).toEqual(['b', 'c', 'u']);
		expect(ids(links.backlinks('b'))).toEqual(['a']); // twice in a, once here; not from itself
		expect(ids(links.backlinks('c'))).toEqual(['a', 'd']);
		// Both notes titled "Twin" are linked from d, as before.
		expect(ids(links.backlinks('t1'))).toEqual(['d']);
		expect(ids(links.backlinks('t2'))).toEqual(['d']);
		expect(links.backlinks('u')).toEqual([]);
		expect(links.backlinks('missing')).toEqual([]);
		// The padded title is only reached when spaces are ignored (unlinked mentions).
		expect(links.backlinks('p')).toEqual([]);
		expect(buildLinkIndex([...vault, note('q', 'Q', '[[padded]]')], { trim: true }).backlinks('p').map((n) => n.id)).toEqual(['q']);
	});

	it('lists outgoing notes once each, without the note itself', () => {
		expect(ids(links.outgoing('a'))).toEqual(['b', 'c']);
		expect(ids(links.outgoing('b'))).toEqual(['a']);
		expect(ids(links.outgoing('c'))).toEqual(['a', 'd']);
		expect(ids(links.outgoing('d'))).toEqual(['t1', 'c']);
		expect(links.outgoing('missing')).toEqual([]);
	});

	it('says whether a link is a link to a note, whichever twin resolves', () => {
		expect(links.isLinkTo('ALPHA', vault[0])).toBe(true);
		expect(links.isLinkTo('Beta', vault[0])).toBe(false);
		expect(links.isLinkTo('twin', vault[4])).toBe(true);
		expect(links.isLinkTo('Twin', vault[5])).toBe(true);
		// A note that isn't in the index still knows its own title.
		expect(links.isLinkTo('loose', note('x', 'Loose'))).toBe(true);
	});

	it('uses the title as the key and reports shared titles', () => {
		expect(links.keyOf(vault[0])).toBe('Alpha');
		expect(links.keyOf(vault[6])).toBe('');
		expect(links.duplicates()).toEqual([{ key: 'Twin', ids: ['t1', 't2'] }]);
		// Several untitled notes aren't duplicates of each other.
		expect(buildLinkIndex([note('1', ''), note('2', '')]).duplicates()).toEqual([]);
	});
});

describe('link resolver, key mode', () => {
	interface Linked extends Note {
		key?: string;
		file: string;
	}
	const linked = (id: string, key: string | undefined, title: string, file: string, bodyMarkdown = ''): Linked => ({ id, key, title, file, bodyMarkdown });
	const notes: Linked[] = [
		linked('1', 'project.foo', 'Foo launch', 'foo-launch', 'Depends on [[project.bar|Bar]] and [[Loose note#Open]].'),
		linked('2', 'project.bar', 'Bar', 'bar', '[[PROJECT.FOO#^b1]] [[foo-launch]] [[bar]]'),
		linked('3', undefined, 'Loose note', 'loose', '[[Project.Foo]] [[project.gone]]'),
		linked('4', 'bar', 'Other', 'other', '[[Bar]]'),
		linked('5', 'project.foo', 'Foo copy', 'foo-copy', ''),
		linked('6', '  ', '', 'untitled', '[[Other]] [[other]]')
	];
	const links = buildLinkIndex(notes, { linkKeyOf: (n) => n.key, fallbacks: [(n) => n.title, (n) => n.file] });

	it('resolves dotted ids, case-insensitively', () => {
		expect(links.resolve('project.bar')?.id).toBe('2');
		expect(links.resolve('Project.Bar')?.id).toBe('2');
		expect(links.resolve(' project.bar ')?.id).toBe('2');
		expect(links.resolve('project.gone')).toBeUndefined();
		expect(links.resolve('')).toBeUndefined();
	});

	it('falls back to the title, then the filename', () => {
		expect(links.resolve('Loose note')?.id).toBe('3');
		expect(links.resolve('foo launch')?.id).toBe('1');
		expect(links.resolve('foo-launch')?.id).toBe('1');
		expect(links.resolve('untitled')?.id).toBe('6');
		// A key beats a title: "bar" is note 4's key before it is note 2's title.
		expect(links.resolve('Bar')?.id).toBe('4');
		// Without fallbacks given, the title is the only one.
		const titleOnly = buildLinkIndex(notes, { linkKeyOf: (n) => n.key });
		expect(titleOnly.resolve('Loose note')?.id).toBe('3');
		expect(titleOnly.resolve('loose')).toBeUndefined();
		expect(buildLinkIndex(notes, { linkKeyOf: (n) => n.key, fallbacks: [] }).resolve('Loose note')).toBeUndefined();
	});

	it('gives the first note a duplicate key and reports the duplicates', () => {
		expect(links.resolve('project.foo')?.id).toBe('1');
		expect(links.duplicates()).toEqual([{ key: 'project.foo', ids: ['1', '5'] }]);
		expect(buildLinkIndex(notes, { linkKeyOf: (n) => n.key, prefer: 'last' }).resolve('project.foo')?.id).toBe('5');
	});

	it('names what a link should contain: the key, else the first fallback', () => {
		expect(links.keyOf(notes[0])).toBe('project.foo');
		expect(links.keyOf(notes[2])).toBe('Loose note');
		expect(links.keyOf(notes[5])).toBe('untitled');
	});

	it('follows links by key through aliases, headings and block refs', () => {
		expect(ids(links.outgoing('1'))).toEqual(['2', '3']);
		expect(ids(links.outgoing('2'))).toEqual(['1', '4']);
		expect(ids(links.outgoing('3'))).toEqual(['1']);
		expect(ids(links.outgoing('6'))).toEqual(['4']);
		// Only the note a link resolves to has it as a backlink.
		expect(ids(links.backlinks('1'))).toEqual(['2', '3']);
		expect(links.backlinks('5')).toEqual([]);
		expect(ids(links.backlinks('2'))).toEqual(['1']);
		expect(ids(links.backlinks('4'))).toEqual(['2', '6']);
		expect(links.isLinkTo('bar', notes[3])).toBe(true);
		expect(links.isLinkTo('bar', notes[1])).toBe(false);
		expect(links.isLinkTo('project.foo', notes[4])).toBe(false);
	});
});

describe('graph walk through the resolver', () => {
	const base: Omit<GraphData, 'notes'> = { projects: [], todos: [], decisions: [], questions: [] };

	it('keeps its title rule: trimmed, the later twin wins, untitled notes are not linked', () => {
		const data: GraphData = {
			...base,
			notes: [
				{ id: 's', title: 'Start', bodyMarkdown: '[[ twin ]] [[#Heading]]', updatedAt: 1 },
				{ id: 't1', title: 'Twin', bodyMarkdown: '', updatedAt: 1 },
				{ id: 't2', title: 'twin ', bodyMarkdown: '', updatedAt: 1 },
				{ id: 'u', title: '', bodyMarkdown: '', updatedAt: 1 }
			]
		};
		const g = exploreGraph('Start', data, { depth: 1 });
		expect(g.nodes.map((n) => n.id)).toEqual(['note:s', 'note:t2']);
	});

	it('follows a key function when given one', () => {
		const keys: Record<string, string> = { a: 'project.a', b: 'project.b' };
		const data: GraphData = {
			...base,
			notes: [
				{ id: 'a', title: 'First', bodyMarkdown: '[[project.b|the other]]', updatedAt: 1 },
				{ id: 'b', title: 'Second', bodyMarkdown: '', updatedAt: 1 }
			],
			linkKeyOf: (n) => keys[n.id]
		};
		expect(exploreGraph('project.a', data, { depth: 1 }).edges).toEqual([{ from: 'note:a', to: 'note:b', label: 'links to' }]);
		expect(exploreGraph('First', data, { depth: 1 }).nodes.map((n) => n.id)).toEqual(['note:a', 'note:b']);
	});
});
