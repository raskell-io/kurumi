/**
 * Open to-dos for the home page: action items, plus unchecked `- [ ]`
 * task-list items written inside notes.
 */

import type { ActionItem, MemoryObject } from './db/types';

export interface NoteTask {
	memoryId: string;
	noteTitle: string;
	text: string;
	line: number; // 0-based line in the note body
}

const TASK_LINE = /^(\s*[-*+]\s+)\[ \](\s+)(.*\S.*)$/;
const FENCE = /^\s*(```|~~~)/;

/** Unchecked task-list items in a markdown body (code blocks skipped). */
export function findOpenTasks(body: string): { line: number; text: string }[] {
	const out: { line: number; text: string }[] = [];
	let inFence = false;
	body.split('\n').forEach((line, i) => {
		if (FENCE.test(line)) inFence = !inFence;
		else if (!inFence) {
			const match = line.match(TASK_LINE);
			if (match) out.push({ line: i, text: match[3].trim() });
		}
	});
	return out;
}

/** Open note tasks across notes, most recently edited notes first. */
export function openNoteTasks(memories: MemoryObject[]): NoteTask[] {
	return [...memories]
		.sort((a, b) => b.updatedAt - a.updatedAt)
		.flatMap((m) =>
			findOpenTasks(m.bodyMarkdown ?? '').map((t) => ({
				memoryId: m.id,
				noteTitle: m.title || 'Untitled',
				text: t.text,
				line: t.line
			}))
		);
}

/**
 * Tick the task on `line` if it's still the same open task, returning the
 * new body, or null if the note changed underneath us.
 */
export function checkTaskInBody(body: string, line: number, text: string): string | null {
	const lines = body.split('\n');
	const match = lines[line]?.match(TASK_LINE);
	if (!match || match[3].trim() !== text) return null;
	lines[line] = `${match[1]}[x]${match[2]}${match[3]}`;
	return lines.join('\n');
}

/**
 * Open action items in the order they need attention: overdue and due
 * today first (by date), then in progress, then upcoming, then undated.
 */
export function sortOpenActionItems(items: ActionItem[], today: string): ActionItem[] {
	const rank = (a: ActionItem) =>
		a.dueDate && a.dueDate <= today ? 0 : a.status === 'in_progress' ? 1 : a.dueDate ? 2 : 3;
	return items
		.filter((a) => a.status === 'open' || a.status === 'in_progress')
		.sort(
			(a, b) =>
				rank(a) - rank(b) ||
				(a.dueDate ?? '').localeCompare(b.dueDate ?? '') ||
				b.createdAt - a.createdAt
		);
}
