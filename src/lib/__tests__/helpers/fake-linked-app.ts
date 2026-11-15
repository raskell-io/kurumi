// The desktop app's linked-folder commands (desktop/src-tauri/src/linked.rs)
// over an in-memory folder, with the same contract: hash-guarded writes, a
// long poll for changes, errors as "NameError: message" strings. Rust's own
// tests cover the real file system and watcher.
import type { LinkedChange, NoteFile } from '$lib/linked/types';

/** Stands in for SHA-256: equal content, equal hash. */
export function fakeHash(content: string): string {
	let h = 0x811c9dc5;
	for (let i = 0; i < content.length; i++) h = Math.imul(h ^ content.charCodeAt(i), 0x01000193) >>> 0;
	return h.toString(16).padStart(8, '0') + content.length.toString(16);
}

export function fakeLinkedApp(root: string, initial: Record<string, string>, otherFiles: Record<string, Uint8Array> = {}) {
	const files = new Map(Object.entries(initial));
	// Files that aren't notes (images beside them).
	const binary = new Map(Object.entries(otherFiles));
	const calls: { cmd: string; args: any }[] = [];
	const open = new Map<string, { cursor: number; readOnly: boolean }>();
	let clock = 1_700_000_000_000;
	let cursors = 1000;
	let log: LinkedChange[] = [];
	let waiting: { vault: string; resolve: (v: unknown) => void; reject: (e: unknown) => void } | null = null;
	const state = { rootExists: true, watch: 'events' as 'events' | 'polling', failWrites: null as string | null, failPolls: 0, pollError: 'NotReadableError: the watcher failed' };

	const noteFile = (rel: string): NoteFile => {
		const content = files.get(rel)!;
		return { rel, content, hash: fakeHash(content), mtime: ++clock, size: content.length };
	};
	const flush = () => {
		if (!waiting || !log.length) return;
		const { vault, resolve } = waiting;
		waiting = null;
		const changes = log;
		log = [];
		resolve({ cursor: (open.get(vault)!.cursor = ++cursors), changes, rescan: false });
	};
	const checkRel = (rel: string) => {
		if (!rel || rel.startsWith('/') || rel.split('/').some((p) => !p || p === '..' || p.startsWith('.'))) throw `NotAllowedError: "${rel}" is not a path inside the linked folder`;
		if (!/\.(md|markdown)$/i.test(rel)) throw `NotAllowedError: "${rel}" is not a Markdown file`;
	};
	const vaultOf = (vault: string) => {
		const v = open.get(vault);
		if (!v) throw `InvalidStateError: the linked folder ${vault} isn't open`;
		return v;
	};

	const commands: Record<string, (args: any) => unknown> = {
		folder_pick: () => ({ path: root, name: root.slice(root.lastIndexOf('/') + 1) }),
		fs_open: ({ path }) => {
			throw `NotFoundError: ${path} doesn't exist`;
		},
		linked_open: ({ vault, root: asked, readOnly }) => {
			if (asked !== root || !state.rootExists) throw `NotFoundError: ${asked} doesn't exist`;
			// A poll of this vault that was waiting is told to start over.
			if (waiting && waiting.vault === vault) {
				waiting.resolve({ cursor: 0, changes: [], rescan: true });
				waiting = null;
			}
			log = [];
			open.set(vault, { cursor: ++cursors, readOnly });
			const dirs = new Set<string>();
			for (const rel of files.keys()) if (rel.includes('/')) dirs.add(rel.slice(0, rel.lastIndexOf('/')));
			return { cursor: cursors, notes: [...files.keys()].map(noteFile), dirs: [...dirs], skipped: 0, watch: state.watch };
		},
		linked_changes: ({ vault, cursor }) => {
			if (state.failPolls > 0) {
				state.failPolls--;
				throw state.pollError;
			}
			const v = vaultOf(vault);
			if (cursor !== v.cursor) return { cursor: 0, changes: [], rescan: true };
			return new Promise((resolve, reject) => {
				waiting = { vault, resolve, reject };
				flush();
			});
		},
		linked_read: ({ vault, rel }) => {
			vaultOf(vault);
			checkRel(rel);
			if (!files.has(rel)) throw `NotFoundError: ${rel} doesn't exist`;
			return noteFile(rel);
		},
		linked_write: ({ vault, rel, expectedHash, content }) => {
			if (vaultOf(vault).readOnly) throw 'NotAllowedError: this linked folder is read-only';
			checkRel(rel);
			if (state.failWrites) throw state.failWrites;
			if (!files.has(rel)) throw `NotFoundError: ${rel} doesn't exist`;
			const current = fakeHash(files.get(rel)!);
			if (current !== expectedHash) throw `ConflictError: ${current}`;
			files.set(rel, content);
			return { hash: fakeHash(content), mtime: ++clock };
		},
		linked_create: ({ vault, rel, content }) => {
			if (vaultOf(vault).readOnly) throw 'NotAllowedError: this linked folder is read-only';
			checkRel(rel);
			if (state.failWrites) throw state.failWrites;
			if (files.has(rel)) throw `InvalidModificationError: ${rel} already exists`;
			files.set(rel, content);
			return { hash: fakeHash(content), mtime: ++clock };
		},
		linked_read_bytes: ({ vault, rel }) => {
			vaultOf(vault);
			if (!rel || rel.startsWith('/') || rel.split('/').some((p: string) => !p || p === '..' || p === '.' || p.startsWith('.'))) throw `NotAllowedError: "${rel}" is not a path inside the linked folder`;
			const bytes = binary.get(rel) ?? (files.has(rel) ? new TextEncoder().encode(files.get(rel)!) : null);
			if (!bytes) throw `NotFoundError: ${rel} doesn't exist`;
			return bytes.slice().buffer;
		},
		linked_reveal: ({ vault, rel }) => {
			vaultOf(vault);
			if (rel && !files.has(rel) && !binary.has(rel)) throw `NotFoundError: ${rel} doesn't exist`;
			return null;
		},
		linked_close: ({ vault }) => {
			open.delete(vault);
			if (waiting && waiting.vault === vault) {
				waiting.reject(`InvalidStateError: the linked folder ${vault} isn't open`);
				waiting = null;
			}
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

	return {
		files,
		binary,
		calls,
		state,
		/** The commands called, without the long poll. */
		commandsCalled: () => calls.map((c) => c.cmd).filter((c) => c !== 'linked_changes'),
		writes: () => calls.filter((c) => c.cmd === 'linked_write' || c.cmd === 'linked_create'),
		/** Something else changes the folder: `null` removes the file. The watcher reports it. */
		external(rel: string, content: string | null, { silent = false } = {}) {
			if (content === null) files.delete(rel);
			else files.set(rel, content);
			if (silent) return; // the watcher hasn't noticed yet
			log.push(content === null ? { type: 'remove', rel } : { type: 'upsert', note: noteFile(rel) });
			flush();
		},
		/** The watcher lost track: the next poll answer says to scan again. */
		overflow() {
			if (!waiting) return;
			waiting.resolve({ cursor: 0, changes: [], rescan: true });
			waiting = null;
		},
		uninstall() {
			delete (globalThis as any).__TAURI_INTERNALS__;
		}
	};
}

/** Let promise chains and zero-delay timers run. */
export const settle = async (rounds = 6) => {
	for (let i = 0; i < rounds; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};
