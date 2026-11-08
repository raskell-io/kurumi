import { describe, expect, it } from 'vitest';
import { parseWikilink, wikilinkLabel, wikilinksToText, markdownSection, markdownBlock, headingsOf, stripBlockIds, editablePart, replacePart } from '$lib/wikilinks';
import { extractWikilinks } from '$lib/db';

describe('wikilinks', () => {
	it('reads the target, heading and alias', () => {
		expect(parseWikilink('Roadmap')).toEqual({ target: 'Roadmap', heading: null, block: null, alias: null });
		expect(parseWikilink('Roadmap|the plan')).toEqual({ target: 'Roadmap', heading: null, block: null, alias: 'the plan' });
		expect(parseWikilink('Roadmap#Q4|Q4 goals')).toEqual({ target: 'Roadmap', heading: 'Q4', block: null, alias: 'Q4 goals' });
		expect(parseWikilink('Roadmap\\|in a table')).toEqual({ target: 'Roadmap', heading: null, block: null, alias: 'in a table' });
	});

	it('shows the alias, else the title', () => {
		expect(wikilinkLabel('Roadmap|the plan')).toBe('the plan');
		expect(wikilinkLabel('Roadmap#Q4')).toBe('Roadmap › Q4');
		expect(wikilinksToText('See [[Roadmap|the plan]] and \\[\\[Ideas]]')).toBe('See the plan and Ideas');
	});

	it('links count by title only (backlinks, graph)', () => {
		expect(extractWikilinks('[[Roadmap|plan]], [[Ideas#Later]], \\[\\[Old]], [[#Here]]')).toEqual(['Roadmap', 'Ideas', 'Old']);
	});

	it('reads block references', () => {
		expect(parseWikilink('Roadmap#^a1b2c3')).toEqual({ target: 'Roadmap', heading: null, block: 'a1b2c3', alias: null });
	});

	it('finds a section and a block', () => {
		const md = '# Plan\nIntro\n\n## Goals\nShip it ^g01\n\n- one\n- two ^li2\n\n```\n## not a heading\n```\n\n### Detail\nMore\n\n## Risks\nNone';
		expect(markdownSection(md, 'goals')).toBe('## Goals\nShip it\n\n- one\n- two\n\n```\n## not a heading\n```\n\n### Detail\nMore');
		expect(markdownSection(md, 'Nope')).toBeNull();
		expect(markdownBlock(md, 'g01')).toBe('Ship it');
		expect(markdownBlock(md, 'li2')).toBe('- two');
		expect(headingsOf(md).map((h) => h.text)).toEqual(['Plan', 'Goals', 'Detail', 'Risks']);
		expect(stripBlockIds('a ^x1\n```\nb ^x2\n```')).toBe('a\n```\nb ^x2\n```');
	});
});

describe('synced parts', () => {
	const md = '# Plan\n\n## Goals\nShip it ^g01\nSee [[Roadmap#^x9]] ^keep\n\n## Risks\nNone';
	it('edits a section and keeps the block ids inside it', () => {
		const part = editablePart(md, { heading: 'Goals' })!;
		expect(part).toBe('## Goals\nShip it ^g01\nSee [[Roadmap#^x9]] ^keep');
		expect(replacePart(md, { heading: 'Goals' }, part.replace('Ship it', 'Ship the beta'))).toBe(md.replace('Ship it', 'Ship the beta'));
	});
	it('edits a block and puts its id back', () => {
		const block = '- one\n- two ^b2\n\nPara line one\npara two ^p1';
		expect(editablePart(block, { block: 'p1' })).toBe('Para line one\npara two');
		expect(replacePart(block, { block: 'p1' }, 'Changed')).toBe('- one\n- two ^b2\n\nChanged ^p1');
		expect(replacePart(block, { block: 'b2' }, '- three')).toBe('- one\n- three ^b2\n\nPara line one\npara two ^p1');
	});
});
