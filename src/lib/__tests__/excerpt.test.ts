import { describe, it, expect } from 'vitest';
import { markdownExcerpt, notePreview } from '../utils/excerpt';

describe('markdownExcerpt', () => {
	it('keeps URLs and link text intact, drops markdown syntax', () => {
		expect(markdownExcerpt('See https://example.com/spec and [docs](https://x.org/a/b) with **@Sam** about #falcon')).toBe(
			'See https://example.com/spec and docs with Sam about'
		);
	});

	it('drops frontmatter and code, joins lines, and truncates', () => {
		expect(markdownExcerpt('---\nid: 1\n---\n# Title\n\n```js\nx\n```\nBody text', 100)).toBe('Title Body text');
		expect(markdownExcerpt('word '.repeat(50), 20)).toBe('word word word word...');
	});

	it('shows no markup of highlights, strikes, callouts, toggles or embeds', () => {
		expect(markdownExcerpt('## Goal New customers… **23** on average, ~~strike~~ and ==marked==')).toBe('Goal New customers… 23 on average, strike and marked');
		expect(markdownExcerpt('> [!info] Good to know\n> The body.\n\n<details>\n<summary>More</summary>\n\nInside\n\n</details>\n\n![[Customer interviews]]')).toBe(
			'Good to know The body. More Inside Customer interviews'
		);
	});
});

describe('notePreview', () => {
	it('says what a canvas holds instead of its JSON', () => {
		expect(notePreview({ type: 'canvas', bodyMarkdown: '{ "nodes": [], "edges": [] }' })).toBe('Canvas, empty');
		const three = JSON.stringify({ nodes: [1, 2, 3].map((i) => ({ id: `n${i}`, type: 'text', text: 'x', x: 0, y: 0, width: 1, height: 1 })), edges: [] });
		expect(notePreview({ type: 'canvas', bodyMarkdown: three })).toBe('Canvas · 3 cards');
	});

	it('prefers the summary, else the text without markup', () => {
		expect(notePreview({ type: 'note', summaryShort: 'A summary', bodyMarkdown: '# Body' })).toBe('A summary');
		expect(notePreview({ type: 'note', bodyMarkdown: 'Attendees: @Ana Ruiz ## Notes - [[Customer interviews|the calls]]' })).toBe('Attendees: Ana Ruiz Notes - the calls');
	});
});
