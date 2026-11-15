// Minimal-diff saves of linked notes (write-back.ts) and single-field
// frontmatter edits. The "normalized" texts are what the editor produced for
// these originals in Chrome (tables re-aligned, escapes added, bullets and
// fences rewritten, blank lines and CRLF dropped).
import { describe, expect, it } from 'vitest';
import { writeBack } from '$lib/linked/write-back';
import { scalarFieldValue, setScalarField } from '$lib/linked/frontmatter';

const cases: Record<string, { original: string; normalized: string }> = {
	plain: {
		original: '# Title\n\nFirst paragraph with *emphasis*.\n\nEDIT HERE\n',
		normalized: '# Title\n\nFirst paragraph with *emphasis*.\n\nEDIT HERE\n'
	},
	table: {
		original: '# Table\n\n| Name | Value |\n|------|------:|\n| a | 1 |\n| [[Alpha\\|first]] | x \\| y |\n\nEDIT HERE\n',
		normalized: '# Table\n\n| Name               |  Value |\n| ------------------ | -----: |\n| a                  |      1 |\n| [[Alpha\\|first]] | x \\| y |\n\nEDIT HERE\n'
	},
	escapes: {
		original: '# Escapes\n\nA snake_case_name and 2 * 3 * 4 and a_b.\nBrackets [not a link] and [[Wiki Link]].\n+ plus bullet?\n\nEDIT HERE\n',
		normalized: '# Escapes\n\nA snake\\_case\\_name and 2 \\* 3 \\* 4 and a\\_b.\nBrackets \\[not a link] and [[Wiki Link]].\n\n- plus bullet?\n\nEDIT HERE\n'
	},
	code: {
		original: '# Code\n\n```rust\nfn main() {}\n```\n\n    indented code\n\n~~~\ntilde fence\n~~~\n\nEDIT HERE\n',
		normalized: '# Code\n\n```rust\nfn main() {}\n```\n\n```\nindented code\n```\n\n```\ntilde fence\n```\n\nEDIT HERE\n'
	},
	misc: {
		original: 'Setext heading\n==============\n\n> quote\n\nText with trailing spaces  \nhard break.\n\nEDIT HERE',
		normalized: '# Setext heading\n\n> quote\n\nText with trailing spaces\\\nhard break.\n\nEDIT HERE\n'
	},
	crlf: {
		original: '# CRLF\r\n\r\nLine one\r\nLine two\r\n\r\nEDIT HERE\r\n',
		normalized: '# CRLF\n\nLine one\nLine two\n\nEDIT HERE\n'
	},
	loose: {
		original: '\n\n# Loose\n\n- item one\n\n- item two\n\nText\n\n\n\nTriple blank above.\n\nEDIT HERE\n\n\n',
		normalized: '# Loose\n\n- item one\n\n- item two\n\nText\n\nTriple blank above.\n\nEDIT HERE\n'
	}
};

/** How many lines of `a` are not in `b` at the same place from either end. */
const changedLines = (a: string, b: string) => {
	const A = a.split('\n');
	const B = b.split('\n');
	let start = 0;
	while (start < A.length && start < B.length && A[start] === B[start]) start++;
	let end = 0;
	while (end < A.length - start && end < B.length - start && A[A.length - 1 - end] === B[B.length - 1 - end]) end++;
	return Math.max(A.length, B.length) - start - end;
};

