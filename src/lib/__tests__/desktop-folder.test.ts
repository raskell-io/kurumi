// The desktop app's stand-in for the File System Access API
// (src/lib/desktop/folder-handle.ts), against an in-memory version of the
// app's commands with the same error contract as folders.rs (whose own tests
// cover the real file system).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	DesktopDirectoryHandle,
	reviveFolderHandle,
	showDesktopDirectoryPicker
} from '$lib/desktop/folder-handle';

const ROOT = '/Users/me/Sync';

function fakeApp() {
	const files = new Map<string, Uint8Array>();
	const dirs = new Set<string>([ROOT]);
	const parent = (p: string) => p.slice(0, p.lastIndexOf('/'));
	const exists = (p: string) => files.has(p) || dirs.has(p);
	const inside = (p: string) => {
		if (!(p === ROOT || p.startsWith(ROOT + '/')) || p.split('/').includes('..')) {
			throw `NotAllowedError: ${p} is outside the folders you picked`;
		}
	};
	const children = (p: string) =>
		[...dirs, ...files.keys()].filter((c) => c !== p && parent(c) === p);
	const calls: string[] = [];
	const commands: Record<string, (args: any, headers?: Record<string, string>) => unknown> = {
		folder_pick: () => ({ path: ROOT, name: 'Sync' }),
		folder_granted: ({ path }) => dirs.has(path),
		fs_list: ({ path }) => {
			inside(path);
			return children(path).map((c) => ({
				name: c.slice(c.lastIndexOf('/') + 1),
				dir: dirs.has(c),
				size: files.get(c)?.byteLength ?? 0,
				modified: 1_700_000_000_000
			}));
		},
		fs_open: ({ path, dir, create }) => {
			inside(path);
			if (exists(path)) {
				if (dirs.has(path) !== dir) throw `TypeMismatchError: ${path} is not the expected kind of entry`;
				return null;
			}
			if (!create) throw `NotFoundError: ${path} doesn't exist`;
			if (!dirs.has(parent(path))) throw `NotFoundError: ${parent(path)} doesn't exist`;
			if (dir) dirs.add(path);
			else files.set(path, new Uint8Array());
			return null;
		},
		fs_stat: ({ path }) => {
			inside(path);
			if (!exists(path)) throw `NotFoundError: ${path} doesn't exist`;
			return { name: path, dir: dirs.has(path), size: files.get(path)?.byteLength ?? 0, modified: 1_700_000_000_000 };
		},
		fs_read: ({ path }) => {
			inside(path);
			const data = files.get(path);
			if (!data) throw `NotFoundError: ${path} doesn't exist`;
			return data.slice().buffer;
		},
		fs_write: (body: Uint8Array, headers) => {
			const path = decodeURIComponent(headers!['x-kurumi-path']);
			inside(path);
			files.set(path, body.slice());
			return null;
		},
		fs_remove: ({ path, recursive }) => {
			inside(path);
			if (files.delete(path)) return null;
			if (!dirs.has(path)) throw `NotFoundError: ${path} doesn't exist`;
			if (children(path).length && !recursive) throw `InvalidModificationError: ${path} isn't empty`;
			for (const c of [...files.keys()]) if (c.startsWith(path + '/')) files.delete(c);
			for (const d of [...dirs]) if (d === path || d.startsWith(path + '/')) dirs.delete(d);
			return null;
		}
	};
	(globalThis as any).__TAURI_INTERNALS__ = {
		invoke: async (cmd: string, args: unknown, options?: { headers: Record<string, string> }) => {
			calls.push(cmd);
			return commands[cmd](args, options?.headers);
		}
	};
	return { files, dirs, calls };
}

