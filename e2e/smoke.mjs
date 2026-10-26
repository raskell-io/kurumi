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
// The app's "mod" key: ⌘ on macOS, Ctrl elsewhere.
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

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

		// Paste a URL onto selected text
		const word = await page.evaluate(() => {
			const h = document.querySelector('main .ProseMirror h3').firstChild;
			const i = h.textContent.indexOf('docs');
			const r = document.createRange();
			r.setStart(h, i);
			r.setEnd(h, i + 4);
			const b = r.getBoundingClientRect();
			return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
		});
		await page.mouse.click(word.x, word.y, { clickCount: 2 });
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
		await page.goto(`${BASE}/settings`, { waitUntil: 'load' });
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
		await page.goto(`${BASE}/settings`, { waitUntil: 'load' });
		await sleep(800);
		assert.equal(await page.$('#labs-list'), null);
		await page.evaluate(() => document.querySelector('#labs input[type=checkbox]').click());
		await sleep(300);
		await clickText(page, 'button.section-label', 'Labs');
		assert.match(await page.$eval('#labs-list', (e) => e.textContent), /Habits/);
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
		}
	}
} finally {
	await browser?.close();
	server.kill();
	rmSync(profile, { recursive: true, force: true });
}
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
