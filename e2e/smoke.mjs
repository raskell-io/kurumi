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
	// The automatic daily digest would add a note 5 s after start, in the
	// middle of a scenario: mark today's as done.
	await page.evaluateOnNewDocument(() => {
		const d = new Date();
		const today = [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
		localStorage.setItem('kurumi-last-auto-digest', today);
		// Same for last week's automatic review note (weekly-review.ts).
		const monday = new Date(d);
		monday.setDate(d.getDate() - ((d.getDay() + 6) % 7) - 7);
		const iso = (x) => [x.getFullYear(), String(x.getMonth() + 1).padStart(2, '0'), String(x.getDate()).padStart(2, '0')].join('-');
		localStorage.setItem('kurumi-last-auto-review', iso(monday));
	});
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

// The editor's HTML without attributes.
const editorHtml = (page, selector = 'main .ProseMirror') =>
	page.$eval(selector, (e) => {
		const copy = e.cloneNode(true);
		return copy.innerHTML.replace(/ (class|id|data-(?!item-type|checked)[\w-]+|contenteditable|draggable|style|aria-[\w-]+)="[^"]*"/g, '');
	});

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
		// A note created in the background (sync, the morning digest) leaves both editors alone
		await db(page, `db.addMemoryObject('Arrived in the background', 'x');`);
		await sleep(1500);
		assert.deepEqual(errors, [], 'a background note broke an editor');
		assert.equal(await bodyOf(page, 'Beta'), 'Beta body plus split\n');
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
		await page.waitForSelector('.hero-title');
		const about = await page.$eval('#about', (e) => e.textContent);
		assert.match(about, /second brain for notes, voice memos and meetings/);
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
		// The note's checkbox is a to-do too, shown with its note.
		await page.waitForFunction(() => [...document.querySelectorAll('.todo-row')].some((r) => r.textContent.includes('Send budget')), { timeout: 10000 });
		const rows = () => page.$$eval('.todo-row', (r) => r.map((x) => x.textContent.replace(/\s+/g, ' ').trim()));
		const shown = (await rows()).map((r) => r.split(' ').slice(0, 2).join(' '));
		assert.equal(shown[0], 'Standup notes');
		assert.deepEqual([...shown].sort(), ['Send budget', 'Someday task', 'Standup notes']);
		assert.ok((await rows()).some((r) => r.startsWith('Send budget') && r.includes('Plan')), 'note link missing');
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
		// A PDF opens in Kurumi's viewer (this one isn't a real PDF: it says so),
		// which can open the stored file in a new tab
		await chip.click();
		await page.waitForFunction(() => document.querySelector('.pdf-viewer .pdf-name')?.textContent === 'brief.pdf');
		const opened = context.waitForTarget((t) => t.url().startsWith('blob:http'), { timeout: 10_000 });
		await page.click('.pdf-viewer button[aria-label="Open in a new tab"]');
		await (await (await opened).page())?.close();
		await page.bringToFront();
		await page.keyboard.press('Escape');
		await page.waitForFunction(() => !document.querySelector('.pdf-viewer'));
		// Read mode too
		const id = await page.evaluate(() => location.hash.split('/').pop());
		await page.goto(`${BASE}/read/${id}`, { waitUntil: 'load' });
		const readChip = await page.waitForSelector('main a[href^="blob:"]');
		await readChip.click();
		await page.waitForSelector('.pdf-viewer');
		await page.keyboard.press('Escape');
		await page.waitForFunction(() => !document.querySelector('.pdf-viewer'));
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
		assert.match(body, /## Agenda\n\n- Hiring plan/);
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
		inner.file(`Work ${id(1)}/Tasks ${id(3)}.csv`, 'Name,Status,Due\nShip,Done,"November 9, 2026"\nPlan,Todo,\nTest,Done,');
		inner.file(`Work ${id(1)}/Tasks ${id(3)}/Ship ${id(4)}.md`, '# Ship\n\nStatus: Done\nDue: November 9, 2026\n\nRelease notes.');
		const outer = new JSZip();
		outer.file('Export-part-1.zip', await inner.generateAsync({ type: 'nodebuffer' }));
		const zipPath = join(tmpdir(), `kurumi-notion-${Date.now()}.zip`);
		writeFileSync(zipPath, await outer.generateAsync({ type: 'nodebuffer' }));

		await page.goto(`${BASE}/settings/data`, { waitUntil: 'load' });
		const input = await page.waitForSelector('input[aria-label="Notion export"]');
		await input.uploadFile(zipPath);
		await page.waitForFunction(() => document.querySelector('main').innerText.includes('Imported 5 pages, 1 database and 2 files'), { timeout: 15_000 });
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
		assert.deepEqual(notes.folders.sort(), ['Tasks', 'Work']);
		// The database: typed properties, values on the row pages, Notion's
		// property lines gone from the body
		const tasks = await db(page, `
			let vs; db.databaseViews.subscribe((v) => (vs = v))();
			let ms; db.memoryObjects.subscribe((v) => (ms = v))();
			const view = vs[0];
			const rows = ms.filter((m) => m.folderId === view.folderId).sort((a, b) => a.title.localeCompare(b.title));
			return { props: view.properties.map((p) => p.label + ':' + p.type), rows: rows.map((r) => [r.title, r.customProps, r.bodyMarkdown]) };
		`);
		assert.deepEqual(tasks.props, ['Status:select', 'Due:date']);
		assert.deepEqual(tasks.rows, [
			['Plan', { status: 'Todo' }, ''],
			['Ship', { status: 'Done', due: '2026-11-09' }, 'Release notes.'],
			['Test', { status: 'Done' }, '']
		]);
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
	},

	async 'a coding agent can add records, notes and files through the folder'(browser) {
		const { page, errors } = await freshPage(browser);
		const out = await page.evaluate(async () => {
			const find = (frag) => performance.getEntriesByType('resource').map((e) => e.name).find((n) => n.includes(frag));
			const db = await import(find('/src/lib/db/store.ts'));
			const svc = await import(find('/src/lib/sync/service.ts'));
			const blobs = await import(find('/src/lib/db/blob-store.ts'));
			const kv = await import('/node_modules/idb-keyval/dist/index.js');
			const root = await navigator.storage.getDirectory();
			const dir = await root.getDirectoryHandle('e2e-agent-' + Date.now(), { create: true });
			await kv.set('kurumi-local-fs-handle', dir);
			localStorage.setItem('kurumi-local-fs-configured', '1');
			localStorage.setItem('kurumi-sync-method', 'local-fs');

			const items = () => { let v; db.actionItems.subscribe((x) => (v = x))(); return v; };
			const write = async (d, name, data) => {
				const w = await (await d.getFileHandle(name, { create: true })).createWritable();
				await w.write(data);
				await w.close();
			};
			const sync = async () => {
				// The sync guards are for automatic runs; a stamp after the last
				// sync needs the clock to have moved on.
				await new Promise((r) => setTimeout(r, 20));
				const res = await svc.sync();
				await new Promise((r) => setTimeout(r, 20));
				return res;
			};
			const first = await sync();
			const kurumi = await dir.getDirectoryHandle('.kurumi');
			const guide = await (await (await kurumi.getFileHandle('AGENTS.md')).getFile()).text();
			const claudeDir = await dir.getDirectoryHandle('.claude');
			const claudeText = await (await (await claudeDir.getFileHandle('CLAUDE.md')).getFile()).text();
			await write(claudeDir, 'CLAUDE.md', '# Mine\n\nKeep this.\n');
			const readMeta = async () => JSON.parse(await (await (await kurumi.getFileHandle('metadata.json')).getFile()).text());

			// What an agent following the guide does.
			const m = await readMeta();
			const now = Date.now();
			m.actionItems.agenttodo1 = { id: 'agenttodo1', text: 'From the agent', dueDate: '2030-01-02', vaultId: m.vault.id, createdAt: now, updatedAt: now };
			m.work.projects.push({ id: 'agentproj1', name: 'Agent project', vaultId: m.vault.id, createdAt: now, updatedAt: now });
			m.people.agentperson = { id: 'agentperson', name: 'Dana Reyes', vaultId: m.vault.id, created: now, modified: now };
			m.blobs['blob:agentblob1'] = { mimeType: 'image/png' };
			m.work.reminderProposals.push({ id: 'agentrem1', memoryObjectId: 'agentnote1', text: 'Follow up', suggestedDate: '2030-01-03', vaultId: m.vault.id, createdAt: now });
			m.work.draftProposals.push({ id: 'agentdraft1', memoryObjectId: 'agentnote1', subject: 'Hello', vaultId: m.vault.id, createdAt: now });
			m.work.templates.push({ id: 'agenttpl1', name: 'Agent template', content: '# {title}', vaultId: m.vault.id, created: now, modified: now });
			await write(kurumi, 'metadata.json', JSON.stringify(m));
			await write(await kurumi.getDirectoryHandle('blobs', { create: true }), 'agentblob1', new Uint8Array([137, 80, 78, 71]));
			await write(dir, 'agent-note.md', '---\nid: agentnote1\nname: "Agent note"\ntags: ["from-agent"]\n---\n![Photo](blob:agentblob1)\n');
			const second = await sync();

			const after = await readMeta();
			const stored = await blobs.getBlob('blob:agentblob1');
			const full = JSON.parse(db.exportFullJSON());
			const proposals = {
				reminder: full.reminderProposals.find((r) => r.id === 'agentrem1')?.status,
				draft: full.draftProposals.find((r) => r.id === 'agentdraft1')?.kind,
				template: full.templates.find((t) => t.id === 'agenttpl1')?.name
			};
			const note = db.getMemoryObject('agentnote1');
			const added = {
				todo: items().find((a) => a.id === 'agenttodo1'),
				fileTodoStatus: after.actionItems.agenttodo1?.status,
				fileProject: after.work.projects.map((p) => p.name),
				filePerson: after.people.agentperson?.name,
				blobMime: stored?.mimeType,
				fileBlobMime: after.blobs['blob:agentblob1']?.mimeType,
				blobKept: !!(await (await kurumi.getDirectoryHandle('blobs')).getFileHandle('agentblob1')),
				noteTitle: note?.title,
				noteTags: note?.tags
			};

			// Deleted in the app: the file still lists it, and it stays deleted.
			db.deleteActionItem('agenttodo1');
			const third = await sync();
			const deleted = {
				gone: !items().some((a) => a.id === 'agenttodo1'),
				goneFromFile: !(await readMeta()).actionItems.agenttodo1
			};

			// An edit with a fresh stamp applies; an agent marking a to-do done.
			const m2 = await readMeta();
			const later = Date.now();
			m2.actionItems.agenttodo2 = { id: 'agenttodo2', text: 'Second', vaultId: m2.vault.id, createdAt: later, updatedAt: later };
			await write(kurumi, 'metadata.json', JSON.stringify(m2));
			await sync();
			const m3 = await readMeta();
			m3.actionItems.agenttodo2.status = 'done';
			m3.actionItems.agenttodo2.updatedAt = Date.now();
			await write(kurumi, 'metadata.json', JSON.stringify(m3));
			await sync();
			const done = items().find((a) => a.id === 'agenttodo2')?.status;

			const claudeAfter = await (await (await claudeDir.getFileHandle('CLAUDE.md')).getFile()).text();
			const notesNow = JSON.parse(db.exportFullJSON()).memoryObjects;
			const claude = {
				imports: claudeText.includes('@../.kurumi/AGENTS.md'),
				keptMine: claudeAfter.startsWith('# Mine\n\nKeep this.'),
				addedBack: claudeAfter.includes('@../.kurumi/AGENTS.md'),
				once: claudeAfter.split('@../.kurumi/AGENTS.md').length === 2,
				notImported: !notesNow.some((n) => /kurumi vault|mine|claude/i.test(n.title))
			};
			return { claude, proposals, results: [first, second, third], guideHasRules: guide.includes('## Rules'), added, deleted, done };
		});
		for (const r of out.results) assert.deepEqual(r, { success: true });
		assert.ok(out.guideHasRules, 'AGENTS.md not written');
		assert.deepEqual(out.claude, { imports: true, keptMine: true, addedBack: true, once: true, notImported: true });
		assert.deepEqual(out.proposals, { reminder: 'pending', draft: 'email', template: 'Agent template' });
		assert.equal(out.added.todo?.text, 'From the agent');
		assert.equal(out.added.todo?.dueDate, '2030-01-02');
		assert.equal(out.added.fileTodoStatus, 'open', 'defaults written back to the file');
		assert.deepEqual(out.added.fileProject, ['Agent project']);
		assert.equal(out.added.filePerson, 'Dana Reyes');
		assert.equal(out.added.blobMime, 'image/png');
		assert.equal(out.added.fileBlobMime, 'image/png');
		assert.ok(out.added.blobKept);
		assert.equal(out.added.noteTitle, 'Agent note');
		assert.deepEqual(out.added.noteTags, ['from-agent']);
		assert.deepEqual(out.deleted, { gone: true, goneFromFile: true });
		assert.equal(out.done, 'done');
		assert.deepEqual(errors, []);
	},
	async 'local folder sync is two-way and safe to edit during'(browser) {
		const { page, errors } = await freshPage(browser);
		const out = await page.evaluate(async () => {
			const find = (frag) => performance.getEntriesByType('resource').map((e) => e.name).find((n) => n.includes(frag));
			const db = await import(find('/src/lib/db/store.ts'));
			const svc = await import(find('/src/lib/sync/service.ts'));
			const kv = await import('/node_modules/idb-keyval/dist/index.js');
			const root = await navigator.storage.getDirectory();
			const dir = await root.getDirectoryHandle('e2e-twoway-' + Date.now(), { create: true });
			await kv.set('kurumi-local-fs-handle', dir);
			localStorage.setItem('kurumi-local-fs-configured', '1');
			localStorage.setItem('kurumi-sync-method', 'local-fs');
			const write = async (d, name, data) => {
				const w = await (await d.getFileHandle(name, { create: true })).createWritable();
				await w.write(data);
				await w.close();
			};
			const read = async (d, name) => (await (await d.getFileHandle(name)).getFile()).text();
			const stamp = async (d, name) => (await (await d.getFileHandle(name)).getFile()).lastModified;
			const items = () => { let v; db.actionItems.subscribe((x) => (v = x))(); return v; };
			const res = {};

			const note = db.addMemoryObject('Shared note', 'original');
			db.addMemoryObject('Other note', 'other');
			await svc.sync();
			const kurumi = await dir.getDirectoryHandle('.kurumi');

			// Nothing changed: files aren't rewritten.
			const before = await stamp(dir, 'other-note.md');
			await new Promise((r) => setTimeout(r, 50));
			await svc.sync();
			res.untouched = before === (await stamp(dir, 'other-note.md'));

			// A record with a stale stamp, and an edit without a bump, still count.
			const m = JSON.parse(await read(kurumi, 'metadata.json'));
			m.actionItems.old1 = { id: 'old1', text: 'Stale stamp', vaultId: m.vault.id, createdAt: 1000, updatedAt: 1000 };
			await write(kurumi, 'metadata.json', JSON.stringify(m));
			await svc.sync();
			res.staleAccepted = items().some((a) => a.id === 'old1');
			const m2 = JSON.parse(await read(kurumi, 'metadata.json'));
			m2.actionItems.old1.status = 'done';
			await write(kurumi, 'metadata.json', JSON.stringify(m2));
			await svc.sync();
			res.noBumpApplied = items().find((a) => a.id === 'old1')?.status;

			// Half-written JSON is neither read nor overwritten.
			await write(kurumi, 'metadata.json', '{ "half": ');
			await svc.sync();
			res.badJsonKept = (await read(kurumi, 'metadata.json')) === '{ "half": ';
			await write(kurumi, 'metadata.json', JSON.stringify(m2));
			await svc.sync();

			// Title and tags edited in the file; then a move; then deleted.
			const shared = await read(dir, 'shared-note.md');
			await write(dir, 'shared-note.md', shared.replace('name: "Shared note"', 'name: "Renamed note"').replace('original', 'edited in file'));
			await svc.sync();
			const renamed = db.getMemoryObject(note.id);
			res.renamed = [renamed.title, renamed.bodyMarkdown.trim()];
			res.renamedFile = (await read(dir, 'renamed-note.md')).includes('edited in file');
			res.oldGone = await dir.getFileHandle('shared-note.md').then(() => false, () => true);

			const text = await read(dir, 'renamed-note.md');
			await dir.removeEntry('renamed-note.md');
			const area = await dir.getDirectoryHandle('area', { create: true });
			await write(area, 'renamed-note.md', text);
			await svc.sync();
			const moved = db.getMemoryObject(note.id);
			res.movedInto = moved.folderId ? 'folder' : 'top';
			res.movedOnDisk = (await read(area, 'renamed-note.md')).includes('edited in file');

			// Edited on both sides: neither is lost.
			const onDisk = await read(area, 'renamed-note.md');
			db.updateMemoryObject(note.id, { bodyMarkdown: 'edited in app' });
			await write(area, 'renamed-note.md', onDisk.replace('edited in file', 'edited by agent'));
			await svc.sync();
			let all; db.memoryObjects.subscribe((v) => (all = v))();
			res.conflict = {
				note: db.getMemoryObject(note.id).bodyMarkdown.trim(),
				copy: all.find((n) => n.title === 'Renamed note (edit from folder)')?.bodyMarkdown.trim()
			};

			// deleted: true goes to the Trash.
			const del = await read(dir, 'other-note.md');
			await write(dir, 'other-note.md', del.replace('---\n', '---\ndeleted: true\n'));
			await svc.sync();
			db.memoryObjects.subscribe((v) => (all = v))();
			res.trashed = !all.some((n) => n.title === 'Other note');

			// A note whose file can't be written: the rest still syncs, and says so.
			// (a directory in its place stands in for a path Windows refuses)
			await dir.getDirectoryHandle('blocked-note.md', { create: true });
			db.addMemoryObject('Blocked note', 'cannot be written');
			const after = db.addMemoryObject('After the long one', 'written');
			const failed = await svc.sync();
			res.failed = failed.error ?? '';
			res.restWritten = (await read(dir, 'after-the-long-one.md')).includes('written');
			res.metaWritten = JSON.parse(await read(kurumi, 'metadata.json')).noteIds['after-the-long-one.md'] === after.id;
			res.guide = (await read(kurumi, 'AGENTS.md')).includes('## Rules');
			return res;
		});
		assert.equal(out.untouched, true, 'unchanged file rewritten');
		assert.equal(out.staleAccepted, true, 'new record with an old stamp dropped');
		assert.equal(out.noBumpApplied, 'done', 'edit without a timestamp bump ignored');
		assert.equal(out.badJsonKept, true, 'invalid metadata overwritten');
		assert.deepEqual(out.renamed, ['Renamed note', 'edited in file']);
		assert.ok(out.renamedFile && out.oldGone, 'file not moved to the new title');
		assert.equal(out.movedInto, 'folder');
		assert.ok(out.movedOnDisk, 'moved file not kept');
		assert.deepEqual(out.conflict, { note: 'edited in app', copy: 'edited by agent' });
		assert.ok(out.trashed, 'deleted: true ignored');
		assert.match(out.failed, /couldn't be written/);
		assert.ok(out.restWritten && out.metaWritten && out.guide, JSON.stringify(out));
		assert.deepEqual(errors, []);
	},

	async 'the open app picks up folder changes by itself, both ways'(browser) {
		const { page, errors } = await freshPage(browser);
		await page.evaluate(async () => {
			const kv = await import('/node_modules/idb-keyval/dist/index.js');
			const root = await navigator.storage.getDirectory();
			const dir = await root.getDirectoryHandle('e2e-watch', { create: true });
			await kv.set('kurumi-local-fs-handle', dir);
			localStorage.setItem('kurumi-local-fs-configured', '1');
			localStorage.setItem('kurumi-sync-method', 'local-fs');
		});
		await page.reload({ waitUntil: 'load' });
		await page.waitForFunction(() => performance.getEntriesByType('resource').some((e) => e.name.includes('/src/lib/db/store.ts')), { timeout: 30000 });
		const seen = await page.evaluate(async () => {
			const find = (frag) => performance.getEntriesByType('resource').map((e) => e.name).find((n) => n.includes(frag));
			const db = await import(find('/src/lib/db/store.ts'));
			const root = await navigator.storage.getDirectory();
			const dir = await root.getDirectoryHandle('e2e-watch');
			const until = async (check) => {
				const end = Date.now() + 45000;
				while (Date.now() < end) {
					if (await check()) return true;
					await new Promise((r) => setTimeout(r, 500));
				}
				return false;
			};
			// Started by the watch alone: it writes the folder on opening.
			const kurumi = await until(() => dir.getDirectoryHandle('.kurumi').then((d) => d.getFileHandle('AGENTS.md')).then(() => true, () => false));
			const w = await (await dir.getFileHandle('from-agent.md', { create: true })).createWritable();
			await w.write('---\nid: watched1\nname: "From agent"\n---\nhello\n');
			await w.close();
			const inbound = await until(() => !!db.getMemoryObject('watched1'));
			// A to-do made in the app reaches the file without a click.
			db.addActionItem({ text: 'From app' });
			const outbound = await until(async () => {
				const d = await dir.getDirectoryHandle('.kurumi');
				const text = await (await (await d.getFileHandle('metadata.json')).getFile()).text();
				return text.includes('From app');
			});
			return { kurumi, inbound, outbound };
		});
		assert.deepEqual([seen.kurumi, seen.inbound, seen.outbound], [true, true, true], JSON.stringify(seen));
		assert.deepEqual(errors, []);
	},

	async 'local folder sync never loses what an agent wrote'(browser) {
		const { page, errors } = await freshPage(browser);
		const out = await page.evaluate(async () => {
			const find = (frag) => performance.getEntriesByType('resource').map((e) => e.name).find((n) => n.includes(frag));
			const db = await import(find('/src/lib/db/store.ts'));
			const svc = await import(find('/src/lib/sync/service.ts'));
			const kv = await import('/node_modules/idb-keyval/dist/index.js');
			const root = await navigator.storage.getDirectory();
			const dir = await root.getDirectoryHandle('e2e-noloss-' + Date.now(), { create: true });
			await kv.set('kurumi-local-fs-handle', dir);
			localStorage.setItem('kurumi-local-fs-configured', '1');
			localStorage.setItem('kurumi-sync-method', 'local-fs');
			const write = async (d, name, data) => { const w = await (await d.getFileHandle(name, { create: true })).createWritable(); await w.write(data); await w.close(); };
			const read = (d, name) => d.getFileHandle(name).then((h) => h.getFile()).then((f) => f.text()).catch(() => null);
			const notes = () => JSON.parse(db.exportFullJSON()).memoryObjects;
			const withText = (t) => notes().filter((m) => !m.deletedAt && (m.bodyMarkdown || '').includes(t));
			const res = {};

			const rewrite = db.addMemoryObject('Rewrite me', 'old body');
			db.updateMemoryObject(rewrite.id, { tags: ['keep'] });
			const trash = db.addMemoryObject('Trash me', 'to trash');
			const first = db.addMemoryObject('Same Title', 'first with this title');
			await svc.sync();

			// Rewritten without frontmatter: an edit of that note.
			await write(dir, 'rewrite-me.md', 'REWRITTEN\n');
			await svc.sync();
			const r1 = db.getMemoryObject(rewrite.id);
			res.noFrontmatter = [r1.title, r1.bodyMarkdown.trim(), r1.tags.join()];
			res.noFrontmatterCount = withText('REWRITTEN').length;
			res.noFrontmatterFile = (await read(dir, 'rewrite-me.md')).includes('REWRITTEN');

			// Emptied: ignored, the file comes back.
			await write(dir, 'rewrite-me.md', '');
			await svc.sync();
			res.emptied = db.getMemoryObject(rewrite.id).bodyMarkdown.trim();
			res.emptiedFile = (await read(dir, 'rewrite-me.md')).includes('REWRITTEN');

			// Another id at that path: a new note, and the old note keeps its file.
			await write(dir, 'rewrite-me.md', '---\nid: otherid01\nname: "Different"\n---\nOTHERID\n');
			await svc.sync();
			res.otherId = withText('OTHERID').map((m) => [m.id, m.title]);
			res.otherIdOwnFile = (await read(dir, 'different.md'))?.includes('OTHERID');
			res.otherIdOldFile = (await read(dir, 'rewrite-me.md'))?.includes('REWRITTEN');
			res.oldNoteKept = db.getMemoryObject(rewrite.id).bodyMarkdown.trim();

			// Written to the path of a note just trashed: a new note, file stays.
			db.deleteMemoryObject(trash.id);
			await write(dir, 'trash-me.md', 'AFTERTRASH\n');
			await svc.sync();
			res.afterTrash = withText('AFTERTRASH').length;
			res.afterTrashFile = (await read(dir, 'trash-me.md'))?.includes('AFTERTRASH');
			res.trashStays = !!JSON.parse(db.exportFullJSON()).memoryObjects.find((m) => m.id === trash.id).deletedAt;

			// Same title: a file each, and it stays that way.
			await write(dir, 'collide.md', '---\nid: collide01\nname: "Same Title"\n---\nCOLLIDE\n');
			await svc.sync();
			await svc.sync();
			res.firstFile = (await read(dir, 'same-title.md'))?.includes('first with this title');
			res.collideFile = (await read(dir, 'same-title-collide0.md'))?.includes('COLLIDE');
			res.collideOriginal = await read(dir, 'collide.md');
			res.notDuplicated = [withText('COLLIDE').length, withText('first with this title').length];

			// A note edited after the app switched vaults: applied to its own vault.
			const vaultA = db.addMemoryObject('Vault A note', 'vault a body');
			const home = vaultA.vaultId;
			await svc.sync();
			const text = await read(dir, 'vault-a-note.md');
			const other = db.addVault('Vault B');
			db.setCurrentVault(other.id);
			await write(dir, 'vault-a-note.md', text.replace('vault a body', 'VAULTEDIT'));
			await write(dir, 'added-then.md', '---\nname: "Added then"\n---\nADDEDTHEN\n');
			await svc.sync();
			res.vaultEdit = db.getMemoryObject(vaultA.id).bodyMarkdown.trim();
			res.addedThen = withText('ADDEDTHEN').map((m) => m.vaultId === home);
			res.addedThenGone = await read(dir, 'added-then.md');
			await svc.sync();
			res.addedOnce = withText('ADDEDTHEN').length;

			// Invalid metadata: the folder stays exactly as it is meanwhile.
			const kurumi = await dir.getDirectoryHandle('.kurumi');
			const good = await read(kurumi, 'metadata.json');
			db.setCurrentVault(home);
			await svc.sync();
			const fresh = await read(kurumi, 'metadata.json');
			await write(dir, 'rewrite-me.md', 'WHILEBROKEN\n');
			await write(kurumi, 'metadata.json', '{ "half": ');
			await svc.sync();
			res.heldWhileBroken = (await read(dir, 'rewrite-me.md')) === 'WHILEBROKEN\n';
			await write(kurumi, 'metadata.json', fresh);
			await svc.sync();
			res.appliedAfterFix = db.getMemoryObject(rewrite.id).bodyMarkdown.trim();

			// Both edit different lines: merged, no copy.
			const merging = db.addMemoryObject('Merging note', 'line one\nline two\nline three\nline four\n');
			await svc.sync();
			const mergeFile = await read(dir, 'merging-note.md');
			db.updateMemoryObject(merging.id, { bodyMarkdown: 'LINE ONE IN APP\nline two\nline three\nline four\n' });
			await write(dir, 'merging-note.md', mergeFile.replace('line four', 'LINE FOUR FROM AGENT'));
			await svc.sync();
			res.merged = db.getMemoryObject(merging.id).bodyMarkdown;
			res.mergedNoCopy = !notes().some((m) => m.title.startsWith('Merging note (edit'));

			// Sync removes nothing outright: a renamed note's old file is archived.
			const renaming = db.addMemoryObject('Before rename', 'ARCHIVEME');
			await svc.sync();
			db.updateMemoryObject(renaming.id, { title: 'After rename' });
			await svc.sync();
			res.renamedAway = await read(dir, 'before-rename.md');
			const archive = await kurumi.getDirectoryHandle('archive');
			const archived = [];
			for await (const h of archive.values()) archived.push(await (await h.getFile()).text());
			res.archivedOld = archived.some((c) => c.includes('ARCHIVEME') && c.includes('Before rename'));

			// A file that repeats a note, without an id: recognised, not doubled.
			await write(dir, 'After rename.md', 'ARCHIVEME\n');
			await svc.sync();
			res.notDoubled = withText('ARCHIVEME').length;

			// Changed, and nothing can take it in: a copy is kept.
			const b = db.addVault('Vault C');
			db.setCurrentVault(b.id);
			const foreign = db.addMemoryObject('Other vault note', 'x');
			db.setCurrentVault(home);
			await svc.sync();
			await write(dir, 'same-title.md', `---\nid: ${foreign.id}\nname: "Other vault note"\n---\nSTRANDED\n`);
			await svc.sync();
			const rescued = await kurumi.getDirectoryHandle('rescued').catch(() => null);
			const copies = [];
			if (rescued) for await (const h of rescued.values()) copies.push(await (await h.getFile()).text());
			res.rescued = copies.some((c) => c.includes('STRANDED'));
			res.firstRestored = (await read(dir, 'same-title.md'))?.includes('first with this title');
			res.firstUntouched = db.getMemoryObject(first.id).bodyMarkdown.trim();

			// Switching layouts there and back: everything moved, nothing deleted.
			localStorage.setItem('kurumi-local-fs-all-vaults', '1');
			res.toAll = await svc.sync();
			const index = JSON.parse(await read(kurumi, 'vaults.json')).vaults;
			const vaultDirs = Object.values(index);
			localStorage.removeItem('kurumi-local-fs-all-vaults');
			res.toSingle = await svc.sync();
			const names = [];
			for await (const h of dir.values()) names.push(h.name);
			res.vaultDirsGone = vaultDirs.filter((d) => names.includes(d));
			const archivedNames = [];
			for await (const h of (await kurumi.getDirectoryHandle('archive')).values()) archivedNames.push(h.name);
			res.vaultMetaArchived = vaultDirs.every((d) => archivedNames.some((n) => n.includes(`${d}__.kurumi__metadata.json`)));
			res.notesBack = (await read(dir, 'merging-note.md'))?.includes('LINE FOUR FROM AGENT');
			return res;
		});
		assert.deepEqual(out.noFrontmatter, ['Rewrite me', 'REWRITTEN', 'keep']);
		assert.equal(out.noFrontmatterCount, 1);
		assert.ok(out.noFrontmatterFile);
		assert.equal(out.emptied, 'REWRITTEN');
		assert.ok(out.emptiedFile, 'emptied file not restored');
		assert.deepEqual(out.otherId, [['otherid01', 'Different']]);
		assert.ok(out.otherIdOwnFile && out.otherIdOldFile, JSON.stringify(out));
		assert.equal(out.oldNoteKept, 'REWRITTEN');
		assert.equal(out.afterTrash, 1);
		assert.ok(out.afterTrashFile, 'file at trashed path deleted');
		assert.ok(out.trashStays);
		assert.ok(out.firstFile && out.collideFile, JSON.stringify(out));
		assert.equal(out.collideOriginal, null);
		assert.deepEqual(out.notDuplicated, [1, 1]);
		assert.equal(out.vaultEdit, 'VAULTEDIT');
		assert.deepEqual(out.addedThen, [true]);
		assert.equal(out.addedThenGone, null);
		assert.equal(out.addedOnce, 1);
		assert.ok(out.heldWhileBroken, 'folder written while metadata invalid');
		assert.equal(out.appliedAfterFix, 'WHILEBROKEN');
		assert.match(out.merged, /LINE ONE IN APP/);
		assert.match(out.merged, /LINE FOUR FROM AGENT/);
		assert.ok(out.mergedNoCopy, 'made a copy instead of merging');
		assert.equal(out.renamedAway, null);
		assert.ok(out.archivedOld, 'old file not in the archive');
		assert.equal(out.notDoubled, 1);
		assert.ok(out.rescued, 'stranded change not rescued');
		assert.ok(out.firstRestored);
		assert.equal(out.firstUntouched, 'first with this title');
		assert.deepEqual(out.toAll, { success: true });
		assert.deepEqual(out.toSingle, { success: true });
		assert.deepEqual(out.vaultDirsGone, []);
		assert.ok(out.vaultMetaArchived, 'vault metadata not archived');
		assert.ok(out.notesBack, 'notes not back at the top level');
		assert.deepEqual(errors, []);
	},

	async 'images show when a note opens, without a click'(browser) {
		const { page, errors } = await freshPage(browser);
		const id = await page.evaluate(async () => {
			const find = (frag) => performance.getEntriesByType('resource').map((e) => e.name).find((n) => n.includes(frag));
			const db = await import(find('/src/lib/db/store.ts'));
			const blobs = await import(find('/src/lib/db/blob-store.ts'));
			const canvas = document.createElement('canvas');
			canvas.width = canvas.height = 40;
			canvas.getContext('2d').fillRect(0, 0, 40, 40);
			const png = await new Promise((r) => canvas.toBlob(r, 'image/png'));
			const ref = await blobs.storeBlob(png, 'image/png');
			return db.addMemoryObject('With image', `before\n\n![pasted image](${ref})\n\nafter`).id;
		});
		await new Promise((r) => setTimeout(r, 800)); // saved
		await page.goto(`${BASE}/#/memory/${id}`, { waitUntil: 'load' });
		const loaded = () =>
			page.waitForFunction(() => {
				const img = document.querySelector('main .ProseMirror img:not(.ProseMirror-separator)');
				return img && img.naturalWidth === 40;
			}, { timeout: 15000 });
		await loaded();
		await page.reload({ waitUntil: 'load' });
		await loaded();
		assert.deepEqual(errors, []);
	},

	async 'content width: wide by default, narrow and full in Appearance, on every page'(browser) {
		const { page, errors } = await freshPage(browser);
		await page.setViewport({ width: 1800, height: 900 });
		const id = await page.evaluate(async () => {
			const find = (frag) => performance.getEntriesByType('resource').map((e) => e.name).find((n) => n.includes(frag));
			const db = await import(find('/src/lib/db/store.ts'));
			return db.addMemoryObject('Wide note', 'text').id;
		});
		const column = async () => {
			await page.goto(`${BASE}/#/memory/${id}`, { waitUntil: 'load' });
			await page.waitForSelector('main .ProseMirror');
			return page.$eval('main .ProseMirror', (el) => el.closest('.mx-auto').getBoundingClientRect().width);
		};
		const pick = async (label) => {
			await page.goto(`${BASE}/#/settings/appearance`, { waitUntil: 'load' });
			await page.waitForSelector('[aria-labelledby="width-label"] button');
			const buttons = await page.$$('[aria-labelledby="width-label"] button');
			for (const b of buttons) if ((await b.evaluate((e) => e.textContent.trim())) === label) await b.click();
		};
		const wide = await column();
		await pick('Narrow');
		const narrow = await column();
		await pick('Full');
		const full = await column();
		await page.reload({ waitUntil: 'load' }); // the choice survives a reload, before first paint
		const kept = await page.evaluate(() => document.documentElement.classList.contains('note-width-full'));
		// Other pages follow it: lists and the home page.
		await page.evaluate(() => localStorage.setItem('kurumi-note-width', 'wide'));
		const pageWidth = async (path, selector) => {
			await page.goto(`${BASE}/#${path}`, { waitUntil: 'load' });
			await page.reload({ waitUntil: 'load' });
			await page.waitForSelector(selector);
			await page.waitForFunction((s) => document.querySelector(s).getBoundingClientRect().width === 64 * 16, { timeout: 15000 }, selector).catch(() => {});
			return page.$eval(selector, (el) => Math.round(el.getBoundingClientRect().width));
		};
		const projects = await pageWidth('/projects', '.k-page');
		const home = await pageWidth('/', '[data-testid="home-page"]');
		assert.equal(narrow, 46 * 16);
		assert.equal(wide, 64 * 16);
		assert.ok(full > wide + 200, `full ${full}`);
		assert.ok(kept);
		assert.equal(projects, 64 * 16);
		assert.equal(home, 64 * 16);
		assert.deepEqual(errors, []);
	},

	async 'mermaid diagrams render in notes, and accents can be chosen'(browser) {
		const { page, errors } = await freshPage(browser);
		const source = 'graph TD\n  A[Capture] --> B[Recall]';
		const id = await page.evaluate(async (src) => {
			const find = (frag) => performance.getEntriesByType('resource').map((e) => e.name).find((n) => n.includes(frag));
			const db = await import(find('/src/lib/db/store.ts'));
			return db.addMemoryObject('Diagram', `Intro\n\n\`\`\`mermaid\n${src}\n\`\`\`\n\nAfter`).id;
		}, source);
		await new Promise((r) => setTimeout(r, 800));
		await page.goto(`${BASE}/#/memory/${id}`, { waitUntil: 'load' });
		await page.waitForSelector('main .kurumi-mermaid-preview svg', { timeout: 30000 });
		const shown = await page.$eval('main .kurumi-mermaid', (el) => ({
			text: el.querySelector('svg').textContent,
			sourceHidden: getComputedStyle(el.querySelector('pre')).display === 'none'
		}));
		assert.match(shown.text, /Capture/);
		assert.ok(shown.sourceHidden, 'source shown while not editing');

		// Click the diagram: its source opens; edit it, and the diagram follows.
		await page.click('main .kurumi-mermaid-preview');
		await page.waitForFunction(() => getComputedStyle(document.querySelector('main .kurumi-mermaid pre')).display !== 'none');
		await page.keyboard.type('\n  B --> C[Act]');
		await page.waitForFunction(() => document.querySelector('main .kurumi-mermaid-preview svg')?.textContent.includes('Act'), { timeout: 15000 });
		// Broken source: an error, and the note keeps working.
		await page.keyboard.type(' -->');
		await page.waitForSelector('main .kurumi-mermaid-error', { timeout: 15000 });
		for (let i = 0; i < 4; i++) await page.keyboard.press('Backspace');
		await page.waitForFunction(() => !document.querySelector('main .kurumi-mermaid-error'), { timeout: 15000 });
		await new Promise((r) => setTimeout(r, 1500)); // autosave
		const stored = await page.evaluate(async (noteId) => {
			const find = (frag) => performance.getEntriesByType('resource').map((e) => e.name).find((n) => n.includes(frag));
			const db = await import(find('/src/lib/db/store.ts'));
			return db.getMemoryObject(noteId).bodyMarkdown;
		}, id);
		assert.match(stored, /```mermaid\ngraph TD\n {2}A\[Capture\] --> B\[Recall\]\n {2}B --> C\[Act\]\n```/);

		// Read mode renders it too.
		await page.goto(`${BASE}/#/read/${id}`, { waitUntil: 'load' });
		await page.waitForFunction(() => [...document.querySelectorAll('svg')].some((s) => s.textContent.includes('Act')), { timeout: 30000 });

		// Accent colour: picked in Appearance, used by the app, kept on reload.
		await page.goto(`${BASE}/#/settings/appearance`, { waitUntil: 'load' });
		await page.waitForSelector('[aria-labelledby="accent-label"] button');
		await page.click('[aria-labelledby="accent-label"] button[aria-label="Teal"]');
		await page.reload({ waitUntil: 'load' });
		// (in the dev server styles arrive after `load`)
		await page.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim() !== '');
		const accent = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim());
		assert.ok(['#179299', '#94e2d5'].includes(accent), accent);
		assert.deepEqual(errors, []);
	},

	async 'math, aliased links and a database'(browser) {
		const { page, errors } = await freshPage(browser);
		const ids = await db(page, `
			db.addMemoryObject('Roadmap', 'The plan.');
			const note = db.addMemoryObject('Notes', 'See [[Roadmap|the plan]] for $5 and $10.');
			const folder = db.addFolder('Tasks');
			const view = db.openFolderAsDatabase(folder.id);
			db.setDatabaseProperties(folder.id, [{ key: 'status', label: 'Status', type: 'select', options: ['Todo', 'Done'] }]);
			const row = db.addDatabaseRow(folder.id, 'Write spec', { status: 'Todo' });
			return { note: note.id, view: view.id, row: row.id, roadmap: db.findBacklinks(db.findMemoryObjectByTitle('Roadmap').id).length };
		`);
		assert.equal(ids.roadmap, 1, 'an aliased link is a backlink');

		// Math typed in the editor: a node, stored as LaTeX (not escaped);
		// the alias reads [[the plan]] and dollar amounts stay text.
		await page.goto(`${BASE}/#/memory/${ids.note}`, { waitUntil: 'load' });
		await page.waitForSelector('main .ProseMirror .wikilink');
		assert.deepEqual(await page.$$eval('main .wikilink-target-hidden', (e) => e.map((x) => x.textContent)), ['Roadmap|']);
		await page.click('main .ProseMirror');
		await page.keyboard.press('End');
		await page.keyboard.type(' Area $a_1^2$ done.');
		await page.waitForSelector('main .kurumi-math-inline .katex', { timeout: 15000 });
		assert.equal(await page.$$eval('main .kurumi-math-inline', (e) => e.length), 1);
		await sleep(1500); // autosave
		const body = await db(page, `return db.getMemoryObject(arg).bodyMarkdown;`, ids.note);
		assert.equal(body.trim(), 'See [[Roadmap|the plan]] for $5 and $10. Area $a_1^2$ done.');
		await page.goto(`${BASE}/#/read/${ids.note}`, { waitUntil: 'load' });
		await page.waitForSelector('.markdown-content .math-inline .katex', { timeout: 15000 });
		assert.equal(await page.$eval('.markdown-content a.wikilink', (a) => a.textContent), 'the plan');

		// The database: change a select through its popover (adding an option),
		// and see it on the board and on the note.
		await page.goto(`${BASE}/#/database/${ids.view}`, { waitUntil: 'load' });
		await page.waitForSelector('td .pv-btn');
		await page.click('td .pv-btn');
		await page.waitForSelector('[role="dialog"] input');
		await sleep(100);
		await page.keyboard.type('Blocked');
		await page.keyboard.press('Enter');
		await page.waitForFunction(() => document.querySelector('td .k-chip')?.textContent === 'Blocked');
		const view = await db(page, `let vs; db.databaseViews.subscribe((v) => (vs = v))(); return vs[0].properties[0].options;`);
		assert.deepEqual(view, ['Todo', 'Done', 'Blocked']);
		await page.goto(`${BASE}/#/memory/${ids.row}`, { waitUntil: 'load' });
		await page.waitForSelector('.note-prop');
		assert.match(await page.$eval('.note-props', (e) => e.textContent), /Status\s*Blocked/);
		assert.deepEqual(errors, []);
	},

	async 'heading and block links, synced blocks, columns and folds'(browser) {
		const { page, errors } = await freshPage(browser);
		const filler = Array.from({ length: 25 }, (_, i) => `Filler paragraph ${i}.`).join('\n\n');
		const ids = await db(page, `
			const src = db.addMemoryObject('Plan', '# Plan\\n\\n' + arg + '\\n\\n## Goals\\n\\nShip the beta ^g01\\n\\n## Risks\\n\\nNone.');
			const note = db.addMemoryObject('Board', 'See [[Plan#Goals]].\\n\\n::::columns\\n:::column\\nLeft\\n:::\\n\\n:::column\\n- one\\n- two\\n:::\\n::::\\n\\n## Folded\\n\\nHidden text\\n\\n![[Plan#^g01]]\\n');
			return { src: src.id, note: note.id };
		`, filler);
		await page.goto(`${BASE}/#/memory/${ids.note}`, { waitUntil: 'load' });
		await page.waitForSelector('main .kurumi-columns');
		assert.deepEqual(await page.$$eval('main .kurumi-column', (c) => c.map((x) => x.textContent.trim())), ['Left', 'onetwo']);
		// Typing in a column keeps the markdown (and the list tight)
		await page.click('main .kurumi-column:nth-child(2) li:last-child p');
		await page.keyboard.press('End');
		await page.keyboard.type('!');
		await sleep(1500);
		const body = await db(page, `return db.getMemoryObject(arg).bodyMarkdown;`, ids.note);
		assert.match(body, /::::columns\n:::column\nLeft\n:::\n\n:::column\n- one\n- two!\n:::\n::::/);
		// Folding hides the section, not the text
		await page.evaluate(() => {
			// The fold caret sits in the margin, left of the heading
			const h = document.querySelector('main .milkdown h2.foldable');
			const r = h.getBoundingClientRect();
			h.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: r.left - 10, clientY: r.top + r.height / 2 }));
		});
		await page.waitForFunction(() => [...document.querySelectorAll('main .fold-hidden')].some((e) => e.textContent.includes('Hidden text')));
		// Synced block: edit it here, saved in Plan with its id
		await page.click('main .note-embed-edit');
		await page.waitForSelector('main .note-embed-editor');
		await page.evaluate(() => {
			const t = document.querySelector('main .note-embed-editor');
			t.value = 'Ship the beta and docs';
			t.dispatchEvent(new Event('input', { bubbles: true }));
		});
		await page.click('main .note-embed-edit');
		await sleep(800);
		assert.match(await db(page, `return db.getMemoryObject(arg).bodyMarkdown;`, ids.src), /Ship the beta and docs \^g01/);
		// A heading link opens the note scrolled to the heading
		await page.click('main .milkdown .wikilink');
		await page.waitForFunction((id) => location.hash.includes(id), {}, ids.src);
		await page.waitForFunction(
			() => {
				const h = [...document.querySelectorAll('main .milkdown h2')].find((x) => x.textContent.includes('Goals'));
				if (!h) return false;
				const r = h.getBoundingClientRect();
				return r.top > 0 && r.bottom < innerHeight;
			},
			{ timeout: 10000 }
		);
		assert.deepEqual(errors, []);
	},

	async 'databases: relations, rollups, formulas, grouping and a timeline'(browser) {
		const { page, errors } = await freshPage(browser);
		const ids = await db(page, `
			const tasks = db.addFolder('Tasks');
			const tasksView = db.openFolderAsDatabase(tasks.id);
			db.setDatabaseProperties(tasks.id, [
				{ key: 'points', label: 'Points', type: 'number' },
				{ key: 'done', label: 'Done', type: 'checkbox' },
				{ key: 'start', label: 'Start', type: 'date' },
				{ key: 'stage', label: 'Stage', type: 'select', options: ['Todo', 'Done'] }
			]);
			const a = db.addDatabaseRow(tasks.id, 'Spec', { points: 3, done: true, start: '2026-11-02', stage: 'Done' });
			const b = db.addDatabaseRow(tasks.id, 'Build', { points: 5, start: '2026-11-09', stage: 'Todo' });
			const projects = db.addFolder('Projects');
			const projView = db.openFolderAsDatabase(projects.id);
			db.setDatabaseProperties(projects.id, [
				{ key: 'tasks', label: 'Tasks', type: 'relation', relationTo: tasks.id },
				{ key: 'total', label: 'Total', type: 'rollup', rollup: { relation: 'tasks', property: 'points', fn: 'sum' } },
				{ key: 'label', label: 'Label', type: 'formula', formula: 'concat(prop("Total"), " pts")' }
			]);
			db.addDatabaseRow(projects.id, 'Launch', { tasks: [a.id, b.id] });
			return { tasksView: tasksView.id, projView: projView.id };
		`);
		await page.goto(`${BASE}/#/database/${ids.projView}`, { waitUntil: 'load' });
		await page.waitForSelector('main tbody tr');
		const row = await page.$eval('main tbody tr', (r) => [...r.querySelectorAll('td')].map((td) => td.textContent.replace(/\s+/g, ' ').trim()));
		assert.deepEqual(row.slice(0, 4), ['Launch', 'Spec Build', '8', '8 pts']);
		await page.goto(`${BASE}/#/database/${ids.tasksView}`, { waitUntil: 'load' });
		await page.waitForSelector('main select[aria-label="Group by"]');
		await page.select('main select[aria-label="Group by"]', 'prop:stage');
		await page.waitForFunction(() => document.querySelectorAll('main .db-group-head').length === 2);
		await db(page, `db.updateDatabaseView(arg, { viewType: 'timeline', dateField: 'prop:start' });`, ids.tasksView);
		await page.waitForFunction(() => document.querySelectorAll('main .db-tl-bar').length === 2);
		assert.deepEqual(errors, []);
	},

	async 'canvas: cards, a connection, saved as JSON Canvas'(browser) {
		const { page, errors } = await freshPage(browser);
		const id = await db(page, `db.addMemoryObject('Roadmap', 'The plan.'); return db.addCanvas('Planning').id;`);
		await page.goto(`${BASE}/#/memory/${id}`, { waitUntil: 'load' });
		await page.waitForSelector('main .canvas-viewport');
		assert.match(await page.evaluate(() => location.hash), /canvas/);
		const vp = await (await page.$('main .canvas-viewport')).boundingBox();
		await page.mouse.click(vp.x + 250, vp.y + 220, { clickCount: 2 });
		await page.waitForSelector('main .card-editor');
		await sleep(100);
		await page.keyboard.type('An idea');
		await page.mouse.click(vp.x + vp.width - 40, vp.y + vp.height - 40);
		await clickText(page, 'main .canvas-toolbar button', 'Note');
		await page.waitForSelector('[role="dialog"] input');
		await sleep(100);
		await page.keyboard.type('Road');
		await page.keyboard.press('Enter');
		await page.waitForFunction(() => document.querySelectorAll('main .canvas-card').length === 2);
		const cards = await page.$$('main .canvas-card');
		const text = await cards[0].boundingBox();
		await page.mouse.click(text.x + 15, text.y + 15);
		const handle = await (await page.waitForSelector('main .canvas-card.is-selected .handle-right')).boundingBox();
		const note = await cards[1].boundingBox();
		await page.mouse.move(handle.x + 6, handle.y + 6);
		await page.mouse.down();
		await page.mouse.move(note.x + note.width / 2, note.y + note.height / 2, { steps: 8 });
		await page.mouse.up();
		await sleep(1000);
		const saved = JSON.parse(await db(page, `return db.getMemoryObject(arg).bodyMarkdown;`, id));
		assert.deepEqual(saved.nodes.map((n) => n.type), ['text', 'file']);
		assert.equal(saved.nodes[0].text, 'An idea');
		assert.equal(saved.edges.length, 1);
		assert.deepEqual(errors, []);
	},

	async 'vim mode: normal, insert and operators'(browser) {
		const { page, errors } = await freshPage(browser);
		await page.evaluate(() => localStorage.setItem('kurumi-vim', 'on'));
		const id = await db(page, `return db.addMemoryObject('Vim', 'alpha beta gamma\\n\\nsecond line').id;`);
		await page.goto(`${BASE}/#/memory/${id}`, { waitUntil: 'load' });
		await page.reload({ waitUntil: 'load' });
		const p = await page.waitForSelector('main .milkdown .ProseMirror p');
		const box = await p.boundingBox();
		await page.mouse.click(box.x + 2, box.y + box.height / 2);
		await page.waitForSelector('main .vim-badge');
		for (const key of ['0', 'd', 'w', 'w', 'c', 'w']) await page.keyboard.type(key);
		await page.keyboard.type('GAMMA');
		await page.keyboard.press('Escape');
		for (const key of ['j', 'd', 'd', 'u']) await page.keyboard.type(key);
		await sleep(1500);
		assert.equal((await db(page, `return db.getMemoryObject(arg).bodyMarkdown;`, id)).trim(), 'beta GAMMA\n\nsecond line');
		assert.equal(await page.$eval('main .vim-badge', (b) => b.textContent), 'NORMAL');
		assert.deepEqual(errors, []);
	},

	async 'code blocks: highlighting and language picker'(browser) {
		const { page, errors } = await freshPage(browser);
		const id = await db(page, `return db.addMemoryObject('Code', 'Intro\\n\\n\\u0060\\u0060\\u0060ts\\nconst answer = 42;\\n\\u0060\\u0060\\u0060\\n').id;`);
		await page.goto(`${BASE}/#/memory/${id}`, { waitUntil: 'load' });
		await page.waitForSelector('main .kurumi-code .hljs-keyword', { timeout: 15000 });
		assert.equal(await page.$eval('main .kurumi-code .hljs-keyword', (e) => e.textContent), 'const');
		// Switch the language from the header: saved in the markdown.
		await page.click('main .kurumi-code-lang', { clickCount: 3 });
		await page.keyboard.type('python');
		await page.keyboard.press('Enter');
		await sleep(1500);
		assert.match(await db(page, `return db.getMemoryObject(arg).bodyMarkdown;`, id), /```python\nconst answer = 42;/);
		// Typing in the block keeps it highlighted.
		await page.click('main .kurumi-code pre');
		await press(page, MOD, 'End');
		await sleep(200);
		// Read mode highlights too.
		await page.goto(`${BASE}/#/read/${id}`, { waitUntil: 'load' });
		await page.waitForSelector('.markdown-content pre code .hljs-number', { timeout: 15000 });
		assert.deepEqual(errors, []);
	},

	async 'tables: toolbar adds, sorts, aligns and deletes'(browser) {
		const { page, errors } = await freshPage(browser);
		const body = '| Name | Count |\\n| --- | --- |\\n| beta | 10 |\\n| alpha | 2 |\\n';
		const id = await db(page, `return db.addMemoryObject('Table', '${body}').id;`);
		await page.goto(`${BASE}/#/memory/${id}`, { waitUntil: 'load' });
		const cell = await page.waitForSelector('main .ProseMirror td:nth-child(2)');
		await cell.click();
		await page.waitForSelector('.kurumi-table-toolbar:not([hidden])');
		const saved = async () => {
			await sleep(1200);
			return (await db(page, `return db.getMemoryObject(arg).bodyMarkdown;`, id)).trim();
		};
		// Sort by Count (numbers by value), then centre it.
		await page.click('.kurumi-table-toolbar [data-action="sort-asc"]');
		await page.click('.kurumi-table-toolbar [data-action="align-center"]');
		let md = await saved();
		assert.match(md, /\| alpha +\| +2 +\|\n\| beta +\| +10 +\|/);
		assert.match(md, /\| :?-+ \| :-+: \|/);
		// A row below, typed into, and a new column.
		await page.click('.kurumi-table-toolbar [data-action="row-below"]');
		await page.keyboard.type('gamma');
		await page.click('.kurumi-table-toolbar [data-action="col-right"]');
		md = await saved();
		assert.equal(md.split('\n').length, 5);
		assert.match(md, /gamma/);
		assert.equal(md.split('\n')[0].split('|').length - 2, 3);
		// Tab in the last cell adds a row and moves into it.
		await page.click('main .ProseMirror tr:last-child td:last-child');
		await page.keyboard.press('Tab');
		await page.keyboard.type('delta');
		md = await saved();
		assert.match(md.split('\n').at(-1), /^\| delta /);
		// The header row has no "insert above" and can't be deleted.
		await page.click('main .ProseMirror th');
		await sleep(200);
		assert.ok(await page.$eval('.kurumi-table-toolbar [data-action="row-above"]', (b) => b.disabled));
		// Delete the table from the menu.
		await page.click('.kurumi-table-toolbar button[aria-label="More table actions"]');
		await clickOnTop(page, '.kurumi-table-menu .k-menu-item', 'Delete table');
		md = await saved();
		assert.doesNotMatch(md, /\|/);
		assert.ok(await page.$eval('.kurumi-table-toolbar', (b) => b.hidden));
		assert.deepEqual(errors, []);
	},

	async 'checkboxes in notes are to-dos, both ways'(browser) {
		const { page, errors } = await freshPage(browser);
		const id = await db(page, `return db.addMemoryObject('Plan', '- [ ] Send the draft @Alice //2030-01-15\\n- [ ] Book the room\\n').id;`);
		const items = () =>
			db(page, `let a; db.actionItems.subscribe((v) => (a = v))(); return a.filter((i) => i.memoryObjectId === arg).map((i) => ({ id: i.id, text: i.text, status: i.status, dueDate: i.dueDate, assignee: i.assignee }));`, id);
		const body = () => db(page, `return db.getMemoryObject(arg).bodyMarkdown;`, id);
		await sleep(1500);
		let list = await items();
		assert.equal(list.length, 2);
		const draft = list.find((i) => i.text === 'Send the draft');
		assert.deepEqual([draft.dueDate, draft.assignee, draft.status], ['2030-01-15', 'Alice', 'open']);

		// Ticking in the note marks the to-do done.
		await page.goto(`${BASE}/#/memory/${id}`, { waitUntil: 'load' });
		await page.waitForSelector('main .ProseMirror li[data-item-type="task"]');
		await page.click('main .ProseMirror');
		await sleep(300);
		const box = await page.$$eval('main .ProseMirror li[data-item-type="task"]', (ls) => {
			const r = ls.find((x) => x.textContent.includes('Book the room')).getBoundingClientRect();
			return { x: r.left + 8, y: r.top + 12 };
		});
		await page.mouse.click(box.x, box.y);
		await sleep(2500);
		assert.match(await body(), /- \[x\] Book the room/);
		list = await items();
		assert.equal(list.find((i) => i.text === 'Book the room').status, 'done');

		// Done on /actions ticks the line; a new due date is written into it.
		await db(page, `db.updateActionItemStatus(arg, 'done'); db.updateActionItem(arg, { dueDate: '2030-02-01' });`, draft.id);
		await sleep(400);
		assert.match(await body(), /- \[x\] Send the draft @Alice \/\/2030-02-01/);
		// Deleting the to-do removes the line; undo (restore) brings it back.
		const saved = (await db(page, `let a; db.actionItems.subscribe((v) => (a = v))(); return a.find((i) => i.id === arg);`, draft.id));
		await db(page, `db.deleteActionItem(arg);`, draft.id);
		await sleep(1500);
		assert.doesNotMatch(await body(), /Send the draft/);
		assert.equal((await items()).length, 1);
		await db(page, `db.restoreActionItem(arg);`, saved);
		await sleep(1500);
		assert.match(await body(), /Send the draft/);
		assert.equal((await items()).length, 2);
		// Removing the line in the note removes the to-do.
		await db(page, `db.updateMemoryObject(arg, { bodyMarkdown: '- [x] Book the room\\n' });`, id);
		await sleep(1500);
		assert.deepEqual((await items()).map((i) => i.text), ['Book the room']);
		assert.deepEqual(errors, []);
	},

	async 'link suggestions: underline, link and dismiss'(browser) {
		const { page, errors } = await freshPage(browser);
		await db(page, `db.addMemoryObject('Project Alpha', 'The plan.'); db.addMemoryObject('Garden', 'Plants.');`);
		const id = await db(page, `return db.addMemoryObject('Weekly', 'Talked about project alpha today.\\n\\nThe Garden needs water.').id;`);
		await page.goto(`${BASE}/#/memory/${id}`, { waitUntil: 'load' });
		await page.waitForFunction(() => document.querySelectorAll('main .kurumi-link-suggestion').length === 2, { timeout: 10000 });
		assert.deepEqual(await page.$$eval('main .kurumi-link-suggestion', (els) => els.map((e) => e.textContent)), ['project alpha', 'Garden']);
		// Link the first: becomes [[Title|text]] in the note.
		await page.click('main .kurumi-link-suggestion');
		await clickOnTop(page, '.kurumi-link-suggest-menu .k-menu-item', 'Link to');
		await sleep(1500);
		assert.match(await db(page, `return db.getMemoryObject(arg).bodyMarkdown;`, id), /Talked about \[\[Project Alpha\|project alpha\]\] today/);
		// Dismiss the second: gone, and stays gone after a reload.
		await page.waitForFunction(() => document.querySelectorAll('main .kurumi-link-suggestion').length === 1, { timeout: 10000 });
		await page.click('main .kurumi-link-suggestion');
		await clickOnTop(page, '.kurumi-link-suggest-menu .k-menu-item', 'Dismiss');
		await sleep(300);
		assert.equal(await page.$$eval('main .kurumi-link-suggestion', (els) => els.length), 0);
		await page.reload({ waitUntil: 'load' });
		await page.waitForSelector('main .ProseMirror');
		await sleep(2500);
		assert.equal(await page.$$eval('main .kurumi-link-suggestion', (els) => els.length), 0);
		assert.deepEqual(errors, []);
	},

	async 'weekly review: written from /review, linked after'(browser) {
		const { page, errors } = await freshPage(browser);
		// An overdue to-do carries over into any week's review.
		await db(page, `db.addActionItem({ text: 'Overdue thing', dueDate: '2020-01-01' });`);
		await page.goto(`${BASE}/review`, { waitUntil: 'load' });
		await page.waitForSelector('[data-testid="write-review"]');
		await page.click('[data-testid="write-review"]');
		await page.waitForFunction(() => location.hash.includes('/memory/review-'), { timeout: 15000 });
		const id = decodeURIComponent(page.url().split('/memory/')[1]);
		const body = await db(page, `return db.getMemoryObject(arg).bodyMarkdown;`, id);
		assert.match(body, /## Still open/);
		assert.match(body, /- Overdue thing \(due 2020-01-01\)/);
		assert.doesNotMatch(body, /- \[[ x]\]/);
		// Writing it again replaces the same note; the page now links it.
		await page.goto(`${BASE}/review`, { waitUntil: 'load' });
		await page.waitForSelector('[data-testid="review-note"]');
		const count = await db(page, `let ms; db.memoryObjects.subscribe((v) => (ms = v))(); return ms.filter((m) => m.id.startsWith('review-')).length;`);
		assert.equal(count, 1);
		assert.deepEqual(errors, []);
	},

	async 'agent memory: remember, prompt, forget, open the note'(browser) {
		const { page, errors } = await freshPage(browser);
		const mod = (path) => `performance.getEntriesByType('resource').map((e) => e.name).find((n) => n.includes('/src/lib/db/store.ts')).replace('/db/store.ts', '${path}')`;
		const run = (path, source) => page.evaluate(`(async () => { const m = await import(${mod(path)}); ${source} })()`);
		await run('/agent-memory.ts', `m.remember('Prefers summaries as bullet points'); m.remember('prefers summaries as bullet points.'); m.remember('Works on Project Falcon');`);
		await sleep(300);
		const prompt = await run('/agent.ts', 'return m.systemPrompt();');
		assert.match(prompt, /What you remember about the user[^]*- Prefers summaries as bullet points\n- Works on Project Falcon/);
		assert.equal(prompt.match(/bullet points/g).length, 1);
		assert.deepEqual(await run('/agent-memory.ts', `return m.forget('falcon').removed;`), ['Works on Project Falcon']);
		assert.doesNotMatch(await run('/agent.ts', 'return m.systemPrompt();'), /Falcon/);
		// The note is an ordinary note, opened from the agent pane's menu.
		await press(page, MOD, '`');
		await page.waitForSelector('button[aria-label="More options"]');
		await page.click('button[aria-label="More options"]');
		await clickText(page, '.k-menu-item', 'What Kurumi remembers');
		await page.waitForFunction(() => location.hash.includes('/memory/agent-memory-'));
		await page.waitForSelector('main .ProseMirror li');
		assert.match(await page.$eval('main .ProseMirror', (e) => e.textContent), /Prefers summaries as bullet points/);
		assert.deepEqual(errors, []);
	},

	async 'highlights: study page, quiz and save as note'(browser) {
		const { page, errors } = await freshPage(browser);
		await db(page, `db.addMemoryObject('Book', '# Ideas\\nSystem 1 is ==fast and automatic==.\\n\\n\\u0060\\u0060\\u0060\\n==not this==\\n\\u0060\\u0060\\u0060'); db.addMemoryObject('Other', 'a == b and c == d');`);
		await page.goto(`${BASE}/#/read/highlights`, { waitUntil: 'load' });
		await page.waitForSelector('.passage');
		assert.deepEqual(await page.$$eval('.passage mark', (m) => m.map((x) => x.textContent)), ['fast and automatic']);
		// Quiz hides the highlight in its sentence; a click shows it.
		await page.click('.toolbar button[aria-pressed]');
		await page.waitForSelector('.cloze .blank');
		assert.equal(await page.$('.passage mark'), null);
		await page.click('.cloze');
		await page.waitForSelector('.passage mark');
		// Save as note: quotes, linked to the source.
		await clickText(page, 'button', 'Save as note');
		await page.waitForFunction(() => location.hash.includes('/memory/'));
		const id = page.url().split('/memory/')[1];
		assert.match(await db(page, `return db.getMemoryObject(arg).bodyMarkdown;`, id), /## \[\[Book\]\]\n\n> fast and automatic/);
		assert.deepEqual(errors, []);
	},

	async 'settings show the selected local folder'(browser) {
		const { page, errors } = await freshPage(browser);
		const name = await page.evaluate(async () => {
			const kv = await import('/node_modules/idb-keyval/dist/index.js');
			const root = await navigator.storage.getDirectory();
			const dir = await root.getDirectoryHandle('my-kurumi-folder', { create: true });
			await kv.set('kurumi-local-fs-handle', dir);
			localStorage.setItem('kurumi-local-fs-configured', '1');
			localStorage.setItem('kurumi-sync-method', 'local-fs');
			return dir.name;
		});
		await page.goto(`${BASE}/settings/sync`, { waitUntil: 'load' });
		await page.waitForSelector('[data-testid="local-folder-name"]', { timeout: 15000 });
		const shown = await page.$eval('[data-testid="local-folder-name"]', (el) => el.textContent.trim());
		assert.equal(shown, name);
		await page.waitForFunction(() => document.querySelector('[data-testid="local-folder-entries"]')?.textContent.includes('.kurumi/'), { timeout: 30000 });
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
