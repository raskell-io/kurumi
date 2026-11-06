import { describe, it, expect } from 'vitest';
import { claudeInstructions } from '../sync/claude-instructions';

describe('claudeInstructions', () => {
	it('imports the guide relative to .claude/, and names it for when imports do not run', () => {
		const text = claudeInstructions(null)!;
		expect(text).toContain('@../.kurumi/AGENTS.md');
		expect(text).toContain('read that file first');
	});

	it('leaves a file that already has it alone', () => {
		expect(claudeInstructions(claudeInstructions(null))).toBeNull();
	});

	it("keeps the user's own instructions and adds to them", () => {
		const text = claudeInstructions('# Mine\n\nAlways answer in German.\n')!;
		expect(text.startsWith('# Mine\n\nAlways answer in German.\n\n')).toBe(true);
		expect(text).toContain('@../.kurumi/AGENTS.md');
		expect(claudeInstructions(text)).toBeNull();
	});

	it('fills an empty file', () => {
		expect(claudeInstructions('  \n')).toBe(claudeInstructions(null));
	});
});
