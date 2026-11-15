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
