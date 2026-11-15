// The read model of a linked folder (src/lib/linked/backend.ts), against an
// in-memory version of the desktop app's commands with the error contract
// of desktop/src-tauri/src/linked.rs (whose own tests cover real folders).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { get } from 'svelte/store';
import {
	buildLinkedResolver,
	buildLinkedVault,
	closeLinkedVault,
	isLinkedFolderId,
	isLinkedNoteId,
	linkedFolderId,
	linkedFolders,
	linkedLinks,
	linkedNote,
	linkedNoteId,
	linkedNoteInfo,
	linkedNotes,
	linkedProblem,
	linkedRevision,
	linkedStats,
	linkedVaultId,
	openLinkedVault,
	parseLinkedId,
	rescanLinkedVault
} from '$lib/linked/backend';
import { newLinkedVaultConfig, validateLinkedVaultConfig } from '$lib/linked/config';
import { capabilitiesFor } from '$lib/linked/capabilities';
import { linkRefusal, pickLinkedFolder, SYNC_FOLDER_REFUSAL } from '$lib/linked/pick';
import type { NoteFile, OpenedFolder } from '$lib/linked/types';

const ROOT = '/picked/knowledge';
const file = (rel: string, content: string, mtime = 1_700_000_000_000): NoteFile => ({ rel, content, hash: `hash-of-${rel}`, mtime, size: content.length });

const FILES: NoteFile[] = [
	file('projects/foo.md', '---\nid: project.foo\ntitle: Foo launch\ntype: project\nstatus: Active\nsummary: Ship it.\ntags: [Launch, q3]\n---\n\n# Ignored heading\n\nNeeds [[project.bar|Bar]] and [[Loose ends#Open]]. #inline\n', 1_700_000_300_000),
	file('projects/bar.md', '---\r\nid: project.bar\r\ntype: project\r\n---\r\n# Bar from the heading\r\n\r\nAfter [[PROJECT.FOO#^b1]].\r\n', 1_700_000_200_000),
	file('loose-ends.md', '﻿# Loose ends\n\nSee [[project.foo]] and [[bar]] and [[Nowhere]].\n', 1_700_000_100_000),
	file('notes/deep/plain.md', 'No heading here, just [[Foo launch]].\n'),
	file('projects/copy.md', '---\nid: project.foo\n---\nA second note with the same id.\n')
];

function fakeApp(files: NoteFile[] = FILES) {
	const calls: { cmd: string; args: any }[] = [];
	const open = new Set<string>();
	const state = { root: ROOT as string | null, files, skipped: 1 };
	const commands: Record<string, (args: any) => unknown> = {
		linked_open: ({ vault, root, ignore, respectGitignore, readOnly }) => {
			if (typeof respectGitignore !== 'boolean' || typeof readOnly !== 'boolean' || !Array.isArray(ignore)) throw 'TypeError: missing argument';
			if (root !== state.root) throw `NotFoundError: ${root} doesn't exist`;
			open.add(vault);
			const dirs = new Set<string>(['empty']);
			for (const f of state.files) if (f.rel.includes('/')) dirs.add(f.rel.slice(0, f.rel.lastIndexOf('/')));
			return { cursor: 1, notes: state.files, dirs: [...dirs], skipped: state.skipped } satisfies OpenedFolder;
		},
		linked_read: ({ vault, rel }) => {
			if (!open.has(vault)) throw `InvalidStateError: the linked folder ${vault} isn't open`;
			const found = state.files.find((f) => f.rel === rel);
			if (!found) throw `NotFoundError: ${rel} doesn't exist`;
			return found;
		},
		linked_close: ({ vault }) => {
			open.delete(vault);
			return null;
		}
	};
	(globalThis as any).__TAURI_INTERNALS__ = {
		invoke: async (cmd: string, args: any) => {
			calls.push({ cmd, args });
			const run = commands[cmd];
			if (!run) throw `NotSupportedError: unknown command ${cmd}`;
			return run(args);
		}
	};
	return { calls, open, state };
}

