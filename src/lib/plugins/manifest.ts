/**
 * Plugin files and their manifests. A plugin is one JavaScript file that
 * starts with its manifest in a comment:
 *
 *   /* kurumi-plugin {"id": "word-stats", "name": "Word stats", "version": "1.0.0",
 *      "description": "…", "permissions": ["read"]} *\/
 *   kurumi.commands.register({ id: 'count', title: 'Count words', run: async ({ noteId }) => { … } });
 *
 * Permissions (approved by the user when installing):
 *   read   list and read notes
 *   write  create and change notes
 * Commands and notices need none. There is no network permission: plugin
 * code runs with network access blocked (see host.ts).
 *
 * Pure, so it can be tested on its own.
 */

export type PluginPermission = 'read' | 'write';
export const PERMISSIONS: Record<PluginPermission, string> = {
	read: 'Read your notes',
	write: 'Create and change notes'
};

export interface PluginManifest {
	id: string;
	name: string;
	version: string;
	description: string;
	permissions: PluginPermission[];
	author?: string;
}

export interface InstalledPlugin {
	manifest: PluginManifest;
	code: string;
	source: string; // URL or file name it came from
	enabled: boolean;
	installedAt: number;
}

const HEADER = /^\s*\/\*\s*kurumi-plugin\s+([\s\S]*?)\*\//;
const ID = /^[a-z0-9][a-z0-9-]{1,48}$/;

export class PluginFormatError extends Error {}

/** Read the manifest from a plugin file; throws PluginFormatError with a readable reason. */
export function parsePlugin(code: string): PluginManifest {
	const header = code.match(HEADER);
	if (!header) throw new PluginFormatError('Not a Kurumi plugin: the file must start with /* kurumi-plugin {…} */');
	let raw: Record<string, unknown>;
	try {
		raw = JSON.parse(header[1]);
	} catch {
		throw new PluginFormatError('The plugin manifest is not valid JSON');
	}
	const id = String(raw.id ?? '');
	if (!ID.test(id)) throw new PluginFormatError('The plugin id must be 2–49 lowercase letters, digits or dashes');
	const name = String(raw.name ?? '').trim();
	if (!name) throw new PluginFormatError('The plugin needs a name');
	const permissions = Array.isArray(raw.permissions) ? raw.permissions.map(String) : [];
	const unknown = permissions.filter((p) => !(p in PERMISSIONS));
	if (unknown.length) throw new PluginFormatError(`Unknown permission: ${unknown.join(', ')}`);
	return {
		id,
		name: name.slice(0, 60),
		version: String(raw.version ?? '0.0.0').slice(0, 20),
		description: String(raw.description ?? '').slice(0, 300),
		permissions: [...new Set(permissions)] as PluginPermission[],
		...(raw.author ? { author: String(raw.author).slice(0, 60) } : {})
	};
}

/** Which permission a host method needs (null: none; undefined: not a method plugins may call). */
export function permissionFor(method: string): PluginPermission | null | undefined {
	switch (method) {
		case 'notes.list':
		case 'notes.get':
		case 'notes.current':
			return 'read';
		case 'notes.create':
		case 'notes.update':
			return 'write';
		case 'commands.register':
		case 'ui.notice':
			return null;
		default:
			return undefined;
	}
}

/** Whether a plugin with `granted` permissions may call `method`. */
export function mayCall(granted: PluginPermission[], method: string): boolean {
	const needed = permissionFor(method);
	if (needed === undefined) return false;
	return needed === null || granted.includes(needed);
}