describe('writeBack', () => {
	it('returns the original bytes when nothing was edited', () => {
		for (const [name, base] of Object.entries(cases)) expect(writeBack(base, base.normalized), name).toBe(base.original);
	});

	it('changes exactly the edited line of the original', () => {
		for (const [name, base] of Object.entries(cases)) {
			const edited = base.normalized.replace('EDIT HERE', 'EDIT HERE now');
			expect(writeBack(base, edited), name).toBe(base.original.replace('EDIT HERE', 'EDIT HERE now'));
		}
	});

	it('adds and removes lines where the user did, and nowhere else', () => {
		const { table, escapes, crlf } = cases;
		expect(writeBack(table, table.normalized.replace('EDIT HERE\n', 'EDIT HERE\n\nA new paragraph.\n'))).toBe(table.original.replace('EDIT HERE\n', 'EDIT HERE\n\nA new paragraph.\n'));
		expect(writeBack(escapes, escapes.normalized.replace('# Escapes\n\n', '# Escapes\n\nInserted above.\n\n'))).toBe(escapes.original.replace('# Escapes\n\n', '# Escapes\n\nInserted above.\n\n'));
		expect(writeBack(crlf, crlf.normalized.replace('Line one\n', ''))).toBe(crlf.original.replace('Line one\r\n', ''));
		expect(writeBack(crlf, crlf.normalized.replace('Line two', 'Line two\nLine three'))).toBe(crlf.original.replace('Line two', 'Line two\r\nLine three'));
	});

	it('writes an edited line the editor escapes in the editor\'s form, and only that line', () => {
		const { escapes } = cases;
		const out = writeBack(escapes, escapes.normalized.replace('and a\\_b.', 'and a\\_b and more.'));
		expect(out).toBe(escapes.original.replace('A snake_case_name and 2 * 3 * 4 and a_b.', 'A snake\\_case\\_name and 2 \\* 3 \\* 4 and a\\_b and more.'));
		expect(changedLines(out, escapes.original)).toBe(1);
	});

	it('writes an edited table row padded, and leaves the other rows as they were', () => {
		const { table } = cases;
		const out = writeBack(table, table.normalized.replace('| a                  |      1 |', '| a                  |      2 |'));
		expect(out).toBe(table.original.replace('| a | 1 |', '| a                  |      2 |'));
	});

	it('rewrites a block the editor restructures only when the edit is in it', () => {
		const { code } = cases;
		const out = writeBack(code, code.normalized.replace('indented code', 'indented code, edited'));
		expect(out).toBe(code.original.replace('    indented code', '```\nindented code, edited\n```'));
		expect(writeBack(code, code.normalized.replace('tilde fence', 'tilde fence!'))).toBe(code.original.replace('tilde fence', 'tilde fence!'));
	});

	it('keeps the file\'s blank lines at both ends and its missing final newline', () => {
		const { loose, misc } = cases;
		const out = writeBack(loose, loose.normalized.replace('item two', 'item 2'));
		expect(out.startsWith('\n\n# Loose')).toBe(true);
		expect(out.endsWith('EDIT HERE\n\n\n')).toBe(true);
		expect(out).toContain('Text\n\n\n\nTriple blank above.');
		expect(writeBack(misc, misc.normalized.replace('> quote', '> quoted')).endsWith('EDIT HERE')).toBe(true);
	});

	it('handles emptying and filling a note', () => {
		expect(writeBack({ original: 'Only line\n', normalized: 'Only line\n' }, '')).toBe('');
		expect(writeBack({ original: '', normalized: '' }, 'First words\n')).toBe('First words');
		expect(writeBack({ original: '\n', normalized: '' }, 'First words\n')).toBe('\nFirst words');
	});
});

describe('setScalarField', () => {
	// The motivating fixture: every field and every byte but one stays.
	const raw = '---\nid: project.foo\ntype: project\nscope: "team"\ntitle: Foo launch\nsummary: \'Ship it.\'\nstatus: active # for now\nsource: https://example.com/a#b\nupdated: 2026-01-02\npaths:\n  - src/a\n  - src/b\nnested:\n  title: inner\n---\n';

	it('changes exactly one line', () => {
		const out = setScalarField(raw, 'updated', '2026-11-15');
		expect(out).toBe(raw.replace('updated: 2026-01-02', 'updated: 2026-11-15'));
		expect(setScalarField(raw, 'title', 'Foo relaunch')).toBe(raw.replace('title: Foo launch', 'title: Foo relaunch'));
		expect(changedLines(out, raw)).toBe(1);
	});

	it('keeps the quoting style', () => {
		expect(setScalarField(raw, 'scope', 'org')).toBe(raw.replace('scope: "team"', 'scope: "org"'));
		expect(setScalarField(raw, 'summary', 'Shipped: done')).toBe(raw.replace("'Ship it.'", "'Shipped: done'"));
	});

	it('leaves the frontmatter untouched when it cannot be sure', () => {
		expect(setScalarField(raw, 'missing', 'x')).toBe(raw);
		expect(setScalarField(raw, 'paths', 'x')).toBe(raw); // a list
		expect(setScalarField(raw, 'nested', 'x')).toBe(raw); // a map
		expect(setScalarField(raw, 'status', 'done')).toBe(raw); // a comment follows
		expect(setScalarField(raw, 'title', 'Foo: the sequel')).toBe(raw); // would need quotes
		expect(setScalarField(raw, 'title', '[draft]')).toBe(raw);
		expect(setScalarField(raw, 'title', 'two\nlines')).toBe(raw);
		expect(setScalarField(raw, 'title', '')).toBe(raw);
		expect(setScalarField(raw, 'scope', 'say "hi"')).toBe(raw);
		expect(setScalarField(raw, 'summary', "it's")).toBe(raw);
		expect(setScalarField('---\ntitle: "a \\"b\\""\n---\n', 'title', 'c')).toBe('---\ntitle: "a \\"b\\""\n---\n');
		expect(setScalarField('---\ntext: |\n  block\n---\n', 'text', 'c')).toBe('---\ntext: |\n  block\n---\n');
		expect(setScalarField('no frontmatter\ntitle: x\n', 'title', 'y')).toBe('no frontmatter\ntitle: x\n');
		// The nested `title:` is not the title.
		expect(setScalarField('---\nmeta:\n  title: inner\n---\n', 'title', 'y')).toBe('---\nmeta:\n  title: inner\n---\n');
	});

	it('keeps CRLF, a BOM and odd spacing', () => {
		const odd = '\uFEFF---\r\ntitle:   Old  \r\nid: a\r\n---\r\n';
		expect(setScalarField(odd, 'title', 'New')).toBe('\uFEFF---\r\ntitle:   New  \r\nid: a\r\n---\r\n');
		expect(scalarFieldValue(odd, 'title')).toBe('Old');
		expect(scalarFieldValue(raw, 'paths')).toBeNull();
		expect(scalarFieldValue(raw, 'scope')).toBe('team');
	});
});
