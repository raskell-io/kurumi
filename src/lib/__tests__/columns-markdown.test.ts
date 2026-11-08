import { describe, it, expect } from 'vitest';
import { remark } from 'remark';
import { remarkColumns } from '$lib/editor/columns-markdown';

const processor = remark().use(remarkColumns as never);
const tree = (md: string) => processor.runSync(processor.parse(md), md) as unknown as { children: { type: string; name?: string; value?: string; children?: { type: string; name?: string }[] }[] };
const roundTrip = (md: string) => processor.stringify(processor.runSync(processor.parse(md), md) as never).trim();

const two = '::::columns\n:::column\nLeft\n:::\n\n:::column\nRight\n:::\n::::';

describe('columns markdown', () => {
	it('reads columns', () => {
		const node = tree(two).children[0];
		expect(node.type).toBe('containerDirective');
		expect(node.children!.map((c) => c.name)).toEqual(['column', 'column']);
	});

	it('writes them back the same', () => {
		expect(roundTrip(two)).toBe(two);
	});

	it('leaves ordinary text and other containers alone', () => {
		expect(roundTrip('Status:done, see:Roadmap')).toBe('Status:done, see:Roadmap');
		const note = ':::note\nCareful\n:::';
		expect(tree(note).children[0]).toMatchObject({ type: 'html', value: note });
		expect(roundTrip(note)).toBe(note);
	});

	it('unwraps a single column', () => {
		const one = tree('::::columns\n:::column\nOnly\n:::\n::::');
		expect(one.children.map((c) => c.type)).toEqual(['paragraph']);
	});
});
