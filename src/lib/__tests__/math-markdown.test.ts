import { describe, expect, it } from 'vitest';
import { remark } from 'remark';
import { remarkMath } from '$lib/editor/math-markdown';

const processor = remark().use(remarkMath as never);
const tree = (md: string) => processor.runSync(processor.parse(md), md) as unknown as { children: { children?: { type: string; value?: string }[]; type: string; value?: string }[] };
const roundTrip = (md: string) => processor.stringify(processor.runSync(processor.parse(md), md) as never).trim();

describe('math markdown', () => {
	it('parses inline and block math', () => {
		const inline = tree('Energy $E = mc^2$ here').children[0].children!;
		expect(inline.map((n) => n.type)).toEqual(['text', 'inlineMath', 'text']);
		expect(inline[1].value).toBe('E = mc^2');
		const block = tree('$$\n\\frac{a}{b}\n$$').children[0];
		expect(block).toMatchObject({ type: 'math', value: '\\frac{a}{b}' });
	});

	it('keeps LaTeX as written', () => {
		expect(roundTrip('$x_1 + \\{a\\} * b_2$')).toBe('$x_1 + \\{a\\} * b_2$');
		expect(roundTrip('$$\n\\sum_{i=1}^n x_i\n$$')).toBe('$$\n\\sum_{i=1}^n x_i\n$$');
	});

	it('leaves dollar amounts as text', () => {
		const nodes = tree('It costs $5 and $10 today').children[0].children!;
		expect(nodes.every((n) => n.type === 'text')).toBe(true);
		expect(roundTrip('It costs $5 and $10 today')).toBe('It costs $5 and $10 today');
		expect(roundTrip('Pay $20 now')).toBe('Pay $20 now');
		expect(tree('$ x $').children[0].children!.some((n) => n.type === 'inlineMath')).toBe(false);
	});
});
