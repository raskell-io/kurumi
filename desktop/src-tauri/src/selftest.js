// Injected at document start in self-test mode only (selftest.rs). Checks
// the running app from inside its webview and reports to desktop/selftest.mjs.
// Phase 1 writes data and exercises folder sync; phase 2 (a restart) checks
// the data is still there and that a deep link opens the app.
(() => {
	if (window.top !== window) return;
	const phase = __PHASE__;
	const nonce = __NONCE__;
	const errors = [];
	addEventListener('error', (e) => errors.push(String(e.message)));
	addEventListener('unhandledrejection', (e) => errors.push(`unhandled: ${e.reason?.message ?? e.reason}`));

	const invoke = (cmd, args) => window.__TAURI_INTERNALS__.invoke(cmd, args);
	const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
	async function until(fn, ms) {
		const end = Date.now() + ms;
		while (Date.now() < end) {
			if (await fn()) return true;
			await sleep(200);
		}
		return false;
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
					location.assign('/memory/does-not-exist');
					return;
				}
				const kept = JSON.parse(sessionStorage.getItem('kurumi-selftest-restart') ?? '{}');
				check('restart: localStorage kept', kept.local === nonce, kept.local);
				check('restart: IndexedDB kept', kept.idb === nonce, kept.idb);
				check('restart: picked folder remembered', sessionStorage.getItem('kurumi-selftest-granted') === 'true');
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
