// Kurumi desktop shell: one window showing the static web build.
//
// The build is served from app://kurumi, a fixed origin, so IndexedDB (the
// whole vault) survives restarts and updates. The scheme is marked secure, so
// the service worker, the File System Access API (local folder sync) and the
// microphone work as they do in Chrome.

const { app, BrowserWindow, Menu, desktopCapturer, protocol, session, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const SCHEME = 'app';
const HOST = 'kurumi';
const ORIGIN = `${SCHEME}://${HOST}`;
// KURUMI_DEV_URL=http://localhost:5173 npm start loads the dev server instead
// (a different origin, so a different vault).
const DEV_URL = process.env.KURUMI_DEV_URL;
// A throwaway profile for tests (desktop/smoke.mjs).
if (process.env.KURUMI_USER_DATA) app.setPath('userData', process.env.KURUMI_USER_DATA);

const webRoot = app.isPackaged
	? path.join(process.resourcesPath, 'web')
	: path.resolve(__dirname, '..', 'build');

protocol.registerSchemesAsPrivileged([
	{
		scheme: SCHEME,
		privileges: {
			standard: true,
			secure: true,
			supportFetchAPI: true,
			corsEnabled: true,
			stream: true,
			allowServiceWorkers: true,
			codeCache: true
		}
	}
]);

const MIME = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.mjs': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json',
	'.webmanifest': 'application/manifest+json',
	'.wasm': 'application/wasm',
	'.png': 'image/png',
	'.avif': 'image/avif',
	'.webp': 'image/webp',
	'.svg': 'image/svg+xml',
	'.ico': 'image/x-icon',
	'.woff': 'font/woff',
	'.woff2': 'font/woff2',
	'.txt': 'text/plain; charset=utf-8',
	'.md': 'text/markdown; charset=utf-8',
	'.xml': 'application/xml'
};

function fileFor(pathname) {
	const rel = decodeURIComponent(pathname).replace(/^\/+/, '');
	// Prerendered routes are /actions → actions.html, like GitHub Pages.
	const candidates = rel === '' ? ['index.html'] : [rel, `${rel}.html`, path.join(rel, 'index.html')];
	for (const candidate of candidates) {
		const full = path.resolve(webRoot, candidate);
		if (full !== webRoot && !full.startsWith(webRoot + path.sep)) return null;
		try {
			if (fs.statSync(full).isFile()) return full;
		} catch {
			// try the next one
		}
	}
	return null;
}

async function serve(request) {
	const url = new URL(request.url);
	if (url.host !== HOST) return new Response('Not found', { status: 404 });
	let file = fileFor(url.pathname);
	// Dynamic routes (/memory/<id>, …) get the SPA shell, as on the web host.
	// Missing assets (anything with an extension) stay 404.
	if (!file && !path.extname(url.pathname)) file = path.join(webRoot, '404.html');
	if (!file) return new Response('Not found', { status: 404 });
	const body = await fs.promises.readFile(file);
	const type = MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
	return new Response(body, { headers: { 'content-type': type } });
}

function isAppUrl(url) {
	return url.startsWith(`${ORIGIN}/`) || url === ORIGIN || (DEV_URL && url.startsWith(DEV_URL));
}

function openOutside(url) {
	if (/^(https?|mailto):/i.test(url)) shell.openExternal(url);
}

let mainWindow = null;

function createWindow() {
	mainWindow = new BrowserWindow({
		width: 1360,
		height: 880,
		minWidth: 360,
		minHeight: 480,
		title: 'Kurumi',
		show: false,
		autoHideMenuBar: true,
		webPreferences: {
			contextIsolation: true,
			sandbox: true,
			spellcheck: true
		}
	});
	mainWindow.once('ready-to-show', () => mainWindow?.show());
	mainWindow.on('closed', () => (mainWindow = null));

	const { webContents } = mainWindow;
	// Links to the web open in the default browser; attachments (blob: URLs)
	// and app pages open in a Kurumi window.
	webContents.setWindowOpenHandler(({ url }) => {
		if (isAppUrl(url) || url.startsWith('blob:')) return { action: 'allow' };
		openOutside(url);
		return { action: 'deny' };
	});
	webContents.on('will-navigate', (event, url) => {
		if (isAppUrl(url)) return;
		event.preventDefault();
		openOutside(url);
	});

	mainWindow.loadURL(DEV_URL ?? `${ORIGIN}/`);
}

// Tab/window audio for meeting recordings (getDisplayMedia). macOS 15+ shows
// the system picker; elsewhere the first screen is shared, with system audio
// on Windows (Electron can only capture it there).
function handleDisplayMedia() {
	session.defaultSession.setDisplayMediaRequestHandler(
		async (_request, callback) => {
			try {
				const [source] = await desktopCapturer.getSources({ types: ['screen'] });
				if (!source) return callback({});
				callback(process.platform === 'win32' ? { video: source, audio: 'loopback' } : { video: source });
			} catch {
				callback({});
			}
		},
		{ useSystemPicker: true }
	);
}

// The default menu binds Cmd/Ctrl+R (References in Kurumi), Cmd/Ctrl+Shift+R
// (Read mode) and Ctrl+Shift+I (Inbox) to reload and DevTools. This one
// keeps the standard edit/window items and moves those out of the way.
function buildMenu() {
	const isMac = process.platform === 'darwin';
	const template = [
		...(isMac ? [{ role: 'appMenu' }] : [{ label: 'File', submenu: [{ role: 'quit' }] }]),
		{ role: 'editMenu' },
		{
			label: 'View',
			submenu: [
				{ label: 'Reload', accelerator: 'F5', click: (_item, win) => win?.webContents.reload() },
				{
					label: 'Developer Tools',
					accelerator: isMac ? 'Alt+Cmd+J' : 'F12',
					click: (_item, win) => win?.webContents.toggleDevTools()
				},
				{ type: 'separator' },
				{ role: 'resetZoom' },
				{ role: 'zoomIn' },
				{ role: 'zoomOut' },
				{ type: 'separator' },
				{ role: 'togglefullscreen' }
			]
		},
		{ role: 'windowMenu' },
		{
			role: 'help',
			submenu: [
				{ label: 'Kurumi on the web', click: () => shell.openExternal('https://kurumi.raskell.io/') },
				{ label: 'Source code', click: () => shell.openExternal('https://github.com/raskell-io/kurumi') }
			]
		}
	];
	Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

if (!app.requestSingleInstanceLock()) {
	app.quit();
} else {
	app.on('second-instance', () => {
		if (!mainWindow) return createWindow();
		if (mainWindow.isMinimized()) mainWindow.restore();
		mainWindow.focus();
	});

	if (process.platform === 'win32') app.setAppUserModelId('io.raskell.kurumi');

	app.whenReady().then(() => {
		protocol.handle(SCHEME, serve);
		handleDisplayMedia();
		buildMenu();
		createWindow();
		app.on('activate', () => {
			if (BrowserWindow.getAllWindows().length === 0) createWindow();
		});
	});

	app.on('window-all-closed', () => {
		if (process.platform !== 'darwin') app.quit();
	});
}
