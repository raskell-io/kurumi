/**
 * AI-native digest and insight generators.
 *
 * These are not real-time — they produce a MemoryObject (note) or a
 * Template as output. The user triggers them explicitly (via a button
 * or the agent chat) and reviews the result before it becomes part of
 * the vault.
 *
 * Each function returns the id of the created memory/template so the
 * caller can navigate to it.
 */

import { get } from 'svelte/store';
import {
	memoryObjects,
	actionItems,
	reminderProposals,
	addMemoryObject,
	addFlashcard,
	todayIso,
	addTemplate,
	getCurrentVaultName
} from '$lib/db';
import type { MemoryObject, ActionItem, ReminderProposal, Template } from '$lib/db/types';
import { inferenceRouter } from '$lib/inference';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function yesterday(): string {
	const d = new Date();
	d.setDate(d.getDate() - 1);
	return d.toISOString().split('T')[0];
}

function dateRangeMs(isoDate: string): { start: number; end: number } {
	const start = new Date(`${isoDate}T00:00:00`).getTime();
	const end = start + 86_400_000;
	return { start, end };
}

function formatDate(ts: number): string {
	return new Date(ts).toLocaleDateString('en-US', {
		weekday: 'short',
		month: 'short',
		day: 'numeric'
	});
}

async function summarizeText(text: string): Promise<string | null> {
	for (const provider of inferenceRouter.allProviders()) {
		try {
			const result = await provider.summarize({ text, style: 'long' });
			if (result.ok && result.value) return result.value;
		} catch {
			// Try next
		}
	}
	return null;
}

// ---------------------------------------------------------------------------
// Daily digest
// ---------------------------------------------------------------------------

/**
 * Generate a daily digest note for a given ISO date (defaults to
 * yesterday). Creates a new memory with type 'note' containing:
 *
 * - Captures summary (meetings, voice memos, notes created that day)
 * - Open action items due on or before today
 * - Pending reminder proposals
 * - An LLM-written narrative summary tying it together
 *
 * Returns the new memory's id so the caller can navigate to it.
 */
export async function generateDailyDigest(
	forDate?: string
): Promise<string> {
	const targetDate = forDate ?? yesterday();
	const today = todayIso();
	const { start, end } = dateRangeMs(targetDate);

	const all = get(memoryObjects);
	const allActions = get(actionItems);
	const allProposals = get(reminderProposals);

	// Captures from the target date
	const captures = all.filter(
		(m) => m.createdAt >= start && m.createdAt < end
	);
	const meetings = captures.filter((m) => m.type === 'meeting');
	const voiceMemos = captures.filter((m) => m.type === 'voice-memo');
	const notes = captures.filter((m) => m.type === 'note');

	// Open actions due today or earlier
	const dueActions = allActions.filter(
		(a) =>
			(a.status === 'open' || a.status === 'in_progress') &&
			a.dueDate !== null &&
			a.dueDate <= today
	);

	// Pending proposals
	const pending = allProposals.filter((p) => p.status === 'pending');

	// Build the markdown body
	const lines: string[] = [];
	lines.push(`# Daily digest — ${targetDate}`);
	lines.push('');

	if (captures.length === 0 && dueActions.length === 0 && pending.length === 0) {
		lines.push('*Nothing to report for this day.*');
	} else {
		// Captures
		if (captures.length > 0) {
			lines.push(`## Captured on ${formatDate(start)}`);
			lines.push('');
			if (meetings.length > 0) {
				lines.push(`**Meetings (${meetings.length}):**`);
				for (const m of meetings) {
					lines.push(`- [${m.title || 'Untitled'}](/memory/${m.id})${m.summaryShort ? ': ' + m.summaryShort : ''}`);
				}
				lines.push('');
			}
			if (voiceMemos.length > 0) {
				lines.push(`**Voice memos (${voiceMemos.length}):**`);
				for (const m of voiceMemos) {
					lines.push(`- [${m.title || 'Untitled'}](/memory/${m.id})${m.summaryShort ? ': ' + m.summaryShort : ''}`);
				}
				lines.push('');
			}
			if (notes.length > 0) {
				lines.push(`**Notes (${notes.length}):**`);
				for (const m of notes) {
					lines.push(`- [${m.title || 'Untitled'}](/memory/${m.id})`);
				}
				lines.push('');
			}
		}

		// Due actions
		if (dueActions.length > 0) {
			lines.push(`## Action items due`);
			lines.push('');
			for (const a of dueActions.slice(0, 15)) {
				lines.push(`- [ ] ${a.text}${a.dueDate ? ` (due ${a.dueDate})` : ''}${a.assignee ? ` — ${a.assignee}` : ''}`);
			}
			if (dueActions.length > 15) {
				lines.push(`- ...and ${dueActions.length - 15} more`);
			}
			lines.push('');
		}

		// Pending proposals
		if (pending.length > 0) {
			lines.push(`## Pending proposals (${pending.length})`);
			lines.push('');
			for (const p of pending.slice(0, 10)) {
				lines.push(`- ${p.text} (${p.suggestedDate})`);
			}
			lines.push('');
		}
	}

	// LLM summary
	const rawContent = lines.join('\n');
	const summary = await summarizeText(rawContent);
	if (summary) {
		lines.push('---');
		lines.push('');
		lines.push('## AI summary');
		lines.push('');
		lines.push(summary);
	}

	const finalBody = lines.join('\n');
	const memory = addMemoryObject(`Daily digest — ${targetDate}`, finalBody, null);
	return memory.id;
}

