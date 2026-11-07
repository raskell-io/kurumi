// Smoke test for the desktop shell: starts Electron on the web build (../build)
// with a throwaway profile, then checks it through the DevTools protocol.
// Run `npm run build` at the repo root first, then `npm test` here.
// KURUMI_EXE=<path to the packaged executable> tests a built app instead.

import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const require = createRequire(import.meta.url);
const electronPath = require('electron');
const here = fileURLToPath(new URL('.', import.meta.url));
const profile = mkdtempSync(join(tmpdir(), 'kurumi-desktop-'));
// A free port, not a fixed one: another browser may already use 9222 & co.
const PORT = await new Promise((resolve) => {
	const server = createServer().listen(0, '127.0.0.1', () => {
		const { port } = server.address();
		server.close(() => resolve(port));
	});
});
const wasm = readdirSync(join(here, '..', 'build', '_app', 'immutable', 'assets')).find((f) => f.endsWith('.wasm'));

function start() {
	const exe = process.env.KURUMI_EXE;
	const args = [...(exe ? [] : [here]), `--remote-debugging-port=${PORT}`];
	if (process.env.CI && process.platform === 'linux') args.push('--no-sandbox');
	return spawn(exe ?? electronPath, args, {
		env: { ...process.env, KURUMI_USER_DATA: profile },
		stdio: ['ignore', 'inherit', 'inherit']
	});
}

async function connect() {
	for (let i = 0; i < 60; i++) {
		try {
			const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${PORT}`, defaultViewport: null });
			for (let j = 0; j < 60; j++) {
				const pages = await browser.pages();
				const page = pages.find((p) => p.url().startsWith('app://kurumi'));
				if (page) return { browser, page };
				await new Promise((r) => setTimeout(r, 250));
			}
			throw new Error('no app://kurumi page');
		} catch (error) {
			if (i === 59) throw error;
			await new Promise((r) => setTimeout(r, 500));
		}
	}
}

async function stop(child, browser) {
	await browser.disconnect().catch(() => {});
	const exited = new Promise((r) => child.once('exit', r));
	child.kill();
	await exited;
}

let failures = 0;
function check(name, ok, detail = '') {
	console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
	if (!ok) failures++;
}

let child = start();
try {
	let { browser, page } = await connect();
	const errors = [];
	page.on('pageerror', (e) => errors.push(e.message));
	await page.waitForFunction(() => document.querySelector('main, nav, aside'), { timeout: 30000 });

	const env = await page.evaluate(
		async (wasmPath) => ({
			origin: location.origin,
			secure: isSecureContext,
			folderSync: 'showDirectoryPicker' in window,
			wasmType: (await fetch(wasmPath)).headers.get('content-type'),
			missingAsset: (await fetch('/nope.js')).status
		}),
		`/_app/immutable/assets/${wasm}`
	);
	check('fixed origin app://kurumi', env.origin === 'app://kurumi', env.origin);
	check('secure context', env.secure);
	check('local folder sync available', env.folderSync);
	check('wasm served as application/wasm', env.wasmType === 'application/wasm', String(env.wasmType));
	check('missing asset is a 404', env.missingAsset === 404, String(env.missingAsset));

	// The Cache API refuses app: URLs, so the desktop app must not register one.
	await new Promise((r) => setTimeout(r, 2000));
	const workers = await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length);
	check('no service worker registered', workers === 0, String(workers));

	await page.goto('app://kurumi/memory/does-not-exist', { waitUntil: 'load' });
	check('dynamic route gets the app shell', (await page.title()).includes('Kurumi'), await page.title());
	await page.goto('app://kurumi/actions', { waitUntil: 'load' });
	await page.evaluate(() => localStorage.setItem('kurumi-desktop-smoke', 'kept'));
	check('no page errors', errors.length === 0, errors.join(' | '));

	// Data must survive a restart (same origin, same profile).
	await stop(child, browser);
	child = start();
	({ browser, page } = await connect());
	const kept = await page.evaluate(() => localStorage.getItem('kurumi-desktop-smoke'));
	check('data survives a restart', kept === 'kept', String(kept));
	await stop(child, browser);
	child = null;
} catch (error) {
	console.error(error);
	failures++;
} finally {
	if (child) child.kill();
	rmSync(profile, { recursive: true, force: true });
}

if (failures) {
	console.error(`${failures} check(s) failed`);
	process.exit(1);
}
console.log('desktop smoke test passed');
