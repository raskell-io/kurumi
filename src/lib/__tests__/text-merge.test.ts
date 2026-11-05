import { describe, it, expect } from 'vitest';
import { mergeText } from '../sync/text-merge';

const lines = (...l: string[]) => l.join('\n');

describe('mergeText', () => {
	const base = lines('one', 'two', 'three', 'four', 'five');

	it('takes the only side that changed', () => {
		expect(mergeText(base, base, 'x')).toBe('x');
		expect(mergeText(base, 'x', base)).toBe('x');
		expect(mergeText(base, 'x', 'x')).toBe('x');
	});

	it('merges edits to different lines', () => {
		const ours = lines('ONE', 'two', 'three', 'four', 'five');
		const theirs = lines('one', 'two', 'three', 'four', 'FIVE');
		expect(mergeText(base, ours, theirs)).toBe(lines('ONE', 'two', 'three', 'four', 'FIVE'));
	});

	it('merges additions at both ends and in the middle', () => {
		const ours = lines('top', 'one', 'two', 'three', 'four', 'five');
		const theirs = lines('one', 'two', 'three', 'added', 'four', 'five', 'bottom');
		expect(mergeText(base, ours, theirs)).toBe(lines('top', 'one', 'two', 'three', 'added', 'four', 'five', 'bottom'));
	});

	it('merges a deletion with an edit elsewhere', () => {
		const ours = lines('one', 'three', 'four', 'five');
		const theirs = lines('one', 'two', 'three', 'four', 'FIVE');
		expect(mergeText(base, ours, theirs)).toBe(lines('one', 'three', 'four', 'FIVE'));
	});

	it('accepts the same edit made on both sides', () => {
		const both = lines('one', 'TWO', 'three', 'four', 'five');
		expect(mergeText(base, both, both)).toBe(both);
		const ours = lines('one', 'TWO', 'three', 'four', 'FIVE');
		expect(mergeText(base, ours, both)).toBe(ours);
	});

	it('refuses when both changed the same line', () => {
		expect(mergeText(base, lines('one', 'A', 'three', 'four', 'five'), lines('one', 'B', 'three', 'four', 'five'))).toBeNull();
	});

	it('refuses both appending different text at the end', () => {
		expect(mergeText('a', lines('a', 'x'), lines('a', 'y'))).toBeNull();
	});

	it('gives up on huge rewrites instead of stalling', () => {
		const huge = (tag: string) => Array.from({ length: 3000 }, (_, i) => `${tag}${i}`).join('\n');
		expect(mergeText(huge('b'), huge('o'), huge('t'))).toBeNull();
	});
});
