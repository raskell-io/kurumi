#!/usr/bin/env node
/**
 * Browser smoke tests for the flows that type checks can't catch (popups
 * that render but can't be clicked, state that doesn't persist, …).
 *
 *   npm run test:e2e
 *
 * Starts `vite dev` on a spare port, drives a fresh headless Chrome profile
 * through each scenario and exits non-zero on the first failure. Set
 * CHROME_PATH to use a specific Chrome; otherwise puppeteer's bundled one
 * is tried, then the system Chrome on macOS.
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';

const PORT = Number(process.env.E2E_PORT ?? 5299);
const BASE = `http://localhost:${PORT}`;
const MAC_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------ harness

function startServer() {
	const server = spawn('npx', ['vite', 'dev', '--port', String(PORT), '--strictPort'], {
		stdio: ['ignore', 'pipe', 'pipe']
	});
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('vite dev did not start')), 60_000);
		server.stdout.on('data', (chunk) => {
			if (chunk.toString().includes(`localhost:${PORT}`)) {
				clearTimeout(timer);
				resolve(server);
			}
		});
		server.on('exit', (code) => reject(new Error(`vite dev exited (${code})`)));
	});
}

async function launchBrowser(profileDir) {
	const options = { headless: true, userDataDir: profileDir };
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

/** Fresh browser profile + page at the app root, with errors collected. */
async function freshPage(browser) {
	const context = await browser.createBrowserContext();
	const page = await context.newPage();
	await page.setViewport({ width: 1400, height: 900 });
	const errors = [];
	page.on('pageerror', (err) => errors.push(err.message));
	await page.goto(BASE, { waitUntil: 'load' });
	await page.waitForSelector('aside');
	await sleep(800);
	return { page, errors, context };
}

// Click the first element matching `selector` whose text includes `text`.
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
	assert.ok(found, `no ${selector} containing "${text}"`);
	await sleep(250);
}

// Real pointer click at the element's centre, but first assert that the
// element is actually what's on top there (catches menus hidden behind
// other panes).
async function clickOnTop(page, selector, text) {
	const point = await page.evaluate(
		(selector, text) => {
			const el = [...document.querySelectorAll(selector)].find((e) => e.textContent.includes(text));
			if (!el) return null;
			const r = el.getBoundingClientRect();
			const x = r.left + r.width / 2;
			const y = r.top + r.height / 2;
			return { x, y, onTop: el.contains(document.elementFromPoint(x, y)) };
		},
		selector,
		text
	);
	assert.ok(point, `no ${selector} containing "${text}"`);
	assert.ok(point.onTop, `${selector} "${text}" is covered by another element`);
	await page.mouse.click(point.x, point.y);
	await sleep(250);
}

async function newNote(page, title) {
	await page.keyboard.down('Meta');
	await page.keyboard.press('n');
	await page.keyboard.up('Meta');
	await page.waitForSelector('input[aria-label="Note title"]');
	await sleep(400);
	await page.click('input[aria-label="Note title"]');
	await page.keyboard.type(title);
	await sleep(600);
}

const treeRowText = (page) =>
	page.$$eval('.note-row', (rows) => rows.map((r) => r.textContent.replace(/\s+/g, ' ').trim()));

// ------------------------------------------------------------ scenarios

