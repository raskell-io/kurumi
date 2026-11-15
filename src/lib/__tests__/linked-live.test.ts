// Live updates, saving, conflicts and new notes of a linked folder
// (src/lib/linked/backend.ts), against the in-memory app in
// helpers/fake-linked-app.ts.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import {
	applyLinkedChanges,
	buildLinkedVault,
	closeLinkedVault,
	createLinkedNote,
	discardLinkedNote,
	isLinkedDraft,
	linkedGoneNote,
	recreateLinkedNote,
	releaseLinkedFiles,
	revealLinkedFile,
	setLinkedRetryDelays,
	linkedFilePath,
	linkedFileUrl,
	linkedFolders,
	linkedLinks,
	linkedNote,
	linkedNoteId,
	linkedNoteInfo,
	linkedNotes,
	linkedRevision,
	linkedSaveIssues,
	linkedTitleEditable,
	linkedWatch,
	newLinkedNoteFile,
	openLinkedVault,
	parseLinkedId,
	raiseLinkedConflict,
	renderNoteTemplate,
	resolveLinkedIssue,
	saveLinkedNote
} from '$lib/linked/backend';
import { newLinkedVaultConfig } from '$lib/linked/config';
import { notice } from '$lib/stores/notice';
import { fakeHash, fakeLinkedApp, settle } from './helpers/fake-linked-app';

const ROOT = '/picked/knowledge';
const FOO = '---\nid: project.foo\ntype: project\nscope: "team"\ntitle: Foo launch\nsummary: Ship it.\nstatus: active\nsource: https://example.com/a#b\nupdated: 2026-01-02\npaths:\n  - src/a\n  - src/b\n---\n\n# Foo\n\nLine one.\nLine two.\nLine three.\n';
const BAR = '---\r\nid: project.bar\r\n---\r\nSee [[project.foo]].\r\n';
const files = () => ({ 'projects/foo.md': FOO, 'projects/bar.md': BAR, 'readme.md': '# Readme\n\nPlain.\n' });

const readOnly = newLinkedVaultConfig({ id: 'lv-live0001', name: 'Knowledge', path: ROOT, created: 1 });
const writable = { ...readOnly, readOnly: false };
const id = (rel: string) => linkedNoteId(readOnly.id, rel);
const rels = () => linkedNotes().map((n) => parseLinkedId(n.id)!.rel);
const fooBody = () => linkedNote(id('projects/foo.md'))!.bodyMarkdown;
const lastNotice = () => get(notice)?.text ?? '';

let app: ReturnType<typeof fakeLinkedApp>;
beforeEach(() => {
	app = fakeLinkedApp(ROOT, files());
});
afterEach(() => {
	closeLinkedVault();
	app.uninstall();
});

describe('applying changes', () => {
	it('adds, changes and removes notes, keeping path order and making folders', () => {
		const data = buildLinkedVault(readOnly, { cursor: 1, notes: [{ rel: 'b.md', content: '# B\n', hash: 'h', mtime: 1, size: 4 }], dirs: [], skipped: 0 });
		const file = (rel: string, content: string) => ({ rel, content, hash: fakeHash(content), mtime: 5, size: content.length });
		const result = applyLinkedChanges(readOnly, data, [
			{ type: 'upsert', note: file('z/deep/new.md', '---\nid: n\n---\nNew\n') },
			{ type: 'upsert', note: file('a.md', '# A\n') },
			{ type: 'upsert', note: file('b.md', '# B changed\n') },
			{ type: 'remove', rel: 'missing.md' }
		]);
		expect([...data.notes.values()].map((n) => parseLinkedId(n.id)!.rel)).toEqual(['a.md', 'b.md', 'z/deep/new.md']);
		expect(data.notes.get(linkedNoteId(readOnly.id, 'b.md'))!.title).toBe('B changed');
		expect([...data.folders.values()].map((f) => f.name)).toEqual(['z', 'deep']);
		expect(result).toEqual({ changed: [linkedNoteId(readOnly.id, 'z/deep/new.md'), linkedNoteId(readOnly.id, 'a.md'), linkedNoteId(readOnly.id, 'b.md')], removed: [] });
		// A rename is a remove and an upsert.
		expect(applyLinkedChanges(readOnly, data, [{ type: 'remove', rel: 'a.md' }, { type: 'upsert', note: file('c.md', '# A\n') }]).removed).toEqual([linkedNoteId(readOnly.id, 'a.md')]);
		expect([...data.notes.values()].map((n) => parseLinkedId(n.id)!.rel)).toEqual(['b.md', 'c.md', 'z/deep/new.md']);
		expect(data.info.has(linkedNoteId(readOnly.id, 'a.md'))).toBe(false);
	});
});

