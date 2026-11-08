import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/db', () => ({}));
vi.mock('$lib/inference', () => ({ inferenceRouter: { allProviders: () => [] }, PROVIDER_CONFIGS: [] }));
vi.mock('$lib/search', () => ({ search: () => [] }));
const { selectSources, sourceSignature, needsUpdate, citeAsLinks, MIN_INTERVAL_MS } = await import('$lib/living-notes');

const note = (id: string, updatedAt: number, extra: Record<string, unknown> = {}) => ({ id, title: id, updatedAt, deletedAt: null, type: 'note', bodyMarkdown: '', ...extra }) as never;

describe('living notes', () => {
	it('feeds on matching notes, newest first, not itself, other living notes or reports', () => {
		const sources = selectSources({ id: 'me' }, [
			note('a', 1),
			note('me', 9),
			note('b', 5),
			note('other-living', 7, { living: { query: 'x' } }),
			note('review-v-2026-11-02', 8),
			note('gone', 6, { deletedAt: 3 }),
			note('digest', 4, { title: 'Daily digest — 2026-11-07' })
		]);
		expect(sources.map((s: { id: string }) => s.id)).toEqual(['b', 'a']);
	});

	it('changes its signature when sources change, not when they reorder', () => {
		const a = sourceSignature([note('a', 1), note('b', 2)]);
		expect(sourceSignature([note('b', 2), note('a', 1)])).toBe(a);
		expect(sourceSignature([note('a', 1), note('b', 3)])).not.toBe(a);
		expect(sourceSignature([note('a', 1)])).not.toBe(a);
	});

	it('rewrites on its own only when sources changed and not too often', () => {
		const now = 10 * MIN_INTERVAL_MS;
		expect(needsUpdate({ query: 'q' }, 'sig', now)).toBe(true);
		expect(needsUpdate({ query: 'q', signature: 'sig', updatedAt: 0 }, 'sig', now)).toBe(false);
		expect(needsUpdate({ query: 'q', signature: 'old', updatedAt: now - 1000 }, 'sig', now)).toBe(false);
		expect(needsUpdate({ query: 'q', signature: 'old', updatedAt: now - MIN_INTERVAL_MS }, 'sig', now)).toBe(true);
		expect(needsUpdate({ query: 'q' }, '', now)).toBe(false);
	});

	it('turns [n] citations into links, dropping the note itself', () => {
		expect(citeAsLinks('We ship in March [2]. Scope is fixed [1][3].', [null, 'Kickoff', 'Plan [v2]'])).toBe('We ship in March [[Kickoff]]. Scope is fixed [[Plan v2]].');
		expect(citeAsLinks('Twice [2][2] and unknown [9].', [null, 'A'])).toBe('Twice [[A]] and unknown [9].');
		expect(citeAsLinks('Fixed [1].', [null])).toBe('Fixed.');
	});
});