// ---------------------------------------------------------------------------
// AI-authored templates
// ---------------------------------------------------------------------------

/**
 * Given 3-5 example memory ids, use the LLM to extract a reusable
 * template with {placeholder} variables. Returns the new template's id.
 */
export async function generateTemplateFromExamples(
	exampleIds: string[]
): Promise<string | null> {
	const all = get(memoryObjects);
	const examples = exampleIds
		.map((id) => all.find((m) => m.id === id))
		.filter((m): m is MemoryObject => !!m);

	if (examples.length < 2) return null;

	const prompt = [
		'Below are several example notes from the same user. They share a',
		'common structure or pattern. Extract a reusable template from them.',
		'',
		'Use {variable_name} placeholders for parts that change between notes.',
		'Always include {title} and {date} as standard placeholders.',
		'Output ONLY the template markdown — no explanation.',
		'',
		...examples.map((m, i) => [
			`--- Example ${i + 1}: "${m.title}" ---`,
			m.bodyMarkdown.slice(0, 1500),
			''
		]).flat()
	].join('\n');

	for (const provider of inferenceRouter.allProviders()) {
		try {
			const result = await provider.summarize({ text: prompt, style: 'long' });
			if (result.ok && result.value) {
				const template = addTemplate(
					`Template from ${examples.length} examples`,
					result.value
				);
				return template.id;
			}
		} catch {
			// Try next
		}
	}
	return null;
}

// ---------------------------------------------------------------------------
// Proactive pattern detection
// ---------------------------------------------------------------------------

export interface DetectedPattern {
	type: 'frequent-person' | 'stale-topic' | 'broad-tag' | 'missing-summary';
	message: string;
	actionLabel: string;
	actionHref: string;
}

/**
 * Scan the vault for patterns worth surfacing. Returns a list of
 * actionable observations.
 */