describe('live updates', () => {
	it('shows what changes in the folder, and links follow', async () => {
		await openLinkedVault(readOnly);
		await settle();
		expect(get(linkedWatch)).toBe('events');
		const before = get(linkedRevision);
		app.external('projects/foo.md', FOO.replace('Line two.', 'Line two, changed outside.'));
		app.external('inbox/new.md', '---\nid: note.new\n---\nLinks to [[project.bar]].\n');
		await settle();
		expect(fooBody()).toContain('Line two, changed outside.');
		expect(rels()).toEqual(['inbox/new.md', 'projects/bar.md', 'projects/foo.md', 'readme.md']);
		expect(linkedFolders().map((f) => f.name).sort()).toEqual(['inbox', 'projects']);
		expect(linkedLinks()!.resolve('note.new')?.id).toBe(id('inbox/new.md'));
		expect(linkedLinks()!.backlinks(id('projects/bar.md')).map((n) => n.id)).toEqual([id('inbox/new.md')]);
		expect(get(linkedRevision)).toBeGreaterThan(before);

		app.external('projects/bar.md', null);
		await settle();
		expect(rels()).toEqual(['inbox/new.md', 'projects/foo.md', 'readme.md']);
		expect(linkedLinks()!.resolve('project.bar')).toBeUndefined();
	});

	it('scans again when told to, with the new cursor, and drops the old poll', async () => {
		await openLinkedVault(readOnly);
		await settle();
		app.external('readme.md', '# Readme\n\nRewritten during a burst.\n', { silent: true });
		app.overflow();
		await settle();
		expect(linkedNote(id('readme.md'))!.bodyMarkdown).toContain('Rewritten during a burst.');
		const opens = app.calls.filter((c) => c.cmd === 'linked_open');
		const polls = app.calls.filter((c) => c.cmd === 'linked_changes');
		expect(opens).toHaveLength(2);
		// One poll per open, each with the cursor its open returned; never the spent one.
		expect(polls).toHaveLength(2);
		expect(polls[1].args.cursor).not.toBe(polls[0].args.cursor);
		// And the new poll is live.
		app.external('readme.md', '# Readme\n\nAnd again.\n');
		await settle();
		expect(linkedNote(id('readme.md'))!.bodyMarkdown).toContain('And again.');
		expect(app.calls.filter((c) => c.cmd === 'linked_open')).toHaveLength(2);
	});

	it('stops when the vault is closed, and says how it watches', async () => {
		app.state.watch = 'polling';
		await openLinkedVault(readOnly);
		await settle();
		expect(get(linkedWatch)).toBe('polling');
		const polls = () => app.calls.filter((c) => c.cmd === 'linked_changes').length;
		const before = polls();
		closeLinkedVault();
		await settle();
		expect(get(linkedWatch)).toBeNull();
		app.external('readme.md', 'changed after close\n');
		await settle();
		expect(polls()).toBe(before);
		expect(linkedNotes()).toEqual([]);
	});
});

