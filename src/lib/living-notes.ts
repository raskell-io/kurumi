/**
 * Living notes: a note that follows a topic (a search query such as
 * `tag:falcon` or `person:"Ana Ruiz"`) and is rewritten by the assistant as
 * the notes matching it change: "my current understanding of X".
 *
 * - The rewrite starts from the note's current text, so the user's own
 *   edits are kept (they're the newest version) and carried forward.
 * - It runs when the matching notes changed since the last rewrite, at
 *   most every 6 hours on its own (`maybeUpdateLivingNotes`), or on request.
 * - Each rewrite is an ordinary edit: version history has every step.
 * - Only remote AI providers are used, so it never starts a model download.
 *
 * The config is `MemoryObject.living` ({ query, signature, updatedAt,
 * sources }), set with `setLivingNote` in the store.
 */

import { get } from 'svelte/store';
import { getMemoryObject, memoryObjects, setLivingNote, updateMemoryObject, type LivingConfig, type MemoryObject } from '$lib/db';
import { inferenceRouter, PROVIDER_CONFIGS } from '$lib/inference';
import { search } from '$lib/search';

export const MIN_INTERVAL_MS = 6 * 60 * 60 * 1000;
const MAX_SOURCES = 20;
const SOURCE_CHARS = 1500;

/** Notes that feed a living note: the query's matches, not itself, other living notes or generated reports. */
export function selectSources(note: Pick<MemoryObject, 'id'>, matches: MemoryObject[]): MemoryObject[] {
	return matches
		.filter(
			(m) =>
				m.id !== note.id &&
				!m.living &&
				!m.deletedAt &&
				m.type !== 'canvas' &&
				!m.id.startsWith('review-') &&
				!m.id.startsWith('agent-memory-') &&
				!/^Daily digest — /.test(m.title)
		)
		.sort((a, b) => b.updatedAt - a.updatedAt)
		.slice(0, MAX_SOURCES);
}

/** A fingerprint of the sources: changes when one is added, removed or edited. */
export function sourceSignature(sources: Pick<MemoryObject, 'id' | 'updatedAt'>[]): string {
	return [...sources]
		.map((s) => `${s.id}:${s.updatedAt}`)
		.sort()
		.join('|');
}

/** Whether a living note is due a rewrite on its own (not forced). */
export function needsUpdate(living: LivingConfig, signature: string, now: number): boolean {
	if (!signature || living.signature === signature) return false;
	return !living.updatedAt || now - living.updatedAt >= MIN_INTERVAL_MS;
}

