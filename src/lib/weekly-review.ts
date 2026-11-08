/**
 * Weekly review agent: a note that looks back at a week (Monday to Sunday)
 * and ahead at the next one. Written automatically for the past week the
 * first time Kurumi opens on or after Monday (`maybeAutoWeeklyReview`), or on
 * request from /review, ⌘K or the agent chat.
 *
 * The note's id comes from the vault and week (`review-<vault>-<monday>`), so two devices that
 * both write it end up with one note, and writing it again replaces it.
 * To-dos are listed as plain bullets: checkboxes would make copies of them
 * ($lib/note-tasks).
 */

import { get } from 'svelte/store';
import {
	actionItems,
	currentVaultId,
	decisions,
	meetingSeries,
	memoryObjects,
	projects,
	putGeneratedNote,
	questions,
	reminderProposals,
	todayIso,
	type ActionItem,
	type Decision,
	type MeetingSeries,
	type MemoryObject,
	type Project,
	type Question,
	type ReminderProposal
} from '$lib/db';
import { inferenceRouter } from '$lib/inference';
import { meetingsOf, nextMeetingDate } from '$lib/meetings';
import { isWaitingFor, myNames } from '$lib/work';

const DAY = 86_400_000;

const pad = (n: number) => String(n).padStart(2, '0');
export const isoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseIso = (iso: string) => {
	const [y, m, d] = iso.split('-').map(Number);
	return new Date(y, m - 1, d);
};

/** The Monday on or before `iso` (local time). */
export function mondayOf(iso: string): string {
	const date = parseIso(iso);
	date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
	return isoDate(date);
}

export const addDays = (iso: string, days: number) => {
	const date = parseIso(iso);
	date.setDate(date.getDate() + days);
	return isoDate(date);
};

export interface Week {
	start: string; // Monday, ISO
	end: string; // Sunday, ISO (inclusive)
}

/** The week before the one `today` is in. */
export function previousWeek(today: string): Week {
	const start = addDays(mondayOf(today), -7);
	return { start, end: addDays(start, 6) };
}

/** One review per week and vault. */
export const reviewNoteId = (week: Week, vaultId = get(currentVaultId)) => `review-${vaultId}-${week.start}`;
export const reviewTitle = (week: Week) => `Weekly review — ${week.start} to ${week.end}`;

export interface ReviewData {
	memories: MemoryObject[];
	items: ActionItem[];
	decisions: Decision[];
	questions: Question[];
	proposals: ReminderProposal[];
	series: MeetingSeries[];
	projects: Project[];
	names: string[];
	today: string;
}

