import { describe, expect, it } from 'vitest';
import { remark } from 'remark';
import remarkGfm from 'remark-gfm';
import { Schema } from '@milkdown/kit/prose/model';
import { CALLOUT_BLOCK, parseCalloutMarker } from '$lib/callouts';
import { groupToggles, ungroupToggles, toggleParts, toggleOpening, startsOpen, type MdNode } from '$lib/editor/toggle-markdown';
import { findHighlights } from '$lib/editor/highlightText';
import { formatDay, formatMoment } from '$lib/format-date';

// What Milkdown's commonmark preset does before the editor sees a tree
// (remarkHtmlTransformer): block HTML in the note, a quote or a list item
// goes into a paragraph of its own.
function wrapHtml(node: MdNode) {
	if (!node.children) return;
	for (const child of node.children) wrapHtml(child);
	if (!['root', 'blockquote', 'listItem'].includes(node.type)) return;
	node.children = node.children.map((child) => (child.type === 'html' ? { type: 'paragraph', children: [child] } : child));
}

const processor = remark().use(remarkGfm).data('settings', { bullet: '-' });
const parse = (md: string) => {
	const tree = processor.runSync(processor.parse(md)) as unknown as MdNode;
	wrapHtml(tree);
	return tree;
};
const write = (tree: MdNode) => processor.stringify(tree as never);

describe('callouts', () => {
	it('reads the marker, its type and length', () => {
		expect(parseCalloutMarker('[!info] Good to know')).toEqual({ type: 'info', length: 8, bare: 7 });
		expect(parseCalloutMarker('[!WARNING]')).toEqual({ type: 'warning', length: 10, bare: 10 });
		expect(parseCalloutMarker('[!unknown] x')).toBeNull();
		expect(parseCalloutMarker('see [!info]')).toBeNull();
	});

	it('finds a whole callout in Markdown, with the blank `>` lines the editor writes', () => {
		const md = 'Before\n\n> [!warning]\n>\n> First paragraph.\n>\n> Second.\n\nAfter\n';
		const found = [...md.matchAll(CALLOUT_BLOCK)];
		expect(found).toHaveLength(1);
		expect(found[0][1]).toBe('warning');
		expect(found[0][3]).toBe('>\n> First paragraph.\n>\n> Second.\n');
		const titled = [...'> [!tip] Tip\n> A tip.'.matchAll(CALLOUT_BLOCK)][0];
		expect(titled[2].trim()).toBe('Tip');
		expect(titled[3]).toBe('> A tip.');
	});
});

describe('toggles', () => {
	const notes = [
		'<details>\n<summary>Toggle title</summary>\n\nContent here...\n\n- one\n- two\n\n</details>\n',
		'<details><summary>A collapsible section</summary>\n\nHidden text inside.\n\n</details>\n',
		'Intro\n\n<details open>\n<summary>Open one</summary>\n\nOuter\n\n<details>\n<summary>Inner</summary>\n\nDeep\n\n</details>\n\n</details>\n\nOutro\n',
		'> <details>\n> <summary>In a quote</summary>\n>\n> Quoted body\n>\n> </details>\n',
		'<details>\n<summary>Empty</summary>\n\n</details>\n'
	];

	it('groups a <details> run into one toggle with its title', () => {
		const tree = groupToggles(parse(notes[0]));
		expect(tree.children!.map((c) => c.type)).toEqual(['kurumiToggle']);
		const toggle = tree.children![0];
		expect(toggle.data).toMatchObject({ summary: 'Toggle title', open: '<details>\n<summary>', close: '</summary>', end: '</details>' });
		expect(toggle.children!.map((c) => c.type)).toEqual(['paragraph', 'list']);
	});

	it('nests, and reads quotes', () => {
		const nested = groupToggles(parse(notes[2]));
		expect(nested.children!.map((c) => c.type)).toEqual(['paragraph', 'kurumiToggle', 'paragraph']);
		const outer = nested.children![1];
		expect(startsOpen((outer.data as { open: string }).open)).toBe(true);
		expect(outer.children!.map((c) => c.type)).toEqual(['paragraph', 'kurumiToggle']);
		const quoted = groupToggles(parse(notes[3]));
		expect(quoted.children![0].children!.map((c) => c.type)).toEqual(['kurumiToggle']);
	});

	it('writes every toggle back byte for byte', () => {
		for (const md of notes) {
			const plain = write(parse(md));
			expect(write(ungroupToggles(groupToggles(parse(md))))).toBe(plain);
		}
		// and those were the notes as written
		expect(write(parse(notes[0]))).toBe(notes[0]);
		expect(write(parse(notes[2]))).toBe(notes[2]);
	});

	it('leaves anything else with <details> as it was', () => {
		for (const md of [
			'<details><summary>One line</summary>All of it</details>\n',
			'<details>\n<summary>No end</summary>\n\nText\n',
			'<details>\n<summary>**bold** <b>x</b></summary>\n\nText\n\n</details>\n',
			'- item\n\n  <details>\n  <summary>In a list</summary>\n\n  Body\n\n  </details>\n'
		]) {
			const tree = groupToggles(parse(md));
			expect(JSON.stringify(tree)).not.toContain('kurumiToggle');
		}
	});

	it('keeps the tags around an edited title', () => {
		const parts = toggleParts('<details open>\n<summary>Old</summary>')!;
		expect(parts.summary).toBe('Old');
		expect(toggleOpening(parts.tags, 'New title')).toBe('<details open>\n<summary>New title</summary>');
	});
});

