// Frontmatter of linked notes: split and joined without changing a byte.
import { describe, expect, it } from 'vitest';
import { joinNote, readFrontmatterFields, splitFrontmatter } from '$lib/linked/frontmatter';

const roundTrips = (text: string) => {
	const { raw, body } = splitFrontmatter(text);
	expect(joinNote(raw, body)).toBe(text);
	return { raw, body };
};

describe('splitFrontmatter / joinNote', () => {
	it('splits LF files and keeps every byte', () => {
		const text = '---\nid: project.foo\ntitle: "Foo"\n---\n\n# Foo\n\nBody.\n';
		const { raw, body } = roundTrips(text);
		expect(raw).toBe('---\nid: project.foo\ntitle: "Foo"\n---\n');
		expect(body).toBe('\n# Foo\n\nBody.\n');
		expect(splitFrontmatter(text).eol).toBe('\n');
	});

	it('keeps CRLF', () => {
		const text = '---\r\nid: a\r\n---\r\nLine one\r\nLine two\r\n';
		const { raw, body } = roundTrips(text);
		expect(raw).toBe('---\r\nid: a\r\n---\r\n');
		expect(body).toBe('Line one\r\nLine two\r\n');
		expect(splitFrontmatter(text).eol).toBe('\r\n');
	});

	it('keeps a BOM out of the body, with and without frontmatter', () => {
		const withBlock = roundTrips('﻿---\nid: a\n---\nBody');
		expect(withBlock.raw).toBe('﻿---\nid: a\n---\n');
		expect(withBlock.body).toBe('Body');
		const without = roundTrips('﻿# Title\n');
		expect(without.raw).toBe('﻿');
		expect(without.body).toBe('# Title\n');
	});

	it('leaves a file without frontmatter whole', () => {
		for (const text of ['# Just a note\n\nText.\n', '', 'One line, no newline', '--- not a delimiter\ntext\n---\n', ' ---\na: 1\n---\n']) {
			const { raw, body } = roundTrips(text);
			expect(raw).toBe('');
			expect(body).toBe(text);
		}
	});

	it('treats an unclosed block as body', () => {
		const { raw, body } = roundTrips('---\nid: a\n\nNo end.\n');
		expect(raw).toBe('');
		expect(body).toBe('---\nid: a\n\nNo end.\n');
		expect(roundTrips('---\n').raw).toBe('');
		expect(roundTrips('---').raw).toBe('');
	});

	it('ends the block at the first closing line; a later --- stays in the body', () => {
		const text = '---\nid: a\n---\nAbove\n\n---\n\nBelow\n---\n';
		const { raw, body } = roundTrips(text);
		expect(raw).toBe('---\nid: a\n---\n');
		expect(body).toBe('Above\n\n---\n\nBelow\n---\n');
		// `----` and `--- x` inside the block don't close it.
		expect(roundTrips('---\na: 1\n----\n--- x\nb: 2\n---\nBody').raw).toBe('---\na: 1\n----\n--- x\nb: 2\n---\n');
	});

	it('handles an empty body and an empty block', () => {
		expect(roundTrips('---\nid: a\n---\n')).toEqual({ raw: '---\nid: a\n---\n', body: '' });
		expect(roundTrips('---\nid: a\n---')).toEqual({ raw: '---\nid: a\n---', body: '' });
		expect(roundTrips('---\n---\nBody')).toEqual({ raw: '---\n---\n', body: 'Body' });
		expect(roundTrips('---\r\nid: a\r\n---')).toEqual({ raw: '---\r\nid: a\r\n---', body: '' });
	});

	it('keeps trailing spaces on delimiters and odd spacing inside', () => {
		const text = '--- \nid:   a  \n\n# comment\n---\t\nBody';
		expect(roundTrips(text).raw).toBe('--- \nid:   a  \n\n# comment\n---\t\n');
	});
});

describe('readFrontmatterFields', () => {
	it('reads plain values, quotes and comments', () => {
		const raw = '---\nid: project.foo\ntitle: "Foo: the \\"launch\\""\nowner: \'O\'\'Neil\'\nstatus: active # for now\nempty:\ncount: 3\n---\n';
		expect(readFrontmatterFields(raw)).toEqual({ id: 'project.foo', title: 'Foo: the "launch"', owner: "O'Neil", status: 'active', count: '3' });
	});

	it('reads inline and block lists', () => {
		const raw = '---\ntags: [alpha, "two words", beta]\naliases:\n  - One\n  - "Two"\ntype: note\n---\n';
		expect(readFrontmatterFields(raw)).toEqual({ tags: ['alpha', 'two words', 'beta'], aliases: ['One', 'Two'], type: 'note' });
	});

	it('leaves out what it cannot read as a plain value', () => {
		const raw = '﻿---\r\nid: a\r\nmeta:\r\n  nested: 1\r\ntext: |\r\n  line one\r\n  line two\r\nmap: { a: 1 }\r\nurl: https://example.com/x#y\r\n---\r\n';
		expect(readFrontmatterFields(raw)).toEqual({ id: 'a', url: 'https://example.com/x#y' });
		expect(readFrontmatterFields('')).toEqual({});
		expect(readFrontmatterFields('no block')).toEqual({});
	});
});
