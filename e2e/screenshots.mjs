#!/usr/bin/env node
/**
 * Screenshots for the docs (docs/images/), taken from the example vault in
 * a fresh browser profile, so no one's own notes end up in them.
 *
 *   npm run screenshots              # light theme
 *   THEME=dark npm run screenshots   # dark copies (*-dark.webp)
 *
 * Builds the app and serves it with `vite preview` (a production build, so
 * the offline settings show what users see). Set CHROME_PATH to use a
 * specific Chrome.
 *
 * For design reviews, without touching docs/images:
 *   SHOTS_OUT=<dir>      write there instead (nothing is copied to static/)
 *   SHOTS_FORMAT=png     PNG instead of WebP; files are <shot>-<light|dark>
 *   SHOTS_SET=design     the app shell set (home, note, split view, project,
 *                        to-dos, graph, command palette, settings, sidebar
 *                        collapsed, and home and a note at phone width)
 *   SHOTS_FONT=<id>      an editor font from Settings → Appearance for the
 *                        note shots (with SHOTS_SET=design: only those)
 *   SHOTS_DEV=1          serve with `vite dev` (no build needed)
 */

import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import puppeteer from 'puppeteer';

const PORT = Number(process.env.E2E_PORT ?? 5298);
const BASE = `http://localhost:${PORT}`;
const MAC_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const THEME = process.env.THEME === 'dark' ? 'dark' : 'light';
const DOCS = new URL('../docs/images/', import.meta.url).pathname;
const OUT = process.env.SHOTS_OUT ? join(process.env.SHOTS_OUT, '/') : DOCS;
const FORMAT = process.env.SHOTS_FORMAT === 'png' ? 'png' : 'webp';
const DESIGN = process.env.SHOTS_SET === 'design';
const FONT = process.env.SHOTS_FONT || null;
// Docs images are name.webp / name-dark.webp; review sets name-light / name-dark.
const fileOf = (name) => join(OUT, OUT === DOCS ? `${name}${THEME === 'dark' ? '-dark' : ''}.${FORMAT}` : `${name}-${THEME}.${FORMAT}`);
const capture = (page, name) => page.screenshot({ path: fileOf(name), type: FORMAT, ...(FORMAT === 'webp' ? { quality: 85 } : {}) });
const ABOUT = new URL('../static/about/', import.meta.url).pathname;
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function startServer() {
	const server = spawn('npx', ['vite', process.env.SHOTS_DEV ? 'dev' : 'preview', '--port', String(PORT), '--strictPort'], {
		stdio: ['ignore', 'pipe', 'pipe'],
		detached: true
	});
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('vite preview did not start')), 60_000);
		server.stdout.on('data', (chunk) => {
			if (chunk.toString().replace(/\x1b\[[0-9;]*m/g, '').includes(`localhost:${PORT}`)) {
				clearTimeout(timer);
				resolve(server);
			}
		});
		server.on('exit', (code) => reject(new Error(`vite preview exited (${code})`)));
	});
}

async function launchBrowser(profileDir) {
	const candidates = [process.env.CHROME_PATH, undefined, existsSync(MAC_CHROME) ? MAC_CHROME : null];
	let lastError;
	for (const executablePath of candidates.filter((c) => c !== null)) {
		try {
			return await puppeteer.launch({
				headless: true,
				userDataDir: profileDir,
				// Same dates and number formats on every machine.
				args: ['--lang=en-US'],
				env: { ...process.env, LANG: 'en_US.UTF-8' },
				...(executablePath ? { executablePath } : {})
			});
		} catch (err) {
			lastError = err;
		}
	}
	throw lastError;
}

const mainIncludes = (page, text) =>
	page.waitForFunction((t) => document.querySelector('main')?.innerText.includes(t), { timeout: 15_000 }, text);

async function clickText(page, selector, text) {
	const found = await page.evaluate(
		(selector, text) => {
			const el = [...document.querySelectorAll(selector)].find((e) => e.textContent.includes(text));
			el?.click();
			return !!el;
		},
		selector,
		text
	);
	if (!found) throw new Error(`no ${selector} with "${text}"`);
}