const scenarios = {
	async 'sidebar row menu is clickable'(browser) {
		const { page, errors } = await freshPage(browser);
		await newNote(page, 'Menu test');
		await page.hover('.note-row');
		await page.click('.note-row .row-action');
		await sleep(250);
		await clickOnTop(page, '.k-menu .k-menu-item', 'Rename');
		assert.ok(await page.$('.note-row input'), 'rename input did not appear');
		assert.deepEqual(errors, []);
	},

	async 'vault create, logo and edit'(browser) {
		const { page, errors } = await freshPage(browser);
		const trigger = 'aside button.flex.max-w-full';
		await page.click(trigger);
		await clickText(page, '.k-menu-item', 'New vault');
		await page.type('#vault-name', 'Work');
		await clickText(page, '.k-dialog button', 'Create vault');
		assert.match(await page.$eval(trigger, (b) => b.textContent), /Work/);

		await page.click(trigger);
		await clickText(page, '.k-menu-item', 'Edit “Work”');
		const png = Buffer.from(
			'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==',
			'base64'
		);
		const dir = mkdtempSync(join(tmpdir(), 'kurumi-e2e-'));
		const file = join(dir, 'logo.png');
		const { writeFileSync } = await import('node:fs');
		writeFileSync(file, png);
		await (await page.$('.k-dialog input[type=file]')).uploadFile(file);
		await sleep(500);
		await clickText(page, '.k-dialog button', 'Save');
		assert.ok(await page.$(`${trigger} img`), 'vault logo not shown');
		rmSync(dir, { recursive: true, force: true });
		assert.deepEqual(errors, []);
	},

	async 'note icon, favorites and quick switcher'(browser) {
		const { page, errors } = await freshPage(browser);
		await newNote(page, 'Beta');
		await newNote(page, 'Alpha');

		// Add an icon via the picker (search + Enter).
		await clickText(page, 'button.insert-btn', 'Icon');
		await page.keyboard.type('rocket');
		await page.keyboard.press('Enter');
		await sleep(300);
		assert.ok(await page.$('button[aria-label="Change icon"]'), 'page icon not shown above title');
		assert.ok((await treeRowText(page)).some((t) => t.includes('🚀') && t.includes('Alpha')), 'tree row has no icon');
		assert.match(await page.$eval('.tab-bar', (el) => el.textContent), /🚀/, 'tab has no icon');

		// Favorite via the header star; it appears in the sidebar section.
		await page.click('button[aria-label="Add to favorites"]');
		await sleep(300);
		assert.match(await page.$eval('#favorites-list', (el) => el.textContent), /Alpha/);

		// Unfavorite from the tree row menu; the section disappears.
		await page.evaluate(() => {
			const row = [...document.querySelectorAll('.note-row')].find((r) => r.textContent.includes('Alpha'));
			row.querySelector('.row-action').click();
		});
		await sleep(250);
		await clickOnTop(page, '.k-menu .k-menu-item', 'Remove from favorites');
		assert.equal(await page.$('#favorites-list'), null, 'favorites section still shown');

		// Persisted across reload.
		await page.click('button[aria-label="Add to favorites"]');
		await sleep(800);
		await page.reload({ waitUntil: 'load' });
		await page.waitForSelector('#favorites-list');
		assert.match(await page.$eval('#favorites-list', (el) => el.textContent), /🚀\s*Alpha/);

		// Cmd+O opens the switcher: recently opened notes first, minus the
		// one we're on, so Enter goes back to the previous note.
		await page.keyboard.down('Meta');
		await page.keyboard.press('o');
		await page.keyboard.up('Meta');
		await page.waitForSelector('[role="listbox"]');
		const items = await page.$$eval('[role="option"]', (opts) => opts.map((o) => o.textContent.replace(/\s+/g, ' ').trim()));
		assert.match(items[0], /Beta/, `first switcher item: ${items[0]}`);
		assert.match(items[0], /Recently opened/);
		assert.ok(!items.some((i) => i.includes('Alpha')), 'current note listed in switcher');
		await page.keyboard.press('Enter');
		await page.waitForFunction(() => document.querySelector('input[aria-label="Note title"]')?.value === 'Beta');
		assert.deepEqual(errors, []);
	},

	async 'wikilink hover preview shows the target'(browser) {
		const { page, errors } = await freshPage(browser);
		await newNote(page, 'Target');
		await clickText(page, 'button.insert-btn', 'Icon');
		await page.keyboard.type('idea');
		await page.keyboard.press('Enter');
		await newNote(page, 'Source');
		await page.click('.ProseMirror');
		await page.keyboard.type('See [[Target]] here');
		await sleep(500);
		await page.hover('.ProseMirror .wikilink');
		await page.waitForSelector('[role="tooltip"]', { timeout: 3000 });
		const preview = await page.$eval('[role="tooltip"]', (el) => el.textContent);
		assert.match(preview, /💡\s*Target/);
		assert.deepEqual(errors, []);
	}
};

// ------------------------------------------------------------ main

const only = process.argv[2];
const server = await startServer();
const profile = mkdtempSync(join(tmpdir(), 'kurumi-e2e-profile-'));
let browser;
let failed = 0;
try {
	browser = await launchBrowser(profile);
	for (const [name, run] of Object.entries(scenarios)) {
		if (only && !name.includes(only)) continue;
		try {
			await run(browser);
			console.log(`  ✓ ${name}`);
		} catch (err) {
			failed++;
			console.log(`  ✗ ${name}\n      ${err.message.split('\n').join('\n      ')}`);
		}
	}
} finally {
	await browser?.close();
	server.kill();
	rmSync(profile, { recursive: true, force: true });
}
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
