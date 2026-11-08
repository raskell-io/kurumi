import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/db', () => ({}));
const { addFact, factsIn, removeFact, searchConversations } = await import('$lib/agent-memory');

describe('agent memory', () => {
	const body = 'Intro text.\n\n- Prefers metric units\n- Works at Raskell\n- [ ] not a fact\n';

	it('reads facts as bullets, not checkboxes', () => {
		expect(factsIn(body)).toEqual(['Prefers metric units', 'Works at Raskell']);
	});

	it('adds a fact once', () => {
		const next = addFact(body, 'Has a dog named  Pixel');
		expect(factsIn(next)).toEqual(['Prefers metric units', 'Works at Raskell', 'Has a dog named Pixel']);
		expect(addFact(next, 'prefers metric units.')).toBe(next);
	});

	it('forgets a whole fact, or the ones containing the words', () => {
		expect(removeFact(body, 'works at raskell').removed).toEqual(['Works at Raskell']);
		const partial = removeFact(body, 'metric');
		expect(partial.removed).toEqual(['Prefers metric units']);
		expect(factsIn(partial.body)).toEqual(['Works at Raskell']);
		expect(removeFact(body, 'nothing like it').removed).toEqual([]);
	});

	it('searches past conversations', () => {
		const store = new Map<string, string>();
		const storage = { getItem: (k: string) => store.get(k) ?? null } as Storage;
		store.set('kurumi-agent-history', JSON.stringify([{ id: 'c1', title: 'Trip', updatedAt: Date.UTC(2026, 10, 1) }, { id: 'c2', title: 'Other', updatedAt: 0 }]));
		store.set('kurumi-agent-session-c1', JSON.stringify({ messages: [{ role: 'user', content: 'Plan my trip to Lisbon' }, { role: 'assistant', content: 'Lisbon in spring is lovely.' }] }));
		store.set('kurumi-agent-session-c2', JSON.stringify({ messages: [{ role: 'user', content: 'Budget' }] }));
		const hits = searchConversations('lisbon trip', 5, storage);
		expect(hits).toHaveLength(1);
		expect(hits[0]).toMatchObject({ id: 'c1', title: 'Trip', date: '2026-11-01' });
		expect(hits[0].snippets[0]).toBe('User: Plan my trip to Lisbon');
		expect(searchConversations('', 5, storage)).toHaveLength(2);
	});
});