describe('saving', () => {
	it('writes one changed line and leaves every other byte, frontmatter included', async () => {
		await openLinkedVault(writable);
		const body = fooBody();
		saveLinkedNote(id('projects/foo.md'), { bodyMarkdown: body.replace('Line two.', 'Line two, edited.') });
		await settle();
		expect(app.files.get('projects/foo.md')).toBe(FOO.replace('Line two.', 'Line two, edited.'));
		expect(app.writes()).toHaveLength(1);
		expect(app.writes()[0].args).toMatchObject({ vault: writable.id, rel: 'projects/foo.md', expectedHash: fakeHash(FOO) });
		expect(fooBody()).toContain('Line two, edited.');
		expect(linkedNoteInfo(id('projects/foo.md'))!.baseHash).toBe(fakeHash(app.files.get('projects/foo.md')!));
		expect(get(linkedSaveIssues).size).toBe(0);
		// CRLF files keep their line ends when the caller keeps them.
		saveLinkedNote(id('projects/bar.md'), { bodyMarkdown: 'See [[project.foo]] and more.\r\n' });
		await settle();
		expect(app.files.get('projects/bar.md')).toBe(BAR.replace('See [[project.foo]].', 'See [[project.foo]] and more.'));
	});

	it('never writes a file that did not change', async () => {
		await openLinkedVault(writable);
		saveLinkedNote(id('projects/foo.md'), { bodyMarkdown: fooBody(), title: 'Foo launch' });
		saveLinkedNote(id('projects/bar.md'), {});
		await settle();
		expect(app.writes()).toEqual([]);
		expect(app.files.get('projects/foo.md')).toBe(FOO);
	});

	it('refuses in a read-only vault', async () => {
		await openLinkedVault(readOnly);
		saveLinkedNote(id('projects/foo.md'), { bodyMarkdown: 'Rewritten.\n' });
		await settle();
		expect(app.writes()).toEqual([]);
		expect(lastNotice()).toMatch(/read-only/);
		expect(createLinkedNote('Nope')).toBeNull();
	});

	it('changes the title only where it is one frontmatter line', async () => {
		await openLinkedVault(writable);
		expect(linkedTitleEditable(id('projects/foo.md'))).toBe(true);
		expect(linkedTitleEditable(id('readme.md'))).toBe(false); // from the heading
		saveLinkedNote(id('projects/foo.md'), { title: 'Foo relaunch' });
		saveLinkedNote(id('readme.md'), { title: 'Renamed' });
		await settle();
		expect(app.files.get('projects/foo.md')).toBe(FOO.replace('title: Foo launch', 'title: Foo relaunch'));
		expect(linkedNote(id('projects/foo.md'))!.title).toBe('Foo relaunch');
		expect(app.files.get('readme.md')).toBe('# Readme\n\nPlain.\n');
		expect(app.writes()).toHaveLength(1);
	});

	it('stamps the updated field when the text changed, and only then', async () => {
		const stamped = { ...writable, updatedField: 'updated' };
		await openLinkedVault(stamped);
		const day = new Date();
		const today = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
		saveLinkedNote(id('projects/foo.md'), { title: 'Foo relaunch' });
		await settle();
		expect(app.files.get('projects/foo.md')).toBe(FOO.replace('title: Foo launch', 'title: Foo relaunch'));
		saveLinkedNote(id('projects/foo.md'), { bodyMarkdown: fooBody().replace('Line one.', 'Line 1.') });
		await settle();
		expect(app.files.get('projects/foo.md')).toBe(FOO.replace('title: Foo launch', 'title: Foo relaunch').replace('updated: 2026-01-02', `updated: ${today}`).replace('Line one.', 'Line 1.'));
		// A note without the field gets none.
		saveLinkedNote(id('readme.md'), { bodyMarkdown: '# Readme\n\nPlainer.\n' });
		await settle();
		expect(app.files.get('readme.md')).toBe('# Readme\n\nPlainer.\n');
	});

	it('saves one after another, the latest text winning', async () => {
		await openLinkedVault(writable);
		const body = fooBody();
		saveLinkedNote(id('projects/foo.md'), { bodyMarkdown: body.replace('Line one.', 'A') });
		saveLinkedNote(id('projects/foo.md'), { bodyMarkdown: body.replace('Line one.', 'AB') });
		saveLinkedNote(id('projects/foo.md'), { bodyMarkdown: body.replace('Line one.', 'ABC') });
		await settle();
		expect(app.files.get('projects/foo.md')).toBe(FOO.replace('Line one.', 'ABC'));
		expect(app.writes().length).toBeLessThanOrEqual(2);
	});
});

