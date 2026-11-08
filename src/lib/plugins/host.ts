/**
 * Plugin host: runs each enabled plugin in its own sandboxed iframe and
 * answers its calls.
 *
 * Sandbox, in layers:
 * - `<iframe sandbox="allow-scripts">` without allow-same-origin: the plugin
 *   gets an opaque origin, so it can't reach the app's DOM, IndexedDB,
 *   localStorage, cookies or service worker, and can't navigate the app.
 * - A CSP in the frame, `default-src 'none'`: no network at all (no fetch,
 *   images, sockets or forms), so a plugin can't send notes anywhere.
 * - The only way out is postMessage. The host takes messages only from that
 *   frame's window and runs a method only if the plugin's approved
 *   permissions allow it (manifest.ts). Arguments are copied and checked.
 *
 * Plugins are kept per device in IndexedDB (`kurumi-plugins`).
 */

import { get, writable } from 'svelte/store';
import { get as idbGet, set as idbSet } from 'idb-keyval';
import { addMemoryObject, getMemoryObject, memoryObjects, updateMemoryObject } from '$lib/db';
import { search } from '$lib/search';
import { showNotice } from '$lib/stores/notice';
import { mayCall, parsePlugin, type InstalledPlugin, type PluginManifest } from './manifest';

const STORE_KEY = 'kurumi-plugins';
const MAX_CODE = 512 * 1024;

export const installedPlugins = writable<InstalledPlugin[]>([]);

export interface PluginCommand {
	pluginId: string;
	pluginName: string;
	id: string;
	title: string;
}

/** Commands plugins registered (shown in ⌘K). */
export const pluginCommands = writable<PluginCommand[]>([]);

const frames = new Map<string, HTMLIFrameElement>();
let container: HTMLDivElement | null = null;

// The SDK every plugin sees as `kurumi` (runs inside the frame).
const SDK = `(() => {
	const pending = new Map();
	const commands = new Map();
	let seq = 0;
	const call = (method, params) => new Promise((resolve, reject) => {
		const id = ++seq;
		pending.set(id, { resolve, reject });
		parent.postMessage({ kurumi: 'call', id, method, params: params ?? {} }, '*');
	});
	addEventListener('message', (event) => {
		if (event.source !== parent) return;
		const m = event.data;
		if (!m || typeof m !== 'object') return;
		if (m.kurumi === 'result') {
			const p = pending.get(m.id);
			if (!p) return;
			pending.delete(m.id);
			if (m.error) p.reject(new Error(m.error));
			else p.resolve(m.value);
		} else if (m.kurumi === 'command') {
			const command = commands.get(m.command);
			if (command) Promise.resolve().then(() => command.run(m.context || {})).catch((err) => call('ui.notice', { text: String((err && err.message) || err) }));
		}
	});
	self.kurumi = Object.freeze({
		commands: Object.freeze({
			register: (c) => {
				commands.set(String(c.id), c);
				return call('commands.register', { id: String(c.id), title: String(c.title || c.id) });
			}
		}),
		notes: Object.freeze({
			list: (options) => call('notes.list', options || {}),
			get: (id) => call('notes.get', { id }),
			current: () => call('notes.current', {}),
			create: (note) => call('notes.create', note || {}),
			update: (id, changes) => call('notes.update', { ...(changes || {}), id })
		}),
		ui: Object.freeze({ notice: (text) => call('ui.notice', { text: String(text) }) })
	});
})();`;

/** The frame's document: CSP first, then the SDK, then the plugin. */
export function frameDocument(code: string): string {
	const safe = (s: string) => s.replace(/<\/script/gi, '<\\/script');
	return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'"></head><body><script>${safe(SDK)}</script><script>${safe(code)}</script></body></html>`;
}

const str = (v: unknown, max = 200_000) => (typeof v === 'string' ? v.slice(0, max) : undefined);
const noteSummary = (m: { id: string; title: string; tags?: string[]; updatedAt: number }) => ({ id: m.id, title: m.title, tags: [...(m.tags ?? [])], updatedAt: m.updatedAt });