export function detectPatterns(): DetectedPattern[] {
	const all = get(memoryObjects);
	const patterns: DetectedPattern[] = [];
	const now = Date.now();
	const thirtyDays = 30 * 86_400_000;

	// Frequent person mentions (>5 memories) without a dedicated Person page
	const personCounts = new Map<string, number>();
	for (const m of all) {
		for (const p of m.participants ?? []) {
			personCounts.set(p, (personCounts.get(p) || 0) + 1);
		}
	}
	for (const [name, count] of personCounts) {
		if (count >= 6) {
			patterns.push({
				type: 'frequent-person',
				message: `${name} appears in ${count} memories this month`,
				actionLabel: 'View',
				actionHref: `/read/person/${encodeURIComponent(name)}`
			});
		}
	}

	// Stale topics: topics referenced only in old memories (>30 days)
	const topicLatest = new Map<string, number>();
	for (const m of all) {
		for (const t of m.topics ?? []) {
			const key = t.toLowerCase();
			topicLatest.set(key, Math.max(topicLatest.get(key) || 0, m.updatedAt));
		}
	}
	for (const [topic, lastSeen] of topicLatest) {
		if (now - lastSeen > thirtyDays * 3) {
			patterns.push({
				type: 'stale-topic',
				message: `Topic "${topic}" hasn't been referenced in 3+ months`,
				actionLabel: 'View',
				actionHref: `/read/topic/${encodeURIComponent(topic)}`
			});
		}
	}

	// Broad tags (>50 memories) — suggest splitting
	const tagCounts = new Map<string, number>();
	for (const m of all) {
		for (const tag of m.tags ?? []) {
			tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
		}
	}
	for (const [tag, count] of tagCounts) {
		if (count >= 50) {
			patterns.push({
				type: 'broad-tag',
				message: `Tag #${tag} has ${count} memories — consider splitting`,
				actionLabel: 'Manage',
				actionHref: '/tags'
			});
		}
	}

	// Memories missing summaries (voice memos / meetings that finished
	// processing but have no summaryShort — might be stuck)
	const missingSummary = all.filter(
		(m) =>
			(m.type === 'voice-memo' || m.type === 'meeting') &&
			m.processingState === 'ready' &&
			!m.summaryShort &&
			m.transcript
	);
	if (missingSummary.length > 0) {
		patterns.push({
			type: 'missing-summary',
			message: `${missingSummary.length} transcribed memo${missingSummary.length === 1 ? '' : 's'} missing a summary`,
			actionLabel: 'View',
			actionHref: '/actions'
		});
	}

	return patterns;
}

// ---------------------------------------------------------------------------
// LLM quiz generation
// ---------------------------------------------------------------------------

/**
 * Generate flashcard Q/A pairs from a memory using the LLM. Creates
 * Flashcard entities linked to the source memory. Returns the number
 * of cards created.
 */
export async function generateQuizFromMemory(memoryId: string): Promise<number> {
	const all = get(memoryObjects);
	const memory = all.find((m) => m.id === memoryId);
	if (!memory) return 0;

	const sourceText = [memory.title, memory.summaryShort, memory.bodyMarkdown]
		.filter(Boolean)
		.join('\n\n')
		.slice(0, 3000);

	if (!sourceText.trim()) return 0;

	const prompt = [
		'Generate 3-8 flashcard question/answer pairs from this note.',
		'Each pair should test a key fact, concept, or decision mentioned.',
		'',
		'Output ONLY a JSON array of objects with "question" and "answer" keys.',
		'Keep questions concise (1-2 sentences) and answers brief (1-3 sentences).',
		'Do not include meta-commentary. Output raw JSON only.',
		'',
		'Note content:',
		sourceText
	].join('\n');

	for (const provider of inferenceRouter.allProviders()) {
		try {
			const result = await provider.summarize({ text: prompt, style: 'long' });
			if (!result.ok || !result.value) continue;

			// Parse the JSON array from the response
			let pairs: Array<{ question?: string; answer?: string }> = [];
			try {
				// The model might wrap in ```json...``` or just return raw JSON
				const cleaned = result.value
					.replace(/^```(?:json)?\n?/m, '')
					.replace(/\n?```$/m, '')
					.trim();
				pairs = JSON.parse(cleaned);
			} catch {
				// Try to extract from a narrative response
				try {
					const match = result.value.match(/\[[\s\S]*\]/);
					if (match) pairs = JSON.parse(match[0]);
				} catch {
					continue;
				}
			}

			if (!Array.isArray(pairs)) continue;

			let created = 0;
			for (const pair of pairs) {
				const q = typeof pair.question === 'string' ? pair.question.trim() : '';
				const a = typeof pair.answer === 'string' ? pair.answer.trim() : '';
				if (!q || !a) continue;
				addFlashcard({ question: q, answer: a, memoryObjectId: memoryId });
				created++;
			}
			return created;
		} catch {
			continue;
		}
	}
	return 0;
}

