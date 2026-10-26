import { describe, it, expect } from 'vitest';
import { unescapeKurumiSyntax } from '$lib/editor/serialize';

describe('unescapeKurumiSyntax', () => {
	it('restores escaped wikilinks', () => {
		expect(unescapeKurumiSyntax('See \\[\\[Design review]] today')).toBe('See [[Design review]] today');
		expect(unescapeKurumiSyntax('\\[\\[A]] and \\[\\[B\\]\\]')).toBe('[[A]] and [[B]]');
	});

	it('restores escaped URL schemes', () => {
		expect(unescapeKurumiSyntax('at https\\://kurumi.app.')).toBe('at https://kurumi.app.');
	});

	it('leaves already-clean markdown alone', () => {
		const md = '# Title\n\n[[Note]] with #tag and @Ana on //2026-11-02\n';
		expect(unescapeKurumiSyntax(md)).toBe(md);
	});

	it('does not touch inline code or fenced code blocks', () => {
		expect(unescapeKurumiSyntax('`\\[\\[x]]` but \\[\\[y]]')).toBe('`\\[\\[x]]` but [[y]]');
		const fenced = '```\n\\[\\[x]] https\\://a.b\n```\n\\[\\[y]]';
		expect(unescapeKurumiSyntax(fenced)).toBe('```\n\\[\\[x]] https\\://a.b\n```\n[[y]]');
	});

	it('restores callout markers and embeds', () => {
		expect(unescapeKurumiSyntax('> \\[!info]\n>\n> Body')).toBe('> [!info]\n>\n> Body');
		expect(unescapeKurumiSyntax('!\\[\\[Other note]]')).toBe('![[Other note]]');
	});

	it('blanks empty table cells but keeps real line breaks', () => {
		expect(unescapeKurumiSyntax('| A | <br />   |\n| - | - |')).toBe('| A |' + ' '.repeat(10) + '|\n| - | - |');
		expect(unescapeKurumiSyntax('| a<br />b | c |')).toBe('| a<br />b | c |');
	});

		it('keeps escapes that are not Kurumi syntax', () => {
		expect(unescapeKurumiSyntax('\\[not a link] and \\*literal\\*')).toBe(
			'\\[not a link] and \\*literal\\*'
		);
	});
});
