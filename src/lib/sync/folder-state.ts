/**
 * What this device last wrote to the local sync folder. Comparing against
 * it tells an outside change (a coding agent, an editor, `git pull`) from
 * Kurumi's own writes by content, so nothing depends on clocks or on anyone
 * remembering to bump a timestamp.
 */

import { get, set, del } from 'idb-keyval';

const KEY = 'kurumi-local-fs-state';

export interface FolderState {
	/** Lowercased path (disks may be case-insensitive) → hash of the file we wrote. */
	files: Record<string, string>;
	/** Vault id → `<section>:<record id>` → fingerprint of the record we wrote. */
	records: Record<string, Record<string, string>>;
	/** Fingerprint of the folder right after our last write; null to resync. */
	signature: string | null;
}

export const emptyFolderState = (): FolderState => ({ files: {}, records: {}, signature: null });

export async function loadFolderState(): Promise<FolderState> {
	try {
		return (await get<FolderState>(KEY)) ?? emptyFolderState();
	} catch {
		return emptyFolderState();
	}
}

export async function saveFolderState(state: FolderState): Promise<void> {
	await set(KEY, state);
}

/** A different folder means nothing we remember applies to it. */
export async function resetFolderState(): Promise<void> {
	await del(KEY);
}

/** cyrb53: fast, and collisions are no concern for comparing a file with itself. */
export function hashText(text: string): string {
	let h1 = 0xdeadbeef;
	let h2 = 0x41c6ce57;
	for (let i = 0; i < text.length; i++) {
		const ch = text.charCodeAt(i);
		h1 = Math.imul(h1 ^ ch, 2654435761);
		h2 = Math.imul(h2 ^ ch, 1597334677);
	}
	h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
	h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
	return `${(h2 >>> 0).toString(36)}${(h1 >>> 0).toString(36)}`;
}

/** JSON with sorted keys, so a tool reordering a record doesn't read as an edit. */
export function canonicalJSON(value: unknown): string {
	return JSON.stringify(value, (_key, v) =>
		v && typeof v === 'object' && !Array.isArray(v)
			? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
			: v
	);
}
