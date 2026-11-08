/**
 * Scheduled agent workflows: instructions in plain words ("every Monday:
 * look at last week's meetings, list new to-dos by project, write me a
 * summary") that the agent carries out in the background.
 *
 * - Safe by construction: the agent gets read-only tools (search, to-dos,
 *   people, topics, the graph) plus `propose_todo`, which only queues a
 *   proposal for the user to approve. Its final answer is saved as a note.
 * - Runs while the app is open (checked every minute). A run missed while it
 *   was closed happens once at the next start, not once per missed slot.
 * - The result note's id comes from the workflow and date, so two devices
 *   running the same workflow on the same day write one note. Settings: a
 *   device can opt out of running workflows (`workflowsRunHere`).
 * - Each workflow keeps its last ten runs (status, tools used, note, error).
 *
 * Schedule maths is pure (`nextRunAfter`, `isDue`) and unit-tested.
 */

import { get } from 'svelte/store';
import { putGeneratedNote, recordWorkflowRun, todayIso, workflows, type Workflow, type WorkflowSchedule } from '$lib/db';

const DAY = 86_400_000;
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function atTime(date: Date, time: string): Date {
	const [h, m] = time.split(':').map(Number);
	const at = new Date(date);
	at.setHours(Number.isFinite(h) ? h : 9, Number.isFinite(m) ? m : 0, 0, 0);
	return at;
}

const daysInMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();

/** The first scheduled time strictly after `after` (ms), or null for manual workflows. */
export function nextRunAfter(schedule: WorkflowSchedule, after: number): number | null {
	if (schedule.kind === 'manual') return null;
	const start = new Date(after);
	start.setHours(0, 0, 0, 0);
	for (let i = 0; i < 400; i++) {
		const day = new Date(start.getTime() + i * DAY + 2 * 3600_000); // +2h: safe across DST
		day.setHours(0, 0, 0, 0);
		const matches =
			schedule.kind === 'daily' ||
			(schedule.kind === 'weekly' && day.getDay() === (schedule.weekday ?? 1)) ||
			(schedule.kind === 'monthly' && day.getDate() === Math.min(schedule.day ?? 1, daysInMonth(day)));
		if (!matches) continue;
		const slot = atTime(day, schedule.time).getTime();
		if (slot > after) return slot;
	}
	return null;
}

/** Whether a workflow should run now: on, scheduled, and a slot has passed since it last ran (or was made). */
export function isDue(w: Pick<Workflow, 'enabled' | 'schedule' | 'lastRunAt' | 'createdAt'>, now: number): boolean {
	if (!w.enabled) return false;
	const next = nextRunAfter(w.schedule, w.lastRunAt ?? w.createdAt);
	return next !== null && next <= now;
}

/** "Every Monday at 09:00" */
export function scheduleLabel(schedule: WorkflowSchedule): string {
	switch (schedule.kind) {
		case 'manual':
			return 'When you run it';
		case 'daily':
			return `Every day at ${schedule.time}`;
		case 'weekly':
			return `Every ${WEEKDAYS[schedule.weekday ?? 1]} at ${schedule.time}`;
		case 'monthly':
			return `Monthly on the ${ordinal(schedule.day ?? 1)} at ${schedule.time}`;
	}
}