// ---------------------------------------------------------------------------
// Journal prompts
// ---------------------------------------------------------------------------

/**
 * Generate 2-3 reflection prompts for a daily journal based on recent
 * vault activity. Returns markdown-formatted prompts. If no inference
 * provider is available, returns a set of generic prompts.
 */
export async function generateJournalPrompts(isoDate: string): Promise<string> {
	const all = get(memoryObjects);
	const allActions = get(actionItems);
	const { start, end } = dateRangeMs(isoDate);

	// Gather context: recent captures, open actions, mentions
	const recentCaptures = all
		.filter((m) => m.createdAt >= start - 3 * 86_400_000 && m.createdAt < end)
		.slice(0, 10);
	const openActions = allActions
		.filter((a) => a.status === 'open' || a.status === 'in_progress')
		.slice(0, 5);

	const context = [
		recentCaptures.length > 0
			? `Recent notes: ${recentCaptures.map((m) => m.title || 'Untitled').join(', ')}`
			: '',
		openActions.length > 0
			? `Open tasks: ${openActions.map((a) => a.text).join('; ')}`
			: ''
	]
		.filter(Boolean)
		.join('\n');

	if (!context.trim()) {
		// No context — return generic prompts
		return [
			'## Journal prompts',
			'',
			'- What is one thing I want to accomplish today?',
			'- What am I grateful for right now?',
			'- What is on my mind that I need to process?'
		].join('\n');
	}

	const prompt = [
		'Based on this context from the user\'s recent activity, generate 2-3 short,',
		'thoughtful journal prompts for today. Each should be a question that encourages',
		'reflection. Output ONLY the prompts as a markdown list (- items). No preamble.',
		'',
		context
	].join('\n');

	for (const provider of inferenceRouter.allProviders()) {
		try {
			const result = await provider.summarize({ text: prompt, style: 'short' });
			if (result.ok && result.value) {
				return `## Journal prompts\n\n${result.value}`;
			}
		} catch {
			continue;
		}
	}

	// Fallback if no provider works
	return [
		'## Journal prompts',
		'',
		'- What is one thing I want to accomplish today?',
		'- What am I grateful for right now?',
		'- What is on my mind that I need to process?'
	].join('\n');
}

// ---------------------------------------------------------------------------
// Semantic backlinks
// ---------------------------------------------------------------------------

/**
 * Find memories semantically similar to the given one. Uses the
 * existing embedding index to rank by cosine similarity, then
 * filters out the source memory itself and any explicit wikilink
 * targets (those are already shown as regular backlinks).
 *
 * Returns up to `limit` memories with their similarity scores.
 */
export async function findSemanticBacklinks(
	memoryId: string,
	limit: number = 5
): Promise<Array<{ memory: MemoryObject; score: number }>> {
	const all = get(memoryObjects);
	const source = all.find((m) => m.id === memoryId);
	if (!source) return [];

	// Use the memory's title + summary as the query for embedding search.
	const queryText = [source.title, source.summaryShort, source.bodyMarkdown?.slice(0, 500)]
		.filter(Boolean)
		.join(' ');
	if (!queryText.trim()) return [];

	try {
		const { semanticSearch } = await import('./embeddings');
		const hits = await semanticSearch(queryText, limit + 5);
		return hits
			.filter((h) => h.memoryId !== memoryId)
			.slice(0, limit)
			.map((h) => {
				const memory = all.find((m) => m.id === h.memoryId);
				return memory ? { memory, score: h.similarity } : null;
			})
			.filter((x): x is { memory: MemoryObject; score: number } => x !== null);
	} catch {
		return [];
	}
}
