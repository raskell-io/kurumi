// Motion helpers: the CSS easings as JS functions, and "off" as the safe state.
import { describe, expect, it } from 'vitest';
import { collapse, cssEasing, flipParams, motionMs, popOut } from '$lib/motion';

describe('cssEasing', () => {
	it('keeps the ends and stays in order', () => {
		for (const value of ['cubic-bezier(0.2, 0, 0, 1)', 'cubic-bezier(0.4, 0, 1, 1)', 'ease', 'ease-in', 'ease-out', 'ease-in-out', 'linear']) {
			const ease = cssEasing(value);
			expect(ease(0)).toBe(0);
			expect(ease(1)).toBe(1);
			let last = 0;
			for (let t = 0.05; t < 1; t += 0.05) {
				const v = ease(t);
				expect(v).toBeGreaterThanOrEqual(last);
				expect(v).toBeLessThanOrEqual(1); // nothing overshoots
				last = v;
			}
		}
	});

	it('decelerates entering and accelerates leaving', () => {
		expect(cssEasing('cubic-bezier(0.2, 0, 0, 1)')(0.5)).toBeGreaterThan(0.7);
		expect(cssEasing('cubic-bezier(0.4, 0, 1, 1)')(0.5)).toBeLessThan(0.4);
	});

	it('matches the browser on a known curve', () => {
		// "ease" at half time is ~0.8024.
		expect(cssEasing('ease')(0.5)).toBeCloseTo(0.8024, 3);
	});

	it('reads the first of a list and falls back to linear', () => {
		expect(cssEasing('ease-in, cubic-bezier(0.2, 0, 0, 1)')(0.5)).toBeCloseTo(cssEasing('ease-in')(0.5), 6);
		expect(cssEasing('steps(4, end)')(0.3)).toBe(0.3);
		expect(cssEasing('')(0.3)).toBe(0.3);
	});
});

describe('before the app is ready (and without a document)', () => {
	it('nothing has a duration', () => {
		expect(motionMs('fast')).toBe(0);
		expect(motionMs('base')).toBe(0);
		expect(flipParams().duration).toBe(0);
		const node = {} as HTMLElement;
		expect(collapse(node).duration).toBe(0);
		expect(popOut(node).duration).toBe(0);
	});
});