const config = newLinkedVaultConfig({ id: 'lv-test0001', name: 'Knowledge', path: ROOT, created: 1_600_000_000_000 });
const id = (rel: string) => linkedNoteId(config.id, rel);
const rels = (notes: { id: string }[]) => notes.map((n) => parseLinkedId(n.id)!.rel);

afterEach(() => {
	closeLinkedVault();
	delete (globalThis as any).__TAURI_INTERNALS__;
});

describe('linked ids', () => {
	it('are reversible, route-safe and never look like document ids', () => {
		const rel = 'Projekte/Ünïcode & spaces/日本語.md';
		const noteId = linkedNoteId('lv-abc', rel);
		expect(noteId).toMatch(/^lf\.lv-abc\.[A-Za-z0-9_-]+$/);
		expect(parseLinkedId(noteId)).toEqual({ vaultId: 'lv-abc', rel });
		expect(parseLinkedId(linkedFolderId('lv-abc', 'a/b'))).toEqual({ vaultId: 'lv-abc', rel: 'a/b' });
		expect(isLinkedNoteId(noteId)).toBe(true);
		expect(isLinkedFolderId(noteId)).toBe(false);
		expect(isLinkedFolderId(linkedFolderId('lv-abc', 'a'))).toBe(true);
		expect(isLinkedNoteId('default-vault')).toBe(false);
		expect(parseLinkedId('Ab3dEf9hIj2k')).toBeNull();
	});
});