describe('changes from both sides', () => {
	const edit = (body: string) => body.replace('Line one.', 'Line one, mine.');

	it('merges an outside change to other lines, also one the watcher has not reported', async () => {
		await openLinkedVault(writable);
		await settle();
		const base = fooBody();
		app.external('projects/foo.md', FOO.replace('Line three.', 'Line three, theirs.'));
		await settle();
		saveLinkedNote(id('projects/foo.md'), { bodyMarkdown: edit(base), basedOn: base });
		await settle();
		expect(app.files.get('projects/foo.md')).toBe(FOO.replace('Line one.', 'Line one, mine.').replace('Line three.', 'Line three, theirs.'));
		expect(lastNotice()).toBe('Merged with a change made outside Kurumi.');
		expect(get(linkedSaveIssues).size).toBe(0);

		// Changed on disk, but no event yet: the write is refused (stale hash), the file read, the two merged.
		const base2 = fooBody();
		app.external('projects/foo.md', app.files.get('projects/foo.md')!.replace('status: active', 'status: done'), { silent: true });
		saveLinkedNote(id('projects/foo.md'), { bodyMarkdown: base2.replace('Line two.', 'Line two, mine.') });
		await settle();
		const now = app.files.get('projects/foo.md')!;
		expect(now).toContain('status: done');
		expect(now).toContain('Line two, mine.');
		expect(now).toContain('Line three, theirs.');
		expect(get(linkedSaveIssues).size).toBe(0);
	});

	it('asks when both changed the same line, and writes nothing until told', async () => {
		await openLinkedVault(writable);
		await settle();
		const base = fooBody();
		const theirs = FOO.replace('Line one.', 'Line one, theirs.');
		app.external('projects/foo.md', theirs);
		await settle();
		saveLinkedNote(id('projects/foo.md'), { bodyMarkdown: edit(base), basedOn: base });
		await settle();
		const issue = get(linkedSaveIssues).get(id('projects/foo.md'))!;
		expect(issue).toMatchObject({ kind: 'conflict', mine: { body: edit(base) } });
		expect(issue.theirs).toContain('Line one, theirs.');
		expect(app.files.get('projects/foo.md')).toBe(theirs);
		expect(app.writes()).toEqual([]);
		// Typing on doesn't write either; it is kept for the decision.
		saveLinkedNote(id('projects/foo.md'), { bodyMarkdown: edit(base) + 'More.\n', basedOn: base });
		await settle();
		expect(app.writes()).toEqual([]);
		expect(get(linkedSaveIssues).get(id('projects/foo.md'))!.mine.body).toBe(edit(base) + 'More.\n');

		resolveLinkedIssue(id('projects/foo.md'), 'mine');
		await settle();
		expect(app.files.get('projects/foo.md')).toBe(FOO.replace('Line one.', 'Line one, mine.') + 'More.\n');
		expect(get(linkedSaveIssues).size).toBe(0);
	});

	it('can take the file\'s version, or a combination', async () => {
		await openLinkedVault(writable);
		await settle();
		let round = 0;
		const conflict = async () => {
			const base = fooBody();
			app.external('projects/foo.md', app.files.get('projects/foo.md')!.replace(/Line one[^\n]*/, `Line one, theirs ${++round}.`));
			await settle();
			saveLinkedNote(id('projects/foo.md'), { bodyMarkdown: base.replace(/Line one[^\n]*/, 'Line one, mine.'), basedOn: base });
			await settle();
			expect(get(linkedSaveIssues).has(id('projects/foo.md'))).toBe(true);
		};
		await conflict();
		const before = app.files.get('projects/foo.md');
		resolveLinkedIssue(id('projects/foo.md'), 'theirs');
		await settle();
		expect(app.files.get('projects/foo.md')).toBe(before);
		expect(fooBody()).toContain('Line one, theirs 1.');
		expect(app.writes()).toEqual([]);

		await conflict();
		resolveLinkedIssue(id('projects/foo.md'), { body: fooBody().replace('Line one, theirs 2.', 'Line one, both.') });
		await settle();
		expect(app.files.get('projects/foo.md')).toContain('Line one, both.');
		expect(app.files.get('projects/foo.md')!.startsWith(FOO.slice(0, FOO.indexOf('\n\n# Foo')))).toBe(true);
	});

	it('holds an edit of a file that was deleted, and can save it as a new file', async () => {
		await openLinkedVault(writable);
		await settle();
		const base = fooBody();
		app.external('projects/foo.md', null);
		await settle();
		saveLinkedNote(id('projects/foo.md'), { bodyMarkdown: edit(base), basedOn: base });
		await settle();
		expect(get(linkedSaveIssues).get(id('projects/foo.md'))).toMatchObject({ kind: 'deleted' });
		expect(app.files.has('projects/foo.md')).toBe(false);
		resolveLinkedIssue(id('projects/foo.md'), 'mine');
		await settle();
		expect(app.files.get('projects/foo.md')).toBe(FOO.replace('Line one.', 'Line one, mine.'));
		expect(linkedNote(id('projects/foo.md'))!.title).toBe('Foo launch');
	});

	it('reports a write that fails and tries again on request', async () => {
		await openLinkedVault(writable);
		app.state.failWrites = 'NotAllowedError: projects/foo.md is write-protected';
		saveLinkedNote(id('projects/foo.md'), { bodyMarkdown: edit(fooBody()) });
		await settle();
		expect(get(linkedSaveIssues).get(id('projects/foo.md'))).toMatchObject({ kind: 'error' });
		expect(app.files.get('projects/foo.md')).toBe(FOO);
		app.state.failWrites = null;
		resolveLinkedIssue(id('projects/foo.md'), 'mine');
		await settle();
		expect(app.files.get('projects/foo.md')).toBe(FOO.replace('Line one.', 'Line one, mine.'));
	});

	it('holds an edit from before a restart whose file changed since', async () => {
		await openLinkedVault(writable);
		raiseLinkedConflict(id('projects/foo.md'), { body: fooBody() }); // the same text: nothing to decide
		expect(get(linkedSaveIssues).size).toBe(0);
		raiseLinkedConflict(id('projects/foo.md'), { body: 'What I had typed.\n' });
		expect(get(linkedSaveIssues).get(id('projects/foo.md'))).toMatchObject({ kind: 'conflict', mine: { body: 'What I had typed.\n' } });
		expect(app.writes()).toEqual([]);
	});
});

