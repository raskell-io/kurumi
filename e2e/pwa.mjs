#!/usr/bin/env node
/**
 * Installed-app checks against a production build: the service worker
 * only exists there (it is off in `vite dev`).
 *
 *   npm run test:pwa          # builds first
 *   node e2e/pwa.mjs          # reuse an existing build/
 *
 * Serves build/ with `vite preview`, then in one headless Chrome profile:
 * manifest, share target POST, notification buttons, icon badge, Settings →
 * Offline & storage, and starting + editing with the network off.
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';

const PORT = Number(process.env.E2E_PWA_PORT ?? 5399);
const BASE = `http://localhost:${PORT}`;
const MAC_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function startServer() {
	const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
		stdio: ['ignore', 'pipe', 'pipe'],
		// Own process group: stopping it also stops vite, not just npx.
		detached: true
	});
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('vite preview did not start')), 60_000);
		server.stdout.on('data', (chunk) => {
			// Without colour codes: with CI set, vite colours the port separately.
			if (chunk.toString().replace(/\x1b\[[0-9;]*m/g, '').includes(`localhost:${PORT}`)) {
				clearTimeout(timer);
				resolve(server);
			}
		});
		server.on('exit', (code) => reject(new Error(`vite preview exited (${code})`)));
	});
}

function stopServer(server) {
	try {
		process.kill(-server.pid);
	} catch {
		server.kill();
	}
}

async function launchBrowser(profileDir) {
	// GitHub's Ubuntu runners block Chrome's sandbox (AppArmor).
	const options = { headless: true, userDataDir: profileDir, args: process.env.CI ? ['--no-sandbox'] : [] };
	const candidates = [process.env.CHROME_PATH, undefined, existsSync(MAC_CHROME) ? MAC_CHROME : null];
	let lastError;
	for (const executablePath of candidates.filter((c) => c !== null)) {
		try {
			return await puppeteer.launch({ ...options, ...(executablePath ? { executablePath } : {}) });
		} catch (err) {
			lastError = err;
		}
	}
	throw lastError;
}

const mainText = (page) => page.$eval('main', (e) => e.innerText);

const checks = {
	async 'service worker installs and precaches the app'(page) {
		await page.waitForFunction(async () => !!(await navigator.serviceWorker.ready).active, { timeout: 60_000 });
		await page.waitForFunction(async () => (await caches.keys()).some((k) => k.includes('precache')), { timeout: 60_000 });
		await page.reload({ waitUntil: 'load' }); // now controlled by the service worker
		await page.waitForFunction(() => !!navigator.serviceWorker.controller, { timeout: 30_000 });
	},

	async 'manifest: share target with files, shortcuts, file handlers'(page) {
		const href = await page.$eval('link[rel="manifest"]', (l) => l.href);
		const manifest = await page.evaluate((href) => fetch(href).then((r) => r.json()), href);
		assert.equal(manifest.share_target.method, 'POST');
		assert.equal(manifest.share_target.params.files[0].name, 'share_files');
		assert.deepEqual(
			manifest.shortcuts.map((s) => s.url),
			['/?new=note', '/#/daily', '/?new=voice', '/#/actions']
		);
		assert.deepEqual(manifest.file_handlers[0].accept['text/markdown'], ['.md', '.markdown']);
		assert.deepEqual(manifest.launch_handler, { client_mode: ['navigate-existing', 'auto'] });
		assert.ok(manifest.share_target.params.files[0].accept.includes('application/*'));
	},

	async 'share target: a POSTed file and text become a note'(page) {
		// What the OS share sheet does: a multipart POST navigation.
		await page.evaluate(() => {
			const form = Object.assign(document.createElement('form'), {
				method: 'post',
				action: '/share-target',
				enctype: 'multipart/form-data'
			});
			const add = (name, value) => form.append(Object.assign(document.createElement('input'), { name, value }));
			add('share_title', 'Shared from phone');
			add('share_text', 'Look at this');
			const file = Object.assign(document.createElement('input'), { type: 'file', name: 'share_files' });
			const dt = new DataTransfer();
			dt.items.add(new File(['# Hello\n\nfrom a file'], 'hello.md', { type: 'text/markdown' }));
			dt.items.add(new File(['%PDF-1.4\n%fake'], 'contract.pdf', { type: 'application/pdf' }));
			file.files = dt.files;
			form.append(file);
			document.body.append(form);
			form.submit();
		});
		await page.waitForFunction(() => location.hash.startsWith('#/memory/'), { timeout: 20_000 });
		await page.waitForFunction(() => document.querySelector('input[aria-label="Note title"]')?.value === 'Shared from phone', { timeout: 10_000 });
		// The PDF is an attachment chip in that note
		await page.waitForFunction(() => document.querySelector('main .ProseMirror a[href^="blob:"]')?.textContent === 'contract.pdf', { timeout: 10_000 });
		await page.goto(`${BASE}/#/read`, { waitUntil: 'load' });
		await page.waitForFunction(() => document.body.innerText.includes('Hello'), { timeout: 10_000 });
	},

	async 'due to-dos: notification with Mark done / Snooze, and the icon badge'(page, context) {
		await context.overridePermissions(BASE, ['notifications']);
		await page.evaluate(() => localStorage.setItem('kurumi-notifications-enabled', 'true'));
		await page.goto(`${BASE}/#/actions`, { waitUntil: 'load' });
		await page.waitForSelector('main', { timeout: 20_000 });
		await page.waitForFunction(() => [...document.querySelectorAll('main button')].some((b) => b.textContent.trim() === 'New'), { timeout: 20_000 });
		await page.evaluate(() => [...document.querySelectorAll('main button')].find((b) => b.textContent.trim() === 'New').click());
		await page.waitForSelector('input[aria-label="To-do"]');
		await page.type('input[aria-label="To-do"]', 'Pay the invoice');
		await page.$eval('input[aria-label="Due date"]', (input) => {
			const d = new Date();
			input.value = [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
			input.dispatchEvent(new Event('input', { bubbles: true }));
		});
		await page.evaluate(() => [...document.querySelectorAll('main button')].find((b) => b.textContent.trim() === 'Create').click());
		await page.waitForFunction(() => window.__badges.includes(1), { timeout: 10_000 });
		// The notification loop starts at boot when notifications are on.
		await sleep(1500);
		await page.reload({ waitUntil: 'load' });
		await page.waitForSelector('aside', { timeout: 20_000 });
		// Poll from here: the app's boot navigation can cut a waitForFunction short.
		let actions = null;
		for (let i = 0; i < 40 && !actions; i++) {
			await sleep(500);
			actions = await page
				.evaluate(async () => {
					const reg = await navigator.serviceWorker.ready;
					const n = (await reg.getNotifications()).find((n) => n.body === 'Pay the invoice');
					return n ? n.actions.map((a) => a.action).join(',') : null;
				})
				.catch(() => null);
		}
		assert.equal(actions, 'done,snooze');
	},

	async 'settings: works offline, version shown'(page) {
		await page.goto(`${BASE}/#/settings/offline`, { waitUntil: 'load' });
		await page.waitForSelector('#offline-title', { timeout: 20_000 });
		await page.waitForFunction(() => document.querySelector('main').innerText.includes('starts without a connection'), { timeout: 10_000 });
		assert.match(await mainText(page), /Version[\s\S]*\d+\.\d+\.\d+ · /);
	},

	async 'offline: starts, navigates, and keeps a note written offline'(page) {
		await page.setOfflineMode(true);
		await page.goto(`${BASE}/`, { waitUntil: 'load' });
		await page.waitForSelector('aside', { timeout: 20_000 });
		for (const path of ['/#/actions', '/#/projects', '/#/references?tab=dates']) {
			await page.goto(BASE + path, { waitUntil: 'load' });
			await page.waitForFunction(() => (document.querySelector('main')?.innerText.length ?? 0) > 20, { timeout: 20_000 });
		}
		await page.goto(`${BASE}/?new=note`, { waitUntil: 'load' });
		await page.waitForSelector('input[aria-label="Note title"]', { timeout: 20_000 });
		await page.click('input[aria-label="Note title"]', { clickCount: 3 });
		await page.keyboard.type('Written offline');
		await sleep(1500);
		await page.reload({ waitUntil: 'load' });
		await page.waitForFunction(() => document.body.innerText.includes('Written offline'), { timeout: 20_000 });
		await page.setOfflineMode(false);
	}
};

const only = process.argv[2];
const server = await startServer();
const profile = mkdtempSync(join(tmpdir(), 'kurumi-pwa-profile-'));
let browser;
let failed = 0;
try {
	browser = await launchBrowser(profile);
	const context = browser.defaultBrowserContext();
	const page = await browser.newPage();
	await page.setViewport({ width: 1400, height: 900 });
	// Record icon badge updates (there's no way to read the badge back).
	await page.evaluateOnNewDocument(() => {
		window.__badges = [];
		navigator.setAppBadge = async (n) => void window.__badges.push(n ?? 0);
		navigator.clearAppBadge = async () => void window.__badges.push(0);
	});
	const errors = [];
	page.on('pageerror', (err) => errors.push(err.message));
	await page.goto(BASE, { waitUntil: 'load' });
	await page.waitForSelector('aside');
	for (const [name, run] of Object.entries(checks)) {
		if (only && !name.includes(only)) continue;
		try {
			await run(page, context);
			console.log(`  ✓ ${name}`);
		} catch (err) {
			failed++;
			console.log(`  ✗ ${name}\n      ${err.message.split('\n').join('\n      ')}`);
		}
	}
	if (errors.length) {
		failed++;
		console.log(`  ✗ page errors\n      ${errors.join('\n      ')}`);
	}
} finally {
	await browser?.close();
	stopServer(server);
	rmSync(profile, { recursive: true, force: true });
}
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
