import { describe, it, expect } from 'vitest';
import { markdownExcerpt } from '../utils/excerpt';

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
});