describe('new notes', () => {
	it('fills in the template placeholders', () => {
		expect(renderNoteTemplate('---\nid: note.{id}\ntitle: "{title}"\ncreated: {date}\n---\n', 'Über Plan: 2!', '2031-02-03')).toBe('---\nid: note.uber-plan-2\ntitle: "Über Plan: 2!"\ncreated: 2031-02-03\n---\n');
		expect(renderNoteTemplate('{other} stays', 'x')).toBe('{other} stays');
		expect(renderNoteTemplate('{id}', '!!!')).toBe('note');
	});

	it('names the file after the pattern, in the directory for new notes, and never an existing one', () => {
		const config = { ...writable, newNoteDir: 'inbox', newNoteFilename: '{date} {title}', newNoteTemplate: 'id: {id}' };
		const taken = new Set(['inbox/2031-02-03 Plan.md', 'inbox/2031-02-03 Plan 2.md']);
		const file = newLinkedNoteFile(config, (r) => taken.has(r), 'Plan', 'Body\n');
		expect(file.rel.replace(/^inbox\/\d{4}-\d{2}-\d{2}/, 'inbox/DATE')).toBe('inbox/DATE Plan.md');
		expect(newLinkedNoteFile({ ...config, newNoteFilename: '{title}' }, (r) => r === 'inbox/Plan.md' || r === 'inbox/Plan 2.md', 'Plan').rel).toBe('inbox/Plan 3.md');
		expect(file.content).toBe('id: plan\nBody\n');
		// Names a file system refuses, hidden names, and no name at all.
		expect(newLinkedNoteFile(writable, () => false, 'a/b: c? "d"').rel).toBe('a-b- c- -d-.md');
		expect(newLinkedNoteFile(writable, () => false, '.hidden').rel).toBe('hidden.md');
		expect(newLinkedNoteFile(writable, () => false, '...').rel).toBe('Untitled.md');
		expect(newLinkedNoteFile(writable, () => false, 'In a folder', '', 'projects/sub').rel).toBe('projects/sub/In a folder.md');
		// No template: the file is exactly the body.
		expect(newLinkedNoteFile(writable, () => false, 'T', 'Just this.').content).toBe('Just this.');
	});

	it('creates the file, and what is typed meanwhile is saved after', async () => {
		await openLinkedVault({ ...writable, newNoteTemplate: '---\nid: note.{id}\ntitle: {title}\n---\n' });
		const note = createLinkedNote('Fresh idea')!;
		expect(parseLinkedId(note.id)!.rel).toBe('Fresh idea.md');
		expect(note.title).toBe('Fresh idea');
		expect(linkedNote(note.id)).toBeDefined();
		saveLinkedNote(note.id, { bodyMarkdown: 'Typed at once.\n' });
		await settle();
		expect(app.files.get('Fresh idea.md')).toBe('---\nid: note.fresh-idea\ntitle: Fresh idea\n---\nTyped at once.\n');
		expect(app.writes().map((c) => c.cmd)).toEqual(['linked_create', 'linked_write']);
		expect(linkedLinks()!.resolve('note.fresh-idea')?.id).toBe(note.id);
		// A second one of the same name, in a directory of the vault.
		const again = createLinkedNote('Fresh idea', 'Body', linkedFolders().find((f) => f.name === 'projects')!.id)!;
		await settle();
		expect(parseLinkedId(again.id)!.rel).toBe('projects/Fresh idea.md');
		expect(parseLinkedId(createLinkedNote('Fresh idea')!.id)!.rel).toBe('Fresh idea 2.md');
		await settle();
		expect(createLinkedNote()!.title).toBe('Untitled');
	});

	it('takes the note back when the file cannot be created', async () => {
		await openLinkedVault(writable);
		app.external('Taken.md', 'Already here, not yet seen.\n', { silent: true });
		const note = createLinkedNote('Taken')!;
		await settle();
		expect(linkedNote(note.id)).toBeUndefined();
		expect(app.files.get('Taken.md')).toBe('Already here, not yet seen.\n');
		expect(lastNotice()).toMatch(/already exists/);
	});
});

describe('watching that fails', () => {
	const polls = () => app.calls.filter((c) => c.cmd === 'linked_changes').length;
	const opens = () => app.calls.filter((c) => c.cmd === 'linked_open').length;
	beforeEach(() => setLinkedRetryDelays([1, 1, 1]));
	afterEach(() => setLinkedRetryDelays([1000, 4000, 15000]));

	it('asks again after a failed poll and carries on', async () => {
		app.state.failPolls = 2;
		await openLinkedVault(readOnly);
		await settle(20);
		expect(get(linkedWatch)).toBe('events');
		expect(opens()).toBe(1);
		app.external('readme.md', '# Readme\n\nAfter the hiccup.\n');
		await settle();
		expect(linkedNote(id('readme.md'))!.bodyMarkdown).toContain('After the hiccup.');
	});

	it('scans again when asking again does not help, then gives up and says so', async () => {
		app.state.failPolls = 4; // the first poll and its three retries
		await openLinkedVault(readOnly);
		await settle(30);
		// One new scan, whose poll works.
		expect(opens()).toBe(2);
		expect(get(linkedWatch)).toBe('events');

		app.state.failPolls = 1000;
		app.external('readme.md', 'x\n'); // ends the poll that is waiting; the next ones fail
		await settle(60);
		expect(get(linkedWatch)).toBe('stopped');
		// Bounded: retries, one scan, retries, and no more.
		const calls = polls();
		expect(opens()).toBe(3);
		await settle(30);
		expect(polls()).toBe(calls);
		// The notes stay; Rescan is the way back.
		expect(linkedNotes().length).toBe(3);
		app.state.failPolls = 0;
		await openLinkedVault(readOnly);
		await settle();
		expect(get(linkedWatch)).toBe('events');
	});

	it('opens the vault again when the app no longer has it open', async () => {
		await openLinkedVault(readOnly);
		await settle();
		app.state.pollError = 'InvalidStateError: the linked folder is not open';
		app.state.failPolls = 1;
		app.external('readme.md', '# Readme\n\nSeen by the new scan.\n'); // answers the waiting poll; the next one fails
		await settle(20);
		expect(opens()).toBe(2);
		expect(get(linkedWatch)).toBe('events');
		expect(linkedNote(id('readme.md'))!.bodyMarkdown).toContain('Seen by the new scan.');
	});
});