async function shot(page, name) {
	// Let transitions, fonts and lazy content settle; no caret in the picture.
	await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : null));
	await sleep(700);
	// No "works offline" toast in the picture.
	await page.evaluate(() => document.querySelector('.update-toast .close-btn')?.click());
	await sleep(200);
	const file = fileOf(name);
	await capture(page, name);
	console.log(`  ✓ ${file}`);
	// Settings → About shows the note screenshot (AboutKurumi.svelte).
	if (name === 'note' && OUT === DOCS) copyFileSync(file, join(ABOUT, basename(file)));
}

// The built app routes by hash (/#/projects), like on a static host.
async function go(page, path) {
	await page.goto(path === '/' ? BASE : `${BASE}/#${path}`, { waitUntil: 'load' });
	await page.waitForSelector('aside');
	await sleep(500);
}

const server = await startServer();
const profile = mkdtempSync(join(tmpdir(), 'kurumi-shots-'));
let browser;
mkdirSync(OUT, { recursive: true });

try {
	browser = await launchBrowser(profile);
	const page = await browser.newPage();
	await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US' });
	await page.emulateTimezone('Europe/Zurich');
	await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
	await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: THEME }]);
	await page.evaluateOnNewDocument((theme) => {
		if (window !== window.top) return; // plugin sandboxes have no storage
		const d = new Date();
		const iso = (x) => [x.getFullYear(), String(x.getMonth() + 1).padStart(2, '0'), String(x.getDate()).padStart(2, '0')].join('-');
		const today = iso(d);
		localStorage.setItem('kurumi-last-auto-digest', today);
		// Nor last week's automatic review note (weekly-review.ts).
		const monday = new Date(d);
		monday.setDate(d.getDate() - ((d.getDay() + 6) % 7) - 7);
		localStorage.setItem('kurumi-last-auto-review', iso(monday));
		localStorage.setItem('kurumi-theme', theme);
		// No model downloads while taking pictures.
		localStorage.setItem('kurumi-local-inference', JSON.stringify({ preloadOnStartup: false }));
	}, THEME);

	if (DESIGN) {
		await designSet(page);
		process.exitCode = 0;
	} else {
		await docsSet(page);
	}
} finally {
	await browser?.close();
	try {
		process.kill(-server.pid);
	} catch {
		server.kill();
	}
	rmSync(profile, { recursive: true, force: true });
}

/** The app shell, for a design review: the same screens in every run. */
async function designSet(page) {
	const notesOnly = !!FONT;
	await go(page, '/');
	await mainIncludes(page, 'Welcome to Kurumi');
	await clickText(page, 'main button', 'explore an example');
	await page.waitForFunction(() => document.querySelector('[aria-label="Note title"]')?.value === 'Start here', { timeout: 15_000 });
	if (FONT) {
		// As Settings → Appearance → Editor font does.
		await page.evaluate((font) => localStorage.setItem('kurumi-editor-font', font), FONT);
		await page.reload({ waitUntil: 'load' });
		await page.waitForFunction(() => document.querySelector('[aria-label="Note title"]')?.value === 'Start here', { timeout: 15_000 });
	}
	await sleep(1500);
	await shot(page, 'note');

	// A second note beside it.
	const other = () => page.evaluate(() => !![...document.querySelectorAll('.note-row')].find((r) => !r.textContent.includes('Start here')));
	// The example's other notes are in folders: open the first.
	if (!(await other())) {
		await page.click('.folder-row');
		await sleep(400);
	}
	await page.evaluate(() => {
		const row = [...document.querySelectorAll('.note-row')].find((r) => !r.textContent.includes('Start here'));
		row.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, altKey: true }));
	});
	await page.waitForSelector('.split-pane .ProseMirror', { timeout: 15_000 });
	await sleep(800);
	await shot(page, 'split');
	await page.click('button[aria-label="Close split view"]');

	if (!notesOnly) {
		await page.keyboard.down(MOD);
		await page.keyboard.press('Backslash');
		await page.keyboard.up(MOD);
		await sleep(600);
		await shot(page, 'sidebar-collapsed');
		await page.keyboard.down(MOD);
		await page.keyboard.press('Backslash');
		await page.keyboard.up(MOD);

		await go(page, '/projects');
		await page.waitForFunction(() => [...document.querySelectorAll('main a')].some((a) => a.textContent.includes('Falcon launch')), { timeout: 10_000 });
		await clickText(page, 'main a', 'Falcon launch');
		await mainIncludes(page, 'Which SSO vendor fits our budget?');
		await shot(page, 'project');

		await go(page, '/actions');
		await sleep(800);
		await shot(page, 'todos');

		await go(page, '/graph');
		await sleep(2500);
		for (let i = 0; i < 3; i++) {
			await page.click('button[aria-label="Zoom out"]').catch(() => {});
			await sleep(300);
		}
		await sleep(800);
		await shot(page, 'graph');

		await go(page, '/settings/appearance');
		await sleep(800);
		await shot(page, 'settings');

		await go(page, '/');
		await mainIncludes(page, 'Ask Kurumi');
		await shot(page, 'home');
		await page.keyboard.down(MOD);
		await page.keyboard.press('k');
		await page.keyboard.up(MOD);
		await sleep(400);
		await page.keyboard.type('falcon');
		await sleep(800);
		await capture(page, 'command-palette');
		console.log(`  ✓ ${fileOf('command-palette')}`);
		await page.keyboard.press('Escape');
	}

	// A phone.
	await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
	if (!notesOnly) {
		await go(page, '/');
		await mainIncludes(page, 'Ask Kurumi');
		await shot(page, 'home-phone');
	}
	await go(page, '/');
	const noteId = await page.evaluate(() => JSON.parse(localStorage.getItem('kurumi-recent-notes') ?? '[]')[0]);
	await go(page, `/memory/${noteId}`);
	await page.waitForSelector('main .ProseMirror', { timeout: 15_000 });
	await sleep(1200);
	await shot(page, 'note-phone');
}