describe('building a linked vault', () => {
	const data = buildLinkedVault(config, { cursor: 1, notes: FILES, dirs: ['empty', 'projects'], skipped: 2 });

	it('makes one note per file, in path order, with ids from the path', () => {
		expect(rels([...data.notes.values()])).toEqual(['loose-ends.md', 'notes/deep/plain.md', 'projects/bar.md', 'projects/copy.md', 'projects/foo.md']);
		expect(data.skipped).toBe(2);
		for (const note of data.notes.values()) {
			expect(note.vaultId).toBe(config.id);
			expect(note.type).toBe('note');
			expect(note.deletedAt ?? null).toBeNull();
		}
	});

	it('takes the title from the field, else the first heading, else the filename', () => {
		expect(data.notes.get(id('projects/foo.md'))!.title).toBe('Foo launch');
		expect(data.notes.get(id('projects/bar.md'))!.title).toBe('Bar from the heading');
		expect(data.notes.get(id('loose-ends.md'))!.title).toBe('Loose ends');
		expect(data.notes.get(id('notes/deep/plain.md'))!.title).toBe('plain');
	});

	it('keeps the body as written and the frontmatter out of it', () => {
		const foo = data.notes.get(id('projects/foo.md'))!;
		expect(foo.bodyMarkdown).toBe('\n# Ignored heading\n\nNeeds [[project.bar|Bar]] and [[Loose ends#Open]]. #inline\n');
		expect(foo.summaryShort).toBe('Ship it.');
		expect(foo.updatedAt).toBe(1_700_000_300_000);
		expect(foo.createdAt).toBe(1_700_000_300_000);
		const info = data.info.get(foo.id)!;
		expect(info.rawFrontmatter + foo.bodyMarkdown).toBe(FILES[0].content);
		expect(info).toMatchObject({ relPath: 'projects/foo.md', baseHash: 'hash-of-projects/foo.md', linkKeyValue: 'project.foo' });
		expect(info.frontmatter.id).toBe('project.foo');
		// CRLF and a BOM stay where they were.
		const bar = data.notes.get(id('projects/bar.md'))!;
		expect(data.info.get(bar.id)!.rawFrontmatter + bar.bodyMarkdown).toBe(FILES[1].content);
		const loose = data.notes.get(id('loose-ends.md'))!;
		expect(data.info.get(loose.id)!.rawFrontmatter).toBe('﻿');
		expect(loose.bodyMarkdown.startsWith('# Loose ends')).toBe(true);
		expect(data.info.get(loose.id)!.linkKeyValue).toBeNull();
	});

	it('turns the tag fields and a tags list into tags', () => {
		expect(data.notes.get(id('projects/foo.md'))!.tags).toEqual(['type/project', 'status/active', 'launch', 'q3']);
		expect(data.notes.get(id('projects/bar.md'))!.tags).toEqual(['type/project']);
		expect(data.notes.get(id('loose-ends.md'))!.tags).toEqual([]);
	});

	it('makes a folder per directory, named as written, also empty and intermediate ones', () => {
		const folders = [...data.folders.values()];
		expect(folders.map((f) => [parseLinkedId(f.id)!.rel, f.name, f.parentId && parseLinkedId(f.parentId)!.rel]).sort()).toEqual([
			['empty', 'empty', null],
			['notes', 'notes', null],
			['notes/deep', 'deep', 'notes'],
			['projects', 'projects', null]
		]);
		expect(data.notes.get(id('notes/deep/plain.md'))!.folderId).toBe(linkedFolderId(config.id, 'notes/deep'));
		expect(data.notes.get(id('loose-ends.md'))!.folderId).toBeNull();
		expect(folders.every((f) => f.vaultId === config.id && isLinkedFolderId(f.id))).toBe(true);
	});

	it('resolves links by key, then title, then filename, across files', () => {
		const links = buildLinkedResolver(config, data);
		expect(links.resolve('project.bar')?.id).toBe(id('projects/bar.md'));
		expect(links.resolve('Project.Foo')?.id).toBe(id('projects/copy.md')); // first by path of the two
		expect(links.resolve('Foo launch')?.id).toBe(id('projects/foo.md'));
		expect(links.resolve('loose ends')?.id).toBe(id('loose-ends.md'));
		expect(links.resolve('bar')?.id).toBe(id('projects/bar.md')); // filename
		expect(links.resolve('Nowhere')).toBeUndefined();
		expect(links.duplicates()).toEqual([{ key: 'project.foo', ids: [id('projects/copy.md'), id('projects/foo.md')] }]);
		expect(links.keyOf(data.notes.get(id('projects/bar.md'))!)).toBe('project.bar');
		expect(links.keyOf(data.notes.get(id('loose-ends.md'))!)).toBe('Loose ends');
	});

	it('finds backlinks through keys, aliases, headings and block refs', () => {
		const links = buildLinkedResolver(config, data);
		expect(rels(links.backlinks(id('projects/bar.md')))).toEqual(['loose-ends.md', 'projects/foo.md']);
		expect(rels(links.backlinks(id('loose-ends.md')))).toEqual(['projects/foo.md']);
		expect(rels(links.backlinks(id('projects/foo.md')))).toEqual(['notes/deep/plain.md']);
		// The duplicate id goes to the first by path.
		expect(rels(links.backlinks(id('projects/copy.md')))).toEqual(['loose-ends.md', 'projects/bar.md']);
		expect(rels(links.outgoing(id('projects/foo.md')))).toEqual(['projects/bar.md', 'loose-ends.md']);
	});

	it('follows the configured conventions', () => {
		const byName = buildLinkedVault({ ...config, linkKey: 'filename', linkFallback: [], titleField: null, tagFields: [], summaryField: null }, { cursor: 1, notes: FILES, dirs: [], skipped: 0 });
		const foo = byName.notes.get(id('projects/foo.md'))!;
		expect(foo.title).toBe('Ignored heading');
		expect(foo.tags).toEqual(['launch', 'q3']);
		expect(foo.summaryShort).toBeNull();
		const links = buildLinkedResolver({ ...config, linkKey: 'filename', linkFallback: [] }, byName);
		expect(links.resolve('foo')?.id).toBe(foo.id);
		expect(links.resolve('project.foo')).toBeUndefined();
	});
});

