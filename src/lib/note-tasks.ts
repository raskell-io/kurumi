/**
 * Checkbox lines in notes as to-dos (inline action items).
 *
 *   - [ ] Send the draft to the team @Alice //2026-11-12
 *
 * Every task line in a note is mirrored as an ActionItem (`noteTask: true`).
 * The line is the source of truth: the checkbox is the status, a `//date` (or
 * Obsidian's `📅 date`) the due date, an `@Name` at the end the assignee. The
 * store reconciles items with the lines (`reconcileNoteTasks` in store.ts) and
 * writes changes made on /actions back into the line (`rewriteTaskLine`).
 *
 * Item ids are derived from the note id and the task's text, so two devices
 * that reconcile the same note make the same items, and a sync can't
 * duplicate them. Editing the date, assignee or checkbox keeps the id;
 * editing the text makes a new one.
 *
 * Kept free of the store so it can be tested on its own.
 */

export interface ParsedTask {
	id: string;
	line: number; // 0-based line in the body
	text: string; // without the due date and trailing assignee
	checked: boolean;
	dueDate: string | null;
	assignee: string | null;
}

const TASK_LINE = /^(\s*(?:[-*+]|\d+[.)])\s+)\[([ xX])\](\s+)(.*\S.*)$/;
const FENCE = /^\s*(```|~~~)/;
const DATE_TOKEN = /\s*(?:\/\/|📅\s*)(\d{4}-\d{2}-\d{2})\b/gu;
// A person at the end of the line: `@Alice` or `@Alice Smith` (as the editor marks them).
const TRAILING_PERSON = /\s+@([A-Z][a-zA-Z]+(?: [A-Z][a-zA-Z]+)*)\s*$/;
const PERSON_NAME = /^[A-Z][a-zA-Z]+(?: [A-Z][a-zA-Z]+)*$/;

/** Whether `name` can be written as an `@Name` in a note. */
export const expressibleAssignee = (name: string) => PERSON_NAME.test(name);

/** FNV-1a, 32 bit, as 8 hex digits: short and stable, not for security. */
function hash(text: string): string {
	let h = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		h ^= text.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return (h >>> 0).toString(16).padStart(8, '0');
}

const identity = (text: string) => text.toLowerCase().replace(/\s+/g, ' ').trim();

/** The id of the `occurrence`-th task with this text in a note. */
export function noteTaskId(memoryId: string, text: string, occurrence = 0): string {
	return `nt-${memoryId}-${hash(identity(text))}${occurrence ? `-${occurrence}` : ''}`;
}

/** Split a task's content into its text, due date and trailing assignee. */
export function splitTaskContent(content: string): { text: string; dueDate: string | null; assignee: string | null } {
	let dueDate: string | null = null;
	let rest = content.replace(DATE_TOKEN, (_, date: string) => {
		dueDate ??= date;
		return '';
	});
	let assignee: string | null = null;
	const person = rest.match(TRAILING_PERSON);
	if (person) {
		assignee = person[1];
		rest = rest.slice(0, person.index);
	}
	return { text: rest.replace(/\s+/g, ' ').trim(), dueDate, assignee };
}

/** Task lines in a markdown body (checked or not; code blocks skipped). */
export function parseNoteTasks(memoryId: string, body: string): ParsedTask[] {
	const tasks: ParsedTask[] = [];
	const seen = new Map<string, number>();
	let inFence = false;
	body.split('\n').forEach((line, index) => {
		if (FENCE.test(line)) {
			inFence = !inFence;
			return;
		}
		if (inFence) return;
		const match = line.match(TASK_LINE);
		if (!match) return;
		const { text, dueDate, assignee } = splitTaskContent(match[4]);
		if (!text) return;
		const key = identity(text);
		const occurrence = seen.get(key) ?? 0;
		seen.set(key, occurrence + 1);
		tasks.push({
			id: noteTaskId(memoryId, text, occurrence),
			line: index,
			text,
			checked: match[2] !== ' ',
			dueDate,
			assignee
		});
	});
	return tasks;
}

export interface TaskChange {
	checked?: boolean;
	text?: string;
	dueDate?: string | null;
	assignee?: string | null;
}

/** Build a task's content from its parts (the inverse of `splitTaskContent`). */
export function taskContent(text: string, dueDate: string | null, assignee: string | null): string {
	let content = text.trim();
	if (assignee && expressibleAssignee(assignee)) content += ` @${assignee}`;
	if (dueDate) content += ` //${dueDate}`;
	return content;
}

/** `line` (a task line) with `change` applied; other lines come back unchanged. */
export function rewriteTaskLine(line: string, change: TaskChange): string {
	const match = line.match(TASK_LINE);
	if (!match) return line;
	const [, prefix, mark, gap, content] = match;
	const box = change.checked === undefined ? mark : change.checked ? (mark === ' ' ? 'x' : mark) : ' ';
	let nextContent = content;
	if (change.text !== undefined || change.dueDate !== undefined || change.assignee !== undefined) {
		const parts = splitTaskContent(content);
		nextContent = taskContent(
			change.text ?? parts.text,
			change.dueDate !== undefined ? change.dueDate : parts.dueDate,
			change.assignee !== undefined ? change.assignee : parts.assignee
		);
	}
	return `${prefix}[${box}]${gap}${nextContent}`;
}

/** The body with task `id` changed, or null if the note has no such task. */
export function updateTaskInBody(memoryId: string, body: string, id: string, change: TaskChange): string | null {
	const task = parseNoteTasks(memoryId, body).find((t) => t.id === id);
	if (!task) return null;
	const lines = body.split('\n');
	lines[task.line] = rewriteTaskLine(lines[task.line], change);
	return lines.join('\n');
}

/** The body without task `id`'s line, plus where it was; null if there's no such task. */
export function removeTaskFromBody(memoryId: string, body: string, id: string): { body: string; line: number; text: string } | null {
	const task = parseNoteTasks(memoryId, body).find((t) => t.id === id);
	if (!task) return null;
	const lines = body.split('\n');
	const [removed] = lines.splice(task.line, 1);
	return { body: lines.join('\n'), line: task.line, text: removed };
}

/** The body with `lineText` put back at `line` (undoing `removeTaskFromBody`). */
export function insertLine(body: string, line: number, lineText: string): string {
	const lines = body.split('\n');
	lines.splice(Math.min(Math.max(0, line), lines.length), 0, lineText);
	return lines.join('\n');
}

/** The fields of a note task's item that come from its line. */
export interface ItemFields {
	text: string;
	dueDate: string | null;
	assignee: string | null;
	status: 'open' | 'in_progress' | 'done' | 'cancelled';
}

/**
 * What an existing item should become given its line: the checkbox decides
 * done / not done (in progress and cancelled are kept while it's unticked),
 * the line's date is the due date, and the line's assignee wins, except that
 * an assignee no `@Name` can express stays on the item.
 */
export function fieldsFromTask(task: ParsedTask, item: ItemFields | null): ItemFields {
	let status: ItemFields['status'] = task.checked ? 'done' : 'open';
	if (item && !task.checked && (item.status === 'in_progress' || item.status === 'cancelled')) status = item.status;
	const keptAssignee = item?.assignee && !expressibleAssignee(item.assignee) ? item.assignee : null;
	return { text: task.text, dueDate: task.dueDate, assignee: task.assignee ?? keptAssignee, status };
}
