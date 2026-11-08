import { describe, expect, it } from 'vitest';
import { buildTitleIndex, findLinkSuggestions, linkFor } from '$lib/link-suggestions';

const index = buildTitleIndex([
	{ id: 'a', title: 'Project Alpha' },
	{ id: 'b', title: 'Alpha' },
	{ id: 'g', title: 'Garden' },
	{ id: 'u', title: 'Untitled' },
	{ id: 'd', title: '2026-11-08' },
	{ id: 'x', title: 'Dup' },
	{ id: 'r1', title: 'Roadmap' },
	{ id: 'r2', title: 'roadmap' },
	{ id: 'l', title: 'A very long title that has far too many words' }
]);

const titles = (text: string, skip?: Set<string>) => findLinkSuggestions(text, index, skip).map((s) => [text.slice(s.from, s.to), s.title]);

describe('link suggestions', () => {
	it('indexes useful titles only', () => {
		expect([...index.values()].map((e) => e.title).sort()).toEqual(['Alpha', 'Garden', 'Project Alpha']);
	});

	it('finds mentions, longest title first, case-insensitively for several words', () => {
		expect(titles('Notes on project alpha and Alpha.')).toEqual([
			['project alpha', 'Project Alpha'],
			['Alpha', 'Alpha']
		]);
	});

	it('needs a capital for single-word titles', () => {
		expect(titles('the garden is green')).toEqual([]);
		expect(titles('the Garden is green')).toEqual([['Garden', 'Garden']]);
	});

	it('skips links, code, mentions, tags, URLs, punctuation between words and skipped ids', () => {
		expect(titles('[[Project Alpha]] and `Garden` and #Garden and @Garden')).toEqual([]);
		expect(titles('see https://x.com/Garden and [Garden](https://g)')).toEqual([]);
		expect(titles('Project, Alpha')).toEqual([['Alpha', 'Alpha']]);
		expect(titles('Project Alpha', new Set(['a']))).toEqual([['Alpha', 'Alpha']]);
	});

	it('links with an alias when the text differs', () => {
		expect(linkFor('Project Alpha', 'Project Alpha')).toBe('[[Project Alpha]]');
		expect(linkFor('Project Alpha', 'project alpha')).toBe('[[Project Alpha|project alpha]]');
	});
});
