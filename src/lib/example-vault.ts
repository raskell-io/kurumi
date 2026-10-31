/**
 * "Explore an example": a separate vault with a small, realistic work
 * setup (a project, a recurring meeting, to-dos, decisions, questions,
 * a person, linked notes) so a newcomer sees what Kurumi does before
 * writing anything. It never touches the user's own vault and can be
 * deleted like any vault.
 */

import {
	addVault,
	setCurrentVault,
	addFolder,
	addMemoryObject,
	updateMemoryObject,
	addProject,
	setMemoryInProject,
	addMeetingSeries,
	addAgendaItem,
	startSeriesMeeting,
	addActionItem,
	addDecision,
	addQuestion,
	addPerson,
	batchUpdates,
	todayIso
} from '$lib/db';

export const EXAMPLE_VAULT_NAME = 'Example';

const day = (offset: number) => {
	const d = new Date(`${todayIso()}T12:00:00`);
	d.setDate(d.getDate() + offset);
	return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
};

/** Create the example vault, switch to it, and return the note to open first. */
export function createExampleVault(): string {
	return batchUpdates(() => {
		const vault = addVault(EXAMPLE_VAULT_NAME, '🌰');
		setCurrentVault(vault.id);

		const projects = addFolder('Projects');
		const meetings = addFolder('Meetings');

		addPerson('Ana Ruiz', { email: 'ana@example.com', company: 'Northwind', title: 'Design lead' });
		addPerson('Sam Okafor', { company: 'Northwind', title: 'Engineering' });

		const falcon = addProject('Falcon launch', {
			owner: 'Ana Ruiz',
			dueDate: day(21),
			description: 'Ship the new onboarding to every customer by the end of the quarter.'
		});

		const brief = addMemoryObject(
			'Falcon launch brief',
			[
				'## Goal',
				'',
				'New customers finish onboarding in under five minutes. Today it takes **23** on average.',
				'',
				'## Scope',
				'',
				'- Guided setup with sample data',
				'- Single sign-on for teams',
				'- Drop the 12-field signup form to 3 fields',
				'',
				'## People',
				'',
				'@Ana Ruiz owns the design, @Sam Okafor the SSO work. Launch review on //' + day(14) + '.',
				'',
				'Background: [[Customer interviews]] · weekly sync: [[Falcon weekly]]',
				'',
				'#falcon #launch'
			].join('\n'),
			projects.id
		);
		setMemoryInProject(brief.id, falcon.name, true);

		const interviews = addMemoryObject(
			'Customer interviews',
			[
				'Five calls this week. What came up most:',
				'',
				'1. "I didn\'t know what to do after signing up." (4 of 5)',
				'2. SSO is a must for anyone over 50 seats.',
				'3. Sample data helped people more than the tour video.',
				'',
				'> The empty dashboard made me think it was broken. (Ana\'s favourite quote)',
				'',
				'Feeds into the [[Falcon launch brief]]. #research #falcon'
			].join('\n'),
			projects.id
		);
		setMemoryInProject(interviews.id, falcon.name, true);

		// Recurring meeting with a running agenda, and its last meeting note
		const weekly = addMeetingSeries({ name: 'Falcon weekly', people: ['Ana Ruiz', 'Sam Okafor'], cadence: 'weekly', projectId: falcon.id });
		addAgendaItem(weekly.id, 'SSO vendor shortlist');
		const lastMeeting = startSeriesMeeting(weekly.id);
		addAgendaItem(weekly.id, 'Launch review prep');
		if (lastMeeting) {
			updateMemoryObject(lastMeeting.id, {
				folderId: meetings.id,
				bodyMarkdown: [
					'Attendees: @Ana Ruiz, @Sam Okafor',
					'',
					'## Notes',
					'',
					'- Sample data in setup is a go; it was the clearest signal from the [[Customer interviews]].',
					'- SSO: two vendors left, pricing differs by 3×.',
					'',
					'## Decisions',
					'',
					'- Signup form drops to three fields.',
					'',
					'## To-dos',
					'',
					'- [ ] Ana: final setup screens',
					'- [ ] Sam: SSO vendor comparison',
					'',
					'#falcon'
				].join('\n')
			});
			setMemoryInProject(lastMeeting.id, falcon.name, true);
		}

		// To-dos: yours (today, overdue, later) and ones you're waiting for
		const from = lastMeeting?.id ?? brief.id;
		addActionItem({ text: 'Write the launch announcement', dueDate: day(0), projectId: falcon.id, memoryObjectId: brief.id });
		addActionItem({ text: 'Send interview summary to the team', dueDate: day(-2), memoryObjectId: interviews.id });
		addActionItem({ text: 'Book the launch review room', dueDate: day(10), projectId: falcon.id });
		addActionItem({ text: 'Final setup screens', assignee: 'Ana Ruiz', dueDate: day(4), memoryObjectId: from });
		addActionItem({ text: 'SSO vendor comparison', assignee: 'Sam Okafor', dueDate: day(6), memoryObjectId: from });

		addDecision({ text: 'Signup form drops to three fields', rationale: 'Every extra field lost us ~4% of signups.', decidedOn: day(-3), decidedBy: ['Ana Ruiz'], memoryId: from, projectId: falcon.id });
		addDecision({ text: 'Ship sample data in setup', rationale: 'Clearest signal from the customer interviews.', decidedOn: day(-3), memoryId: from, projectId: falcon.id });
		addQuestion({ text: 'Which SSO vendor fits our budget?', assignee: 'Sam Okafor', projectId: falcon.id });
		addQuestion({ text: 'Do we need a tour video at all?', projectId: falcon.id });

		const start = addMemoryObject(
			'Start here',
			[
				'This vault is an example: a small work project, set up the way Kurumi is meant to be used. Click around, change anything, or delete the vault when you\'re done (vault menu, top left).',
				'',
				'## What to look at',
				'',
				'- **To-dos** in the sidebar: one due today, one overdue, and two you\'re *waiting for* from Ana and Sam.',
				'- **Projects → Falcon launch**: notes, to-dos, decisions and open questions in one place.',
				'- **Meetings → Falcon weekly**: a running agenda. *Start meeting* creates the note with the open agenda and everyone\'s open to-dos.',
				'- **@Ana Ruiz**: click the name for her page: what you\'re waiting for from her, questions, shared meetings.',
				'- **Links**: [[Falcon launch brief]] links to [[Customer interviews]]; each shows its backlinks at the bottom.',
				'- **Ask Kurumi** (home page): ask "what did we decide about signup?"',
				'',
				'## Try',
				'',
				'- Type `/` in a note for headings, to-dos, tables and more.',
				'- Type `[[` to link a note, `@` for a person, `//` for a date.',
				'- Press ⌘K / Ctrl+K to search everything.',
				'- Paste a screenshot or drop a PDF into a note.',
				'',
				'Your own notes live in your other vault; switching vaults is in the menu at the top left.'
			].join('\n'),
			null
		);
		return start.id;
	});
}