describe('highlights', () => {
	const schema = new Schema({
		nodes: {
			doc: { content: 'block+' },
			paragraph: { group: 'block', content: 'inline*' },
			code_block: { group: 'block', content: 'text*', marks: '' },
			text: { group: 'inline' },
			hardbreak: { group: 'inline', inline: true }
		},
		marks: { inlineCode: {}, strong: {} }
	});
	const para = (...parts: (string | [string, string])[]) =>
		schema.nodes.paragraph.create(
			null,
			parts.map((p) => (typeof p === 'string' ? schema.text(p) : schema.text(p[1], [schema.marks[p[0]].create()])))
		);

	it('finds ==text== across formatting, not in code', () => {
		const doc = schema.nodes.doc.create(null, [
			para('Some ==high ', ['strong', 'lighted'], ' words== and a = b'),
			para('Code ', ['inlineCode', '==not=='], ' here'),
			schema.nodes.code_block.create(null, schema.text('==no=='))
		]);
		const ranges = findHighlights(doc);
		expect(ranges).toHaveLength(1);
		const { from, to } = ranges[0];
		expect(doc.textBetween(from, to)).toBe('==high lighted words==');
	});
});

describe('dates for people', () => {
	const now = new Date(2026, 10, 16);
	it('a day, with the year only when it is another', () => {
		expect(formatDay('2026-11-20', now, 'en-US')).toBe('Nov 20');
		expect(formatDay('2027-01-02', now, 'en-US')).toBe('Jan 2, 2027');
		expect(formatDay('2026-11-20', now, 'de-CH')).toBe('20. Nov.');
		expect(formatDay('2026-02-30', now, 'en-US')).toBe('2026-02-30');
	});

	it('a moment, by today and yesterday', () => {
		expect(formatMoment(new Date(2026, 10, 16, 10, 47), new Date(2026, 10, 16, 12), 'en-US')).toBe('Today 10:47 AM');
		expect(formatMoment(new Date(2026, 10, 15, 18, 2), new Date(2026, 10, 16, 12), 'en-GB')).toBe('Yesterday 18:02');
		expect(formatMoment(new Date(2026, 10, 12, 9, 5), new Date(2026, 10, 16, 12), 'en-GB')).toBe('12 Nov, 9:05');
		expect(formatMoment(new Date(2026, 10, 16, 10, 47, 3), new Date(2026, 10, 16, 12), 'en-GB', { seconds: true })).toBe('Today 10:47:03');
		expect(formatMoment(new Date(2025, 0, 2, 8, 0), new Date(2026, 10, 16, 12), 'en-US')).toBe('Jan 2, 2025, 8:00 AM');
	});
});
