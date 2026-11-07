/**
 * The File System Access API for the desktop app (desktop/, Tauri).
 *
 * WebKit (macOS, Linux) has no showDirectoryPicker, so in the desktop app
 * these classes stand in for FileSystemDirectoryHandle/FileSystemFileHandle,
 * backed by the app's own commands (desktop/src-tauri/src/folders.rs), which
 * only reach folders picked in the system dialog. Only what Kurumi uses is
 * implemented: local folder sync (sync/local-fs.ts) and the Obsidian import.
 *
 * Handles are stored in IndexedDB like the browser's; a stored one comes
 * back as a plain object, which reviveFolderHandle turns into a handle again.
 */

type Invoke = (cmd: string, args?: unknown, options?: { headers: Record<string, string> }) => Promise<unknown>;

interface Entry {
	name: string;
	dir: boolean;
	size: number;
	modified: number;
}

function invoke(cmd: string, args?: unknown, options?: { headers: Record<string, string> }): Promise<unknown> {
	const internals = (globalThis as { __TAURI_INTERNALS__?: { invoke: Invoke } }).__TAURI_INTERNALS__;
	if (!internals) return Promise.reject(new DOMException('Not in the desktop app', 'NotSupportedError'));
	return internals.invoke(cmd, args, options).catch(rethrow);
}

/** Commands fail with "NotFoundError: …"; callers check DOMException names. */
function rethrow(err: unknown): never {
	const message = typeof err === 'string' ? err : err instanceof Error ? err.message : String(err);
	const match = /^(\w+Error): ([\s\S]*)$/.exec(message);
	if (match?.[1] === 'TypeError') throw new TypeError(match[2]);
	if (match) throw new DOMException(match[2], match[1]);
	throw new DOMException(message, 'UnknownError');
}

function child(dir: string, name: string): string {
	if (!name || name === '.' || name === '..' || /[/\\]/.test(name)) {
		throw new TypeError(`Name is not allowed: ${name}`);
	}
	// Windows paths from the app are backslashed (\\?\C:\…), where a slash
	// isn't a separator.
	const sep = dir.includes('\\') && !dir.includes('/') ? '\\' : '/';
	return dir.endsWith(sep) ? `${dir}${name}` : `${dir}${sep}${name}`;
}

const MIME: Record<string, string> = {
	md: 'text/markdown',
	txt: 'text/plain',
	json: 'application/json',
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	pdf: 'application/pdf'
};

/**
 * What getFile() returns: name, size and date right away, the contents only
 * when read. Folder sync looks at the size and date of every file each few
 * seconds and reads few of them.
 */
export class DesktopFile {
	readonly type: string;
	constructor(
		readonly path: string,
		readonly name: string,
		readonly size: number,
		readonly lastModified: number
	) {
		this.type = MIME[name.split('.').pop()?.toLowerCase() ?? ''] ?? '';
	}

	async arrayBuffer(): Promise<ArrayBuffer> {
		const data = await invoke('fs_read', { path: this.path });
		if (data instanceof ArrayBuffer) return data;
		// Older IPC paths hand back a number array.
		return new Uint8Array(data as number[]).buffer;
	}

	async bytes(): Promise<Uint8Array> {
		return new Uint8Array(await this.arrayBuffer());
	}

	async text(): Promise<string> {
		return new TextDecoder().decode(await this.arrayBuffer());
	}
}

