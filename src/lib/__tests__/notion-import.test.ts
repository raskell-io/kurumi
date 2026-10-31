import { describe, it, expect } from 'vitest';
import { cleanNotionName, resolveNotionPath, splitNotionTitle, rewriteNotionLinks } from '../utils/notion-import';

describe('Notion import', () => {
	it('drops the page id from names', () => {
		expect(cleanNotionName('Meeting notes 1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d.md')).toBe('Meeting notes');
		expect(cleanNotionName('Projects 1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d')).toBe('Projects');
		expect(cleanNotionName('Plain.md')).toBe('Plain');
	});

	it('resolves relative, URL-encoded links and ignores URLs', () => {
		expect(resolveNotionPath('Work abc', 'Kickoff%20123.md')).toBe('Work abc/Kickoff 123.md');
		expect(resolveNotionPath('Work abc/Sub', '../Other%20x.md')).toBe('Work abc/Other x.md');
		expect(resolveNotionPath('', 'https://notion.so/x')).toBeNull();
		expect(resolveNotionPath('', '#heading')).toBeNull();
	});

	it('takes the title from the first heading', () => {
		expect(splitNotionTitle('a/Kickoff 123.md', '# Kickoff call\n\nAgenda')).toEqual({ title: 'Kickoff call', body: 'Agenda' });
		expect(splitNotionTitle('a/Kickoff 1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d.md', 'No heading')).toEqual({ title: 'Kickoff', body: 'No heading' });
	});

	it('turns page links into wikilinks and files into blob refs', () => {
		const titles = new Map([['Work/Kickoff 1.md', 'Kickoff call']]);
		const refs = new Map([['Work/Kickoff 1/chart.png', 'blob:img1'], ['Work/Kickoff 1/brief.pdf', 'blob:pdf1']]);
		const body = 'See [Kickoff call](Kickoff%201.md), [the kickoff](Kickoff%201.md), ![](Kickoff%201/chart.png), [brief.pdf](Kickoff%201/brief.pdf) and [site](https://x.org).';
		expect(rewriteNotionLinks(body, 'Work', (p) => titles.get(p), (p) => refs.get(p))).toBe(
			'See [[Kickoff call]], [[Kickoff call]], ![](blob:img1), [brief.pdf](blob:pdf1) and [site](https://x.org).'
		);
	});
});
