// A linked folder's notes exist in memory only. With one open and current,
// nothing of it may reach the Automerge document, what is saved to
// IndexedDB, a backup, a sync upload or the folder mirror, and nothing may be
// written to its files. If this test fails, fix the path that leaked.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const idb = vi.hoisted(() => new Map<string, unknown>());
vi.mock('idb-keyval', () => ({
	get: async (key: string) => idb.get(key),
	set: async (key: string, value: unknown) => void idb.set(key, value),
	setMany: async (entries: [string, unknown][]) => entries.forEach(([k, v]) => idb.set(k, v)),
	del: async (key: string) => void idb.delete(key),
	keys: async () => [...idb.keys()],
	delMany: async (keys: string[]) => keys.forEach((k) => idb.delete(k)),
	createStore: () => ({})
}));

import * as Automerge from '@automerge/automerge';
import { get } from 'svelte/store';
import * as db from '$lib/db';
import { mirroredVaultIds } from '$lib/sync/service';
import { agentMemoryId } from '$lib/agent-memory';
import { generateWeeklyReview, reviewNoteId } from '$lib/weekly-review';
import { linkedFolderId, linkedNoteId, linkedVaultId } from '$lib/linked/backend';
import { newLinkedVaultConfig, saveLinkedVault } from '$lib/linked/config';
import { notice } from '$lib/stores/notice';
import { NO_NEW_NOTES } from '$lib/linked/capabilities';
import { generateDailyDigest } from '$lib/digest';
import { maybeUpdateLivingNotes } from '$lib/living-notes';
import { runDueWorkflows } from '$lib/workflows';
import { importMarkdownFile, importShared } from '$lib/incoming';
import type { KurumiDocument } from '$lib/db/types';
import { fakeLinkedApp, settle } from './helpers/fake-linked-app';
import { restoreLinkedStashes, restoreStashedEdits, stashEdit } from '$lib/unsaved';
import { linkedNoteInfo, linkedSaveIssues } from '$lib/linked/backend';

const MARK = 'LINKED-ONLY-TEXT';
const ROOT = '/picked/knowledge';
const FILES: Record<string, string> = {
	'projects/foo.md': `---\nid: project.foo\ntitle: Foo ${MARK}\ntype: project\n---\n${MARK} body.\n\n- [ ] ${MARK} task\n\nSee [[project.bar]] with @Ada Lovelace on //2031-01-02. #${MARK.toLowerCase()}\n`,
	'projects/bar.md': `---\nid: project.bar\n---\n# Bar\n\n${MARK} again, back to [[project.foo|foo]].\n- [ ] ${MARK} second task\n`
};
const config = newLinkedVaultConfig({ id: 'lv-isolated', name: `Knowledge ${MARK}`, path: ROOT });
const fooId = linkedNoteId(config.id, 'projects/foo.md');
const barId = linkedNoteId(config.id, 'projects/bar.md');
const dirId = linkedFolderId(config.id, 'projects');

let app: ReturnType<typeof fakeLinkedApp>;
const calls = () => app.commandsCalled();
const storage = new Map<string, string>();

/** Everything a leak could show up as. */
const LEAKS = [MARK, 'lf.', 'lfd.', config.id, ROOT];
const expectClean = (text: string, where: string) => {
	for (const leak of LEAKS) expect(text.includes(leak), `${where} contains ${leak}`).toBe(false);
};
const bytesAsText = (bytes: Uint8Array) => new TextDecoder('utf-8', { fatal: false }).decode(bytes);
const savedDoc = () => Automerge.load<KurumiDocument>(db.getDocBinary());
/** The document and everything stored in IndexedDB, as text. */
async function everythingPersisted(): Promise<string> {
	// Saves are fire-and-forget; let them finish.
	for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 5));
	// What a restart would load: the snapshot, then the change chunks on top
	// (as loadDoc does). Read as a document too, since Automerge compresses.
	let restored = Automerge.init<KurumiDocument>();
	const stored = [...idb.entries()].map(([key, value]) => {
		const parts = Array.isArray(value) ? value : [value];
		return key + parts
			.map((part) => {
				if (!(part instanceof Uint8Array)) return JSON.stringify(part);
				restored = Automerge.loadIncremental(restored, part);
				return bytesAsText(part);
			})
			.join('');
	});
	expect(idb.size, 'something was saved').toBeGreaterThan(0);
	stored.push(JSON.stringify(restored));
	return JSON.stringify(savedDoc()) + bytesAsText(db.getDocBinary()) + stored.join('');
}

