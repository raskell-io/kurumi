// Injected at document start in self-test mode only (selftest.rs). Checks
// the running app from inside its webview and reports to desktop/selftest.mjs.
// Phase 1 writes data and exercises folder sync, then links the fixture
// folder `<dir>/linked` as a vault and uses it through the app's own UI and
// the real commands (linked.rs): listing, a keyed link, the watcher, an
// edit, a conflict, a new note (a file only once it has text). Phase 2 (a restart) checks the data is
// still there, that the linked vault is current again without a dialog and
// that a deep link opens the app.
(() => {
	if (window.top !== window) return;
	const phase = __PHASE__;
	const nonce = __NONCE__;
	const errors = [];
	// On macOS the self-test's web storage outlives a run (one data store,
	// selftest.rs): a linked folder from an earlier run is gone from disk.
	// Forgotten here, before the app starts and looks for it.
	if (phase === '1') {
		localStorage.removeItem('kurumi-linked-vaults');
		localStorage.removeItem('kurumi-active-linked-vault');
	}
	addEventListener('error', (e) => errors.push(String(e.message)));
	addEventListener('unhandledrejection', (e) => errors.push(`unhandled: ${e.reason?.message ?? e.reason}`));

	const invoke = (cmd, args, options) => window.__TAURI_INTERNALS__.invoke(cmd, args, options);
	const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
	async function until(fn, ms) {
		const end = Date.now() + ms;
		while (Date.now() < end) {
			if (await fn()) return true;
			await sleep(200);
		}
		return false;
	}
	// ---- Linked folder vault (src/lib/linked, src-tauri/src/linked.rs) ----

	const VAULT_MENU = 'aside button.flex.max-w-full';
	const DIALOG = '[data-testid="linked-vault-dialog"]';
	const all = (selector) => [...document.querySelectorAll(selector)];
	const text = (el) => (el?.textContent ?? '').trim();
	const byText = (selector, part) => all(selector).find((el) => el.textContent.includes(part));
	const rows = () => all('.note-row').map(text);
	const hasRow = (title) => rows().some((row) => row.includes(title));
	async function need(what, fn, ms = 15000) {
		let found;
		if (!(await until(async () => (found = await fn()), ms))) throw new Error(`timed out waiting for ${what}`);
		return found;
	}
	// A click as the editor needs it: where the element is, pressed and released.
	function mouse(el) {
		el.scrollIntoView({ block: 'center' });
		const box = el.getBoundingClientRect();
		const init = { bubbles: true, cancelable: true, view: window, button: 0, detail: 1, clientX: box.left + Math.min(box.width / 2, 12), clientY: box.top + box.height / 2 };
		for (const type of ['mousedown', 'mouseup', 'click']) el.dispatchEvent(new MouseEvent(type, init));
	}
	async function openNote(title) {
		// The tree is drawn again when the vault is read again: a row found
		// just before that is gone when clicked, so click until the note is open.
		let clicks = 0;
		await need(`the note "${title}" (clicked its row ${clicks} times; the page shows "${document.querySelector('input[aria-label="Note title"]')?.value}")`, () => {
			if (document.querySelector('input[aria-label="Note title"]')?.value === title) return true;
			byText('.note-row', title)?.click();
			clicks++;
			return false;
		});
		await need('the editor', () => document.querySelector('main .ProseMirror'));
		await sleep(700);
	}
	const editorText = () => text(document.querySelector('main .ProseMirror'));
	// Type at the end of the line that reads `line`.
	function typeAfter(line, typed) {
		const editor = document.querySelector('main .ProseMirror');
		const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
		for (let node = walker.nextNode(); node; node = walker.nextNode()) {
			const at = node.textContent.indexOf(line);
			if (at < 0) continue;
			editor.focus();
			const range = document.createRange();
			range.setStart(node, at + line.length);
			range.collapse(true);
			getSelection().removeAllRanges();
			getSelection().addRange(range);
			if (!document.execCommand('insertText', false, typed)) throw new Error('the editor took no typing');
			return;
		}
		throw new Error(`"${line}" is not in the editor: ${editorText().slice(0, 200)}`);
	}
	// The first place two texts differ, for a failure's detail.
	function difference(got, want) {
		let i = 0;
		while (i < got.length && i < want.length && got[i] === want[i]) i++;
		return `at ${i}: got ${JSON.stringify(got.slice(Math.max(0, i - 20), i + 60))}, expected ${JSON.stringify(want.slice(Math.max(0, i - 20), i + 60))}`;
	}
	const same = (got, want, what) => {
		if (got !== want) throw new Error(`${what} differs ${difference(got, want)}`);
	};
	// Waits until the file reads `want`; says where it differs if it never does.
	async function needFile(disk, rel, want, what = rel, ms = 15000) {
		let got = '';
		const read = async () => (got = await disk.read(rel).catch((e) => `(${e})`)) === want;
		if (!(await until(read, ms))) same(got, want, what);
	}
	const failure = (promise) => promise.then(() => 'no error', (e) => String(e));

	// The folder as it is on disk, through the plain folder commands
	// (folders.rs): "outside" as far as the linked vault is concerned.
	function folderOnDisk(root) {
		const sep = root.includes('\\') && !root.includes('/') ? '\\' : '/';
		const at = (rel) => root + sep + rel.split('/').join(sep);
		return {
			read: async (rel) => new TextDecoder('utf-8', { ignoreBOM: true }).decode(await invoke('fs_read', { path: at(rel) })),
			write: (rel, content) => invoke('fs_write', new TextEncoder().encode(content), { headers: { 'x-kurumi-path': encodeURIComponent(at(rel)) } }),
			remove: (rel) => invoke('fs_remove', { path: at(rel), recursive: false }),
			exists: (rel) => invoke('fs_stat', { path: at(rel) }).then(() => true, () => false),
			modified: async (rel) => (await invoke('fs_stat', { path: at(rel) })).modified,
			list: async () => (await invoke('fs_list', { path: root })).map((e) => e.name).sort()
		};
	}
	const linkedConfig = () => JSON.parse(localStorage.getItem('kurumi-linked-vaults') ?? '[]').at(-1);
	const NOTES = ['bar.md', 'crlf.md', 'foo.md', 'readme.md'];

	// Runs the steps in order; after one fails the rest are reported as not run.
	function steps(check) {
		let failed = null;
		return async (name, fn) => {
			if (failed) return check(name, false, `not run: "${failed}" failed`);
			try {
				check(name, true, await fn());
			} catch (e) {
				failed = name;
				check(name, false, e?.message ?? e);
			}
		};
	}

	async function linkedFolder(check) {
		const step = steps(check);
		let disk;
		let vault;
		const original = {};
		const modified = {};

		await step('linked: link a folder from the vault menu', async () => {
			// The folder dialog now "chooses" <dir>/linked.
			await invoke('selftest_folder', { name: 'linked' });
			(await need('the vault menu', () => document.querySelector(VAULT_MENU))).click();
			(await need('"Link a folder" in the menu', () => byText('.k-menu-item', 'Link a folder'))).click();
			(await need('the dialog', () => byText(`${DIALOG} button`, 'Choose folder'))).click();
			const found = text(await need('a first look at the notes', () => document.querySelector('[data-testid="linked-conventions"]')));
			if (!/4 notes, 3 with frontmatter: id \(100%\)/.test(found)) throw new Error(found);
			if (document.querySelector('#linked-key').value !== 'id') throw new Error(`link key field: ${document.querySelector('#linked-key').value}`);
			if (document.querySelector('[data-testid="linked-allow-editing"]').checked) throw new Error('editing is on before it was asked for');
			byText(`${DIALOG} button`, 'Link folder').click();
			await need('the notes in the tree', () => rows().length === 4, 20000);
			for (const title of ['Bar plan', 'Foo launch', 'Readme', 'Windows']) if (!hasRow(title)) throw new Error(`no "${title}" in ${rows().join(' | ')}`);
			const dialogs = await invoke('selftest_dialogs');
			if (dialogs !== 2) throw new Error(`the folder dialog was asked for ${dialogs} times, not once for each folder`);
			const config = linkedConfig();
			if (!config?.path || localStorage.getItem('kurumi-active-linked-vault') !== config.id) throw new Error(`the vault was not remembered: ${localStorage.getItem('kurumi-linked-vaults')}`);
			vault = config.id;
			disk = folderOnDisk(config.path);
			for (const rel of NOTES) original[rel] = await disk.read(rel);
			for (const rel of NOTES) modified[rel] = await disk.modified(rel);
			return `${text(document.querySelector(VAULT_MENU))}: ${rows().length} notes; hidden, ignored and .gitignore'd files left out`;
		});

		await step('linked: read-only at first, and a keyed link opens its note', async () => {
			await openNote('Foo launch');
			if (!/Read-only/.test(text(document.querySelector('[data-testid="linked-chip"]')))) throw new Error('no Read-only chip');
			if (document.querySelector('main .ProseMirror').getAttribute('contenteditable') !== 'false') throw new Error('the editor can be typed in');
			const shown = editorText();
			if (!shown.includes('Line one.') || shown.includes('project.foo')) throw new Error(`editor shows: ${shown.slice(0, 200)}`);
			// [[project.bar]] is the note whose frontmatter says id: project.bar.
			mouse(await need('the link', () => document.querySelector('main .ProseMirror .wikilink[data-wikilink-title="project.bar"]')));
			await need('the note "Bar plan"', () => document.querySelector('input[aria-label="Note title"]')?.value === 'Bar plan');
		});

		await step('linked: files changed outside show up through the watcher', async () => {
			let started = Date.now();
			await disk.write('dropped.md', '---\nid: note.dropped\ntitle: Dropped in\n---\nNew file.\n');
			await need('the new file in the tree', () => hasRow('Dropped in'), 20000);
			const added = Date.now() - started;
			started = Date.now();
			await disk.write('dropped.md', '---\nid: note.dropped\ntitle: Dropped twice\n---\nNew file.\n');
			await need('its new title in the tree', () => hasRow('Dropped twice') && !hasRow('Dropped in'), 20000);
			const changed = Date.now() - started;
			started = Date.now();
			await disk.remove('dropped.md');
			await need('it to leave the tree', () => !hasRow('Dropped twice') && rows().length === 4, 20000);
			// What the vault leaves out doesn't show up.
			await disk.write('private/later.md', '# Later\n');
			await disk.write('visible.md', '# Visible\n');
			await need('a second new file', () => hasRow('Visible'), 20000);
			if (hasRow('Later')) throw new Error("a .gitignore'd file was listed");
			await disk.remove('visible.md');
			await disk.remove('private/later.md');
			await need('it to leave the tree', () => rows().length === 4, 20000);
			return `added after ${added} ms, changed after ${changed} ms, removed after ${Date.now() - started} ms`;
		});

		await step('linked: an image arrives as bytes, and only from inside the vault', async () => {
			const bytes = await invoke('linked_read_bytes', { vault, rel: 'assets/pic.png' });
			if (!(bytes instanceof ArrayBuffer)) throw new Error(`got ${Object.prototype.toString.call(bytes)}`);
			const view = new Uint8Array(bytes);
			if (view.length !== 256 || !view.every((b, i) => b === i)) throw new Error(`${view.length} bytes, not the file's`);
			for (const rel of ['../folder/x.png', '.gitignore', 'private/secret.md', '.obsidian/workspace.md']) {
				const refused = await failure(invoke('linked_read_bytes', { vault, rel }));
				if (!/NotAllowedError/.test(refused)) throw new Error(`${rel}: ${refused}`);
			}
			// Reveal in the file manager: the self-test only checks what it would show.
			await invoke('linked_reveal', { vault, rel: 'foo.md' });
			await invoke('linked_reveal', { vault });
			const refused = await failure(invoke('linked_reveal', { vault, rel: '../folder' }));
			if (!/NotAllowedError/.test(refused)) throw new Error(`reveal ../folder: ${refused}`);
			return `${view.length} bytes as an ArrayBuffer`;
		});

		await step("linked: editing is turned on in the vault's settings", async () => {
			document.querySelector(VAULT_MENU).click();
			(await need('"Edit" in the menu', () => byText('.k-menu-item', 'Edit “'))).click();
			const box = await need('the setting', () => document.querySelector(`${DIALOG} [data-testid="linked-allow-editing"]`));
			const watch = text(document.querySelector('[data-testid="linked-watch"]'));
			if (!/right away/.test(watch)) throw new Error(`watching: ${watch}`);
			box.click();
			await need('the setting to be on', () => box.checked);
			byText(`${DIALOG} button`, 'Save').click();
			await need('the dialog to close', () => !document.querySelector(DIALOG));
			if (linkedConfig().readOnly !== false) throw new Error('still read-only in the settings');
			await openNote('Foo launch');
			await need('an editor that can be typed in', () => document.querySelector('main .ProseMirror')?.getAttribute('contenteditable') === 'true');
			return watch;
		});

		await step('linked: opening notes and clicking in them writes nothing', async () => {
			for (const title of ['Readme', 'Windows', 'Bar plan', 'Foo launch']) {
				await openNote(title);
				mouse(document.querySelector('main .ProseMirror'));
				await sleep(600);
			}
			await sleep(800);
			// Not even with the same bytes: a write would replace the file.
			for (const rel of NOTES) {
				same(await disk.read(rel), original[rel], rel);
				if ((await disk.modified(rel)) !== modified[rel]) throw new Error(`${rel} was written`);
			}
			if ((await disk.list()).length !== 9) throw new Error(`in the folder: ${(await disk.list()).join(', ')}`);
		});

		let edited;
		await step('linked: an edit changes its line in the file and nothing else', async () => {
			await openNote('Foo launch');
			typeAfter('Line two.', ' now');
			edited = original['foo.md'].replace('Line two.', 'Line two. now');
			await needFile(disk, 'foo.md', edited);
			const head = (content) => content.slice(0, content.indexOf('\n\n# Foo'));
			same(head(edited), head(original['foo.md']), 'the frontmatter');
			// The app's own write isn't reported back as a change from outside.
			await sleep(1500);
			if (document.querySelector('[data-testid="linked-save-issue"]')) throw new Error('the save raised an issue');
			if (!editorText().includes('Line two. now')) throw new Error('the edit left the editor');
		});

		await step('linked: a file changed on disk since it was read is not overwritten', async () => {
			// Changed outside and typed into on the same line, before the watcher says so.
			const theirs = edited.replace('Line three.', 'Line three, theirs.');
			await disk.write('foo.md', theirs);
			typeAfter('Line three.', ' Mine.');
			await need('the app to ask', () => document.querySelector('[data-testid="linked-save-issue"]'), 20000);
			same(await disk.read('foo.md'), theirs, 'foo.md when the conflict was noticed');
			await sleep(2000);
			same(await disk.read('foo.md'), theirs, 'foo.md while the conflict is open');
			byText('[data-testid="linked-save-issue"] button', 'Resolve').click();
			await need('the conflict dialog', () => document.querySelector('[data-testid="linked-conflict-dialog"]'));
			const mine = text(document.querySelector('[data-testid="conflict-mine"]'));
			const file = text(document.querySelector('[data-testid="conflict-theirs"]'));
			if (!mine.includes('Line three. Mine.') || !file.includes('Line three, theirs.')) throw new Error(`mine: ${mine.slice(-120)} / theirs: ${file.slice(-120)}`);
			byText('[data-testid="linked-conflict-dialog"] button', 'Keep mine').click();
			await needFile(disk, 'foo.md', edited.replace('Line three.', 'Line three. Mine.'), 'foo.md after "Keep mine"');
			await need('the notice to go', () => !document.querySelector('[data-testid="linked-save-issue"]'));
		});

		await step('linked: a blank new note has no file until its first change', async () => {
			const before = await disk.list();
			const button = all('aside button[aria-label="New note"]').find((b) => getComputedStyle(b).display !== 'none');
			if (!button) throw new Error('no New note button');
			button.click();
			// Listed as "Untitled", with an empty title field and an empty editor.
			await need('it in the tree', () => hasRow('Untitled'));
			await need('the new note', () => document.querySelector('input[aria-label="Note title"]')?.value === '');
			const editor = await need('its editor', () => (editorText() === '' ? document.querySelector('main .ProseMirror[contenteditable="true"]') : null));
			// Shown, but not in the folder: left like this it would leave nothing behind.
			await sleep(1500);
			same((await disk.list()).join(', '), before.join(', '), 'the folder before the first change');
			// The first words make the file, with exactly them in it.
			editor.focus();
			const range = document.createRange();
			range.selectNodeContents(editor.querySelector('p') ?? editor);
			range.collapse(false);
			getSelection().removeAllRanges();
			getSelection().addRange(range);
			if (!document.execCommand('insertText', false, 'First words.')) throw new Error('the editor took no typing');
			await need('Untitled.md in the folder', () => disk.exists('Untitled.md'), 15000);
			await needFile(disk, 'Untitled.md', 'First words.');
		});

		await step('linked: the folder holds the notes and nothing of Kurumi', async () => {
			const expected = ['.gitignore', '.obsidian', 'Untitled.md', 'assets', 'bar.md', 'crlf.md', 'foo.md', 'node_modules', 'private', 'readme.md'];
			let names = [];
			// Once the last write has settled (its temporary file is gone).
			if (!(await until(async () => (names = await disk.list()).join(',') === expected.join(','), 10000))) throw new Error(names.join(', '));
			for (const rel of ['bar.md', 'crlf.md', 'readme.md']) same(await disk.read(rel), original[rel], rel);
			same(await disk.read('Untitled.md'), 'First words.', 'Untitled.md');
			localStorage.setItem('kurumi-selftest-foo', await disk.read('foo.md'));
			return names.join(', ');
		});
	}

	// After the restart: on the first page load, before anything is clicked.
	async function linkedAfterRestart() {
		const result = {};
		const check = (name, ok, detail) => (result[name] = { ok: !!ok, detail: detail === undefined ? undefined : String(detail) });
		const step = steps(check);
		let disk;
		await step('restart: the linked vault is current again, without a dialog', async () => {
			await need('its notes in the tree', () => hasRow('Foo launch') && rows().length === 5, 30000);
			const menu = text(document.querySelector(VAULT_MENU));
			if (!menu.includes('linked')) throw new Error(`current vault: ${menu}`);
			// Counted in selftest.rs: every time the app asked for the folder dialog.
			const dialogs = await invoke('selftest_dialogs');
			if (dialogs !== 0) throw new Error(`the folder dialog was asked for ${dialogs} times`);
			disk = folderOnDisk(linkedConfig().path);
			same(await disk.read('foo.md'), localStorage.getItem('kurumi-selftest-foo') ?? '', 'foo.md');
			return `${menu}: ${rows().length} notes, no folder dialog`;
		});
		await step('restart: the folder is watched again', async () => {
			const started = Date.now();
			await disk.write('after-restart.md', '# After restart\n');
			await need('a new file in the tree', () => hasRow('After restart'), 20000);
			const added = Date.now() - started;
			await disk.remove('after-restart.md');
			await need('it to leave the tree', () => !hasRow('After restart'), 20000);
			return `added after ${added} ms`;
		});
		return result;
	}

	function idb(mode, value) {
		return new Promise((resolve, reject) => {
			const open = indexedDB.open('kurumi-selftest', 1);
			open.onupgradeneeded = () => open.result.createObjectStore('kv');
			open.onerror = () => reject(open.error);
			open.onsuccess = () => {
				const tx = open.result.transaction('kv', mode === 'put' ? 'readwrite' : 'readonly');
				const req = mode === 'put' ? tx.objectStore('kv').put(value, 'nonce') : tx.objectStore('kv').get('nonce');
				req.onsuccess = () => resolve(req.result);
				req.onerror = () => reject(req.error);
			};
		});
	}

	addEventListener('load', async () => {
		const report = { phase, checks: {} };
		const check = (name, ok, detail) => {
			report.checks[name] = { ok: !!ok, detail: detail === undefined ? undefined : String(detail) };
		};
		try {
			check('app rendered', await until(() => document.querySelector('main, nav, aside'), 30000), location.href);
			check('fixed origin', ['tauri://localhost', 'https://tauri.localhost'].includes(location.origin), location.origin);
			check('secure context', isSecureContext);
			check('no service worker', !navigator.serviceWorker || (await navigator.serviceWorker.getRegistrations()).length === 0);

			if (phase === '1') {
				localStorage.setItem('kurumi-selftest', nonce);
				await idb('put', nonce);
				check('notifications available', typeof window.Notification === 'function');
				check('microphone API', typeof navigator.mediaDevices?.getUserMedia === 'function');

				check('folder picker installed', typeof window.showDirectoryPicker === 'function');
				const root = await window.showDirectoryPicker({ mode: 'readwrite' });
				localStorage.setItem('kurumi-selftest-folder', root.path);
				const notes = await root.getDirectoryHandle('nested', { create: true });
				const md = await notes.getFileHandle('ä b.md', { create: true });
				let w = await md.createWritable();
				await w.write('# hi');
				await w.close();
				const text = await (await md.getFile()).text();
				check('folder: write and read text', text === '# hi', text);

				const bytes = new Uint8Array(256).map((_, i) => i);
				w = await (await root.getFileHandle('kurumi-sync.bin', { create: true })).createWritable();
				await w.write(bytes);
				await w.close();
				const file = await (await root.getFileHandle('kurumi-sync.bin')).getFile();
				const back = new Uint8Array(await file.arrayBuffer());
				check('folder: binary round trip', file.size === 256 && back.every((b, i) => b === i), `${file.size} bytes`);

				const names = [];
				for await (const e of root.values()) names.push(`${e.name}:${e.kind}`);
				check('folder: list', names.sort().join(',') === 'kurumi-sync.bin:file,nested:directory', names.join(','));

				const missing = await root.getFileHandle('missing.md').catch((e) => e);
				check('folder: NotFoundError', missing instanceof DOMException && missing.name === 'NotFoundError', missing?.name);
				const notEmpty = await root.removeEntry('nested').catch((e) => e);
				check('folder: non-empty folder kept', notEmpty?.name === 'InvalidModificationError', notEmpty?.name);
				await notes.removeEntry('ä b.md');
				await root.removeEntry('nested');

				const outside = await invoke('fs_read', { path: '/etc/hosts' }).then(
					() => 'read it',
					(e) => String(e)
				);
				check('folder: outside refused', /NotAllowedError/.test(outside), outside);

				await linkedFolder(check);

				const a = document.createElement('a');
				a.href = URL.createObjectURL(new Blob(['exported'], { type: 'text/plain' }));
				a.download = 'kurumi-selftest.txt';
				document.body.append(a);
				a.click();
				a.remove();
				await sleep(3000);
			} else {
				if (!sessionStorage.getItem('kurumi-selftest-routed')) {
					// A deep link must open the app (the host has no file for it).
					sessionStorage.setItem('kurumi-selftest-routed', '1');
					report.restartCheck = {
						local: localStorage.getItem('kurumi-selftest'),
						idb: await idb('get')
					};
					sessionStorage.setItem('kurumi-selftest-restart', JSON.stringify(report.restartCheck));
					sessionStorage.setItem('kurumi-selftest-granted', String(await invoke('folder_granted', { path: localStorage.getItem('kurumi-selftest-folder') ?? '' })));
					sessionStorage.setItem('kurumi-selftest-linked', JSON.stringify(await linkedAfterRestart()));
					location.assign('/memory/does-not-exist');
					return;
				}
				const kept = JSON.parse(sessionStorage.getItem('kurumi-selftest-restart') ?? '{}');
				check('restart: localStorage kept', kept.local === nonce, kept.local);
				check('restart: IndexedDB kept', kept.idb === nonce, kept.idb);
				check('restart: picked folder remembered', sessionStorage.getItem('kurumi-selftest-granted') === 'true');
				for (const [name, { ok, detail }] of Object.entries(JSON.parse(sessionStorage.getItem('kurumi-selftest-linked') ?? '{}'))) check(name, ok, detail);
				// The app's hash router (lib/hash-router.ts) moves it to /#/memory/….
				const route = location.pathname === '/' ? location.hash.slice(1) : location.pathname;
				check('deep link opens the app', route === '/memory/does-not-exist', location.href);
			}
			check('no page errors', errors.length === 0, errors.join(' | '));
		} catch (e) {
			check('self-test ran', false, e?.stack ?? e);
		}
		await invoke('selftest_report', { report: JSON.stringify(report) });
	});
})();
