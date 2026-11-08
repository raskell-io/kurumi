import { describe, expect, it } from 'vitest';
import { attachmentsIn, collectHighlights, highlightsToMarkdown, noteHighlights } from '$lib/highlights';

const body = [
	'# Chapter ==one==',
	'Intro with ==a key idea== and ==another==.',
	'```',
	'==not in code==',
	'```',
	'## Details',
	'- Use `==not inline code==` but ==this one==',
	'> ==quoted==',
	'a == b and c == d'
].join('\n');

describe('highlights', () => {
	it('finds highlights with their heading and line, not in code', () => {
		const found = noteHighlights(body);
		expect(found.map((h) => [h.text, h.heading, h.line])).toEqual([
			['one', null, 0],
			['a key idea', 'Chapter one', 1],
			['another', 'Chapter one', 1],
			['this one', 'Details', 6],
			['quoted', 'Details', 7]
		]);
		expect(found[1].context).toBe('Intro with a key idea and another.');
		expect(found[3].context).toBe('Use `==not inline code==` but this one');
	});

	it('maps attachments to their names', () => {
		expect([...attachmentsIn('See [report.pdf](blob:abc) and [report.pdf, p. 3](blob:abc#page=3)')]).toEqual([['abc', 'report.pdf']]);
	});

	it('groups by note, newest first, with PDF highlights under the note linking the PDF', () => {
		const groups = collectHighlights(
			[
				{ id: 'old', title: 'Old', bodyMarkdown: '==early==', updatedAt: 1 },
				{ id: 'new', title: 'Reading', bodyMarkdown: 'Notes on [paper.pdf](blob:p1)', updatedAt: 5 },
				{ id: 'none', title: 'Plain', bodyMarkdown: 'nothing', updatedAt: 9 }
			],
			[
				{ ref: 'blob:p1', page: 4, text: 'Later finding', comment: '', color: 'yellow' },
				{ ref: 'p1', page: 2, text: 'Main finding', comment: 'Important', color: 'green' },
				{ ref: 'blob:unlinked', page: 1, text: 'Orphan', comment: '', color: 'yellow' }
			]
		);
		expect(groups.map((g) => g.noteId)).toEqual(['new', 'old']);
		expect(groups[0].highlights.map((h) => (h.kind === 'pdf' ? [h.text, h.page, h.file] : h.text))).toEqual([
			['Main finding', 2, 'paper.pdf'],
			['Later finding', 4, 'paper.pdf']
		]);
		const md = highlightsToMarkdown(groups);
		expect(md).toContain('## [[Reading]]\n\n> Main finding\n>\n> — [paper.pdf, p. 2](blob:p1#page=2)\n>\n> Important');
		expect(md).toContain('## [[Old]]\n\n> early');
		expect(md).not.toMatch(/- \[ \]/);
	});
});
