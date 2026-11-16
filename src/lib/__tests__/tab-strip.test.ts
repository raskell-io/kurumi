// Which tabs the strip shows and which it stacks.
import { describe, expect, it } from 'vitest';
import { fitTabs, STACK_CONTROL, STRIP_SLACK, TAB_GAP, TAB_MIN } from '$lib/tab-strip';

const tabs = (n: number, pinned = 0) => Array.from({ length: n }, (_, i) => ({ id: `t${i}`, pinned: i < pinned }));
const ids = (list: { id: string }[]) => list.map((t) => t.id).join(' ');

describe('fitTabs', () => {
	it('shows every tab while they fit at the minimum width', () => {
		const all = tabs(6);
		const width = 6 * TAB_MIN + 5 * TAB_GAP + STRIP_SLACK;
		expect(fitTabs(all, 't0', width).stacked).toEqual([]);
		expect(fitTabs(all, 't0', width).visible).toEqual(all);
	});

	it('shows them all before the strip has been measured', () => {
		expect(fitTabs(tabs(12), null, 0).visible).toHaveLength(12);
		expect(fitTabs(tabs(12), null, Number.NaN).stacked).toEqual([]);
	});

	it('stacks from the end, leaving room for the stack control', () => {
		const width = 4 * TAB_MIN + 3 * TAB_GAP + STACK_CONTROL + STRIP_SLACK;
		const { visible, stacked } = fitTabs(tabs(7), 't0', width);
		expect(ids(visible)).toBe('t0 t1 t2 t3');
		expect(ids(stacked)).toBe('t4 t5 t6');
		// What is shown fits beside the control.
		expect(visible.length * TAB_MIN + (visible.length - 1) * TAB_GAP + STACK_CONTROL).toBeLessThanOrEqual(width);
	});

	it('one pixel short of fitting stacks, and never shows fewer than one', () => {
		const exact = 5 * TAB_MIN + 4 * TAB_GAP + STRIP_SLACK;
		expect(fitTabs(tabs(5), null, exact).stacked).toHaveLength(0);
		expect(fitTabs(tabs(5), null, exact - 1).stacked.length).toBeGreaterThan(0);
		expect(fitTabs(tabs(5), 't4', 20).visible).toHaveLength(1);
		expect(ids(fitTabs(tabs(5), 't4', 20).visible)).toBe('t4');
	});

	it('the open note is never stacked: it takes the last place shown', () => {
		const width = 3 * TAB_MIN + 2 * TAB_GAP + STACK_CONTROL + STRIP_SLACK;
		const { visible, stacked } = fitTabs(tabs(6), 't5', width);
		expect(ids(visible)).toBe('t0 t1 t5');
		expect(ids(stacked)).toBe('t2 t3 t4');
		// Every tab is in exactly one of the two.
		expect([...visible, ...stacked].map((t) => t.id).sort()).toEqual(tabs(6).map((t) => t.id).sort());
	});

	it('pinned tabs keep their place when an ordinary one is swapped in', () => {
		const width = 3 * TAB_MIN + 2 * TAB_GAP + STACK_CONTROL + STRIP_SLACK;
		const { visible, stacked } = fitTabs(tabs(6, 2), 't4', width);
		expect(ids(visible)).toBe('t0 t1 t4');
		expect(ids(stacked)).toBe('t2 t3 t5');
	});

	it('says when tabs are narrower than they would like', () => {
		expect(fitTabs(tabs(2), null, 1000).tight).toBe(false);
		expect(fitTabs(tabs(8), null, 1000).tight).toBe(true);
	});
});