/** Replace `[n]` citations with links to the cited notes (n counts from 1 over `titles`; null drops it). */
export function citeAsLinks(text: string, titles: (string | null)[]): string {
	return text
		.replace(/\s*\[(\d+)\]/g, (whole, n: string) => {
			const index = Number(n) - 1;
			if (index < 0 || index >= titles.length) return whole;
			const title = titles[index];
			return title ? ` [[${title.replace(/[[\]|]/g, '')}]]` : '';
		})
		.replace(/ {2,}\[\[/g, ' [[')
		.replace(/(\[\[[^\]]+\]\])(?: \1)+/g, '$1');
}

function matchesFor(note: MemoryObject): MemoryObject[] {
	const query = note.living?.query.trim();
	if (!query) return [];
	const byId = new Map(get(memoryObjects).map((m) => [m.id, m]));
	return search(query)
		.map((hit) => byId.get(hit.id))
		.filter((m): m is MemoryObject => !!m);
}

/** A first topic for a note made living: its tags, else its title as words. */
export function livingQueryFor(note: Pick<MemoryObject, 'title' | 'tags'>): string {
	if (note.tags?.length) return note.tags.map((t) => `tag:${t}`).join(' ');
	return note.title.replace(/["\[\]]/g, '').trim();
}

export function sourcesOf(note: MemoryObject): MemoryObject[] {
	return selectSources(note, matchesFor(note));
}

// Remote providers with a key set (all of them are registered, keyed or not).
function hasKey(id: string): boolean {
	const storageKey = id === 'openai' ? 'kurumi-openai-key' : PROVIDER_CONFIGS.find((c) => c.id === id)?.apiKeyStorageKey;
	if (!storageKey) return true; // not one of ours (e.g. a test stub)
	try {
		return !!localStorage.getItem(storageKey);
	} catch {
		return false;
	}
}
const remoteProviders = () => inferenceRouter.allProviders().filter((p) => p.capabilities.target === 'remote' && hasKey(p.capabilities.id));

/** Whether a living note can be rewritten here (an AI provider is set up). */
export function canRewrite(): boolean {
	return remoteProviders().length > 0;
}

export type RewriteResult = { ok: true; changed: boolean; sources: number } | { ok: false; error: string };

/** Rewrite a living note from its sources now. */
export async function rewriteLivingNote(id: string): Promise<RewriteResult> {
	const note = getMemoryObject(id);
	if (!note?.living) return { ok: false, error: 'Not a living note' };
	const sources = sourcesOf(note);
	const signature = sourceSignature(sources);
	if (!sources.length) return { ok: false, error: `No notes match “${note.living.query}” yet` };

	const since = note.living.updatedAt ?? 0;
	const context = [
		{ memoryId: note.id, text: `CURRENT VERSION of the living note "${note.title}" (keep what is still true; the user may have edited it):\n\n${note.bodyMarkdown.trim() || '(empty)'}` },
		...sources.map((s) => ({
			memoryId: s.id,
			text: `"${s.title || 'Untitled'}" (${new Date(s.updatedAt).toISOString().slice(0, 10)}${s.updatedAt > since && since ? ', changed since the last version' : ''})\n${(s.summaryShort ? s.summaryShort + '\n' : '') + s.bodyMarkdown.slice(0, SOURCE_CHARS)}`
		}))
	];
	const question = [
		`Rewrite the living note "${note.title}": the user's current understanding of the topic "${note.living.query}", from the memories below.`,
		'Start from the current version [1]: keep what is still true and anything the user wrote there, update what changed, add what is new, drop what the memories now contradict.',
		'Write it as the note itself, in markdown, in the user\'s voice ("we", "I"), not as an answer about it:',
		'a short summary paragraph, then sections with headings such as Current state, Decisions, Open questions, Next steps (only those that have content).',
		'Cite the memories each point rests on with [n]. Do not cite [1]. Up to about 400 words. No title heading.'
	].join(' ');

	let lastError = 'No AI provider configured';
	for (const provider of remoteProviders()) {
		try {
			const result = await provider.answerWithContext({ question, context });
			if (!result.ok || !result.value?.answer) {
				lastError = result.ok ? 'Empty answer' : (result.error ?? 'Failed');
				continue;
			}
			const titles = [null, ...sources.map((s) => s.title || null)];
			const body = citeAsLinks(result.value.answer.trim(), titles).trim() + '\n';
			const current = getMemoryObject(id);
			if (!current?.living) return { ok: false, error: 'No longer a living note' };
			const changed = body !== current.bodyMarkdown;
			if (changed) updateMemoryObject(id, { bodyMarkdown: body });
			setLivingNote(id, { ...current.living, signature, updatedAt: Date.now(), sources: sources.map((s) => s.id) });
			return { ok: true, changed, sources: sources.length };
		} catch (err) {
			lastError = err instanceof Error ? err.message : 'Failed';
		}
	}
	return { ok: false, error: lastError };
}

let running = false;

/**
 * Rewrite the living notes whose sources changed (at most every 6 hours
 * each, three per run). Called on start and every half hour by the layout.
 */
export async function maybeUpdateLivingNotes(now = Date.now()): Promise<number> {
	if (running || !canRewrite()) return 0;
	running = true;
	let updated = 0;
	try {
		const living = get(memoryObjects).filter((m) => m.living && !m.deletedAt);
		for (const note of living) {
			if (updated >= 3) break;
			const signature = sourceSignature(sourcesOf(note));
			if (!needsUpdate(note.living!, signature, now)) continue;
			const result = await rewriteLivingNote(note.id);
			if (result.ok) updated++;
		}
	} finally {
		running = false;
	}
	return updated;
}
