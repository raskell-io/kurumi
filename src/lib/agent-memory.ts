/**
 * Persistent agent memory: what the Kurumi agent remembers across
 * conversations, kept in an ordinary note ("Kurumi memory", one per vault)
 * as a bulleted list. The agent adds and removes facts with its `remember` /
 * `forget` tools and is shown the list at the start of every conversation.
 * Being a note, it syncs, exports and can be edited or emptied by hand.
 *
 * Past conversations stay on the device (AgentPane, localStorage);
 * `searchConversations` lets the agent look through them.
 */

import { get } from 'svelte/store';
import { currentVaultId, getMemoryObject, putGeneratedNote, updateMemoryObject } from '$lib/db';

export const MEMORY_TITLE = 'Kurumi memory';
const INTRO =
	'What the Kurumi assistant remembers about you, from your conversations. It reads this list at the start of every chat. Edit or delete anything: the list is all it keeps.';
const PROMPT_LIMIT = 4000;

export const agentMemoryId = (vaultId = get(currentVaultId)) => `agent-memory-${vaultId}`;

const BULLET = /^\s*[-*+]\s+(?!\[[ xX]\])(.+?)\s*$/;

/** The facts in a memory note body: its bullet lines (checkbox lines aren't facts). */
export function factsIn(body: string): string[] {
	return body
		.split('\n')
		.map((line) => line.match(BULLET)?.[1])
		.filter((fact): fact is string => !!fact);
}

const same = (a: string, b: string) => a.trim().toLowerCase().replace(/[.!]+$/, '') === b.trim().toLowerCase().replace(/[.!]+$/, '');

/** `body` with `fact` added as a bullet (unchanged if it's there already). */
export function addFact(body: string, fact: string): string {
	const clean = fact.replace(/\s+/g, ' ').trim();
	if (!clean || factsIn(body).some((f) => same(f, clean))) return body;
	return `${body.replace(/\s*$/, '')}\n- ${clean}\n`;
}

/** `body` without the bullets matching `text` (whole fact, or a part of one when nothing matches whole). */
export function removeFact(body: string, text: string): { body: string; removed: string[] } {
	const needle = text.trim().toLowerCase();
	if (!needle) return { body, removed: [] };
	const lines = body.split('\n');
	const facts = lines.map((line) => line.match(BULLET)?.[1] ?? null);
	const exact = facts.some((f) => f !== null && same(f, text));
	const removed: string[] = [];
	const kept = lines.filter((_, i) => {
		const fact = facts[i];
		const hit = fact !== null && (exact ? same(fact, text) : fact.toLowerCase().includes(needle));
		if (hit) removed.push(fact);
		return !hit;
	});
	return { body: kept.join('\n'), removed };
}

/** The facts the agent remembers in the current vault. */
export function rememberedFacts(): string[] {
	return factsIn(getMemoryObject(agentMemoryId())?.bodyMarkdown ?? '');
}

/** Remember `fact` (creates the memory note the first time). */
export function remember(fact: string): { ok: boolean; memoryId: string; added: boolean } {
	const id = agentMemoryId();
	const note = getMemoryObject(id);
	const body = note && !note.deletedAt ? note.bodyMarkdown : `${INTRO}\n`;
	const next = addFact(body, fact);
	if (!note || note.deletedAt) putGeneratedNote(id, MEMORY_TITLE, next);
	else if (next !== body) updateMemoryObject(id, { bodyMarkdown: next });
	return { ok: true, memoryId: id, added: next !== body };
}

/** The memory note's id, creating it (empty) if it's not there yet. */
export function ensureMemoryNote(): string {
	const id = agentMemoryId();
	const note = getMemoryObject(id);
	if (!note || note.deletedAt) putGeneratedNote(id, MEMORY_TITLE, note?.bodyMarkdown || `${INTRO}\n`);
	return id;
}

/** Forget the facts matching `text`. */
export function forget(text: string): { ok: boolean; removed: string[] } {
	const id = agentMemoryId();
	const note = getMemoryObject(id);
	if (!note || note.deletedAt) return { ok: true, removed: [] };
	const { body, removed } = removeFact(note.bodyMarkdown, text);
	if (removed.length) updateMemoryObject(id, { bodyMarkdown: body });
	return { ok: true, removed };
}

/** The system prompt section with what the agent remembers, or '' when nothing. */
export function memoryPrompt(): string {
	const facts = rememberedFacts();
	if (!facts.length) return '';
	let list = '';
	for (const fact of facts) {
		if (list.length + fact.length > PROMPT_LIMIT) break;
		list += `- ${fact}\n`;
	}
	return `What you remember about the user (from their note "${MEMORY_TITLE}", which they can edit):\n${list}`;
}

// --- Past conversations (AgentPane's localStorage history) ------------------

const HISTORY_INDEX_KEY = 'kurumi-agent-history';
const SESSION_PREFIX = 'kurumi-agent-session-';

export interface ConversationHit {
	id: string;
	title: string;
	date: string;
	snippets: string[];
}

interface StoredMessage {
	role: string;
	content: string;
	createdAt?: number;
}

/** Earlier conversations on this device whose messages mention every word of `query`. */
export function searchConversations(query: string, limit = 5, storage: Storage | undefined = globalThis.localStorage): ConversationHit[] {
	if (!storage) return [];
	const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
	let index: { id: string; title: string; updatedAt: number }[] = [];
	try {
		index = JSON.parse(storage.getItem(HISTORY_INDEX_KEY) ?? '[]');
	} catch {
		return [];
	}
	const hits: ConversationHit[] = [];
	for (const meta of index) {
		let messages: StoredMessage[] = [];
		try {
			messages = JSON.parse(storage.getItem(SESSION_PREFIX + meta.id) ?? '{"messages":[]}').messages ?? [];
		} catch {
			continue;
		}
		const said = messages.filter((m) => (m.role === 'user' || m.role === 'assistant') && m.content);
		const all = said.map((m) => m.content.toLowerCase()).join('\n');
		if (words.length && !words.every((w) => all.includes(w))) continue;
		const snippets = said
			.filter((m) => !words.length || words.some((w) => m.content.toLowerCase().includes(w)))
			.slice(0, 3)
			.map((m) => `${m.role === 'user' ? 'User' : 'You'}: ${m.content.replace(/\s+/g, ' ').slice(0, 280)}`);
		hits.push({ id: meta.id, title: meta.title, date: new Date(meta.updatedAt).toISOString().slice(0, 10), snippets });
		if (hits.length >= limit) break;
	}
	return hits;
}