function currentNoteId(): string | null {
	const match = (location.hash || location.pathname).match(/\/memory\/([^/?#]+)/);
	return match ? decodeURIComponent(match[1]) : null;
}

/** Run one call from plugin `manifest`. Throws with a message the plugin sees. */
async function dispatch(manifest: PluginManifest, method: string, params: Record<string, unknown>): Promise<unknown> {
	if (!mayCall(manifest.permissions, method)) throw new Error(`Not allowed: ${method} (permissions: ${manifest.permissions.join(', ') || 'none'})`);
	const inVault = (id: unknown) => {
		const note = typeof id === 'string' ? getMemoryObject(id) : undefined;
		return note && !note.deletedAt && get(memoryObjects).some((m) => m.id === note.id) ? note : null;
	};
	switch (method) {
		case 'commands.register': {
			const id = str(params.id, 60);
			const title = str(params.title, 80);
			if (!id || !title) throw new Error('A command needs an id and a title');
			pluginCommands.update((list) => [...list.filter((c) => !(c.pluginId === manifest.id && c.id === id)), { pluginId: manifest.id, pluginName: manifest.name, id, title }]);
			return true;
		}
		case 'ui.notice':
			showNotice(`${manifest.name}: ${str(params.text, 300) ?? ''}`);
			return true;
		case 'notes.list': {
			const limit = Math.min(Math.max(Number(params.limit) || 50, 1), 500);
			const query = str(params.query, 500)?.trim();
			const notes = query
				? search(query)
						.map((h) => inVault(h.id))
						.filter((m): m is NonNullable<typeof m> => !!m)
				: [...get(memoryObjects)].sort((a, b) => b.updatedAt - a.updatedAt);
			return notes.slice(0, limit).map(noteSummary);
		}
		case 'notes.get':
		case 'notes.current': {
			const note = inVault(method === 'notes.current' ? currentNoteId() : params.id);
			return note ? { ...noteSummary(note), body: note.bodyMarkdown } : null;
		}
		case 'notes.create': {
			const note = addMemoryObject(str(params.title, 300) ?? 'Untitled', str(params.body) ?? '', null);
			return { id: note.id };
		}
		case 'notes.update': {
			const note = inVault(params.id);
			if (!note) throw new Error('No such note');
			const title = str(params.title, 300);
			const body = str(params.body);
			updateMemoryObject(note.id, { ...(title !== undefined ? { title } : {}), ...(body !== undefined ? { bodyMarkdown: body } : {}) });
			return true;
		}
	}
	throw new Error(`Unknown method ${method}`);
}

function onMessage(event: MessageEvent) {
	const data = event.data as { kurumi?: string; id?: number; method?: string; params?: unknown };
	if (!data || data.kurumi !== 'call' || typeof data.method !== 'string') return;
	for (const [pluginId, frame] of frames) {
		if (event.source !== frame.contentWindow) continue;
		const plugin = get(installedPlugins).find((p) => p.manifest.id === pluginId);
		if (!plugin) return;
		const params = data.params && typeof data.params === 'object' ? (data.params as Record<string, unknown>) : {};
		dispatch(plugin.manifest, data.method, params).then(
			(value) => frame.contentWindow?.postMessage({ kurumi: 'result', id: data.id, value }, '*'),
			(err) => frame.contentWindow?.postMessage({ kurumi: 'result', id: data.id, error: err instanceof Error ? err.message : String(err) }, '*')
		);
		return;
	}
}

function startFrame(plugin: InstalledPlugin) {
	stopFrame(plugin.manifest.id);
	if (!container) {
		container = document.createElement('div');
		container.hidden = true;
		container.dataset.kurumiPlugins = '';
		document.body.appendChild(container);
	}
	const frame = document.createElement('iframe');
	frame.setAttribute('sandbox', 'allow-scripts');
	frame.setAttribute('referrerpolicy', 'no-referrer');
	frame.title = `Plugin: ${plugin.manifest.name}`;
	frame.dataset.plugin = plugin.manifest.id;
	frame.srcdoc = frameDocument(plugin.code);
	frames.set(plugin.manifest.id, frame);
	container.appendChild(frame);
}

function stopFrame(id: string) {
	frames.get(id)?.remove();
	frames.delete(id);
	pluginCommands.update((list) => list.filter((c) => c.pluginId !== id));
}

/** Run a plugin command (from ⌘K), with the note that's open. */
export function runPluginCommand(command: PluginCommand): void {
	frames.get(command.pluginId)?.contentWindow?.postMessage({ kurumi: 'command', command: command.id, context: { noteId: currentNoteId() } }, '*');
}

async function save(list: InstalledPlugin[]) {
	installedPlugins.set(list);
	await idbSet(STORE_KEY, list);
}

let started = false;

/** Load installed plugins and start the enabled ones (once, at boot). */
export async function startPlugins(): Promise<void> {
	if (started || typeof window === 'undefined') return;
	started = true;
	window.addEventListener('message', onMessage);
	const list = ((await idbGet(STORE_KEY).catch(() => null)) as InstalledPlugin[] | null) ?? [];
	installedPlugins.set(list);
	for (const plugin of list) if (plugin.enabled) startFrame(plugin);
}

/** Read a plugin file without installing it (for the approval dialog). */
export function inspectPlugin(code: string): PluginManifest {
	if (code.length > MAX_CODE) throw new Error('The plugin file is too large (over 512 KB)');
	return parsePlugin(code);
}

/** Fetch a plugin file from a URL. */
export async function fetchPlugin(url: string): Promise<string> {
	const response = await fetch(url, { credentials: 'omit' });
	if (!response.ok) throw new Error(`Couldn't download the plugin (${response.status})`);
	return response.text();
}

/** Install (or update) a plugin the user approved, and start it. */
export async function installPlugin(code: string, source: string): Promise<PluginManifest> {
	const manifest = inspectPlugin(code);
	await startPlugins();
	const plugin: InstalledPlugin = { manifest, code, source, enabled: true, installedAt: Date.now() };
	await save([...get(installedPlugins).filter((p) => p.manifest.id !== manifest.id), plugin]);
	startFrame(plugin);
	return manifest;
}

export async function setPluginEnabled(id: string, enabled: boolean): Promise<void> {
	const list = get(installedPlugins).map((p) => (p.manifest.id === id ? { ...p, enabled } : p));
	await save(list);
	const plugin = list.find((p) => p.manifest.id === id);
	if (plugin && enabled) startFrame(plugin);
	else stopFrame(id);
}

export async function removePlugin(id: string): Promise<void> {
	stopFrame(id);
	await save(get(installedPlugins).filter((p) => p.manifest.id !== id));
}
