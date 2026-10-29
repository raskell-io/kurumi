import { describe, it, expect } from 'vitest';
import { findOpenTasks, checkTaskInBody, sortOpenActionItems } from '../todos';
import type { ActionItem } from '../db/types';

describe('note tasks', () => {
	const body = '# Plan\n- [ ] Call Sam\n- [x] Done thing\n  * [ ] Nested item\n```\n- [ ] not a task\n```\n- [ ]   \n';

	it('finds unchecked items, skipping code blocks and empty ones', () => {
		expect(findOpenTasks(body)).toEqual([
			{ line: 1, text: 'Call Sam' },
			{ line: 3, text: 'Nested item' }
		]);
	});

	it('ticks only the expected task', () => {
		expect(checkTaskInBody(body, 3, 'Nested item')).toContain('  * [x] Nested item');
		expect(checkTaskInBody(body, 1, 'Something else')).toBeNull();
		expect(checkTaskInBody(body, 2, 'Done thing')).toBeNull();
	});
});

describe('sortOpenActionItems', () => {
	const item = (id: string, over: Partial<ActionItem>): ActionItem =>
		({ id, text: id, status: 'open', dueDate: null, createdAt: 0, ...over }) as ActionItem;

	it('puts overdue/today first, then in progress, upcoming, undated; drops closed', () => {
		const sorted = sortOpenActionItems(
			[
				item('undated', {}),
				item('upcoming', { dueDate: '2026-11-05' }),
				item('doing', { status: 'in_progress' }),
				item('today', { dueDate: '2026-10-28' }),
				item('overdue', { dueDate: '2026-10-20' }),
				item('done', { status: 'done', dueDate: '2026-10-01' })
			],
			'2026-10-28'
		);
		expect(sorted.map((a) => a.id)).toEqual(['overdue', 'today', 'doing', 'upcoming', 'undated']);
	});
});