describe('directories', () => {
	it('leave the tree with their last note', async () => {
		await openLinkedVault(readOnly);
		await settle();
		app.external('projects/sub/deep.md', '# Deep\n');
		await settle();
		expect(linkedFolders().map((f) => f.name).sort()).toEqual(['projects', 'sub']);
		app.external('projects/sub/deep.md', null);
		await settle();
		expect(linkedFolders().map((f) => f.name)).toEqual(['projects']);
		app.external('projects/foo.md', null);
		app.external('projects/bar.md', null);
		await settle();
		expect(linkedFolders()).toEqual([]);
		expect(rels()).toEqual(['readme.md']);
	});
});

describe('a file deleted while its note is open', () => {
	it('stays available with its text, and can be saved as a new file', async () => {
		await openLinkedVault(writable);
		await settle();
		const body = fooBody();
		app.external('projects/foo.md', null);
		await settle();
		expect(linkedNote(id('projects/foo.md'))).toBeUndefined();
		expect(linkedGoneNote(id('projects/foo.md'))).toMatchObject({ title: 'Foo launch', bodyMarkdown: body });
		// With no edit held, the note as it was.
		recreateLinkedNote(id('projects/foo.md'));
		await settle();
		expect(app.files.get('projects/foo.md')).toBe(FOO);
		expect(linkedGoneNote(id('projects/foo.md'))).toBeUndefined();
		expect(linkedNote(id('projects/foo.md'))!.title).toBe('Foo launch');

		// With an edit typed after it was gone: that text.
		app.external('projects/foo.md', null);
		await settle();
		saveLinkedNote(id('projects/foo.md'), { bodyMarkdown: body.replace('Line one.', 'Typed after.'), basedOn: body });
		await settle();
		expect(get(linkedSaveIssues).get(id('projects/foo.md'))).toMatchObject({ kind: 'deleted' });
		expect(app.writes().filter((c) => c.args.rel === 'projects/foo.md')).toHaveLength(1);
		recreateLinkedNote(id('projects/foo.md'));
		await settle();
		expect(app.files.get('projects/foo.md')).toBe(FOO.replace('Line one.', 'Typed after.'));
		expect(get(linkedSaveIssues).size).toBe(0);
	});

	it('can be let go, and is forgotten when the file comes back', async () => {
		await openLinkedVault(writable);
		await settle();
		app.external('readme.md', null);
		await settle();
		expect(linkedGoneNote(id('readme.md'))).toBeDefined();
		discardLinkedNote(id('readme.md'));
		expect(linkedGoneNote(id('readme.md'))).toBeUndefined();
		expect(app.files.has('readme.md')).toBe(false);

		app.external('projects/bar.md', null);
		await settle();
		app.external('projects/bar.md', BAR);
		await settle();
		expect(linkedGoneNote(id('projects/bar.md'))).toBeUndefined();
		expect(linkedNote(id('projects/bar.md'))).toBeDefined();
		expect(app.writes()).toEqual([]);
	});

	it('is noticed at the next save when the watcher has not reported it', async () => {
		await openLinkedVault(writable);
		await settle();
		app.external('readme.md', null, { silent: true });
		saveLinkedNote(id('readme.md'), { bodyMarkdown: '# Readme\n\nStill typing.\n' });
		await settle();
		expect(get(linkedSaveIssues).get(id('readme.md'))).toMatchObject({ kind: 'deleted', mine: { body: '# Readme\n\nStill typing.\n' } });
		expect(linkedGoneNote(id('readme.md'))).toBeDefined();
		resolveLinkedIssue(id('readme.md'), 'mine');
		await settle();
		expect(app.files.get('readme.md')).toBe('# Readme\n\nStill typing.\n');
	});
});

