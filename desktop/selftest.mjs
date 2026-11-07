// Runs the desktop app in self-test mode (src-tauri/src/selftest.rs) twice:
// phase 1 checks the app and writes data, phase 2 restarts it and checks the
// data is still there. Needs a build: `npm test` makes a debug one first;
// KURUMI_EXE=<path to the executable> tests another (e.g. a packaged app).
// On Linux without a display, run it under xvfb-run.

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
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
		}, 120_000);
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
} catch (error) {
	console.error(error.message);
	failures++;
} finally {
	rmSync(dir, { recursive: true, force: true });
}

if (failures) {
	console.error(`${failures} check(s) failed`);
	process.exit(1);
}
console.log('desktop self-test passed');
