import { describe, expect, it } from 'vitest';
import {
	fieldsFromTask,
	insertLine,
	noteTaskId,
	parseNoteTasks,
	removeTaskFromBody,
	rewriteTaskLine,
	splitTaskContent,
	updateTaskInBody
} from '$lib/note-tasks';

const body = [
	'# Plan',
	'- [ ] Send the draft @Alice //2026-11-12',
	'- [x] Book the room',
	'  * [ ] Nested 📅 2026-12-01',
	'1. [ ] Numbered task',
	'```',
	'- [ ] not a task, in code',
	'```',
	'- [ ] Book the room',
	'- [ ]   ',
	'- plain item'
].join('\n');

describe('note tasks', () => {
	it('finds task lines with status, date and trailing assignee', () => {
		const tasks = parseNoteTasks('m1', body);
		expect(tasks.map((t) => [t.line, t.text, t.checked, t.dueDate, t.assignee])).toEqual([
			[1, 'Send the draft', false, '2026-11-12', 'Alice'],
			[2, 'Book the room', true, null, null],
			[3, 'Nested', false, '2026-12-01', null],
			[4, 'Numbered task', false, null, null],
			[8, 'Book the room', false, null, null]
		]);
	});

	it('gives stable ids that ignore date, assignee and checkbox, unique per duplicate', () => {
		const tasks = parseNoteTasks('m1', body);
		expect(tasks[0].id).toBe(noteTaskId('m1', 'Send the draft'));
		const edited = parseNoteTasks('m1', body.replace('- [ ] Send the draft @Alice //2026-11-12', '- [x] Send the draft @Bob'));
		expect(edited[0].id).toBe(tasks[0].id);
		expect(tasks[1].id).not.toBe(tasks[4].id);
		expect(new Set(tasks.map((t) => t.id)).size).toBe(tasks.length);
		expect(noteTaskId('m2', 'Send the draft')).not.toBe(tasks[0].id);
	});

	it('keeps a mention in the middle as text', () => {
		expect(splitTaskContent('Ask @Bob about it')).toEqual({ text: 'Ask @Bob about it', dueDate: null, assignee: null });
	});

	it('rewrites the checkbox, date and assignee in place', () => {
		const line = '  - [ ] Send the draft @Alice //2026-11-12';
		expect(rewriteTaskLine(line, { checked: true })).toBe('  - [x] Send the draft @Alice //2026-11-12');
		expect(rewriteTaskLine('- [X] a', { checked: true })).toBe('- [X] a');
		expect(rewriteTaskLine(line, { dueDate: '2026-11-20' })).toBe('  - [ ] Send the draft @Alice //2026-11-20');
		expect(rewriteTaskLine(line, { dueDate: null, assignee: 'Bob Stone' })).toBe('  - [ ] Send the draft @Bob Stone');
		// An assignee no @Name can express isn't written.
		expect(rewriteTaskLine('- [ ] a', { assignee: 'bob' })).toBe('- [ ] a');
		expect(rewriteTaskLine('- [ ] a 📅 2026-01-02', { text: 'b' })).toBe('- [ ] b //2026-01-02');
		expect(rewriteTaskLine('plain', { checked: true })).toBe('plain');
	});

	it('updates, removes and re-inserts a task by id', () => {
		const id = noteTaskId('m1', 'Numbered task');
		expect(updateTaskInBody('m1', body, id, { checked: true })!.split('\n')[4]).toBe('1. [x] Numbered task');
		expect(updateTaskInBody('m1', body, 'nt-nope', { checked: true })).toBeNull();
		const removed = removeTaskFromBody('m1', body, id)!;
		expect(removed.line).toBe(4);
		expect(removed.body).not.toContain('Numbered task');
		expect(insertLine(removed.body, removed.line, removed.text)).toBe(body);
	});

	it('derives item fields from the line, keeping in-progress and odd assignees', () => {
		const [task] = parseNoteTasks('m', '- [ ] Do it');
		expect(fieldsFromTask(task, null)).toEqual({ text: 'Do it', dueDate: null, assignee: null, status: 'open' });
		expect(fieldsFromTask(task, { text: 'Do it', dueDate: '2026-01-01', assignee: 'Alice', status: 'in_progress' })).toEqual({
			text: 'Do it',
			dueDate: null,
			assignee: null,
			status: 'in_progress'
		});
		expect(fieldsFromTask(task, { text: 'Do it', dueDate: null, assignee: 'bob@example.com', status: 'done' }).assignee).toBe('bob@example.com');
		const [checked] = parseNoteTasks('m', '- [x] Do it');
		expect(fieldsFromTask(checked, { text: 'Do it', dueDate: null, assignee: null, status: 'cancelled' }).status).toBe('done');
	});
});