describe('a blank new note', () => {
	it('has no file until it is changed, and leaves none when left untouched', async () => {
		await openLinkedVault({ ...writable, newNoteTemplate: '---\nid: note.{id}\ntitle: {title}\n---\n' });
		const note = createLinkedNote()!;
		await settle();
		expect(isLinkedDraft(note.id)).toBe(true);
		expect(linkedNote(note.id)).toMatchObject({ title: 'Untitled', bodyMarkdown: '' });
		expect(app.writes()).toEqual([]);
		// Saving it unchanged makes no file either.
		saveLinkedNote(note.id, { title: 'Untitled', bodyMarkdown: '' });
		await settle();
		expect(app.writes()).toEqual([]);
		// It survives a rescan, and goes when it is left.
		await openLinkedVault({ ...writable, newNoteTemplate: '---\nid: note.{id}\ntitle: {title}\n---\n' });
		expect(linkedNote(note.id)).toBeDefined();
		discardLinkedNote(note.id);
		expect(linkedNote(note.id)).toBeUndefined();
		expect(app.files.has('Untitled.md')).toBe(false);
		expect(app.writes()).toEqual([]);
	});

	it('gets its file with the first change, title or text', async () => {
		await openLinkedVault({ ...writable, newNoteTemplate: '---\nid: note.{id}\ntitle: {title}\n---\n' });
		const first = createLinkedNote()!;
		saveLinkedNote(first.id, { bodyMarkdown: 'Now it has text.\n' });
		await settle();
		expect(app.writes().map((c) => c.cmd)).toEqual(['linked_create']);
		expect(app.files.get('Untitled.md')).toBe('---\nid: note.untitled\ntitle: Untitled\n---\nNow it has text.\n');
		expect(isLinkedDraft(first.id)).toBe(false);
		// From then on it is an ordinary note: saved by hash, not discarded.
		saveLinkedNote(first.id, { bodyMarkdown: 'Now it has more text.\n' });
		await settle();
		expect(app.writes().map((c) => c.cmd)).toEqual(['linked_create', 'linked_write']);
		discardLinkedNote(first.id);
		expect(linkedNote(first.id)).toBeDefined();

		const second = createLinkedNote()!;
		expect(parseLinkedId(second.id)!.rel).toBe('Untitled 2.md');
		saveLinkedNote(second.id, { title: 'Named later' });
		await settle();
		expect(app.files.get('Untitled 2.md')).toBe('---\nid: note.untitled\ntitle: Named later\n---\n');
	});

	it('is not discarded once another program wrote a file there', async () => {
		await openLinkedVault(writable);
		const note = createLinkedNote()!;
		app.external('Untitled.md', 'Someone else made this.\n');
		await settle();
		discardLinkedNote(note.id);
		expect(linkedNote(note.id)!.bodyMarkdown).toBe('Someone else made this.\n');
		expect(app.files.get('Untitled.md')).toBe('Someone else made this.\n');
	});
});

describe('template values in frontmatter', () => {
	const template = '---\nid: note.{id}\ntitle: {title}\nquoted: "{title}"\nsingle: \'{title}\'\naliases:\n  - {title}\ncreated: {date}\n---\n# {title}\n';
	const render = (title: string) => renderNoteTemplate(template, title, '2031-02-03').split('\n');

	it('leaves a plain title as written', () => {
		expect(render('Weekly plan')).toEqual(['---', 'id: note.weekly-plan', 'title: Weekly plan', 'quoted: "Weekly plan"', "single: 'Weekly plan'", 'aliases:', '  - Weekly plan', 'created: 2031-02-03', '---', '# Weekly plan', '']);
	});

	it('quotes and escapes what YAML would misread', () => {
		const cases: Record<string, string> = {
			'Plan: phase 2': '"Plan: phase 2"',
			'Ends with colon:': '"Ends with colon:"',
			'Cost #1 # not a comment': '"Cost #1 # not a comment"',
			'#hashtag first': '"#hashtag first"',
			// Quotes inside a plain value are plain YAML; at the start they are not.
			'She said "go"': 'She said "go"',
			'"Go" she said': '"\\"Go\\" she said"',
			"It's fine": "It's fine",
			"'quoted' start": '"\'quoted\' start"',
			' padded ': '" padded "',
			'[draft] idea': '"[draft] idea"',
			'- dash first': '"- dash first"',
			'back\\slash: here': '"back\\\\slash: here"',
			'two\nlines': '"two\\nlines"',
			true: '"true"',
			'2031': '"2031"',
			'1.5': '"1.5"',
			'2031 plans': '2031 plans',
			'*starred*': '"*starred*"'
		};
		for (const [title, expected] of Object.entries(cases)) {
			const lines = render(title);
			expect(lines[2], title).toBe(`title: ${expected}`);
			expect(lines[6], title).toBe(`  - ${expected}`);
		}
	});

	it('escapes inside the quotes a template already has', () => {
		const lines = render('She said "go": it\'s \\ on');
		expect(lines[3]).toBe('quoted: "She said \\"go\\": it\'s \\\\ on"');
		expect(lines[4]).toBe("single: 'She said \"go\": it''s \\ on'");
		// Outside the frontmatter nothing is quoted.
		expect(lines[9]).toBe('# She said "go": it\'s \\ on');
	});

	it('quotes an id that would read as a number', () => {
		expect(renderNoteTemplate('---\nid: {id}\nkey: n-{id}\n---\n', '2031')).toBe('---\nid: "2031"\nkey: n-2031\n---\n');
	});

	it('leaves a template without frontmatter alone', () => {
		expect(renderNoteTemplate('# {title}\n\ntitle: {title}\n', 'A: b')).toBe('# A: b\n\ntitle: A: b\n');
		expect(renderNoteTemplate('', 'A: b')).toBe('');
	});
});