const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`;

export const workflowNoteId = (w: Pick<Workflow, 'id'>, date: string) => `wf-${w.id}-${date}`;

const RUN_HERE_KEY = 'kurumi-run-workflows';

/** Whether this device runs scheduled workflows (on unless turned off here). */
export function workflowsRunHere(): boolean {
	try {
		return localStorage.getItem(RUN_HERE_KEY) !== 'off';
	} catch {
		return false;
	}
}

export function setWorkflowsRunHere(on: boolean): void {
	try {
		localStorage.setItem(RUN_HERE_KEY, on ? 'on' : 'off');
	} catch {
		// Not remembered: stays as it was.
	}
}

export const hasAgentKey = () => {
	try {
		return !!localStorage.getItem('kurumi-openai-key');
	} catch {
		return false;
	}
};

const running = new Set<string>();

export function isRunning(id: string): boolean {
	return running.has(id);
}

/** Run a workflow now. Resolves when it has finished and its run is recorded. */
export async function runWorkflow(w: Workflow): Promise<{ ok: boolean; noteId: string | null; error?: string }> {
	if (running.has(w.id)) return { ok: false, noteId: null, error: 'Already running' };
	running.add(w.id);
	const at = Date.now();
	try {
		if (!hasAgentKey()) throw new Error('Needs an OpenAI API key (Settings → AI assistant)');
		const { createAgentSession, sendAgentMessage, WORKFLOW_TOOLS } = await import('$lib/agent');
		const today = todayIso();
		const session = await sendAgentMessage(createAgentSession(), w.instructions, {
			tools: WORKFLOW_TOOLS,
			systemExtra: [
				`You are running the user's scheduled workflow "${w.name}" (${scheduleLabel(w.schedule)}), today ${today}, in the background: nobody is watching.`,
				'Carry out the instructions with your tools. You cannot change their notes or to-dos; suggest new to-dos with propose_todo (they approve them later).',
				'When done, reply with the result written as a markdown note for the user (no preamble, no questions back), citing notes as [[Title]].'
			].join(' ')
		});
		if (session.error) throw new Error(session.error);
		const answer = [...session.messages].reverse().find((m) => m.role === 'assistant' && m.content)?.content?.trim() ?? '';
		const tools = [...new Set(session.messages.flatMap((m) => m.toolCalls?.map((t) => t.name) ?? []))];
		let noteId: string | null = null;
		if (w.output === 'note' && answer) {
			noteId = putGeneratedNote(workflowNoteId(w, today), `${w.name} — ${today}`, `${answer}\n`).id;
		}
		const plain = answer.replace(/^#+\s*/gm, '').replace(/[*_>`]|\[\[|\]\]/g, '').replace(/\s+/g, ' ').trim();
		recordWorkflowRun(w.id, { at, status: 'ok', noteId, summary: plain.slice(0, 160), tools });
		if (w.notify) void notify(w.name, plain.slice(0, 140) || 'Done', noteId);
		return { ok: true, noteId };
	} catch (err) {
		const error = err instanceof Error ? err.message : 'Failed';
		recordWorkflowRun(w.id, { at, status: 'error', noteId: null, summary: error, tools: [] });
		if (w.notify) void notify(`${w.name} failed`, error, null);
		return { ok: false, noteId: null, error };
	} finally {
		running.delete(w.id);
	}
}

async function notify(title: string, body: string, noteId: string | null): Promise<void> {
	if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
	try {
		const registration = await navigator.serviceWorker?.getRegistration();
		if (registration?.active) await registration.showNotification(title, { body, tag: `kurumi-workflow-${title}`, icon: '/icon-192.png' });
		else {
			const n = new Notification(title, { body, icon: '/icon-192.png' });
			n.onclick = () => {
				window.focus();
				if (noteId) location.hash = `#/memory/${noteId}`;
			};
		}
	} catch {
		// Notifications are a nicety.
	}
}

/** Run every due workflow, one after another (the layout calls this every minute). */
export async function runDueWorkflows(now = Date.now()): Promise<number> {
	if (!workflowsRunHere() || !hasAgentKey()) return 0;
	let ran = 0;
	for (const w of get(workflows)) {
		if (!isDue(w, now) || running.has(w.id)) continue;
		await runWorkflow(w);
		ran++;
	}
	return ran;
}

/** Starting points for the "New workflow" form. */
export const WORKFLOW_EXAMPLES = [
	{
		name: 'Monday planning',
		instructions:
			"Look at last week's meetings and notes. List the to-dos that came out of them that aren't in my to-do list yet and propose them, grouped by project. Then write a short summary of where each project stands and what I should focus on this week.",
		schedule: { kind: 'weekly', time: '08:30', weekday: 1 } as WorkflowSchedule
	},
	{
		name: 'Waiting-for check',
		instructions: 'List the to-dos I am waiting on other people for, oldest first, and for each say what I could do to move it along. Keep it short.',
		schedule: { kind: 'weekly', time: '15:00', weekday: 4 } as WorkflowSchedule
	},
	{
		name: 'Open questions digest',
		instructions: 'Find open questions in my notes from the last month that nobody has answered yet, and for each one suggest who could answer it, based on who is mentioned in related notes.',
		schedule: { kind: 'monthly', time: '09:00', day: 1 } as WorkflowSchedule
	}
];
