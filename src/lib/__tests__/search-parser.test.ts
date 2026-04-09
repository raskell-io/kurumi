import { describe, it, expect } from 'vitest';
import { parseSearchQuery, hasAnyFilter } from '../search/index';

describe('parseSearchQuery', () => {
	it('returns plain text when no operators', () => {
		const result = parseSearchQuery('hello world');
		expect(result.text).toBe('hello world');
		expect(hasAnyFilter(result.filters)).toBe(false);
	});

	it('parses tag: operator', () => {
		const result = parseSearchQuery('tag:work important');
		expect(result.text).toBe('important');
		expect(result.filters.tag).toEqual(['work']);
	});

	it('parses multiple tags', () => {
		const result = parseSearchQuery('tag:work tag:urgent');
		expect(result.text).toBe('');
		expect(result.filters.tag).toEqual(['work', 'urgent']);
	});

	it('parses person: operator', () => {
		const result = parseSearchQuery('person:alice meetings');
		expect(result.text).toBe('meetings');
		expect(result.filters.person).toEqual(['alice']);
	});

	it('parses quoted person with spaces', () => {
		const result = parseSearchQuery('person:"Alice Smith" budget');
		expect(result.text).toBe('budget');
		expect(result.filters.person).toEqual(['alice smith']);
	});

	it('parses type: operator', () => {
		const result = parseSearchQuery('type:meeting');
		expect(result.text).toBe('');
		expect(result.filters.type).toEqual(['meeting']);
	});

	it('parses after: and before: dates', () => {
		const result = parseSearchQuery('after:2026-01-01 before:2026-12-31 notes');
		expect(result.text).toBe('notes');
		expect(result.filters.after).toBe('2026-01-01');
		expect(result.filters.before).toBe('2026-12-31');
	});

	it('parses has: operator', () => {
		const result = parseSearchQuery('has:audio has:transcript');
		expect(result.filters.has).toEqual(['audio', 'transcript']);
	});

	it('parses folder: operator', () => {
		const result = parseSearchQuery('folder:projects plan');
		expect(result.text).toBe('plan');
		expect(result.filters.folder).toEqual(['projects']);
	});

	it('treats unknown operators as text', () => {
		const result = parseSearchQuery('foo:bar baz');
		expect(result.text).toBe('foo:bar baz');
		expect(hasAnyFilter(result.filters)).toBe(false);
	});

	it('rejects invalid dates', () => {
		const result = parseSearchQuery('after:not-a-date something');
		expect(result.text).toBe('after:not-a-date something');
		expect(result.filters.after).toBeNull();
	});

	it('combines multiple operators', () => {
		const result = parseSearchQuery('tag:work type:meeting person:alice budget');
		expect(result.text).toBe('budget');
		expect(result.filters.tag).toEqual(['work']);
		expect(result.filters.type).toEqual(['meeting']);
		expect(result.filters.person).toEqual(['alice']);
	});
});
