#!/usr/bin/env node
/**
 * kurumi-agent — sync a Kurumi local folder with a git remote (GitHub,
 * GitLab, Codeberg, …) using the system `git` and your own credentials.
 *
 * Kurumi (Settings → Sync → Local) writes into a folder on disk; this agent
 * commits that folder and pulls/pushes it. The browser never sees a token
 * or needs a CORS proxy, and whatever auth your `git` already has (SSH
 * keys, credential helper, SSO) is what gets used.
 *
 *   kurumi-agent init  <dir> [--remote <url>] [--branch main]
 *   kurumi-agent sync  <dir> [--message <msg>]
 *   kurumi-agent watch <dir> [--interval 300] [--debounce 10]
 *
 * Merging: `kurumi-sync.bin` is an Automerge document and is the source of
 * truth, so it gets a merge driver that does a CRDT merge (the same thing
 * the app does). The markdown and metadata files are regenerated from it
 * by the app on its next sync, so for those any conflict resolves to the
 * local side. See agent/README.md.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, watch, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const BINARY = 'kurumi-sync.bin';
const ATTRIBUTES_MARKER = '# kurumi-agent';
const ATTRIBUTES = `${ATTRIBUTES_MARKER} (managed; edit outside this block)
${BINARY} merge=kurumi-automerge -diff
**/.kurumi/metadata.json merge=kurumi-ours
.kurumi/vaults.json merge=kurumi-ours
**/.kurumi/blobs/** binary
${ATTRIBUTES_MARKER} end
`;
const IGNORES = ['.DS_Store', '.kurumi-write-test'];

// ---------------------------------------------------------------- utils

function log(message) {
	const time = new Date().toLocaleTimeString([], { hour12: false });
	console.log(`[${time}] ${message}`);
}

function fail(message) {
	console.error(`kurumi-agent: ${message}`);
	process.exit(1);
}

function git(dir, args, { allowFail = false } = {}) {
	try {
		return execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
	} catch (err) {
		if (allowFail) return null;
		const detail = (err.stderr || err.stdout || err.message || '').toString().trim();
		throw new Error(`git ${args.join(' ')} failed${detail ? `:\n${detail}` : ''}`);
	}
}

function parseArgs(argv) {
	const positional = [];
	const flags = {};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg.startsWith('--')) {
			const key = arg.slice(2);
			const next = argv[i + 1];
			if (next === undefined || next.startsWith('--')) flags[key] = true;
			else {
				flags[key] = next;
				i++;
			}
		} else positional.push(arg);
	}
	return { positional, flags };
}

function shellQuote(value) {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

// ---------------------------------------------------------------- repo setup

function isRepo(dir) {
	return git(dir, ['rev-parse', '--show-toplevel'], { allowFail: true }) === resolve(dir);
}

// Register the merge drivers (per clone: git doesn't version driver config)
// and make sure .gitattributes / .gitignore route the files to them.
function configureRepo(dir) {
	git(dir, ['config', 'merge.kurumi-automerge.name', 'Kurumi Automerge document']);
	git(dir, [
		'config',
		'merge.kurumi-automerge.driver',
		`${shellQuote(process.execPath)} ${shellQuote(SELF)} merge-driver %O %A %B`
	]);
	git(dir, ['config', 'merge.kurumi-ours.name', 'Kurumi regenerated file (keep local)']);
	git(dir, ['config', 'merge.kurumi-ours.driver', 'true']);

	const attributesPath = join(dir, '.gitattributes');
	const current = existsSync(attributesPath) ? readFileSync(attributesPath, 'utf8') : '';
	const block = new RegExp(`${ATTRIBUTES_MARKER} \\(managed[\\s\\S]*?${ATTRIBUTES_MARKER} end\\n?`);
	const next = block.test(current)
		? current.replace(block, ATTRIBUTES)
		: `${current}${current && !current.endsWith('\n') ? '\n' : ''}${ATTRIBUTES}`;
	if (next !== current) writeFileSync(attributesPath, next);

	const ignorePath = join(dir, '.gitignore');
	const ignore = existsSync(ignorePath) ? readFileSync(ignorePath, 'utf8') : '';
	const lines = new Set(ignore.split('\n').map((l) => l.trim()));
	const missing = IGNORES.filter((entry) => !lines.has(entry));
	if (missing.length) {
		writeFileSync(ignorePath, `${ignore}${ignore && !ignore.endsWith('\n') ? '\n' : ''}${missing.join('\n')}\n`);
	}
}

function currentBranch(dir) {
	return git(dir, ['symbolic-ref', '--short', 'HEAD'], { allowFail: true }) || 'main';
}

function hasRemote(dir) {
	return (git(dir, ['remote'], { allowFail: true }) || '').split('\n').includes('origin');
}

// ---------------------------------------------------------------- commands

function init(dir, flags) {
	const remote = typeof flags.remote === 'string' ? flags.remote : null;
	const branch = typeof flags.branch === 'string' ? flags.branch : 'main';
	const empty = !existsSync(dir) || readdirSync(dir).length === 0;

	if (remote && empty) {
		mkdirSync(dir, { recursive: true });
		log(`Cloning ${remote}…`);
		git(resolve(dir, '..'), ['clone', remote, resolve(dir)]);
		// An empty remote clones without a branch; name it.
		if (!git(dir, ['rev-parse', '--verify', '--quiet', 'HEAD'], { allowFail: true })) {
			git(dir, ['symbolic-ref', 'HEAD', `refs/heads/${branch}`]);
		}
	} else {
		mkdirSync(dir, { recursive: true });
		if (!isRepo(dir)) {
			log(`Initialising a git repo in ${dir}`);
			git(dir, ['init', '-b', branch]);
		}
		if (remote) {
			if (hasRemote(dir)) git(dir, ['remote', 'set-url', 'origin', remote]);
			else git(dir, ['remote', 'add', 'origin', remote]);
		}
	}

	configureRepo(dir);
	git(dir, ['add', '.gitattributes', '.gitignore']);
	if (git(dir, ['diff', '--cached', '--quiet'], { allowFail: true }) === null) {
		git(dir, ['commit', '-m', 'kurumi-agent: configure merge drivers']);
	}
	log('Ready. Point Kurumi at this folder (Settings → Sync → Local), then run');
	log(`  kurumi-agent sync ${dir}    or    kurumi-agent watch ${dir}`);
}

// Resolve whatever conflicts the merge drivers left behind. Returns false if
// the database itself is still conflicted (the driver refused to merge).
function resolveConflicts(dir) {
	const unmerged = (git(dir, ['diff', '--name-only', '--diff-filter=U']) || '').split('\n').filter(Boolean);
	if (!unmerged.length) return true;

	if (unmerged.includes(BINARY)) {
		// Two copies of the database with no shared history: a CRDT merge
		// would silently drop one side. Keep ours and park theirs for the app,
		// which merges it with its recovery logic on the next sync.
		const parked = `kurumi-sync.incoming-${Date.now()}.bin`;
		const theirs = execFileSync('git', ['show', `:3:${BINARY}`], { cwd: dir, maxBuffer: 1 << 30 });
		writeFileSync(join(dir, parked), theirs);
		git(dir, ['checkout', '--ours', '--', BINARY]);
		git(dir, ['add', BINARY, parked]);
		log(`Remote database has unrelated history; parked it as ${parked} for Kurumi to merge.`);
	}

	// Markdown / metadata: regenerated from the database by the app, so the
	// local side wins (including modify/delete conflicts).
	for (const path of unmerged) {
		if (path === BINARY) continue;
		const ours = git(dir, ['rev-parse', '--verify', '--quiet', `:2:${path}`], { allowFail: true });
		if (ours) {
			git(dir, ['checkout', '--ours', '--', path]);
			git(dir, ['add', '--', path]);
		} else {
			git(dir, ['rm', '--quiet', '--', path]);
		}
	}
	log(`Resolved ${unmerged.length} conflicting file(s) in favour of this machine.`);
	return true;
}

function mergeRemote(dir, branch) {
	const upstream = `origin/${branch}`;
	if (!git(dir, ['rev-parse', '--verify', '--quiet', upstream], { allowFail: true })) return 0;

	const incoming = Number(git(dir, ['rev-list', '--count', `HEAD..${upstream}`], { allowFail: true }) || 0);
	if (!incoming) return 0;

	const hasHead = git(dir, ['rev-parse', '--verify', '--quiet', 'HEAD'], { allowFail: true });
	if (!hasHead) {
		git(dir, ['reset', '--hard', upstream]);
		return incoming;
	}

	// Unrelated histories happen when an existing folder was `init`ed against
	// a remote that already had content.
	const merged = git(
		dir,
		['merge', '--no-edit', '--allow-unrelated-histories', '-X', 'ours', upstream],
		{ allowFail: true }
	);
	if (merged === null) {
		resolveConflicts(dir);
		git(dir, ['commit', '--no-edit']);
	}
	return incoming;
}

function sync(dir, flags = {}) {
	if (!isRepo(dir)) fail(`${dir} is not a git repo yet. Run: kurumi-agent init ${dir} --remote <url>`);
	configureRepo(dir);

	git(dir, ['add', '-A']);
	let committed = false;
	if (git(dir, ['diff', '--cached', '--quiet'], { allowFail: true }) === null) {
		const message =
			typeof flags.message === 'string'
				? flags.message
				: `kurumi: sync from ${hostname()} at ${new Date().toISOString()}`;
		git(dir, ['commit', '--quiet', '-m', message]);
		committed = true;
	}

	if (!hasRemote(dir)) {
		log(committed ? 'Committed (no remote configured).' : 'Nothing to commit (no remote configured).');
		return;
	}

	const branch = currentBranch(dir);
	let pulled = 0;
	for (let attempt = 1; ; attempt++) {
		git(dir, ['fetch', '--quiet', 'origin']);
		pulled += mergeRemote(dir, branch);
		const ahead = git(dir, ['rev-parse', '--verify', '--quiet', `origin/${branch}`], { allowFail: true })
			? Number(git(dir, ['rev-list', '--count', `origin/${branch}..HEAD`]) || 0)
			: Number(git(dir, ['rev-list', '--count', 'HEAD'], { allowFail: true }) || 0);
		if (!ahead) break;
		const pushed = git(dir, ['push', '--quiet', '-u', 'origin', branch], { allowFail: attempt < 3 });
		if (pushed !== null) break;
		log('Push rejected (remote moved on); fetching and retrying…');
	}

	const parts = [];
	if (committed) parts.push('committed local changes');
	if (pulled) parts.push(`pulled ${pulled} commit(s) — Kurumi picks them up on its next sync`);
	log(parts.length ? `Synced: ${parts.join('; ')}.` : 'Up to date.');
}

function watchDir(dir, flags) {
	const intervalSec = Number(flags.interval ?? 300);
	const debounceSec = Number(flags.debounce ?? 10);
	let timer = null;
	let running = false;
	let pending = false;
	let quietUntil = 0;

	const run = () => {
		if (running) {
			pending = true;
			return;
		}
		running = true;
		try {
			sync(dir);
		} catch (err) {
			log(`Sync failed: ${err.message}`);
		} finally {
			running = false;
			// Ignore the file events our own merge just caused.
			quietUntil = Date.now() + 2000;
			if (pending) {
				pending = false;
				schedule();
			}
		}
	};
	const schedule = () => {
		clearTimeout(timer);
		timer = setTimeout(run, debounceSec * 1000);
	};

	watch(dir, { recursive: true }, (_event, filename) => {
		if (!filename || running || Date.now() < quietUntil) return;
		const path = filename.toString();
		if (path === '.git' || path.startsWith('.git/') || path.startsWith('.git\\')) return;
		schedule();
	});
	setInterval(run, intervalSec * 1000);

	log(`Watching ${dir} (commit ${debounceSec}s after changes, pull every ${intervalSec}s). Ctrl+C to stop.`);
	run();
}

// git merge driver: `merge-driver %O %A %B`. Merges theirs (%B) into ours
// (%A) in place. Exit 0 = merged, non-zero = leave conflicted.
async function mergeDriver([, oursPath, theirsPath]) {
	const Automerge = await import('@automerge/automerge');
	const read = (path) => {
		try {
			const bytes = readFileSync(path);
			return bytes.length ? new Uint8Array(bytes) : null;
		} catch {
			return null;
		}
	};
	const oursBytes = read(oursPath);
	const theirsBytes = read(theirsPath);
	if (!theirsBytes) return 0;
	if (!oursBytes) {
		writeFileSync(oursPath, theirsBytes);
		return 0;
	}

	const ours = Automerge.load(oursBytes);
	const theirs = Automerge.load(theirsBytes);

	// Every top-level collection must be the *same* Automerge object on both
	// sides. If one was created independently (two databases that never
	// synced), merging would keep only one of them — refuse instead.
	for (const key of Object.keys(ours)) {
		const a = ours[key];
		const b = theirs[key];
		if (a && b && typeof a === 'object' && typeof b === 'object') {
			if (Automerge.getObjectId(a) !== Automerge.getObjectId(b)) {
				console.error(`kurumi-agent: "${key}" has unrelated history on each side; not merging`);
				return 1;
			}
		}
	}

	writeFileSync(oursPath, Automerge.save(Automerge.merge(ours, theirs)));
	return 0;
}

// ---------------------------------------------------------------- main

const USAGE = `kurumi-agent — sync a Kurumi local folder with a git remote

Usage:
  kurumi-agent init  <dir> [--remote <url>] [--branch main]
  kurumi-agent sync  <dir> [--message <msg>]
  kurumi-agent watch <dir> [--interval <seconds>] [--debounce <seconds>]

See agent/README.md for the full setup.`;

const [command, ...rest] = process.argv.slice(2);
const { positional, flags } = parseArgs(rest);

try {
	switch (command) {
		case 'init':
		case 'sync':
		case 'watch': {
			if (!positional[0]) fail(`missing <dir>\n\n${USAGE}`);
			const dir = resolve(positional[0]);
			if (command === 'init') init(dir, flags);
			else if (command === 'sync') sync(dir, flags);
			else watchDir(dir, flags);
			break;
		}
		case 'merge-driver':
			process.exit(await mergeDriver(rest));
			break;
		default:
			console.log(USAGE);
			process.exit(command && command !== 'help' && command !== '--help' ? 1 : 0);
	}
} catch (err) {
	fail(err.message);
}