async function toBytes(data: unknown): Promise<Uint8Array> {
	if (typeof data === 'string') return new TextEncoder().encode(data);
	if (data instanceof Uint8Array) return data;
	if (data instanceof ArrayBuffer) return new Uint8Array(data);
	if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
	if (typeof Blob !== 'undefined' && data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
	const params = data as { type?: unknown; data?: unknown } | null;
	if (params && typeof params === 'object' && params.type === 'write') return toBytes(params.data);
	throw new TypeError('Unsupported data for write()');
}

/** createWritable(): collects the writes, writes the file on close(). */
class DesktopWritable {
	private chunks: Uint8Array[] = [];
	constructor(private path: string) {}

	async write(data: unknown): Promise<void> {
		this.chunks.push(await toBytes(data));
	}

	async close(): Promise<void> {
		const size = this.chunks.reduce((n, c) => n + c.byteLength, 0);
		const body = new Uint8Array(size);
		let offset = 0;
		for (const c of this.chunks) {
			body.set(c, offset);
			offset += c.byteLength;
		}
		this.chunks = [];
		await invoke('fs_write', body, { headers: { 'x-kurumi-path': encodeURIComponent(this.path) } });
	}

	async abort(): Promise<void> {
		this.chunks = [];
	}
}

export class DesktopFileHandle {
	readonly kind = 'file' as const;
	/** Marks a stored handle as one of these (see reviveFolderHandle). */
	readonly desktop = true;
	constructor(
		readonly path: string,
		readonly name: string
	) {}

	async getFile(): Promise<DesktopFile> {
		const entry = (await invoke('fs_stat', { path: this.path })) as Entry;
		if (entry.dir) throw new DOMException(`${this.name} is a folder`, 'TypeMismatchError');
		return new DesktopFile(this.path, this.name, entry.size, entry.modified);
	}

	async createWritable(): Promise<DesktopWritable> {
		return new DesktopWritable(this.path);
	}

	async queryPermission(): Promise<PermissionState> {
		return 'granted';
	}

	async requestPermission(): Promise<PermissionState> {
		return 'granted';
	}

	async isSameEntry(other: { path?: string }): Promise<boolean> {
		return other?.path === this.path;
	}
}

export class DesktopDirectoryHandle {
	readonly kind = 'directory' as const;
	readonly desktop = true;
	constructor(
		readonly path: string,
		readonly name: string
	) {}

	async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<DesktopDirectoryHandle> {
		const path = child(this.path, name);
		await invoke('fs_open', { path, dir: true, create: !!options?.create });
		return new DesktopDirectoryHandle(path, name);
	}

	async getFileHandle(name: string, options?: { create?: boolean }): Promise<DesktopFileHandle> {
		const path = child(this.path, name);
		await invoke('fs_open', { path, dir: false, create: !!options?.create });
		return new DesktopFileHandle(path, name);
	}

	async removeEntry(name: string, options?: { recursive?: boolean }): Promise<void> {
		await invoke('fs_remove', { path: child(this.path, name), recursive: !!options?.recursive });
	}

	async *entries(): AsyncIterableIterator<[string, DesktopDirectoryHandle | DesktopFileHandle]> {
		const list = (await invoke('fs_list', { path: this.path })) as Entry[];
		for (const e of list) {
			const path = child(this.path, e.name);
			yield [e.name, e.dir ? new DesktopDirectoryHandle(path, e.name) : new DesktopFileHandle(path, e.name)];
		}
	}

	async *values(): AsyncIterableIterator<DesktopDirectoryHandle | DesktopFileHandle> {
		for await (const [, handle] of this.entries()) yield handle;
	}

	async *keys(): AsyncIterableIterator<string> {
		for await (const [name] of this.entries()) yield name;
	}

	[Symbol.asyncIterator]() {
		return this.entries();
	}

	/** 'granted' while the folder is still there and was picked here. */
	async queryPermission(): Promise<PermissionState> {
		return (await invoke('folder_granted', { path: this.path })) ? 'granted' : 'denied';
	}

	async requestPermission(): Promise<PermissionState> {
		return this.queryPermission();
	}

	async isSameEntry(other: { path?: string }): Promise<boolean> {
		return other?.path === this.path;
	}
}

/** window.showDirectoryPicker for the desktop app: the system folder dialog. */
export async function showDesktopDirectoryPicker(): Promise<DesktopDirectoryHandle> {
	const picked = (await invoke('folder_pick')) as { path: string; name: string } | null;
	if (!picked) throw new DOMException('The user aborted a request.', 'AbortError');
	return new DesktopDirectoryHandle(picked.path, picked.name);
}

/**
 * A handle read back from IndexedDB. Structured cloning keeps a desktop
 * handle's fields but not its class; this restores it. Anything else (a
 * browser handle, nothing) is returned as it is.
 */
export function reviveFolderHandle<T>(stored: T): T | DesktopDirectoryHandle {
	const raw = stored as { desktop?: unknown; kind?: unknown; path?: unknown; name?: unknown } | null | undefined;
	if (
		raw &&
		!(raw instanceof DesktopDirectoryHandle) &&
		raw.desktop === true &&
		raw.kind === 'directory' &&
		typeof raw.path === 'string' &&
		typeof raw.name === 'string'
	) {
		return new DesktopDirectoryHandle(raw.path, raw.name);
	}
	return stored;
}