describe('files beside the notes', () => {
	const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
	const reads = () => app.calls.filter((c) => c.cmd === 'linked_read_bytes').map((c) => c.args.rel);
	const bytesAt = async (url: string) => new Uint8Array(await (await fetch(url)).arrayBuffer());
	beforeEach(() => {
		app.uninstall();
		app = fakeLinkedApp(ROOT, files(), { 'projects/images/shot.png': PNG, 'assets/logo.svg': new TextEncoder().encode('<svg/>') });
	});

	it('resolves a link relative to the note, or from the top of the folder, never outside it', () => {
		expect(linkedFilePath('projects/foo.md', 'images/shot.png')).toBe('projects/images/shot.png');
		expect(linkedFilePath('projects/foo.md', './images/shot.png?v=2#x')).toBe('projects/images/shot.png');
		expect(linkedFilePath('projects/foo.md', '../assets/logo.svg')).toBe('assets/logo.svg');
		expect(linkedFilePath('projects/foo.md', '/assets/logo.svg')).toBe('assets/logo.svg');
		expect(linkedFilePath('projects/foo.md', 'my%20shots/a%20b.png')).toBe('projects/my shots/a b.png');
		expect(linkedFilePath('readme.md', 'a\\b.png')).toBe('a/b.png');
		for (const outside of ['../../etc/passwd', '../../../x.png', '/../x.png']) expect(linkedFilePath('projects/foo.md', outside), outside).toBeNull();
		expect(linkedFilePath('readme.md', '../x.png')).toBeNull();
		for (const notAPath of ['https://example.com/a.png', 'data:image/png;base64,AAAA', 'blob:abc', '//cdn.example.com/a.png', '#anchor', '', '/']) expect(linkedFilePath('readme.md', notAPath), notAPath).toBeNull();
	});

	it('reads the bytes once and hands out an object URL with the file\'s type', async () => {
		await openLinkedVault(readOnly);
		const url = await linkedFileUrl(id('projects/foo.md'), 'images/shot.png');
		expect(url).toMatch(/^blob:/);
		expect(await bytesAt(url!)).toEqual(PNG);
		expect((await (await fetch(url!)).blob()).type).toBe('image/png');
		// Another note showing the same file, and the reader of the same note: the same URL, no second read.
		expect(await linkedFileUrl(id('readme.md'), 'projects/images/shot.png')).toBe(url);
		expect(await linkedFileUrl(id('projects/foo.md'), './images/shot.png', 'read:foo')).toBe(url);
		expect(reads()).toEqual(['projects/images/shot.png']);
		expect((await (await fetch((await linkedFileUrl(id('projects/foo.md'), '/assets/logo.svg'))!)).blob()).type).toBe('image/svg+xml');
	});

	it('answers null for what is missing, outside the folder or not in a linked note', async () => {
		await openLinkedVault(readOnly);
		expect(await linkedFileUrl(id('projects/foo.md'), 'images/nope.png')).toBeNull();
		expect(await linkedFileUrl(id('projects/foo.md'), '../../outside.png')).toBeNull();
		expect(await linkedFileUrl(id('projects/foo.md'), 'https://example.com/a.png')).toBeNull();
		expect(await linkedFileUrl('some-document-note', 'images/shot.png')).toBeNull();
		// Only the one that is a path in the vault was asked for.
		expect(reads()).toEqual(['projects/images/nope.png']);
		closeLinkedVault();
		expect(await linkedFileUrl(id('projects/foo.md'), 'images/shot.png')).toBeNull();
	});

	it('lets go of a URL when the last note showing it closes, and of all when the vault closes', async () => {
		await openLinkedVault(readOnly);
		const url = (await linkedFileUrl(id('projects/foo.md'), 'images/shot.png'))!;
		await linkedFileUrl(id('readme.md'), 'projects/images/shot.png');
		releaseLinkedFiles(id('projects/foo.md'));
		await settle();
		expect(await bytesAt(url)).toEqual(PNG); // still shown by the other note
		releaseLinkedFiles(id('readme.md'));
		await settle();
		await expect(fetch(url)).rejects.toThrow();
		// Asked again: read again.
		const again = (await linkedFileUrl(id('projects/foo.md'), 'images/shot.png'))!;
		expect(again).not.toBe(url);
		expect(reads()).toHaveLength(2);
		closeLinkedVault();
		await settle();
		await expect(fetch(again)).rejects.toThrow();
	});

	it('reveals a note\'s file or the folder, and says so when that fails', async () => {
		await openLinkedVault(readOnly);
		await revealLinkedFile(id('projects/foo.md'));
		await revealLinkedFile();
		expect(app.calls.filter((c) => c.cmd === 'linked_reveal').map((c) => c.args)).toEqual([
			{ vault: readOnly.id, rel: 'projects/foo.md' },
			{ vault: readOnly.id, rel: '' }
		]);
		app.files.delete('projects/foo.md');
		await revealLinkedFile(id('projects/foo.md'));
		expect(lastNotice()).toMatch(/no longer in the folder/);
	});
});