const link = (m: Pick<MemoryObject, 'id' | 'title'>) => `[${(m.title || 'Untitled').replace(/[[\]]/g, '')}](/memory/${m.id})`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The review's markdown, or null when nothing happened that week and nothing is pending. */
export function buildWeeklyReview(week: Week, data: ReviewData): { body: string; facts: string } | null {
	const from = parseIso(week.start).getTime();
	const to = parseIso(week.end).getTime() + DAY;
	const inWeek = (ts: number) => ts >= from && ts < to;
	const inWeekIso = (iso: string | null) => !!iso && iso >= week.start && iso <= week.end;
	const nextStart = addDays(week.end, 1);
	const nextEnd = addDays(nextStart, 6);
	const isReview = (m: MemoryObject) => m.id.startsWith('review-') || /^(Daily digest|Weekly review) — /.test(m.title);

	const created = data.memories.filter((m) => inWeek(m.createdAt) && !isReview(m));
	const meetings = created.filter((m) => m.type === 'meeting' || m.seriesId);
	const voice = created.filter((m) => m.type === 'voice-memo');
	const notes = created.filter((m) => m.type === 'note' && !m.seriesId);
	const edited = data.memories.filter((m) => inWeek(m.updatedAt) && !inWeek(m.createdAt) && !isReview(m));
	const done = data.items.filter((a) => a.status === 'done' && inWeek(a.updatedAt));
	const added = data.items.filter((a) => inWeek(a.createdAt));
	const open = data.items.filter((a) => a.status === 'open' || a.status === 'in_progress');
	const overdue = open.filter((a) => a.dueDate && a.dueDate < data.today);
	const dueNext = open.filter((a) => a.dueDate && a.dueDate >= nextStart && a.dueDate <= nextEnd);
	const waiting = open.filter((a) => isWaitingFor(a, data.names));
	const decided = data.decisions.filter((d) => inWeekIso(d.decidedOn) || (!d.decidedOn && inWeek(d.createdAt)));
	const answered = data.questions.filter((q) => q.status === 'answered' && q.resolvedAt && inWeek(q.resolvedAt));
	const openQuestions = data.questions.filter((q) => q.status === 'open');
	const pending = data.proposals.filter((p) => p.status === 'pending');
	const upcoming = data.series
		.map((s) => ({ series: s, date: nextMeetingDate(s.cadence, meetingsOf(s.id, data.memories)[0]) }))
		.filter((x): x is { series: MeetingSeries; date: string } => !!x.date && x.date >= nextStart && x.date <= nextEnd)
		.sort((a, b) => a.date.localeCompare(b.date));

	// Projects worked on: notes in the project written or edited, to-dos done.
	const touched = [...created, ...edited];
	const activity = data.projects
		.map((p) => {
			const noteIds = new Set(data.memories.filter((m) => m.projects?.includes(p.name)).map((m) => m.id));
			const notesCount = touched.filter((m) => noteIds.has(m.id)).length;
			const doneCount = done.filter((a) => a.projectId === p.id || (a.memoryObjectId && noteIds.has(a.memoryObjectId))).length;
			return { project: p, notesCount, doneCount };
		})
		.filter((x) => x.notesCount || x.doneCount)
		.sort((a, b) => b.notesCount + b.doneCount - (a.notesCount + a.doneCount));

	const quiet = created.length + edited.length + done.length + decided.length + answered.length === 0;
	if (quiet && overdue.length + dueNext.length + waiting.length + pending.length === 0) return null;

	const lines: string[] = [];
	const stats = [
		created.length && plural(created.length, 'new note'),
		edited.length && `${edited.length} edited`,
		done.length && `${done.length} of ${open.length + done.length} to-dos done`,
		added.length && `${plural(added.length, 'to-do')} added`,
		decided.length && plural(decided.length, 'decision'),
		answered.length && `${plural(answered.length, 'question')} answered`
	].filter(Boolean);
	lines.push(stats.length ? stats.join(' · ') : '*A quiet week.*', '');

	if (meetings.length) {
		lines.push('## Meetings', '');
		for (const m of meetings) lines.push(`- ${link(m)}${m.summaryShort ? `: ${m.summaryShort}` : ''}`);
		lines.push('');
	}
	if (decided.length) {
		lines.push('## Decisions', '');
		for (const d of decided) lines.push(`- ${d.text}${d.rationale ? ` (${d.rationale})` : ''}`);
		lines.push('');
	}
	if (done.length) {
		lines.push('## Done', '');
		for (const a of done.slice(0, 20)) lines.push(`- ${a.text}`);
		if (done.length > 20) lines.push(`- …and ${done.length - 20} more`);
		lines.push('');
	}
	if (activity.length) {
		lines.push('## Projects', '');
		for (const { project, notesCount, doneCount } of activity.slice(0, 8)) {
			const parts = [notesCount && plural(notesCount, 'note'), doneCount && `${doneCount} done`].filter(Boolean);
			lines.push(`- **${project.name}**: ${parts.join(', ')}`);
		}
		lines.push('');
	}
	if (notes.length || voice.length) {
		lines.push('## Captured', '');
		for (const m of [...notes, ...voice].slice(0, 15)) lines.push(`- ${link(m)}`);
		if (notes.length + voice.length > 15) lines.push(`- …and ${notes.length + voice.length - 15} more`);
		lines.push('');
	}
	if (overdue.length || waiting.length || openQuestions.length || pending.length) {
		lines.push('## Still open', '');
		if (overdue.length) {
			lines.push(`**Overdue (${overdue.length})**`, '');
			for (const a of overdue.slice(0, 10)) lines.push(`- ${a.text} (due ${a.dueDate})`);
			lines.push('');
		}
		if (waiting.length) {
			lines.push(`**Waiting for others (${waiting.length})**`, '');
			for (const a of waiting.slice(0, 10)) lines.push(`- ${a.text} (${a.assignee})`);
			lines.push('');
		}
		if (openQuestions.length) {
			lines.push(`**Open questions (${openQuestions.length})**`, '');
			for (const q of openQuestions.slice(0, 8)) lines.push(`- ${q.text}`);
			lines.push('');
		}
		if (pending.length) lines.push(`${plural(pending.length, 'reminder proposal')} waiting for review on [Proposals](/proposals).`, '');
	}
	if (dueNext.length || upcoming.length) {
		lines.push(`## Next week (${nextStart} to ${nextEnd})`, '');
		for (const { series, date } of upcoming) lines.push(`- ${series.name} (meeting, ${date})`);
		for (const a of dueNext.sort((x, y) => x.dueDate!.localeCompare(y.dueDate!)).slice(0, 15)) lines.push(`- ${a.text} (due ${a.dueDate})`);
		lines.push('');
	}

	const body = lines.join('\n').trimEnd() + '\n';
	return { body, facts: `Week ${week.start} to ${week.end}\n\n${body}` };
}

