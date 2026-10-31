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
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer';

const PORT = Number(process.env.E2E_PORT ?? 5298);
const BASE = `http://localhost:${PORT}`;
const MAC_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const THEME = process.env.THEME === 'dark' ? 'dark' : 'light';
const OUT = new URL('../docs/images/', import.meta.url).pathname;
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function startServer() {
	const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
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
	const file = join(OUT, `${name}${THEME === 'dark' ? '-dark' : ''}.webp`);
	await page.screenshot({ path: file, type: 'webp', quality: 85 });
	console.log(`  ✓ ${file.replace(OUT, 'docs/images/')}`);
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
		const d = new Date();
		const today = [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
		localStorage.setItem('kurumi-last-auto-digest', today);
		localStorage.setItem('kurumi-theme', theme);
		// No model downloads while taking pictures.
		localStorage.setItem('kurumi-local-inference', JSON.stringify({ preloadOnStartup: false }));
	}, THEME);

	await go(page, '/');
	await mainIncludes(page, 'Welcome to Kurumi');
	await shot(page, 'welcome');

	await clickText(page, 'main button', 'explore an example');
	await page.waitForFunction(() => document.querySelector('input[aria-label="Note title"]')?.value === 'Start here', { timeout: 15_000 });
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
	await page.screenshot({ path: join(OUT, `command-palette${THEME === 'dark' ? '-dark' : ''}.webp`), type: 'webp', quality: 85 });
	console.log('  ✓ docs/images/command-palette');
	await page.keyboard.press('Escape');

	await go(page, '/settings/sync');
	await mainIncludes(page, 'Kurumi server');
	await shot(page, 'settings-sync');

	await go(page, '/settings/offline');
	await mainIncludes(page, 'Offline');
	await shot(page, 'settings-offline');
} finally {
	await browser?.close();
	try {
		process.kill(-server.pid);
	} catch {
		server.kill();
	}
	rmSync(profile, { recursive: true, force: true });
}
