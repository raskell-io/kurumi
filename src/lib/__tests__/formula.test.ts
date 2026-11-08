import { describe, it, expect } from 'vitest';
import { evaluateFormula, formulaText, parseFormula, FormulaError } from '$lib/formula';

const props: Record<string, unknown> = { rating: 4, title: 'Dune', done: true, due: '2026-11-20', tags: ['a', 'b'], price: '12.5' };
const run = (src: string) => evaluateFormula(src, (name) => (props[name.toLowerCase()] ?? null) as never, '2026-11-08');

describe('formulas', () => {
	it('does arithmetic and precedence', () => {
		expect(run('1 + 2 * 3')).toBe(7);
		expect(run('(1 + 2) * 3')).toBe(9);
		expect(run('-prop("Rating") + 10')).toBe(6);
		expect(run('prop("Price") * 2')).toBe(25);
		expect(run('10 / 0')).toBeNull();
	});

	it('handles text, logic and lists', () => {
		expect(run('concat(prop("Title"), " (", prop("Rating"), "/5)")')).toBe('Dune (4/5)');
		expect(run('if(prop("Done"), "✓ done", "open")')).toBe('✓ done');
		expect(run('prop("Rating") >= 4 && !empty(prop("Tags"))')).toBe(true);
		expect(run('length(prop("Tags"))')).toBe(2);
		expect(run('contains(prop("Tags"), "b")')).toBe(true);
		expect(run('"a" + 1')).toBe('a1');
	});

	it('works with dates', () => {
		expect(run('dateBetween(prop("Due"), today(), "days")')).toBe(12);
		expect(run('dateAdd(prop("Due"), 1, "months")')).toBe('2026-12-20');
		expect(run('prop("Due") - today()')).toBe(12);
		expect(run('prop("Due") + 3')).toBe('2026-11-23');
		expect(run('year(prop("Due"))')).toBe(2026);
	});

	it('reports mistakes instead of running anything', () => {
		expect(() => parseFormula('1 +')).toThrow(FormulaError);
		expect(() => run('alert(1)')).toThrow(FormulaError);
		expect(() => parseFormula('prop("x"); fetch()')).toThrow(FormulaError);
		expect(formulaText(run('round(10 / 3, 2)'))).toBe('3.33');
	});
});