async function narrative(facts: string): Promise<string | null> {
	for (const provider of inferenceRouter.allProviders()) {
		try {
			const result = await provider.summarize({
				text: `Write a short, warm weekly review (3-5 sentences) for the person whose week this is: what moved forward, what's stuck, and what to focus on next week. Address them as "you".\n\n${facts}`,
				style: 'long'
			});
			if (result.ok && result.value) return result.value.trim();
		} catch {
			// Try the next provider.
		}
	}
	return null;
}

/**
 * Write (or rewrite) the review note for `week`, by default last week.
 * Returns its id, or null when `skipIfEmpty` and there's nothing to say.
 */
export async function generateWeeklyReview(
	week: Week = previousWeek(todayIso()),
	options: { skipIfEmpty?: boolean; summary?: boolean } = {}
): Promise<string | null> {
	const data: ReviewData = {
		memories: get(memoryObjects),
		items: get(actionItems),
		decisions: get(decisions),
		questions: get(questions),
		proposals: get(reminderProposals),
		series: get(meetingSeries),
		projects: get(projects),
		names: get(myNames),
		today: todayIso()
	};
	const built = buildWeeklyReview(week, data);
	if (!built && options.skipIfEmpty) return null;
	let body = built?.body ?? '*Nothing happened this week, and nothing is waiting.*\n';
	if (built && options.summary !== false) {
		const summary = await narrative(built.facts);
		if (summary) body = `> ${summary.replace(/\n+/g, '\n> ')}\n\n${body}`;
	}
	return putGeneratedNote(reviewNoteId(week), reviewTitle(week), body).id;
}

const AUTO_KEY = 'kurumi-last-auto-review';

/**
 * Write last week's review the first time the app opens in a new week,
 * unless it exists already (from another device). Quiet weeks get no note.
 */
export async function maybeAutoWeeklyReview(): Promise<void> {
	const week = previousWeek(todayIso());
	try {
		if (localStorage.getItem(AUTO_KEY) === week.start) return;
	} catch {
		return;
	}
	const exists = get(memoryObjects).some((m) => m.id === reviewNoteId(week));
	if (!exists) await generateWeeklyReview(week, { skipIfEmpty: true });
	try {
		localStorage.setItem(AUTO_KEY, week.start);
	} catch {
		// Tried again next start.
	}
}
