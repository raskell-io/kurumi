import { describe, expect, it } from 'vitest';
import { parseWikilink, wikilinkLabel, wikilinksToText } from '$lib/wikilinks';
import { extractWikilinks } from '$lib/db';

describe('wikilinks', () => {
	it('reads the target, heading and alias', () => {
		expect(parseWikilink('Roadmap')).toEqual({ target: 'Roadmap', heading: null, alias: null });
		expect(parseWikilink('Roadmap|the plan')).toEqual({ target: 'Roadmap', heading: null, alias: 'the plan' });
		expect(parseWikilink('Roadmap#Q4|Q4 goals')).toEqual({ target: 'Roadmap', heading: 'Q4', alias: 'Q4 goals' });
		expect(parseWikilink('Roadmap\\|in a table')).toEqual({ target: 'Roadmap', heading: null, alias: 'in a table' });
	});

	it('shows the alias, else the title', () => {
		expect(wikilinkLabel('Roadmap|the plan')).toBe('the plan');
		expect(wikilinkLabel('Roadmap#Q4')).toBe('Roadmap › Q4');
		expect(wikilinksToText('See [[Roadmap|the plan]] and \\[\\[Ideas]]')).toBe('See the plan and Ideas');
	});

	it('links count by title only (backlinks, graph)', () => {
		expect(extractWikilinks('[[Roadmap|plan]], [[Ideas#Later]], \\[\\[Old]], [[#Here]]')).toEqual(['Roadmap', 'Ideas', 'Old']);
	});
});