describe('opening a linked vault', () => {
	let app: ReturnType<typeof fakeApp>;
	beforeEach(() => {
		app = fakeApp();
	});

	it('scans with the vault settings and serves the notes', async () => {
		const before = get(linkedRevision);
		await openLinkedVault(config);
		expect(app.calls).toEqual([
			{ cmd: 'linked_open', args: { vault: config.id, root: ROOT, ignore: config.ignore, respectGitignore: true, readOnly: true } }
		]);
		expect(get(linkedVaultId)).toBe(config.id);
		expect(get(linkedRevision)).toBeGreaterThan(before);
		expect(get(linkedProblem)).toBeNull();
		expect(linkedNotes()).toHaveLength(5);
		expect(linkedFolders().map((f) => f.name).sort()).toEqual(['deep', 'empty', 'notes', 'projects']);
		expect(linkedNote(id('projects/foo.md'))?.title).toBe('Foo launch');
		expect(linkedNoteInfo(id('projects/foo.md'))?.relPath).toBe('projects/foo.md');
		expect(linkedLinks()?.resolve('project.bar')?.id).toBe(id('projects/bar.md'));
		expect(linkedStats()).toMatchObject({ notes: 5, folders: 4, skipped: 1 });
	});

	it('rescans, and closes the vault it leaves', async () => {
		await openLinkedVault(config);
		app.state.files = [...FILES, file('new.md', '# New\n')];
		const before = get(linkedRevision);
		await rescanLinkedVault();
		expect(linkedNotes()).toHaveLength(6);
		expect(get(linkedRevision)).toBeGreaterThan(before);

		const other = newLinkedVaultConfig({ id: 'lv-test0002', name: 'Other', path: ROOT });
		await openLinkedVault(other);
		expect(get(linkedVaultId)).toBe(other.id);
		expect(app.calls.at(-1)).toEqual({ cmd: 'linked_close', args: { vault: config.id } });
		expect(linkedNote(id('projects/foo.md'))).toBeUndefined();

		closeLinkedVault();
		expect(get(linkedVaultId)).toBeNull();
		expect(linkedNotes()).toEqual([]);
		expect(linkedLinks()).toBeNull();
		expect(app.calls.at(-1)).toEqual({ cmd: 'linked_close', args: { vault: other.id } });
	});

	it('reports a missing folder and keeps what was open', async () => {
		await openLinkedVault(config);
		app.state.root = null; // unplugged
		await expect(rescanLinkedVault()).rejects.toMatchObject({ name: 'NotFoundError' });
		expect(get(linkedProblem)).toMatchObject({ vaultId: config.id, kind: 'missing' });
		expect(linkedNotes()).toHaveLength(5);

		closeLinkedVault();
		await expect(openLinkedVault(config)).rejects.toMatchObject({ name: 'NotFoundError' });
		expect(get(linkedVaultId)).toBeNull();
		expect(get(linkedProblem)?.kind).toBe('missing');
	});

	it('never calls a command that writes', async () => {
		await openLinkedVault(config);
		await rescanLinkedVault();
		closeLinkedVault();
		expect(new Set(app.calls.map((c) => c.cmd))).toEqual(new Set(['linked_open', 'linked_close']));
	});

	it('fails outside the desktop app', async () => {
		delete (globalThis as any).__TAURI_INTERNALS__;
		await expect(openLinkedVault(config)).rejects.toMatchObject({ name: 'NotSupportedError' });
		expect(get(linkedProblem)?.kind).toBe('error');
	});
});

