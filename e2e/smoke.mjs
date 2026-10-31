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
import JSZip from 'jszip';
import { writeFileSync } from 'node:fs';
import { createServer } from 'node:http';

const PORT = Number(process.env.E2E_PORT ?? 5299);
const BASE = `http://localhost:${PORT}`;
const MAC_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// The app's "mod" key: ⌘ on macOS, Ctrl elsewhere.
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

// ------------------------------------------------------------ harness

function startServer() {
	const server = spawn('npx', ['vite', 'dev', '--port', String(PORT), '--strictPort'], {
		stdio: ['ignore', 'pipe', 'pipe'],
		// Own process group: stopping it also stops vite, not just npx.
		detached: true
	});
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('vite dev did not start')), 60_000);
		server.stdout.on('data', (chunk) => {
			// Without colour codes: with CI set, vite colours the port separately.
			if (chunk.toString().replace(/\x1b\[[0-9;]*m/g, '').includes(`localhost:${PORT}`)) {
				clearTimeout(timer);
				resolve(server);
			}
		});
		server.on('exit', (code) => reject(new Error(`vite dev exited (${code})`)));
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
	// GitHub's Ubuntu runners block Chrome's sandbox (AppArmor). HEADFUL=1
	// (CI runs it under xvfb-run): headless Chrome on Linux has no mouse,
	// reports (hover: none), and the app then hides its hover UI.
	const options = {
		headless: !process.env.HEADFUL,
		userDataDir: profileDir,
		args: [
			...(process.env.CI ? ['--no-sandbox'] : []),
			// Room for the 1400x900 viewport the scenarios set.
			...(process.env.HEADFUL ? ['--window-size=1600,1000'] : [])
		]
	};
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

// Contexts opened by the running scenario; closed when it ends, so earlier
// scenarios' app instances (timers, workers) don't pile up and stall Chrome.
const openContexts = [];

/** Fresh browser profile + page at the app root, with errors collected. */
async function freshPage(browser) {
	const context = await browser.createBrowserContext();
	openContexts.push(context);
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
	await page.keyboard.down(MOD);
	await page.keyboard.press('n');
	await page.keyboard.up(MOD);
	await page.waitForSelector('input[aria-label="Note title"]');
	await sleep(400);
	await page.click('input[aria-label="Note title"]');
	await page.keyboard.type(title);
	await sleep(600);
}

async function press(page, ...keys) {
	for (const k of keys.slice(0, -1)) await page.keyboard.down(k);
	await page.keyboard.press(keys[keys.length - 1]);
	for (const k of keys.slice(0, -1).reverse()) await page.keyboard.up(k);
	await sleep(300);
}

// Run code against the app's own store module (the instance the page uses)
// with `db` (src/lib/db/store.ts) and `kv` (idb-keyval) in scope.
async function db(page, source, arg) {
	return page.evaluate(
		async (source, arg) => {
			const url = performance
				.getEntriesByType('resource')
				.map((e) => e.name)
				.find((n) => n.includes('/src/lib/db/store.ts'));
			const db = await import(url);
			const kv = await import('/node_modules/idb-keyval/dist/index.js');
			return new Function('db', 'kv', 'arg', `return (async () => {${source}})()`)(db, kv, arg);
		},
		source,
		arg
	);
}

const bodyOf = (page, title) =>
	db(page, `let ms; db.allMemoryObjects.subscribe((v) => (ms = v))(); return ms.find((m) => m.title === arg)?.bodyMarkdown ?? null;`, title);

async function typeInEditor(page, text, selector = 'main .ProseMirror') {
	await page.click(selector);
	await press(page, MOD, 'End');
	await page.keyboard.type(text);
	await sleep(700); // editor debounce + autosave
}

const editorHtml = (page, selector = 'main .ProseMirror') =>
	page.$eval(selector, (e) => e.innerHTML.replace(/ (class|id|data-(?!item-type|checked)[\w-]+|contenteditable|draggable|style|aria-[\w-]+)="[^"]*"/g, ''));

const treeRowText = (page) =>
	page.$$eval('.note-row', (rows) => rows.map((r) => r.textContent.replace(/\s+/g, ' ').trim()));

// The real sync worker (worker/src/index.ts) behind a local HTTP server,
// with an in-memory R2 bucket.
async function startSyncServer(port, appUrl) {
	const { default: worker } = await import('../worker/src/index.ts');
	const objects = new Map();
	const bucket = {
		objects,
		async get(key) {
			const o = objects.get(key);
			return o && { body: o.body, httpEtag: '"x"', httpMetadata: { contentType: o.contentType }, text: async () => new TextDecoder().decode(o.body) };
		},
		async put(key, value, opts) {
			const body = typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value);
			objects.set(key, { body, contentType: opts?.httpMetadata?.contentType });
		}
	};
	const env = { KURUMI_BUCKET: bucket, KURUMI_APP_URL: appUrl };
	const server = createServer(async (req, res) => {
		const chunks = [];
		for await (const c of req) chunks.push(c);
		const body = ['GET', 'HEAD', 'OPTIONS'].includes(req.method) ? undefined : Buffer.concat(chunks);
		const response = await worker.fetch(new Request(`http://localhost:${port}${req.url}`, { method: req.method, headers: req.headers, body }), env);
		res.writeHead(response.status, Object.fromEntries(response.headers));
		res.end(Buffer.from(await response.arrayBuffer()));
	});
	await new Promise((r) => server.listen(port, r));
	return { bucket, close: () => new Promise((r) => server.close(r)) };
}

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
		await page.keyboard.down(MOD);
		await page.keyboard.press('o');
		await page.keyboard.up(MOD);
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
	},

	async 'note lifecycle: create, rename, trash, restore, search'(browser) {
		const { page, errors } = await freshPage(browser);
		await newNote(page, 'Quarterly plan');
		await typeInEditor(page, 'Budget for Falcon');
		// Rename through the title field
		await page.click('input[aria-label="Note title"]', { clickCount: 3 });
		await page.keyboard.type('Q3 plan');
		await sleep(700);
		assert.ok((await treeRowText(page)).includes('Q3 plan'), 'rename not reflected in the tree');
		// Search finds it
		await page.click('.note-header');
		await press(page, MOD, 'k');
		await page.keyboard.type('falcon');
		await sleep(400);
		const hits = await page.$$eval('[role="option"]', (o) => o.map((x) => x.textContent));
		assert.ok(hits.some((h) => h.includes('Q3 plan')), `search results: ${hits}`);
		await page.keyboard.press('Escape');
		// Trash from the note menu, then restore from Trash
		await page.click('button[aria-label="More actions"]');
		await clickText(page, '.k-menu-item', 'Move to trash');
		await sleep(500);
		assert.ok(!(await treeRowText(page)).includes('Q3 plan'), 'note still in tree after trash');
		await page.goto(`${BASE}/trash`, { waitUntil: 'load' });
		await sleep(800);
		await page.click('button[aria-label="Restore Q3 plan"]');
		await sleep(500);
		assert.ok((await treeRowText(page)).includes('Q3 plan'), 'note not restored');
		assert.equal(await bodyOf(page, 'Q3 plan'), 'Budget for Falcon\n');
		assert.deepEqual(errors, []);
	},

	async 'editor: slash commands, block handle, tasks, paste link'(browser) {
		const { page, errors } = await freshPage(browser);
		await newNote(page, 'Blocks');
		await page.click('main .ProseMirror');
		for (const [cmd, text] of [['/heading 2', 'Title'], ['/checkbox', 'Call Sam'], ['/quote', 'Quoted']]) {
			await page.keyboard.type(cmd);
			await sleep(300);
			await page.keyboard.press('Enter');
			await page.keyboard.type(text);
			await page.keyboard.press('Enter');
			await page.keyboard.press('Enter');
			await page.keyboard.press('Enter');
		}
		await page.keyboard.type('Read the docs here');
		await sleep(700);
		let html = await editorHtml(page);
		assert.match(html, /<h2>Title<\/h2>/, html);
		assert.match(html, /data-item-type="task"[^>]*data-checked="false"><p>Call Sam/, html);
		assert.match(html, /<blockquote><p>Quoted/, html);

		// Block handle: hover the paragraph, ⋮⋮ → Turn into Heading 3
		const para = await page.evaluate(() => {
			const p = [...document.querySelectorAll('main .ProseMirror > p')].find((x) => x.textContent.includes('Read the docs'));
			const r = p.getBoundingClientRect();
			return { x: r.left + 20, y: r.top + r.height / 2 };
		});
		await page.mouse.move(para.x, para.y);
		await sleep(500);
		const grip = await page.evaluate(() => {
			const r = document.querySelector('.bh-grip').getBoundingClientRect();
			return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
		});
		await page.mouse.click(grip.x, grip.y);
		await sleep(300);
		await clickOnTop(page, '.k-menu .k-menu-item', 'Heading 3');
		assert.match(await editorHtml(page), /<h3>Read the docs here<\/h3>/);

		// Tick the to-do
		const box = await page.evaluate(() => {
			const r = document.querySelector('main li[data-item-type="task"]').getBoundingClientRect();
			return { x: r.left + 8, y: r.top + 12 };
		});
		await page.mouse.click(box.x, box.y);
		await sleep(700);

		// Paste a URL onto selected text. The word is selected directly:
		// a double-click doesn't select under Linux/X11 (CI).
		await page.evaluate(() => {
			const editor = document.querySelector('main .ProseMirror');
			editor.focus();
			const h = editor.querySelector('h3').firstChild;
			const i = h.textContent.indexOf('docs');
			const r = document.createRange();
			r.setStart(h, i);
			r.setEnd(h, i + 4);
			const sel = getSelection();
			sel.removeAllRanges();
			sel.addRange(r);
		});
		await sleep(200); // ProseMirror reads the DOM selection on selectionchange
		await page.evaluate(() => {
			const dt = new DataTransfer();
			dt.setData('text/plain', 'https://example.com/docs');
			document.querySelector('main .ProseMirror').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
		});
		await sleep(900);
		const md = await bodyOf(page, 'Blocks');
		assert.match(md, /## Title/);
		assert.match(md, /- \[x\] Call Sam/);
		assert.match(md, /> Quoted/);
		assert.match(md, /### Read the \[docs\]\(https:\/\/example\.com\/docs\) here/);
		assert.deepEqual(errors, []);
	},

	async 'find and replace across notes, with undo'(browser) {
		const { page, errors } = await freshPage(browser);
		await newNote(page, 'Other');
		await typeInEditor(page, 'Project Falcon kickoff');
		await newNote(page, 'Main');
		await typeInEditor(page, 'Falcon is the plan. falcon again.');
		await press(page, MOD, 'Alt', 'KeyF');
		await page.keyboard.type('falcon');
		await sleep(300);
		assert.equal(await page.$$eval('main .find-match', (m) => m.length), 2);
		await page.type('input[aria-label="Replace with"]', 'Osprey');
		await clickText(page, '.find-bar button', 'Replace in all notes');
		await clickText(page, '.find-bar button', 'Replace all');
		await sleep(900);
		assert.equal(await bodyOf(page, 'Main'), 'Osprey is the plan. Osprey again.\n');
		assert.equal(await bodyOf(page, 'Other'), 'Project Osprey kickoff\n');
		await page.keyboard.press('Escape');
		await page.click('.note-header');
		await press(page, MOD, 'z');
		await sleep(600);
		assert.equal(await bodyOf(page, 'Other'), 'Project Falcon kickoff\n', 'undo did not restore the other note');
		assert.deepEqual(errors, []);
	},

	async 'embedded note renders live'(browser) {
		const { page, errors } = await freshPage(browser);
		await newNote(page, 'Specs');
		await typeInEditor(page, 'Must work offline');
		await newNote(page, 'Overview');
		await typeInEditor(page, '![[Specs]]');
		await page.waitForSelector('main .note-embed', { timeout: 3000 });
		assert.match(await page.$eval('main .note-embed', (e) => e.textContent), /Must work offline/);
		await db(page, `let ms; db.allMemoryObjects.subscribe((v) => (ms = v))(); const s = ms.find((m) => m.title === 'Specs'); db.updateMemoryObject(s.id, { bodyMarkdown: 'Updated spec' });`);
		await sleep(400);
		assert.match(await page.$eval('main .note-embed', (e) => e.textContent), /Updated spec/);
		assert.deepEqual(errors, []);
	},

	async 'split view edits the right note and never loses text'(browser) {
		const { page, errors } = await freshPage(browser);
		await newNote(page, 'Beta');
		await typeInEditor(page, 'Beta body');
		await newNote(page, 'Alpha');
		await typeInEditor(page, 'Alpha body');
		await page.evaluate(() => {
			const row = [...document.querySelectorAll('.note-row')].find((r) => r.textContent.includes('Beta'));
			row.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, altKey: true }));
		});
		await page.waitForSelector('.split-pane .ProseMirror');
		await sleep(500);
		assert.match(await page.$eval('.split-pane .ProseMirror', (e) => e.textContent), /Beta body/, 'split pane opened empty');
		await typeInEditor(page, ' plus split', '.split-pane .ProseMirror');
		await typeInEditor(page, ' plus main');
		await sleep(400);
		assert.equal(await bodyOf(page, 'Beta'), 'Beta body plus split\n');
		assert.equal(await bodyOf(page, 'Alpha'), 'Alpha body plus main\n');
		// Slash menus still work in the main editor after the split closes
		await page.click('button[aria-label="Close split view"]');
		await page.click('main .ProseMirror');
		await press(page, MOD, 'End');
		await page.keyboard.press('Enter');
		await page.keyboard.type('/quote');
		await sleep(300);
		await page.keyboard.press('Enter');
		await page.keyboard.type('Q');
		await sleep(300);
		assert.match(await editorHtml(page), /<blockquote>/);
		assert.deepEqual(errors, []);
	},

	async 'action board moves items between columns'(browser) {
		const { page, errors } = await freshPage(browser);
		await db(page, `db.addActionItem({ text: 'Book venue', assignee: 'Ana' }); db.addActionItem({ text: 'Draft brief', assignee: 'Sam' });`);
		await page.goto(`${BASE}/actions`, { waitUntil: 'load' });
		await sleep(800);
		await clickText(page, '.k-segmented button', 'Board');
		const column = (i) => page.$$eval('.board-col', (cs, i) => [...cs[i].querySelectorAll('.board-card-text')].map((t) => t.textContent), i);
		assert.deepEqual((await column(0)).sort(), ['Book venue', 'Draft brief']);
		await page.evaluate(() => {
			const card = [...document.querySelectorAll('.board-card')].find((c) => c.textContent.includes('Book venue'));
			card.querySelector('button[title="Move right"]').click();
		});
		await sleep(300);
		assert.deepEqual(await column(1), ['Book venue']);
		await page.select('select[aria-label="Filter by assignee"]', 'Sam');
		await sleep(200);
		assert.deepEqual(await column(1), []);
		assert.deepEqual(errors, []);
	},

	async 'shortcuts can be rebound; Labs toggles its section'(browser) {
		const { page, errors } = await freshPage(browser);
		await page.goto(`${BASE}/settings/shortcuts`, { waitUntil: 'load' });
		await page.waitForFunction(() => document.querySelectorAll('#shortcuts .set-row').length > 10);
		const rows = await page.$$eval('#shortcuts .set-row', (rs) => rs.map((r) => r.textContent.replace(/\s+/g, ' ').trim()));
		assert.ok(rows.some((r) => r.includes('Graph')), `shortcut rows: ${JSON.stringify(rows)} at ${page.url()}`);
		await page.evaluate(() => {
			const row = [...document.querySelectorAll('#shortcuts .set-row')].find((r) => r.textContent.includes('Graph'));
			row.querySelector('button').click();
		});
		await press(page, MOD, 'Shift', 'g');
		await page.click('#shortcuts-title');
		await press(page, MOD, 'g');
		assert.ok(!page.url().includes('graph'), 'old binding still active');
		await press(page, MOD, 'Shift', 'g');
		assert.ok(page.url().includes('graph'), 'new binding not active');
		await page.goto(`${BASE}/settings/labs`, { waitUntil: 'load' });
		await page.waitForSelector('#labs input[type=checkbox]');
		assert.equal(await page.$('#labs-list'), null);
		await page.evaluate(() => document.querySelector('#labs input[type=checkbox]').click());
		await sleep(300);
		await clickText(page, 'button.section-label', 'Labs');
		assert.match(await page.$eval('#labs-list', (e) => e.textContent), /Habits/);
		assert.deepEqual(errors, []);
	},

	async 'settings: one page per section, About explains Kurumi'(browser) {
		const { page, errors } = await freshPage(browser);
		await page.goto(`${BASE}/settings`, { waitUntil: 'load' });
		await page.waitForSelector('.settings-nav-link');
		const shown = () => page.$$eval('section.set-section', (s) => s.map((x) => x.id));
		const active = () => page.$eval('.settings-nav-link[aria-current="page"]', (e) => e.textContent.trim());
		assert.deepEqual(await shown(), ['appearance']);
		for (const [label, id] of [['About', 'about'], ['Danger zone', 'danger'], ['Sync', 'sync']]) {
			await clickText(page, '.settings-nav-link', label);
			await page.waitForFunction((id) => location.hash === `#/settings/${id}`, {}, id);
			assert.deepEqual(await shown(), [id]);
			assert.equal(await active(), label);
		}
		await page.goto(`${BASE}/settings/about`, { waitUntil: 'load' });
		await page.waitForSelector('.about-headline');
		const about = await page.$eval('#about', (e) => e.textContent);
		assert.match(about, /local-first second brain/);
		// The real build version (package · commit · date), not a fixed string
		assert.match(about, /Kurumi \d+\.\d+\.\d+ · [0-9a-f]{7,} · \d{4}-\d{2}-\d{2}/);
		assert.deepEqual(errors, []);
	},

	async 'home: quick capture, new note, and the to-do card'(browser) {
		const { page, errors } = await freshPage(browser);
		await db(page, `
			const today = new Date().toISOString().slice(0, 10);
			db.addMemoryObject('Plan', '- [ ] Send budget\\n- [x] Done already\\n');
			db.addActionItem({ text: 'Standup notes', dueDate: today, recurrence: 'daily' });
			db.addActionItem({ text: 'Someday task' });
		`);
		await page.goto(BASE, { waitUntil: 'load' });
		await page.waitForSelector('.todo-row');
		const rows = () => page.$$eval('.todo-row', (r) => r.map((x) => x.textContent.replace(/\s+/g, ' ').trim()));
		assert.deepEqual((await rows()).map((r) => r.split(' ').slice(0, 2).join(' ')), ['Standup notes', 'Someday task', 'Send budget']);
		// Quick capture saves without leaving the page
		await page.click('.capture-input');
		await page.keyboard.type('Call the bank');
		await page.keyboard.press('Enter');
		await page.waitForSelector('[role=status]');
		assert.ok(page.url().endsWith('/#/'), page.url());
		assert.equal(await bodyOf(page, 'Call the bank'), '');
		// Ticking: recurring item rolls over; note task is checked in the note
		await page.evaluate(() => [...document.querySelectorAll('.todo-row')].find((r) => r.textContent.includes('Standup')).querySelector('.todo-check').click());
		await page.evaluate(() => [...document.querySelectorAll('.todo-row')].find((r) => r.textContent.includes('Send budget')).querySelector('.todo-check').click());
		await sleep(400);
		assert.match(await bodyOf(page, 'Plan'), /- \[x\] Send budget/);
		assert.ok((await rows()).some((r) => r.startsWith('Standup notes') && r.includes('Tomorrow')), 'next occurrence missing');
		// The big New note button opens a note
		await page.click('.capture-primary');
		await page.waitForSelector('input[aria-label="Note title"]');
		assert.deepEqual(errors, []);
	},

	async 'pasted images: one copy each, and a zoomable viewer'(browser) {
		const { page, errors } = await freshPage(browser);
		await newNote(page, 'Photos');
		await page.click('main .ProseMirror');
		// Image file + HTML <img>, as when copying an image in a browser
		for (const color of ['#2b6cb0', '#c05621']) {
			await page.evaluate(async (color) => {
				const c = document.createElement('canvas');
				c.width = 1600;
				c.height = 1000;
				const ctx = c.getContext('2d');
				ctx.fillStyle = color;
				ctx.fillRect(0, 0, 1600, 1000);
				const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
				const dt = new DataTransfer();
				dt.items.add(new File([blob], 'image.png', { type: 'image/png' }));
				dt.setData('text/html', '<img src="https://example.com/x.png">');
				document.querySelector('main .ProseMirror').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
			}, color);
			await sleep(1500);
		}
		const images = () => page.$$('main .ProseMirror img:not(.ProseMirror-separator)');
		assert.equal((await images()).length, 2, 'each paste should insert one image');
		assert.doesNotMatch(await bodyOf(page, 'Photos'), /example\.com/);

		const state = () => page.evaluate(() => {
			const v = document.querySelector('.viewer');
			return v ? `${v.querySelector('.viewer-percent').textContent} ${v.querySelector('.viewer-bottom span')?.textContent ?? ''}` : 'closed';
		});
		await (await images())[0].click();
		await page.waitForSelector('.viewer');
		await sleep(300);
		const fit = await state();
		assert.match(fit, /^\d+% 1 \/ 2$/, fit);
		await page.keyboard.press('+');
		assert.notEqual(await state(), fit, 'zoom did not change');
		await page.keyboard.press('0');
		assert.equal(await state(), fit);
		await page.keyboard.press('ArrowRight');
		await sleep(300);
		assert.match(await state(), / 2 \/ 2$/);
		await page.keyboard.press('Escape');
		assert.equal(await state(), 'closed');
		assert.equal((await images()).length, 2, 'opening the viewer changed the note');
		assert.deepEqual(errors, []);
	},

	async 'attachments open from the note, and edits survive a reload'(browser) {
		const { page, errors, context } = await freshPage(browser);
		await newNote(page, 'Files');
		await page.click('main .ProseMirror');
		await page.evaluate(() => {
			const dt = new DataTransfer();
			dt.items.add(new File(['%PDF-1.4\n%fake'], 'brief.pdf', { type: 'application/pdf' }));
			document.querySelector('main .ProseMirror').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
		});
		const chip = await page.waitForSelector('main .ProseMirror a[href^="blob:"]');
		assert.equal(await chip.evaluate((a) => a.textContent), 'brief.pdf');
		// The cursor ends up after the link
		await page.keyboard.type('signed');
		await page.waitForFunction(() => /brief\.pdf\s+signed/.test(document.querySelector('main .ProseMirror').textContent));
		await sleep(700);
		assert.match(await bodyOf(page, 'Files'), /\[brief\.pdf\]\(blob:[0-9A-Za-z]+\) signed/);
		// Clicking opens the stored file in a new tab
		const opened = context.waitForTarget((t) => t.url().startsWith('blob:http'), { timeout: 10_000 });
		await chip.click();
		await (await (await opened).page())?.close();
		// Read mode too
		const id = await page.evaluate(() => location.hash.split('/').pop());
		await page.goto(`${BASE}/read/${id}`, { waitUntil: 'load' });
		const readChip = await page.waitForSelector('main a[href^="blob:"]');
		const openedAgain = context.waitForTarget((t) => t.url().startsWith('blob:http'), { timeout: 10_000 });
		await readChip.click();
		await (await (await openedAgain).page())?.close();
		// A file another device attached that hasn't synced here: a notice
		await db(page, `db.addMemoryObject('Elsewhere', '[minutes.docx](blob:notSyncedYet1)');`);
		await page.goto(`${BASE}/read/${await db(page, `let ms; db.memoryObjects.subscribe((v) => (ms = v))(); return ms.find((m) => m.title === 'Elsewhere').id;`)}`, { waitUntil: 'load' });
		await (await page.waitForSelector('main a[href="blob:notSyncedYet1"]')).click();
		await page.waitForFunction(() => document.querySelector('.notice-toast')?.textContent.includes("isn't on this device yet"));
		// Typing and reloading at once (as when a shared file opens in this
		// window) keeps the last keystrokes: the editor saves on pagehide.
		await page.goto(`${BASE}/memory/${id}`, { waitUntil: 'load' });
		await page.waitForSelector('main .ProseMirror');
		await sleep(500);
		// Focus, not a click (that would open the chip); the cursor lands at
		// the start of the line, right before the chip.
		await page.focus('main .ProseMirror');
		await page.keyboard.type('last words ');
		const typed = await page.$eval('main .ProseMirror', (e) => e.textContent);
		assert.match(typed, /last words/);
		await page.reload({ waitUntil: 'load' });
		await page.waitForSelector('main .ProseMirror');
		await sleep(800);
		const body = await bodyOf(page, 'Files');
		assert.match(body, /last words/);
		// Typed at the start of the line, before the chip: not part of the link
		assert.match(body, /last words \[brief\.pdf\]\(blob:/);
		assert.deepEqual(errors, []);
	},

	async 'work: projects, waiting for, decisions, questions, recurring meetings'(browser) {
		const { page, errors } = await freshPage(browser);
		await db(page, `
			const m = db.addMemoryObject('Falcon weekly', 'body');
			db.setMemoryInProject(m.id, 'Falcon', true);
			db.addQuestion({ text: 'Who owns the budget?', memoryId: m.id, assignee: 'Sam' });
		`);
		await sleep(600); // let the save land before reloading
		// A note's project name is suggested, then made a project
		await page.goto(`${BASE}/projects`, { waitUntil: 'load' });
		await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent.includes('Make project')));
		await clickText(page, 'button', 'Make project');
		await page.waitForSelector('input[aria-label="Project name"]');
		const quickAdd = async (prefix, value) => {
			await page.evaluate((p) => [...document.querySelectorAll('input')].find((i) => (i.placeholder || '').startsWith(p)).focus(), prefix);
			await page.keyboard.type(value);
			await page.keyboard.press('Enter');
			await sleep(300);
		};
		await quickAdd('Add a to-do', 'Send the deck @Sam');
		await quickAdd('Log a decision', 'Launch in Q1');
		const projectText = await page.$eval('main', (e) => e.innerText);
		assert.match(projectText, /Send the deck\s+Waiting · Sam/);
		assert.match(projectText, /Who owns the budget\?/, 'question from a project note missing');
		assert.match(projectText, /Launch in Q1/);
		// Waiting for
		await page.goto(`${BASE}/actions?filter=waiting`, { waitUntil: 'load' });
		await page.waitForSelector('.k-section-title');
		assert.match(await page.$eval('main', (e) => e.innerText), /Sam\s+1[\s\S]*Send the deck/);
		// Recurring meeting: agenda + start
		await page.goto(`${BASE}/meetings`, { waitUntil: 'load' });
		await page.waitForSelector('input[aria-label="Meeting name"]');
		await page.type('input[aria-label="Meeting name"]', '1:1 with Sam');
		await page.type('input[aria-label="People"]', 'Sam');
		await clickText(page, 'button', 'Create');
		await page.waitForFunction(() => location.hash.startsWith('#/meetings/'));
		await page.waitForSelector('.series-title');
		await quickAdd('Add something to discuss', 'Hiring plan');
		await clickText(page, 'button', 'Start meeting');
		await page.waitForSelector('input[aria-label="Note title"]');
		await sleep(300);
		const body = await db(page, `let ms; db.memoryObjects.subscribe((v) => (ms = v))(); return ms.find((m) => m.title.startsWith('1:1 with Sam')).bodyMarkdown;`);
		assert.match(body, /## Agenda\n\n- \[ \] Hiring plan/);
		assert.match(body, /Send the deck \(@Sam\)/);
		assert.match(body, /Who owns the budget\? \(@Sam\)/);
		// Profile: being Sam means nothing is waiting
		await page.goto(`${BASE}/settings/profile`, { waitUntil: 'load' });
		await page.waitForSelector('#my-names');
		await page.type('#my-names', 'Sam');
		await page.keyboard.press('Tab');
		await page.goto(`${BASE}/actions?filter=waiting`, { waitUntil: 'load' });
		await page.waitForSelector('.k-empty');
		// Full backup carries the new collections
		const backup = await db(page, `const j = JSON.parse(db.exportFullJSON()); return [j.projects.length, j.decisions.length, j.questions.length, j.meetingSeries.length];`);
		assert.deepEqual(backup, [1, 1, 1, 1]);
		assert.deepEqual(errors, []);
	},

	async 'person page and the dates agenda'(browser) {
		const { page, errors } = await freshPage(browser);
		await db(page, `
			db.addMemoryObject('Contract call', 'Talked to @Ana about the contract');
			const due = new Date(Date.now() + 2 * 864e5);
			const iso = [due.getFullYear(), String(due.getMonth() + 1).padStart(2, '0'), String(due.getDate()).padStart(2, '0')].join('-');
			db.addActionItem({ text: 'Send the contract', assignee: 'Ana', dueDate: iso });
			const series = db.addMeetingSeries({ name: 'Sync with Ana', people: ['Ana'], cadence: 'weekly' });
			db.startSeriesMeeting(series.id);
		`);
		await sleep(600);
		// References → People rows open the person page
		await page.goto(`${BASE}/references?tab=people`, { waitUntil: 'load' });
		await page.waitForFunction(() => [...document.querySelectorAll('a')].some((a) => a.textContent.includes('@Ana')));
		await clickText(page, 'main a', '@Ana');
		await page.waitForFunction(() => location.hash.startsWith('#/people/Ana'));
		await page.waitForFunction(() => document.querySelector('main').innerText.includes('Mentioned in'));
		const text = await page.$eval('main', (e) => e.innerText);
		assert.match(text, /Waiting for from Ana[\s\S]*Send the contract/);
		assert.match(text, /Meetings[\s\S]*Sync with Ana/);
		assert.match(text, /Mentioned in[\s\S]*Contract call/);
		// Profile: create, edit, clear
		await clickText(page, 'main button', 'Create profile');
		await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Edit'));
		await clickText(page, 'main button', 'Edit');
		await page.type('input[aria-label="Email"]', 'ana@example.com');
		await clickText(page, 'main button', 'Save');
		await page.waitForFunction(() => document.querySelector('main').innerText.includes('ana@example.com'));
		await clickText(page, 'main button', 'Edit');
		await page.$eval('input[aria-label="Email"]', (i) => (i.value = '') || i.dispatchEvent(new Event('input', { bubbles: true })));
		await clickText(page, 'main button', 'Save');
		await page.waitForFunction(() => !document.querySelector('main').innerText.includes('ana@example.com'));
		// Old person links land on the person page too
		await page.goto(`${BASE}/references?tab=people&item=Ana`, { waitUntil: 'load' });
		await page.waitForFunction(() => location.hash.startsWith('#/people/Ana'));
		// Dates tab lists the due to-do and the next meeting
		await page.goto(`${BASE}/references?tab=dates`, { waitUntil: 'load' });
		await page.waitForSelector('.event-card');
		const agenda = await page.$eval('main', (e) => e.innerText);
		assert.match(agenda, /Send the contract[\s\S]*1 to-do/);
		assert.match(agenda, /Sync with Ana[\s\S]*1 meeting/);
		await clickText(page, '.event-card button', 'Send the contract');
		await page.waitForFunction(() => document.querySelector('main').innerText.includes('To-dos due'));
		assert.deepEqual(errors, []);
	},

	async 'app arrivals: icon shortcuts, shares, notification actions'(browser) {
		const { page, errors } = await freshPage(browser);
		const notes = () => db(page, `let ms; db.memoryObjects.subscribe((v) => (ms = v))(); return ms.map((m) => ({ title: m.title, body: m.bodyMarkdown, tags: [...m.tags] }));`);
		// App icon shortcut: new note, without leaving ?new=note in history
		await page.goto(`${BASE}/?new=note`, { waitUntil: 'load' });
		await page.waitForFunction(() => location.hash.startsWith('#/memory/'));
		assert.ok(!(await page.evaluate(() => location.search.includes('new='))));
		// Text share (GET params)
		await page.goto(`${BASE}/?share_title=Read%20later&share_text=Worth%20a%20look&share_url=https%3A%2F%2Fexample.org%2Fpost`, { waitUntil: 'load' });
		await page.waitForFunction(() => location.hash.startsWith('#/memory/'));
		const link = (await notes()).find((n) => n.title === 'Read later');
		assert.match(link.body, /Source: \[https:\/\/example\.org\/post\]\(https:\/\/example\.org\/post\)\n\nWorth a look/);
		// Files shared through the service worker's mailbox
		await page.evaluate(async () => {
			const canvas = Object.assign(document.createElement('canvas'), { width: 4, height: 4 });
			const png = await new Promise((r) => canvas.toBlob(r, 'image/png'));
			const files = [
				new File([png], 'whiteboard.png', { type: 'image/png' }),
				new File(['---\nname: "Spec draft"\ntags: [spec]\n---\nThe body'], 'spec.md', { type: 'text/markdown' })
			];
			const req = indexedDB.open('kurumi-sw', 1);
			req.onupgradeneeded = () => ['shared', 'pending', 'snoozed'].forEach((n) => req.result.createObjectStore(n, { keyPath: 'id' }));
			const idb = await new Promise((r) => (req.onsuccess = () => r(req.result)));
			await new Promise((r) => {
				const tx = idb.transaction('shared', 'readwrite');
				tx.objectStore('shared').put({ id: 'x', title: '', text: 'From my phone', url: '', files, receivedAt: Date.now() });
				tx.oncomplete = r;
			});
			idb.close();
		});
		await page.goto(`${BASE}/?share=incoming`, { waitUntil: 'load' });
		await page.waitForFunction(() => location.hash.startsWith('#/memory/'), { timeout: 15000 });
		await sleep(500);
		const all = await notes();
		const photo = all.find((n) => n.title === 'From my phone');
		assert.ok(photo, 'shared text + image note missing');
		assert.match(photo.body, /From my phone\n\n!\[whiteboard\]\(blob:/);
		const spec = all.find((n) => n.title === 'Spec draft');
		assert.deepEqual([spec?.body.trim(), spec?.tags], ['The body', ['spec']]);
		// Mark done from a notification while the app was closed
		const id = await db(page, `return db.addActionItem({ text: 'Renew passport', dueDate: db.todayIso() }).id;`);
		await sleep(600);
		await page.evaluate(async (id) => {
			const req = indexedDB.open('kurumi-sw', 1);
			const idb = await new Promise((r) => (req.onsuccess = () => r(req.result)));
			await new Promise((r) => {
				const tx = idb.transaction('pending', 'readwrite');
				tx.objectStore('pending').put({ id, action: 'done', at: Date.now() });
				tx.oncomplete = r;
			});
			idb.close();
		}, id);
		await page.reload({ waitUntil: 'load' });
		await page.waitForFunction(
			async (id) => {
				const url = performance.getEntriesByType('resource').map((e) => e.name).find((n) => n.includes('/src/lib/db/store.ts'));
				if (!url) return false;
				const db = await import(url);
				let items = [];
				db.actionItems.subscribe((v) => (items = v))();
				return items.find((a) => a.id === id)?.status === 'done';
			},
			{ timeout: 10000 },
			id
		);
		// Settings → Offline & storage
		await page.goto(`${BASE}/settings/offline`, { waitUntil: 'load' });
		await page.waitForSelector('#offline-title');
		await sleep(500); // status reads are async
		const text = await page.$eval('main', (e) => e.innerText);
		assert.match(text, /Not in the development server/);
		assert.match(text, /Version/);
		assert.match(text, /The database loaded in \d+(\.\d)? m?s: \d+ notes? with/);
		assert.deepEqual(errors, []);
	},

	async 'edits persist across reloads (incremental saves)'(browser) {
		const { page, errors } = await freshPage(browser);
		await db(page, `for (let i = 0; i < 5; i++) db.addMemoryObject('Saved ' + i, 'b');`);
		await sleep(600);
		const chunks = await db(page, `return ((await kv.get('kurumi-doc-changes')) || []).length;`);
		assert.ok(chunks > 0, 'expected incremental chunks');
		await page.reload({ waitUntil: 'load' });
		await sleep(1500);
		const titles = await db(page, `let ms; db.allMemoryObjects.subscribe((v) => (ms = v))(); return ms.map((m) => m.title);`);
		for (let i = 0; i < 5; i++) assert.ok(titles.includes('Saved ' + i), `missing Saved ${i}`);
		// Chunks loaded at start are folded into a snapshot shortly after
		await page.waitForFunction(
			async () => {
				const kv = await import('/node_modules/idb-keyval/dist/index.js');
				return ((await kv.get('kurumi-doc-changes')) || []).length === 0;
			},
			{ timeout: 20_000, polling: 500 }
		);
		assert.deepEqual(errors, []);
	},

	async 'autosaves store the edit, not a copy of the note'(browser) {
		const { page, errors } = await freshPage(browser);
		const growth = await db(page, `
			const W = 'falcon budget roadmap hiring launch review customer contract design meeting'.split(' ');
			const words = (n) => Array.from({ length: n }, (_, i) => W[(i * 7 + n) % W.length]).join(' ');
			const m = db.addMemoryObject('Long note', words(450));
			const stored = async () => {
				await new Promise((r) => setTimeout(r, 300));
				const snap = (await kv.get('kurumi-doc'))?.length ?? 0;
				const chunks = ((await kv.get('kurumi-doc-changes')) || []).reduce((a, c) => a + c.length, 0);
				return snap + chunks;
			};
			const before = await stored();
			let body = words(450);
			for (let i = 0; i < 300; i++) {
				body += ' ' + W[i % W.length] + i;
				db.updateMemoryObject(m.id, { bodyMarkdown: body, title: 'Long note ' + (i % 3) });
				if (i % 50 === 0) await new Promise((r) => setTimeout(r, 0));
			}
			return (await stored()) - before;
		`);
		// Whole-text replacement grew it by ~1.5 MB here; diffs by ~50 KB
		// (mostly per-change overhead, which compaction folds away).
		assert.ok(growth < 150_000, `300 autosaves grew storage by ${growth} bytes`);
		assert.deepEqual(errors, []);
	},

	async 'import from Notion: pages, nesting, links, images'(browser) {
		const { page, errors } = await freshPage(browser);
		// A Notion "Markdown & CSV" export, wrapped in an outer ZIP as Notion does
		const id = (n) => String(n).padStart(32, 'a');
		const inner = new JSZip();
		inner.file(`Work ${id(1)}.md`, `# Work\n\nOur team space. See [Kickoff call](Work%20${id(1)}/Kickoff%20call%20${id(2)}.md).`);
		inner.file(`Work ${id(1)}/Kickoff call ${id(2)}.md`, `# Kickoff call\n\nDecided the scope.\n\n![](Kickoff%20call%20${id(2)}/whiteboard.png)\n\n[brief.pdf](Kickoff%20call%20${id(2)}/brief.pdf)\n\nBack to [Work](../Work%20${id(1)}.md)`);
		inner.file(`Work ${id(1)}/Kickoff call ${id(2)}/whiteboard.png`, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'));
		inner.file(`Work ${id(1)}/Kickoff call ${id(2)}/brief.pdf`, '%PDF-1.4');
		inner.file(`Work ${id(1)}/Tasks ${id(3)}.csv`, 'Name,Status\nShip,Done');
		const outer = new JSZip();
		outer.file('Export-part-1.zip', await inner.generateAsync({ type: 'nodebuffer' }));
		const zipPath = join(tmpdir(), `kurumi-notion-${Date.now()}.zip`);
		writeFileSync(zipPath, await outer.generateAsync({ type: 'nodebuffer' }));

		await page.goto(`${BASE}/settings/data`, { waitUntil: 'load' });
		const input = await page.waitForSelector('input[aria-label="Notion export"]');
		await input.uploadFile(zipPath);
		await page.waitForFunction(() => document.querySelector('main').innerText.includes('Imported 2 pages and 2 files'), { timeout: 15_000 });
		rmSync(zipPath, { force: true });

		const notes = await db(page, `
			let ms; db.memoryObjects.subscribe((v) => (ms = v))();
			let fs; db.folders.subscribe((v) => (fs = v))();
			return { notes: ms.map((m) => ({ title: m.title, body: m.bodyMarkdown, folder: fs.find((f) => f.id === m.folderId)?.name ?? null })), folders: fs.map((f) => f.name) };
		`);
		const work = notes.notes.find((n) => n.title === 'Work');
		const kickoff = notes.notes.find((n) => n.title === 'Kickoff call');
		assert.equal(work.folder, null);
		assert.equal(kickoff.folder, 'Work');
		assert.deepEqual(notes.folders, ['Work']);
		assert.match(work.body, /See \[\[Kickoff call\]\]/);
		assert.match(kickoff.body, /!\[\]\(blob:[0-9A-Za-z]+\)/);
		assert.match(kickoff.body, /\[brief\.pdf\]\(blob:[0-9A-Za-z]+\)/);
		assert.match(kickoff.body, /Back to \[\[Work\]\]/);
		assert.doesNotMatch(kickoff.body, /^# Kickoff/);
		assert.deepEqual(errors, []);
	},

	async 'welcome: explore the example vault'(browser) {
		const { page, errors } = await freshPage(browser);
		await page.waitForFunction(() => document.querySelector('main').innerText.includes('Welcome to Kurumi'));
		await clickText(page, 'main button', 'explore an example');
		await page.waitForFunction(() => document.querySelector('input[aria-label="Note title"]')?.value === 'Start here', { timeout: 15_000 });
		const counts = await db(page, `
			let v; db.vaults.subscribe((x) => (v = x))();
			let cur; db.currentVaultId.subscribe((x) => (cur = x))();
			let ms; db.memoryObjects.subscribe((x) => (ms = x))();
			let ai; db.actionItems.subscribe((x) => (ai = x))();
			let ps; db.projects.subscribe((x) => (ps = x))();
			let ss; db.meetingSeries.subscribe((x) => (ss = x))();
			let ds; db.decisions.subscribe((x) => (ds = x))();
			let qs; db.questions.subscribe((x) => (qs = x))();
			return { vault: v.find((x) => x.id === cur).name, notes: ms.length, todos: ai.length, waiting: ai.filter((a) => a.assignee).length, projects: ps.map((p) => p.name), series: ss.map((s) => s.name), decisions: ds.length, questions: qs.length };
		`);
		assert.deepEqual(counts, { vault: 'Example', notes: 4, todos: 5, waiting: 2, projects: ['Falcon launch'], series: ['Falcon weekly'], decisions: 2, questions: 2 });
		// The project page pulls it together
		await page.goto(`${BASE}/projects`, { waitUntil: 'load' });
		await page.waitForFunction(() => [...document.querySelectorAll('main a')].some((a) => a.textContent.includes('Falcon launch')), { timeout: 10_000 });
		await clickText(page, 'main a', 'Falcon launch');
		await page.waitForFunction(() => document.querySelector('main').innerText.includes('Which SSO vendor fits our budget?'), { timeout: 10_000 });
		// Asking again switches to it instead of making a second one
		await page.goto(`${BASE}/`, { waitUntil: 'load' });
		await page.waitForSelector('aside');
		const vaultsAfter = await db(page, `let v; db.vaults.subscribe((x) => (v = x))(); return v.filter((x) => x.name === 'Example').length;`);
		assert.equal(vaultsAfter, 1);
		assert.deepEqual(errors, []);
	},

	async 'sync server: claim, pair a second device, end-to-end encryption'(browser) {
		const SERVER = `http://localhost:${PORT + 7}`;
		const server = await startSyncServer(PORT + 7, BASE);
		let a, b;
		try {
			// Device A: the server's page → Connect Kurumi → paired and synced
			a = await freshPage(browser);
			await a.page.goto(`${SERVER}/`, { waitUntil: 'load' });
			await a.page.click('#connect');
			await a.page.waitForFunction(() => location.hash.startsWith('#/settings/sync') && !location.hash.includes('pair='), { timeout: 15_000 });
			await a.page.waitForFunction(() => document.querySelector('main').innerText.includes('Syncing with localhost'), { timeout: 15_000 });
			assert.ok(server.bucket.objects.has('kurumi-config/tokens.json'));

			// A note and an attachment, then encryption on
			await db(a.page, `
				const { storeAttachment } = await import('/src/lib/attachments.ts');
				const file = await storeAttachment(new File(['%PDF budget sheet'], 'budget.pdf', { type: 'application/pdf' }));
				db.addMemoryObject('Secret plan', 'Falcon budget is 120k. ' + file.markdown);
			`);
			await a.page.type('input[aria-label="Sync passphrase"]', 'walnut-tree-42');
			await clickText(a.page, 'main button', 'Turn on');
			await a.page.waitForFunction(() => document.querySelector('main').innerText.includes('Encrypted. Use the same passphrase'), { timeout: 20_000 });
			const docBytes = server.bucket.objects.get('kurumi-doc.automerge').body;
			assert.equal(new TextDecoder().decode(docBytes.slice(0, 8)), 'KRMENC01');
			assert.ok(!Buffer.from(docBytes).includes('Falcon'), 'document uploaded in the clear');
			const blobObjects = [...server.bucket.objects].filter(([k]) => k.startsWith('kurumi-blobs/'));
			assert.ok(blobObjects.length >= 2, 'manifest and file uploaded');
			for (const [key, o] of blobObjects) assert.equal(new TextDecoder().decode(o.body.slice(0, 8)), 'KRMENC01', `${key} not sealed`);

			// Add a device: A's link
			await clickText(a.page, 'main button', 'Show link');
			const link = await a.page.$eval('input[aria-label="Pairing link"]', (i) => i.value);
			assert.match(link, /#\/settings\/sync\?pair=/);

			// Device B: opens the link, is asked for the passphrase
			b = await freshPage(browser);
			await b.page.goto(link, { waitUntil: 'load' });
			await b.page.waitForFunction(() => document.querySelector('main').innerText.includes('The synced copy is encrypted'), { timeout: 20_000 });
			await b.page.type('input[aria-label="Sync passphrase"]', 'wrong-passphrase');
			await clickText(b.page, 'main button', 'Unlock');
			await b.page.waitForFunction(() => document.querySelector('main').innerText.includes("doesn't open the synced copy"), { timeout: 20_000 });
			await b.page.type('input[aria-label="Sync passphrase"]', 'walnut-tree-42');
			await clickText(b.page, 'main button', 'Unlock');
			await b.page.waitForFunction(() => document.querySelector('main').innerText.includes('Unlocked'), { timeout: 20_000 });
			const synced = await db(b.page, `let ms; db.memoryObjects.subscribe((v) => (ms = v))(); return ms.find((m) => m.title === 'Secret plan')?.bodyMarkdown ?? null;`);
			assert.match(synced, /Falcon budget is 120k/);
			// The attachment came along and opens on B
			const blob = await b.page.evaluate(async (ref) => {
				const { getBlob } = await import('/src/lib/db/blob-store.ts');
				const stored = await getBlob(ref);
				return stored ? await stored.blob.text() : null;
			}, synced.match(/blob:[0-9A-Za-z]+/)[0]);
			assert.equal(blob, '%PDF budget sheet');
			// Turning it off on A switches every device: B's next sync stays readable
			await a.page.reload({ waitUntil: 'load' });
			await a.page.waitForFunction(() => [...document.querySelectorAll('main button')].some((b) => b.textContent.trim() === 'Turn off'), { timeout: 15_000 });
			await clickText(a.page, 'main button', 'Turn off');
			await a.page.waitForFunction(() => document.querySelector('main').innerText.includes('The synced copy is readable again'), { timeout: 20_000 });
			const syncB = await b.page.evaluate(async () => (await import('/src/lib/sync/index.ts')).sync());
			assert.deepEqual(syncB, { success: true });
			const after = server.bucket.objects.get('kurumi-doc.automerge').body;
			assert.notEqual(new TextDecoder().decode(after.slice(0, 8)), 'KRMENC01', 'B sealed the copy again');
			// On again with a new passphrase: B (old key only) is asked for the new one
			await a.page.type('input[aria-label="Sync passphrase"]', 'second-walnut-77');
			await clickText(a.page, 'main button', 'Turn on');
			await a.page.waitForFunction(() => document.querySelector('main').innerText.includes('Encrypted. Use the same passphrase'), { timeout: 20_000 });
			const lockedB = await b.page.evaluate(async () => (await import('/src/lib/sync/index.ts')).sync());
			assert.match(lockedB.error, /encrypted\. Enter its passphrase/);
			await b.page.reload({ waitUntil: 'load' });
			await b.page.waitForSelector('#sync-title', { timeout: 15_000 });
			await clickText(b.page, 'main button', 'Sync now');
			await b.page.waitForFunction(() => [...document.querySelectorAll('main button')].some((x) => x.textContent.trim() === 'Unlock'), { timeout: 20_000 });
			await b.page.type('input[aria-label="Sync passphrase"]', 'second-walnut-77');
			await clickText(b.page, 'main button', 'Unlock');
			await b.page.waitForFunction(() => document.querySelector('main').innerText.includes('Unlocked'), { timeout: 20_000 });
			// The server's page no longer offers to connect
			await b.page.goto(`${SERVER}/`, { waitUntil: 'load' });
			assert.match(await b.page.$eval('body', (e) => e.innerText), /already|is connected/);
			assert.deepEqual([...a.errors, ...b.errors], []);
		} finally {
			await server.close();
		}
	},

	async 'optimize vault: fast format, nothing lost, undo'(browser) {
		const { page, errors } = await freshPage(browser);
		const snapshot = `
			const strip = (d) => JSON.parse(JSON.stringify(d), (k, v) => (k === 'epoch' || k === 'textFormat' || k === 'minAppVersion' ? undefined : v));
			const doc = JSON.parse(db.exportFullJSON());
			return { doc, optimized: db.isVaultOptimized() };
		`;
		await db(page, `
			const words = 'falcon budget roadmap hiring launch review customer contract design meeting'.split(' ');
			db.batchUpdates(() => {
				for (let i = 0; i < 300; i++) {
					const m = db.addMemoryObject('Note ' + i, Array.from({ length: 120 }, (_, k) => words[(i + k) % words.length]).join(' ') + ' @Sam Lee #draft');
					if (i % 50 === 0) db.updateMemoryObject(m.id, { transcript: 'spoken words ' + i, summaryLong: 'summary ' + i });
				}
			});
			const p = db.addProject('Falcon');
			db.addActionItem({ text: 'Ship it', dueDate: '2026-11-02', projectId: p.id });
			db.addDecision({ text: 'Go', projectId: p.id });
			db.addQuestion({ text: 'Budget?', projectId: p.id });
			db.addMeetingSeries({ name: 'Weekly', people: ['Sam Lee'], cadence: 'weekly' });
		`);
		await sleep(800);
		const before = await db(page, snapshot);
		assert.equal(before.optimized, false);
		// Load time of the stored database, before
		const loadMs = () =>
			page.evaluate(async () => {
				const find = (f) => performance.getEntriesByType('resource').map((e) => e.name).find((n) => n.includes(f));
				const A = await import(find('@automerge_automerge') ?? find('automerge'));
				const db = await import(find('/src/lib/db/store.ts'));
				const bytes = db.getDocBinary();
				const t = performance.now();
				for (let i = 0; i < 3; i++) A.load(bytes);
				return (performance.now() - t) / 3;
			});
		const slow = await loadMs();

		await page.goto(`${BASE}/settings/offline`, { waitUntil: 'load' });
		await page.waitForFunction(() => [...document.querySelectorAll('main button')].some((b) => b.textContent.trim() === 'Optimize'), { timeout: 15_000 });
		await clickText(page, 'main button', 'Optimize');
		await page.waitForFunction(() => document.querySelector('main').innerText.includes('Optimized:'), { timeout: 30_000 });
		const after = await db(page, snapshot);
		assert.equal(after.optimized, true);
		// Every record, every collection, every field: unchanged
		const records = (d) => Object.fromEntries(Object.entries(d).filter(([, v]) => v && typeof v === 'object' && !Array.isArray(v)));
		assert.deepEqual(records(after.doc), records(before.doc));
		const fast = await loadMs();
		assert.ok(fast < slow / 2, `load ${slow.toFixed(0)} ms → ${fast.toFixed(0)} ms`);

		// Reading, editing, searching, people and tag renames work on the new format
		const checks = await db(page, `
			let ms; db.memoryObjects.subscribe((v) => (ms = v))();
			const n7 = ms.find((m) => m.title === 'Note 7');
			const types = new Set(ms.flatMap((m) => [typeof m.bodyMarkdown, typeof (m.transcript ?? '')]));
			db.updateMemoryObject(n7.id, { bodyMarkdown: n7.bodyMarkdown + ' appended' });
			db.renameTag('draft', 'final');
			const sam = db.addPerson('Sam Lee');
			const samuel = db.addPerson('Samuel Lee');
			db.mergePeople(sam.id, samuel.id);
			db.memoryObjects.subscribe((v) => (ms = v))();
			const edited = ms.find((m) => m.title === 'Note 7').bodyMarkdown;
			const search = await import('/src/lib/search/index.ts');
			search.syncIndex?.();
			return { types: [...types], edited: edited.slice(-40), searchHits: search.search('appended').length };
		`);
		assert.deepEqual(checks.types, ['string']);
		assert.match(checks.edited, /@Samuel Lee #final appended$/);
		assert.ok(checks.searchHits >= 1, 'search misses optimized notes');

		// A reload reads the new format, and the note opens in the editor
		await sleep(800);
		await page.reload({ waitUntil: 'load' });
		await page.waitForSelector('aside');
		const id = await db(page, `let ms; db.memoryObjects.subscribe((v) => (ms = v))(); return ms.find((m) => m.title === 'Note 7').id;`);
		await page.goto(`${BASE}/memory/${id}`, { waitUntil: 'load' });
		await page.waitForFunction(() => document.querySelector('main .ProseMirror')?.textContent.includes('appended'), { timeout: 15_000 });

		// Undo: back to the previous format, keeping the edit made since
		await page.goto(`${BASE}/settings/offline`, { waitUntil: 'load' });
		await page.waitForFunction(() => [...document.querySelectorAll('main button')].some((b) => b.textContent.trim() === 'Undo'), { timeout: 15_000 });
		await clickText(page, 'main button', 'Undo');
		await page.waitForFunction(() => document.querySelector('main').innerText.includes('Back to the previous format'), { timeout: 30_000 });
		const undone = await db(page, `let ms; db.memoryObjects.subscribe((v) => (ms = v))(); return { optimized: db.isVaultOptimized(), body: ms.find((m) => m.title === 'Note 7').bodyMarkdown.slice(-9), notes: ms.length };`);
		assert.deepEqual(undone, { optimized: false, body: ' appended', notes: 300 });
		assert.deepEqual(errors, []);
	},

	async 'sync across an optimize: other devices adopt the new format'(browser) {
		const SERVER = `http://localhost:${PORT + 8}`;
		const server = await startSyncServer(PORT + 8, BASE);
		try {
			const pair = async () => {
				const device = await freshPage(browser);
				return device;
			};
			// A claims the server; B joins with A's link; both have the notes
			const a = await pair();
			await a.page.goto(`${SERVER}/`, { waitUntil: 'load' });
			await a.page.click('#connect');
			await a.page.waitForFunction(() => document.querySelector('main')?.innerText.includes('Syncing with localhost'), { timeout: 15_000 });
			await db(a.page, `db.addMemoryObject('Shared', 'from A'); db.addMemoryObject('Edited later', 'v1');`);
			const syncOn = (p) => p.evaluate(async () => (await import('/src/lib/sync/index.ts')).sync());
			assert.deepEqual(await syncOn(a.page), { success: true });
			await clickText(a.page, 'main button', 'Show link');
			const link = await a.page.$eval('input[aria-label="Pairing link"]', (i) => i.value);
			const b = await pair();
			await b.page.goto(link, { waitUntil: 'load' });
			await b.page.waitForFunction(() => document.querySelector('main')?.innerText.includes('Syncing with localhost'), { timeout: 15_000 });
			await sleep(1500);
			assert.deepEqual(await syncOn(b.page), { success: true });

			// B edits offline-from-sync, A optimizes and syncs
			await db(b.page, `let ms; db.memoryObjects.subscribe((v) => (ms = v))(); db.updateMemoryObject(ms.find((m) => m.title === 'Edited later').id, { bodyMarkdown: 'v2 from B' }); db.addMemoryObject('B only', 'new on B');`);
			await db(a.page, `await db.optimizeVault();`);
			assert.deepEqual(await syncOn(a.page), { success: true });
			// B syncs: adopts A's new history, keeps its own edits
			assert.deepEqual(await syncOn(b.page), { success: true });
			const onB = await db(b.page, `let ms; db.memoryObjects.subscribe((v) => (ms = v))(); return { optimized: db.isVaultOptimized(), notes: Object.fromEntries(ms.map((m) => [m.title, m.bodyMarkdown])) };`);
			assert.deepEqual(onB, { optimized: true, notes: { Shared: 'from A', 'Edited later': 'v2 from B', 'B only': 'new on B' } });
			// …and A gets them on its next sync, in the same history (a normal merge now)
			assert.deepEqual(await syncOn(a.page), { success: true });
			const onA = await db(a.page, `let ms; db.memoryObjects.subscribe((v) => (ms = v))(); return Object.fromEntries(ms.map((m) => [m.title, m.bodyMarkdown]));`);
			assert.deepEqual(onA, { Shared: 'from A', 'Edited later': 'v2 from B', 'B only': 'new on B' });

			// A copy saved by a newer Kurumi is refused, not mixed in
			await b.page.evaluate(async () => {
				const find = (f) => performance.getEntriesByType('resource').map((e) => e.name).find((n) => n.includes(f));
				const A = await import(find('@automerge_automerge') ?? find('automerge'));
				const db = await import(find('/src/lib/db/store.ts'));
				const newer = A.change(A.load(db.getDocBinary()), (d) => { d.minAppVersion = '99.0.0'; });
				window.__newer = A.save(newer);
			});
			const refused = await b.page.evaluate(async () => {
				const find = (f) => performance.getEntriesByType('resource').map((e) => e.name).find((n) => n.includes(f));
				const db = await import(find('/src/lib/db/store.ts'));
				try {
					await db.mergeDoc(window.__newer);
					return 'merged';
				} catch (err) {
					return err.message;
				}
			});
			assert.match(refused, /newer Kurumi\. Reload this device/);
			assert.deepEqual([...a.errors, ...b.errors], []);
		} finally {
			await server.close();
		}
	},

	async 'pasting formatted text keeps its markdown'(browser) {
		const { page, errors } = await freshPage(browser);
		const paste = (data) =>
			page.evaluate((data) => {
				const dt = new DataTransfer();
				for (const [k, v] of Object.entries(data)) dt.setData(k, v);
				document.querySelector('main .ProseMirror').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
			}, data);
		// Rendered chat output (HTML), as copied from a ChatGPT window
		await newNote(page, 'From chat');
		await page.click('main .ProseMirror');
		await paste({
			'text/plain': 'Plan Name Role Ana Lead print("hi")',
			'text/html':
				'<h2>Plan</h2><p>A <strong>bold</strong> idea</p><ul><li><p>one</p></li><li><p>two</p></li></ul>' +
				'<div class="overflow-x-auto"><table><thead><tr><th>Name</th><th>Role</th></tr></thead><tbody><tr><td>Ana</td><td>Lead</td></tr></tbody></table></div>' +
				'<pre><div class="code-header"><span>python</span><button>Copy code</button></div><code class="language-python">print("hi")</code></pre>'
		});
		await sleep(900);
		const md = await bodyOf(page, 'From chat');
		assert.match(md, /## Plan/);
		assert.match(md, /A \*\*bold\*\* idea/);
		assert.match(md, /- one\n- two/);
		assert.match(md, /\| Name \| Role \|/);
		assert.match(md, /```python\nprint\("hi"\)\n```/);
		assert.doesNotMatch(md, /Copy code/);
		// Markdown source as plain text (ChatGPT's copy button, editors)
		await newNote(page, 'From markdown');
		await page.click('main .ProseMirror');
		await paste({ 'text/plain': '# Title\n\n- [ ] task\n\n> quote', 'text/html': '<div><span># Title</span></div>' });
		await sleep(900);
		const md2 = await bodyOf(page, 'From markdown');
		assert.match(md2, /^# Title/);
		assert.match(md2, /- \[ \] task/);
		assert.match(md2, /> quote/);
		assert.deepEqual(errors, []);
	},

	async 'files and folders added to the sync folder are imported'(browser) {
		const { page, errors } = await freshPage(browser);
		const out = await page.evaluate(async () => {
			const find = (frag) => performance.getEntriesByType('resource').map((e) => e.name).find((n) => n.includes(frag));
			const db = await import(find('/src/lib/db/store.ts'));
			const svc = await import(find('/src/lib/sync/service.ts'));
			const kv = await import('/node_modules/idb-keyval/dist/index.js');
			const root = await navigator.storage.getDirectory();
			const dir = await root.getDirectoryHandle('e2e-import-' + Date.now(), { create: true });
			await kv.set('kurumi-local-fs-handle', dir);
			localStorage.setItem('kurumi-local-fs-configured', '1');
			localStorage.setItem('kurumi-sync-method', 'local-fs');
			const write = async (path, text) => {
				const parts = path.split('/');
				const name = parts.pop();
				let d = dir;
				for (const p of parts) d = await d.getDirectoryHandle(p, { create: true });
				const w = await (await d.getFileHandle(name, { create: true })).createWritable();
				await w.write(text);
				await w.close();
			};
			await svc.sync();
			await write('Inbox idea.md', 'Just a thought');
			await write('Client X/Kickoff.md', '---\ntitle: "Kickoff call"\ntags: [client]\n---\nAgenda');
			await dir.getDirectoryHandle('Empty Dir', { create: true });
			await svc.sync();
			await svc.sync(); // a second pass must not duplicate anything
			let all;
			db.allMemoryObjects.subscribe((v) => (all = v))();
			let vaultId;
			db.currentVaultId.subscribe((v) => (vaultId = v))();
			const folders = db.getVaultContents(vaultId).folders;
			const names = [];
			for await (const h of dir.values()) names.push(h.name);
			return {
				notes: all.map((m) => `${folders.find((f) => f.id === m.folderId)?.name ?? '/'}:${m.title}:${m.tags.join(',')}`).sort(),
				folders: folders.map((f) => f.name).sort(),
				rootEntries: names.sort()
			};
		});
		assert.deepEqual(out.notes, ['/:Inbox idea:', 'Client X:Kickoff call:client']);
		assert.deepEqual(out.folders, ['Client X', 'Empty Dir']);
		assert.ok(!out.rootEntries.includes('Inbox idea.md'), 'original file not replaced');
		assert.ok(out.rootEntries.includes('inbox-idea.md') && out.rootEntries.includes('client-x'), out.rootEntries.join(', '));
		assert.deepEqual(errors, []);
	},

	async 'local folder sync writes every vault (all-vaults layout)'(browser) {
		const { page, errors } = await freshPage(browser);
		const tree = await page.evaluate(async () => {
			const find = (frag) => performance.getEntriesByType('resource').map((e) => e.name).find((n) => n.includes(frag));
			const db = await import(find('/src/lib/db/store.ts'));
			const svc = await import(find('/src/lib/sync/service.ts'));
			const kv = await import('/node_modules/idb-keyval/dist/index.js');
			// The folder picker can't be automated; an origin-private folder
			// stands in for the user's directory.
			const root = await navigator.storage.getDirectory();
			const dir = await root.getDirectoryHandle('e2e-sync-' + Date.now(), { create: true });
			await kv.set('kurumi-local-fs-handle', dir);
			localStorage.setItem('kurumi-local-fs-configured', '1');
			localStorage.setItem('kurumi-sync-method', 'local-fs');
			localStorage.setItem('kurumi-local-fs-all-vaults', '1');
			let defId;
			db.currentVaultId.subscribe((v) => (defId = v))();
			db.addMemoryObject('Home note', 'h');
			const work = db.addVault('Work');
			db.setCurrentVault(work.id);
			db.addMemoryObject('Roadmap', 'r', db.addFolder('Projects').id);
			db.setCurrentVault(defId);
			const result = await svc.sync();
			const walk = async (d, p = '') => {
				const out = [];
				for await (const h of d.values()) {
					if (h.kind === 'directory') out.push(...(await walk(h, p + h.name + '/')));
					else out.push(p + h.name);
				}
				return out.sort();
			};
			return { result, files: await walk(dir) };
		});
		assert.deepEqual(tree.result, { success: true });
		for (const f of ['kurumi-sync.bin', '.kurumi/vaults.json', 'default/home-note.md', 'work/projects/roadmap.md', 'work/.kurumi/metadata.json']) {
			assert.ok(tree.files.includes(f), `missing ${f} in ${tree.files.join(', ')}`);
		}
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
		} finally {
			for (const context of openContexts.splice(0)) await context.close().catch(() => {});
		}
	}
} finally {
	await browser?.close();
	stopServer(server);
	rmSync(profile, { recursive: true, force: true });
}
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
