/**
 * WebDAV sync client.
 *
 * Works with Nextcloud, ownCloud, Synology, QNAP, Box, and any
 * WebDAV-compliant server. Uses simple HTTP (GET/PUT/MKCOL) with
 * Basic auth. CORS must be configured on the server.
 *
 * Object path: /kurumi-sync/<vault-id>.bin
 */

export interface WebDAVConfig {
	url: string; // e.g. "https://cloud.example.com/remote.php/dav/files/user"
	username: string;
	password: string;
}

const STORAGE_KEYS = {
	url: 'kurumi-webdav-url',
	username: 'kurumi-webdav-username',
	password: 'kurumi-webdav-password'
};

export function getWebDAVConfig(): WebDAVConfig | null {
	if (typeof localStorage === 'undefined') return null;
	const url = localStorage.getItem(STORAGE_KEYS.url);
	const username = localStorage.getItem(STORAGE_KEYS.username);
	const password = localStorage.getItem(STORAGE_KEYS.password);
	if (!url || !username || !password) return null;
	return { url, username, password };
}

export function saveWebDAVConfig(config: WebDAVConfig): void {
	if (typeof localStorage === 'undefined') return;
	localStorage.setItem(STORAGE_KEYS.url, config.url);
	localStorage.setItem(STORAGE_KEYS.username, config.username);
	localStorage.setItem(STORAGE_KEYS.password, config.password);
}

export function isWebDAVConfigured(): boolean {
	return getWebDAVConfig() !== null;
}

function authHeader(config: WebDAVConfig): string {
	return 'Basic ' + btoa(`${config.username}:${config.password}`);
}

function objectUrl(config: WebDAVConfig, vaultId: string): string {
	const base = config.url.replace(/\/+$/, '');
	return `${base}/kurumi-sync/${vaultId}.bin`;
}

function keyUrl(config: WebDAVConfig, key: string): string {
	const base = config.url.replace(/\/+$/, '');
	return `${base}/${key.replace(/^\/+/, '')}`;
}

/** Generic object GET by key — used for blob sync. */
export async function webdavGetObject(
	config: WebDAVConfig,
	key: string
): Promise<Uint8Array | null> {
	const response = await fetch(keyUrl(config, key), {
		headers: { Authorization: authHeader(config) }
	});
	if (response.status === 404) return null;
	if (!response.ok) throw new Error(`WebDAV GET failed (${response.status})`);
	return new Uint8Array(await response.arrayBuffer());
}

/** Generic object PUT by key — used for blob sync. */
export async function webdavPutObject(
	config: WebDAVConfig,
	key: string,
	data: Uint8Array,
	contentType = 'application/octet-stream'
): Promise<void> {
	await ensureDirectory(config);
	const response = await fetch(keyUrl(config, key), {
		method: 'PUT',
		headers: { Authorization: authHeader(config), 'Content-Type': contentType },
		body: data.buffer as ArrayBuffer
	});
	if (!response.ok) throw new Error(`WebDAV PUT failed (${response.status})`);
}

async function ensureDirectory(config: WebDAVConfig): Promise<void> {
	const base = config.url.replace(/\/+$/, '');
	try {
		await fetch(`${base}/kurumi-sync/`, {
			method: 'MKCOL',
			headers: { Authorization: authHeader(config) }
		});
	} catch {
		// Directory might already exist or MKCOL not supported — fine either way
	}
}

export async function webdavPull(
	config: WebDAVConfig,
	vaultId: string
): Promise<Uint8Array | null> {
	const url = objectUrl(config, vaultId);
	const response = await fetch(url, {
		headers: { Authorization: authHeader(config) }
	});
	if (response.status === 404) return null;
	if (!response.ok) {
		throw new Error(`WebDAV GET failed (${response.status})`);
	}
	return new Uint8Array(await response.arrayBuffer());
}

export async function webdavPush(
	config: WebDAVConfig,
	vaultId: string,
	data: Uint8Array
): Promise<void> {
	await ensureDirectory(config);
	const url = objectUrl(config, vaultId);
	const response = await fetch(url, {
		method: 'PUT',
		headers: {
			Authorization: authHeader(config),
			'Content-Type': 'application/octet-stream'
		},
		body: data.buffer as ArrayBuffer
	});
	if (!response.ok) {
		throw new Error(`WebDAV PUT failed (${response.status})`);
	}
}

export async function webdavTest(
	config: WebDAVConfig
): Promise<{ success: boolean; error?: string }> {
	try {
		const base = config.url.replace(/\/+$/, '');
		const response = await fetch(`${base}/`, {
			method: 'PROPFIND',
			headers: {
				Authorization: authHeader(config),
				Depth: '0'
			}
		});
		if (response.status === 401 || response.status === 403) {
			return { success: false, error: 'Authentication failed' };
		}
		if (response.ok || response.status === 207) {
			return { success: true };
		}
		return { success: false, error: `Server returned ${response.status}` };
	} catch (err) {
		return {
			success: false,
			error: err instanceof Error ? err.message : 'Connection failed'
		};
	}
}