describe('linked vault settings', () => {
	it('has the documented defaults', () => {
		const fresh = newLinkedVaultConfig({ name: 'K', path: ROOT });
		expect(fresh.id).toMatch(/^lv-[a-z0-9]{8}$/);
		expect(fresh).toMatchObject({ linkKey: 'frontmatter', linkKeyField: 'id', linkFallback: ['title', 'filename'], titleField: 'title', readOnly: true, respectGitignore: true });
		expect(fresh.ignore).toEqual(['.git/', '.obsidian/', '.trash/', 'node_modules/', 'target/', '.kurumi/', '.claude/']);
	});

	it('validates stored entries and fills in what is missing', () => {
		expect(validateLinkedVaultConfig(null)).toBeNull();
		expect(validateLinkedVaultConfig({ id: 'not-linked', name: 'x', path: '/p' })).toBeNull();
		expect(validateLinkedVaultConfig({ id: 'lv-a', name: ' ', path: '/p' })).toBeNull();
		expect(validateLinkedVaultConfig({ id: 'lv-a', name: 'A' })).toBeNull();
		const ok = validateLinkedVaultConfig({ id: 'lv-a', name: 'A', path: '/p', linkKeyField: ' uid ', ignore: ['x/', ' '], linkFallback: ['filename', 'bogus'], titleField: null, readOnly: false });
		expect(ok).toMatchObject({ id: 'lv-a', linkKey: 'frontmatter', linkKeyField: 'uid', ignore: ['x/'], linkFallback: ['filename'], titleField: null, readOnly: false, respectGitignore: true });
	});

	it('gives a linked vault no editing, records, sync or generated notes', () => {
		expect(capabilitiesFor({ kind: 'linked' })).toEqual({ kind: 'linked', editNotes: false, createNotes: false, records: false, sync: false, generated: false });
		expect(capabilitiesFor({})).toMatchObject({ kind: 'kurumi', editNotes: true, records: true, sync: true });
		expect(capabilitiesFor(undefined).kind).toBe('kurumi');
	});
});

describe('choosing a folder to link', () => {
	function folders(existing: string[]) {
		(globalThis as any).__TAURI_INTERNALS__ = {
			invoke: async (cmd: string, args?: { path: string; dir: boolean }) => {
				const { path, dir } = args ?? { path: '', dir: false };
				if (cmd === 'folder_pick') return { path: '/picked/notes', name: 'notes' };
				if (cmd !== 'fs_open') throw `NotSupportedError: ${cmd}`;
				const entry = existing.find((e) => e.replace(/\/$/, '') === path);
				if (!entry) throw `NotFoundError: ${path} doesn't exist`;
				if (entry.endsWith('/') !== dir) throw `TypeMismatchError: ${path} is not the expected kind of entry`;
				return null;
			}
		};
	}
	const picked = { path: '/picked/notes', name: 'notes' };

	it('accepts an ordinary folder, also one that has a .kurumi folder without metadata', async () => {
		folders(['/picked/notes/.git/', '/picked/notes/.kurumi/']);
		expect(await pickLinkedFolder()).toEqual(picked);
		expect(await linkRefusal(picked)).toBeNull();
		expect(await linkRefusal(picked, '/somewhere/else')).toBeNull();
	});

	it('refuses a Kurumi sync folder', async () => {
		folders(['/picked/notes/kurumi-sync.bin']);
		expect(await linkRefusal(picked)).toBe(SYNC_FOLDER_REFUSAL);
		folders(['/picked/notes/.kurumi/', '/picked/notes/.kurumi/metadata.json']);
		expect(await linkRefusal(picked)).toBe(SYNC_FOLDER_REFUSAL);
		// A directory of that name isn't the sync file.
		folders(['/picked/notes/kurumi-sync.bin/']);
		expect(await linkRefusal(picked)).toBeNull();
	});

	it('refuses the folder Local sync is set up with', async () => {
		folders([]);
		expect(await linkRefusal(picked, '/picked/notes/')).toBe(SYNC_FOLDER_REFUSAL);
		expect(await linkRefusal({ path: 'C:\\Users\\me\\notes', name: 'notes' }, 'C:\\Users\\me\\notes\\')).toBe(SYNC_FOLDER_REFUSAL);
	});
});

describe('src/lib/linked', () => {
	it("imports nothing of Kurumi's own folder format", () => {
		const dir = join(process.cwd(), 'src/lib/linked');
		for (const name of readdirSync(dir)) {
			const source = readFileSync(join(dir, name), 'utf8');
			const imports = [...source.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
			for (const path of imports) {
				expect(path, `${name} imports ${path}`).not.toMatch(/local-fs|claude-instructions|agent-guide|sync\/|git\/|db\/store|\$lib\/db$/);
			}
		}
	});
});
