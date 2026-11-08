import { describe, expect, it } from 'vitest';
import { highlightToHtml, loadHighlighter, tokenize, canHighlight } from '$lib/highlight';

describe('highlight', () => {
	it('tokenizes known languages as ranges of the source', async () => {
		const ll = await loadHighlighter();
		const code = 'const x = "hi"; // note';
		const tokens = tokenize(ll, code, 'ts');
		const keyword = tokens.find((t) => t.className.includes('hljs-keyword'));
		expect(code.slice(keyword!.from, keyword!.to)).toBe('const');
		const string = tokens.find((t) => t.className.includes('hljs-string'));
		expect(code.slice(string!.from, string!.to)).toBe('"hi"');
		// ranges are ordered and inside the text
		for (let i = 1; i < tokens.length; i++) expect(tokens[i].from).toBeGreaterThanOrEqual(tokens[i - 1].to);
	});

	it('skips unknown, diagram and frontmatter languages', async () => {
		const ll = await loadHighlighter();
		expect(tokenize(ll, 'graph TD; A-->B', 'mermaid')).toEqual([]);
		expect(tokenize(ll, 'a: 1', 'yaml:frontmatter')).toEqual([]);
		expect(canHighlight(ll, 'no-such-lang')).toBe(false);
		expect(highlightToHtml(ll, 'x', '')).toBeNull();
	});

	it('escapes HTML in the output', async () => {
		const ll = await loadHighlighter();
		const html = highlightToHtml(ll, '<div class="a">&</div>', 'html')!;
		expect(html).toContain('&lt;');
		expect(html).toContain('&amp;');
		expect(html).not.toContain('<div');
	});
});