describe('desktop folder handles', () => {
	let app: ReturnType<typeof fakeApp>;
	beforeEach(() => (app = fakeApp()));
	afterEach(() => delete (globalThis as any).__TAURI_INTERNALS__);

	it('reads and writes files through the app like the browser API', async () => {
		const root = await showDesktopDirectoryPicker();
		expect([root.kind, root.name]).toEqual(['directory', 'Sync']);
		expect(await root.queryPermission()).toBe('granted');

		const kurumi = await root.getDirectoryHandle('.kurumi', { create: true });
		const handle = await kurumi.getFileHandle('metadata.json', { create: true });
		const writable = await handle.createWritable();
		await writable.write('{"a":');
		await writable.write(new TextEncoder().encode('1}').buffer as ArrayBuffer);
		await writable.close();
		expect(new TextDecoder().decode(app.files.get(`${ROOT}/.kurumi/metadata.json`))).toBe('{"a":1}');

		const file = await (await kurumi.getFileHandle('metadata.json')).getFile();
		expect([file.name, file.size, file.lastModified, file.type]).toEqual(['metadata.json', 7, 1_700_000_000_000, 'application/json']);
		expect(await file.text()).toBe('{"a":1}');
		expect([...(await file.bytes())]).toEqual([...new TextEncoder().encode('{"a":1}')]);

		const names: string[] = [];
		for await (const entry of root.values()) names.push(`${entry.name}:${entry.kind}`);
		expect(names).toEqual(['.kurumi:directory']);
		for await (const [name, entry] of kurumi.entries()) expect([name, entry.kind]).toEqual(['metadata.json', 'file']);
	});

	it('only reads contents when asked (size and date come from a stat)', async () => {
		const root = await showDesktopDirectoryPicker();
		await (await (await root.getFileHandle('big.bin', { create: true })).createWritable()).close();
		app.calls.length = 0;
		const file = await (await root.getFileHandle('big.bin')).getFile();
		void file.size;
		void file.lastModified;
		expect(app.calls).toEqual(['fs_open', 'fs_stat']);
	});

	it('throws the DOMExceptions local folder sync checks for', async () => {
		const root = await showDesktopDirectoryPicker();
		const missing = await root.getFileHandle('kurumi-sync.bin').catch((e) => e);
		expect(missing).toBeInstanceOf(DOMException);
		expect(missing.name).toBe('NotFoundError');

		const dir = await root.getDirectoryHandle('notes', { create: true });
		await dir.getFileHandle('a.md', { create: true });
		expect((await root.getFileHandle('notes').catch((e) => e)).name).toBe('TypeMismatchError');
		expect((await root.removeEntry('notes').catch((e) => e)).name).toBe('InvalidModificationError');
		await root.removeEntry('notes', { recursive: true });
		expect(app.dirs.has(`${ROOT}/notes`)).toBe(false);

		await expect(root.getFileHandle('../secrets')).rejects.toThrow(TypeError);
		await expect(root.getFileHandle('a/b')).rejects.toThrow(TypeError);
	});

	it('turns a cancelled dialog into an AbortError', async () => {
		(globalThis as any).__TAURI_INTERNALS__.invoke = async () => null;
		const err = await showDesktopDirectoryPicker().catch((e) => e);
		expect([err instanceof DOMException, err.name]).toEqual([true, 'AbortError']);
	});

	it('comes back from IndexedDB as a working handle', async () => {
		const stored = structuredClone(await showDesktopDirectoryPicker());
		expect(stored).not.toBeInstanceOf(DesktopDirectoryHandle);
		const revived = reviveFolderHandle(stored) as DesktopDirectoryHandle;
		expect(revived).toBeInstanceOf(DesktopDirectoryHandle);
		expect([revived.path, revived.name]).toEqual([ROOT, 'Sync']);
		await revived.getFileHandle('x.md', { create: true });
		expect(app.files.has(`${ROOT}/x.md`)).toBe(true);
		// Anything else passes through untouched.
		const browserHandle = { kind: 'directory', name: 'x' };
		expect(reviveFolderHandle(browserHandle)).toBe(browserHandle);
		expect(reviveFolderHandle(undefined)).toBeUndefined();
	});

	it('joins Windows paths with backslashes', async () => {
		const calls: any[] = [];
		(globalThis as any).__TAURI_INTERNALS__ = { invoke: async (cmd: string, args: any) => (calls.push([cmd, args]), null) };
		const root = new DesktopDirectoryHandle('\\\\?\\C:\\Users\\me\\Sync', 'Sync');
		await root.getFileHandle('a.md');
		expect(calls[0][1].path).toBe('\\\\?\\C:\\Users\\me\\Sync\\a.md');
	});
});