async function docsSet(page) {

	await go(page, '/');
	await mainIncludes(page, 'Welcome to Kurumi');
	await shot(page, 'welcome');

	await clickText(page, 'main button', 'explore an example');
	await page.waitForFunction(() => document.querySelector('[aria-label="Note title"]')?.value === 'Start here', { timeout: 15_000 });
	await sleep(1500);
	await shot(page, 'note');

	await go(page, '/projects');
	await page.waitForFunction(() => [...document.querySelectorAll('main a')].some((a) => a.textContent.includes('Falcon launch')), { timeout: 10_000 });
	await clickText(page, 'main a', 'Falcon launch');
	await mainIncludes(page, 'Which SSO vendor fits our budget?');
	await shot(page, 'project');

	await go(page, '/meetings');
	await mainIncludes(page, 'Falcon weekly');
	await clickText(page, 'main a', 'Falcon weekly');
	await sleep(800);
	await shot(page, 'meeting-series');

	await go(page, '/actions');
	await sleep(800);
	await shot(page, 'todos');

	await go(page, '/people/Ana%20Ruiz');
	await mainIncludes(page, 'Ana Ruiz');
	await shot(page, 'person');

	await go(page, '/references');
	await sleep(500);
	await clickText(page, 'main button', 'Dates');
	await shot(page, 'references-dates');

	await go(page, '/graph');
	await sleep(2500);
	// Four notes fill the screen at the default zoom.
	for (let i = 0; i < 3; i++) {
		await page.click('button[aria-label="Zoom out"]').catch(() => {});
		await sleep(300);
	}
	await sleep(800);
	await shot(page, 'graph');

	await go(page, '/');
	await mainIncludes(page, 'Ask Kurumi');
	await shot(page, 'home');
	await page.keyboard.down(MOD);
	await page.keyboard.press('k');
	await page.keyboard.up(MOD);
	await sleep(400);
	await page.keyboard.type('falcon');
	await sleep(800);
	await capture(page, 'command-palette');
	console.log(`  ✓ ${fileOf('command-palette')}`);
	await page.keyboard.press('Escape');

	await go(page, '/settings/sync');
	await mainIncludes(page, 'Use Kurumi on another device');
	await shot(page, 'settings-sync');

	await go(page, '/settings/offline');
	await mainIncludes(page, 'Offline');
	await shot(page, 'settings-offline');
}
