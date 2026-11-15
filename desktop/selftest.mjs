// Runs the desktop app in self-test mode (src-tauri/src/selftest.rs) twice:
// phase 1 checks the app and writes data, phase 2 restarts it and checks the
// data is still there. Both also use a linked folder vault: the fixture
// below, which afterwards must hold the edits made and nothing of Kurumi.
// Needs a build: `npm test` makes a debug one first;
// KURUMI_EXE=<path to the executable> tests another (e.g. a packaged app).
// On Linux without a display, run it under xvfb-run.

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const exe =
	process.env.KURUMI_EXE ??
	join(here, 'src-tauri', 'target', 'debug', process.platform === 'win32' ? 'kurumi.exe' : 'kurumi');
if (!existsSync(exe)) {
	console.error(`No app at ${exe}; run \`npm run build:debug\` first.`);
	process.exit(1);
}

const dir = mkdtempSync(join(tmpdir(), 'kurumi-selftest-'));
mkdirSync(join(dir, 'folder'));
const nonce = randomUUID();

// The linked folder: notes as another tool keeps them (its own frontmatter,
// links by id, one with CRLF), and what a vault leaves out.
const linked = join(dir, 'linked');
const FOO =
	'---\nid: project.foo\ntype: project\nscope: "team"\ntitle: Foo launch\nsummary: Ship it.\nstatus: active\nsource: https://example.com/a#b\nupdated: 2026-01-02\npaths:\n  - src/a\n  - src/b\n---\n\n# Foo\n\nLine one.\nLine two.\nLine three.\n\nNeeds [[project.bar]] and [[Nowhere note]].\n';
const fixture = {
	'foo.md': FOO,
	'bar.md': '---\nid: project.bar\ntitle: Bar plan\n---\nThe bar plan, after [[project.foo|the launch]].\n',
	'crlf.md': '---\r\nid: note.crlf\r\ntitle: Windows\r\n---\r\n# CRLF\r\n\r\nLine one\r\nLine two\r\n',
	'readme.md': '# Readme\n\nPlain text.\n\n![A picture](assets/shown.png)\n',
	// One pixel; the self-test replaces it with another (below) while the note shows it.
	'assets/shown.png': Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'),
	'assets/pic.png': Buffer.from(Array.from({ length: 256 }, (_, i) => i)),
	'.gitignore': 'private/\n',
	'private/secret.md': '# Secret\n',
	'.obsidian/workspace.md': '# Not a note\n',
	'node_modules/pkg/README.md': '# Not a note either\n'
};
for (const [rel, content] of Object.entries(fixture)) {
	mkdirSync(join(linked, rel, '..'), { recursive: true });
	writeFileSync(join(linked, rel), content);
}

/** What the linked folder must look like after both phases. */
function linkedFolderChecks() {
	const files = readdirSync(linked, { recursive: true, withFileTypes: true })
		.filter((entry) => entry.isFile())
		.map((entry) => join(entry.parentPath ?? entry.path, entry.name).slice(linked.length + 1).replaceAll('\\', '/'))
		.sort();
	const expected = { ...fixture, 'foo.md': FOO.replace('Line two.', 'Line two. now').replace('Line three.', 'Line three. Mine.'), 'Untitled.md': 'First words.',
		'assets/shown.png': Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')
	};
	const differing = Object.entries(expected)
		.filter(([rel, content]) => !files.includes(rel) || !readFileSync(join(linked, rel)).equals(Buffer.from(content)))
		.map(([rel]) => rel);
	const litter = readdirSync(linked, { recursive: true }).filter((name) => /(^|[\\/])(\.kurumi|\.claude|kurumi-sync\.bin)([\\/]|$)|\.kurumi-tmp$/.test(String(name)));
	return {
		'linked folder: only the notes, the edits and the new note': {
			ok: files.join(',') === Object.keys(expected).sort().join(','),
			detail: files.join(', ')
		},
		'linked folder: every file has the bytes expected': { ok: differing.length === 0, detail: differing.join(', ') || undefined },
		'linked folder: no .kurumi, .claude, kurumi-sync.bin or temp file': { ok: litter.length === 0, detail: litter.join(', ') || undefined }
	};
}

function run(phase) {
	return new Promise((resolve, reject) => {
		const child = spawn(exe, [], {
			env: { ...process.env, KURUMI_SELFTEST: dir, KURUMI_SELFTEST_PHASE: phase, KURUMI_SELFTEST_NONCE: nonce },
			stdio: ['ignore', 'pipe', 'inherit']
		});
		let out = '';
		child.stdout.on('data', (d) => (out += d));
		const timer = setTimeout(() => {
			child.kill();
			reject(new Error(`phase ${phase} timed out; output:\n${out}`));
		}, 300_000);
		child.on('exit', () => {
			clearTimeout(timer);
			const line = out.split('\n').find((l) => l.startsWith('KURUMI_SELFTEST '));
			if (!line) return reject(new Error(`phase ${phase} reported nothing; output:\n${out}`));
			resolve(JSON.parse(line.slice('KURUMI_SELFTEST '.length)));
		});
	});
}

let failures = 0;
function show(checks) {
	for (const [name, { ok, detail }] of Object.entries(checks)) {
		console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail && !ok ? ` (${detail})` : detail ? ` (${detail})` : ''}`);
		if (!ok) failures++;
	}
}

try {
	console.log(`testing ${exe}`);
	show((await run('1')).checks);
	const download = join(dir, 'downloads', 'kurumi-selftest.txt');
	const downloaded = existsSync(download) ? readFileSync(download, 'utf8') : null;
	show({ 'download saved to Downloads': { ok: downloaded === 'exported', detail: downloaded ?? 'no file' } });
	show((await run('2')).checks);
	show(linkedFolderChecks());
} catch (error) {
	console.error(error.message);
	failures++;
} finally {
	// WebView2's helper processes can hold the profile for a moment after
	// the app exits (EBUSY on Windows); a leftover temp dir is no failure.
	try {
		rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
	} catch (error) {
		console.warn(`couldn't remove ${dir}: ${error.code ?? error.message}`);
	}
}

if (failures) {
	console.error(`${failures} check(s) failed`);
	process.exit(1);
}
console.log('desktop self-test passed');