let docVaultId = '';
let docNoteId = '';

beforeAll(async () => {
	vi.stubGlobal('localStorage', {
		getItem: (k: string) => storage.get(k) ?? null,
		setItem: (k: string, v: string) => void storage.set(k, String(v)),
		removeItem: (k: string) => void storage.delete(k)
	});
	app = fakeLinkedApp(ROOT, FILES);

	// A document with two vaults and a note with a checkbox line.
	const second = db.addVault('Second');
	db.setCurrentVault(second.id);
	docVaultId = second.id;
	docNoteId = db.addMemoryObject('Document note', 'In the document.\n\n- [ ] document task\n').id;
	db.reconcileNoteTasks();

	saveLinkedVault(config);
	db.setCurrentVault(config.id);
	await vi.waitFor(() => expect(get(linkedVaultId)).toBe(config.id));
});

afterAll(() => {
	db.setCurrentVault(docVaultId);
	app.uninstall();
	vi.unstubAllGlobals();
});

describe('with a linked vault current', () => {
	it('the readers show the linked folder', () => {
		expect(get(db.currentVaultId)).toBe(config.id);
		expect(get(db.currentVault)).toMatchObject({ id: config.id, kind: 'linked' });
		expect(get(db.currentVaultCaps)).toMatchObject({ kind: 'linked', editNotes: false, createNotes: false, records: false });
		expect(get(db.vaults).map((v) => v.id)).toContain(config.id);
		expect(get(db.memoryObjects).map((m) => m.id).sort()).toEqual([barId, fooId].sort());
		expect(get(db.folders).map((f) => f.id)).toEqual([dirId]);
		expect(db.getMemoryObject(fooId)?.title).toBe(`Foo ${MARK}`);
		expect(db.getFolder(dirId)?.name).toBe('projects');
		expect(db.getFolderPath(dirId).map((f) => f.name)).toEqual(['projects']);
		expect(db.getSubfolders(null).map((f) => f.id)).toEqual([dirId]);
		expect(db.getMemoryObjectsInFolder(dirId)).toHaveLength(2);
		expect(db.getMemoryObjectsInFolder(null)).toEqual([]);
		// Links by key, in both directions.
		expect(db.findMemoryObjectByTitle('project.bar')?.id).toBe(barId);
		expect(db.findBacklinks(fooId).map((m) => m.id)).toEqual([barId]);
		expect(db.findBacklinks(barId).map((m) => m.id)).toEqual([fooId]);
		expect(db.vaultLinkResolver(get(db.memoryObjects)).resolve('PROJECT.FOO')?.id).toBe(fooId);
		// Tags from the text and from frontmatter fields.
		expect(db.getAllTags().map((t) => t.tag).sort()).toEqual([MARK.toLowerCase(), 'type/project']);
		expect(db.getMemoryObjectsByTag('type/project').map((m) => m.id)).toEqual([fooId]);
		expect(db.getAllDates().map((d) => d.date)).toEqual(['2031-01-02']);
		// The document's own note isn't in this vault.
		expect(get(db.memoryObjects).some((m) => m.id === docNoteId)).toBe(false);
	});

	it('the document keeps its own current vault', () => {
		expect(get(db.docCurrentVaultId)).toBe(docVaultId);
		expect(savedDoc().currentVaultId).toBe(docVaultId);
		expect(get(db.docVaults).map((v) => v.id)).not.toContain(config.id);
		expect(get(db.docMemoryObjects).map((m) => m.id)).toEqual([docNoteId]);
		expect(get(db.docFolders)).toEqual([]);
		expect(db.getVault(config.id)).toMatchObject({ kind: 'linked' });
		expect(Object.keys(savedDoc().vaults)).not.toContain(config.id);
	});

	it('the saved document and a backup contain nothing of it', async () => {
		expectClean(bytesAsText(db.getDocBinary()), 'getDocBinary()');
		expectClean(JSON.stringify(savedDoc()), 'the loaded document');
		expectClean(db.exportFullJSON(), 'exportFullJSON()');
		expectClean(db.exportMemoryObjectsJSON(), 'exportMemoryObjectsJSON()');
		const persisted = await everythingPersisted();
		expectClean(persisted, 'IndexedDB');
		// The check does read note text: the document's own note is in there.
		expect(persisted).toContain('document task');
		expect(db.exportFullJSON()).toContain('document task');
		expect(JSON.parse(db.exportFullJSON()).memoryObjects.map((m: { id: string }) => m.id)).toEqual([docNoteId]);
	});

	it('sync and the folder mirror only see document vaults', () => {
		expect(db.getVaultContents(config.id)).toEqual({ memories: [], folders: [], people: [], events: [], actionItems: [] });
		expect(db.getVaultContents(docVaultId).memories.map((m) => m.id)).toEqual([docNoteId]);
		for (const vault of get(db.docVaults)) expectClean(JSON.stringify(db.getVaultContents(vault.id)), `getVaultContents(${vault.name})`);
		expect(mirroredVaultIds(false)).toEqual([docVaultId]);
		expect(mirroredVaultIds(true)).toEqual(get(db.docVaults).map((v) => v.id));
		expect(mirroredVaultIds(true)).not.toContain(config.id);
		expectClean(JSON.stringify(db.getVaultWorkRecords(docVaultId)), 'getVaultWorkRecords()');
		// Notes the app generates are named after the document's vault.
		expectClean(agentMemoryId(), 'agentMemoryId()');
		expectClean(reviewNoteId({ start: '2031-01-06', end: '2031-01-12' }), 'reviewNoteId()');
	});

	it('checkbox lines in linked notes do not become to-dos', async () => {
		const before = Object.values(savedDoc().actionItems).map((a) => a.id).sort();
		expect(Object.values(savedDoc().actionItems).map((a) => a.text)).toEqual(['document task']);
		db.reconcileNoteTasks();
		const after = Object.values(savedDoc().actionItems);
		expect(after.map((a) => a.id).sort()).toEqual(before);
		expect(after.every((a) => a.memoryObjectId === docNoteId && a.vaultId === docVaultId)).toBe(true);
		// In this vault the to-do list is empty; the document's is still there.
		expect(get(db.actionItems)).toEqual([]);
		expect(get(db.docActionItems)).toHaveLength(1);
		expectClean(await everythingPersisted(), 'after reconcileNoteTasks()');
	});

	it('changing a linked note changes nothing, anywhere', async () => {
		const heads = Automerge.getHeads(savedDoc());
		const seen: string[] = [];
		const stop = notice.subscribe((n) => n && seen.push(n.text));
		db.updateMemoryObject(fooId, { title: 'Renamed', bodyMarkdown: 'Rewritten.' });
		db.deleteMemoryObject(fooId);
		db.moveMemoryObjectToFolder(fooId, null);
		db.moveMemoryObjectToFolder(docNoteId, dirId);
		db.setMemoryIcon(fooId, '🔗');
		db.setMemoryFavorite(fooId, true);
		db.setMemoryCustomProp(fooId, 'status', 'done');
		db.moveMemoryObjectToVault(fooId, docVaultId);
		db.moveMemoryObjectToVault(docNoteId, config.id);
		db.moveFolderToVault(dirId, docVaultId);
		db.updateFolder(dirId, { name: 'renamed' });
		db.deleteFolder(dirId, true);
		db.moveFolderToFolder(dirId, null);
		db.addFolder('inside', dirId);
		db.addFolder('at the root');
		expect(db.linkUnlinkedMention(fooId, 'Bar')).toBe(false);
		db.restoreMemoryObject(fooId);
		db.permanentlyDeleteMemoryObject(fooId);
		db.setLivingNote(fooId, null);
		stop();

		expect(seen.length).toBeGreaterThan(10);
		expect(db.getMemoryObject(fooId)).toMatchObject({ title: `Foo ${MARK}`, folderId: dirId });
		expect(db.getFolder(dirId)?.name).toBe('projects');
		expect(Automerge.getHeads(savedDoc())).toEqual(heads);
		expect(db.getMemoryObject(docNoteId)).toMatchObject({ vaultId: docVaultId, folderId: null });
		expect(Object.keys(savedDoc().folders)).toEqual([]);
		expectClean(await everythingPersisted(), 'after mutators');
		// Only scanning ever reached the folder.
		expect(new Set(calls())).toEqual(new Set(['linked_open']));
		expect(Object.fromEntries(app.files)).toEqual(FILES);
	});

	it('nothing is generated from its notes, and capture is refused', async () => {
		const heads = Automerge.getHeads(savedDoc());
		const seen: string[] = [];
		const stop = notice.subscribe((n) => n && seen.push(n.text));
		expect(db.canCreateNotes()).toBe(false);
		stop();
		expect(seen.at(-1)).toBe(NO_NEW_NOTES);

		expect(await generateDailyDigest('2031-01-02')).toBeNull();
		expect(await generateWeeklyReview({ start: '2031-01-06', end: '2031-01-12' })).toBeNull();
		expect(await maybeUpdateLivingNotes()).toBe(0);
		expect(await runDueWorkflows()).toBe(0);
		expect(await importShared({ title: 'Shared', text: 'text' })).toEqual([]);
		await expect(importMarkdownFile(new File(['# Opened'], 'opened.md'))).rejects.toThrow(NO_NEW_NOTES);

		expect(Automerge.getHeads(savedDoc())).toEqual(heads);
		expect(get(db.docMemoryObjects).map((m) => m.id)).toEqual([docNoteId]);
	});

	it('a note created anyway lands in the document vault, without linked ids', async () => {
		const created = db.addMemoryObject('Stray', 'Made while a linked folder was open.', dirId);
		expect(created.vaultId).toBe(docVaultId);
		expect(savedDoc().memoryObjects[created.id]).toMatchObject({ vaultId: docVaultId, folderId: null });
		expect(get(db.memoryObjects).some((m) => m.id === created.id)).toBe(false);
		expectClean(await everythingPersisted(), 'after addMemoryObject()');
		db.permanentlyDeleteMemoryObject(created.id);
	});

	it('with editing turned on, saves and new notes go to the files and nowhere else', async () => {
		saveLinkedVault({ ...config, readOnly: false, updatedField: 'updated' });
		db.setCurrentVault(config.id); // opens it again with the new setting
		await vi.waitFor(() => expect(get(db.currentVaultCaps).editNotes).toBe(true));
		await settle();
		const heads = Automerge.getHeads(savedDoc());

		// An edit through the store: one line of the file, frontmatter as it was.
		const body = db.getMemoryObject(fooId)!.bodyMarkdown;
		db.updateMemoryObject(fooId, { bodyMarkdown: body.replace(`${MARK} body.`, `${MARK} body, edited.`), tags: ['ignored'], folderId: null });
		await settle();
		expect(app.files.get('projects/foo.md')).toBe(FILES['projects/foo.md'].replace(`${MARK} body.`, `${MARK} body, edited.`));
		expect(db.getMemoryObject(fooId)).toMatchObject({ folderId: dirId, title: `Foo ${MARK}` });
		expect(db.linkUnlinkedMention(barId, 'again')).toBe(true);
		await settle();
		expect(app.files.get('projects/bar.md')).toContain('[[again]]');

		// A new note is a new file, not a record.
		expect(db.canCreateNotes()).toBe(true);
		expect(db.canCreateNotes('capture')).toBe(false);
		const created = db.addMemoryObject(`New ${MARK}`, `${MARK} text.\n`, dirId);
		await settle();
		expect(created.id.startsWith('lf.')).toBe(true);
		expect(app.files.get(`projects/New ${MARK}.md`)).toBe(`${MARK} text.\n`);
		expect(get(db.memoryObjects).map((m) => m.id)).toContain(created.id);

		// An edit from before a restart: written if the file is as it was, held if not.
		stashEdit(fooId, `Foo ${MARK}`, `${MARK} stashed.\n`, linkedNoteInfo(fooId)!.baseHash);
		stashEdit(barId, 'Bar', `${MARK} stashed too.\n`, 'hash-of-an-older-file');
		stashEdit(docNoteId, 'Document note', 'In the document, stashed.\n');
		expect(restoreStashedEdits()).toBe(1);
		expect(db.getMemoryObject(docNoteId)!.bodyMarkdown).toBe('In the document, stashed.\n');
		const headsAfterDocEdit = Automerge.getHeads(savedDoc());
		expect(restoreLinkedStashes()).toBe(2);
		await settle();
		expect(app.files.get('projects/foo.md')!.endsWith(`---\n${MARK} stashed.\n`)).toBe(true);
		expect(app.files.get('projects/bar.md')).not.toContain('stashed too');
		expect(get(linkedSaveIssues).get(barId)).toMatchObject({ kind: 'conflict', mine: { body: `${MARK} stashed too.\n` } });
		expect(storage.get('kurumi-unsaved-edits')).toBeUndefined();

		// None of it reached the document or what is stored. (The one change
		// to the document above is the stash of its own note.)
		expect(headsAfterDocEdit).not.toEqual(heads);
		expect(Automerge.getHeads(savedDoc())).toEqual(headsAfterDocEdit);
		expect(get(db.docMemoryObjects).map((m) => m.id)).toEqual([docNoteId]);
		expect(savedDoc().currentVaultId).toBe(docVaultId);
		expectClean(await everythingPersisted(), 'after saving and creating in the linked folder');
		expectClean(db.exportFullJSON(), 'exportFullJSON() after saving');
		expect(new Set(calls())).toEqual(new Set(['linked_open', 'linked_write', 'linked_create']));
	});

	it('switching back closes it and tells the document nothing new', async () => {
		db.setCurrentVault(docVaultId);
		expect(get(linkedVaultId)).toBeNull();
		expect(get(db.currentVaultId)).toBe(docVaultId);
		expect(get(db.memoryObjects).map((m) => m.id)).toEqual([docNoteId]);
		expect(db.getMemoryObject(fooId)).toBeUndefined();
		expect(db.findMemoryObjectByTitle('project.bar')).toBeUndefined();
		expect(db.findMemoryObjectByTitle('document note')?.id).toBe(docNoteId);
		expect(storage.get('kurumi-active-linked-vault')).toBeUndefined();
		expect(calls().at(-1)).toBe('linked_close');
		expectClean(await everythingPersisted(), 'after switching back');

		// And a missing folder leaves the document's vault current.
		saveLinkedVault({ ...config, id: 'lv-gone0001', path: '/not/there' });
		db.setCurrentVault('lv-gone0001');
		await new Promise((r) => setTimeout(r, 20));
		expect(get(db.currentVaultId)).toBe(docVaultId);
		expect(savedDoc().currentVaultId).toBe(docVaultId);
	});
});
