/**
 * Choosing the folder to link: the system dialog of the desktop app, and the
 * folders that must not be linked. A Kurumi sync folder is the opposite
 * arrangement (the document is the truth there and Kurumi rewrites the
 * files); linking it would set two writers with opposite rules on it.
 */

import { invoke } from '$lib/desktop/invoke';
import { readFrontmatterFields, splitFrontmatter } from './frontmatter';
import type { NoteFile, OpenedFolder } from './types';

export interface PickedFolder {
	path: string;
	name: string;
}

export const SYNC_FOLDER_REFUSAL = 'This is a Kurumi sync folder; use Settings → Sync → Local instead.';

const join = (dir: string, name: string) => {
	const sep = dir.includes('\\') && !dir.includes('/') ? '\\' : '/';
	return dir.endsWith(sep) ? `${dir}${name}` : `${dir}${sep}${name}`;
};

/** Without the trailing separator, for comparing two paths of one device. */
const normal = (path: string) => path.replace(/[/\\]+$/, '');

async function exists(path: string, dir: boolean): Promise<boolean> {
	try {
		await invoke('fs_open', { path, dir, create: false });
		return true;
	} catch (err) {
		const name = err instanceof DOMException ? err.name : '';
		if (name === 'NotFoundError' || name === 'TypeMismatchError') return false;
		throw err;
	}
}

/**
 * Why `folder` can't be linked, or null if it can. `syncFolderPath` is the
 * folder Local sync is set up with, if any.
 */
export async function linkRefusal(folder: PickedFolder, syncFolderPath: string | null = null): Promise<string | null> {
	if (syncFolderPath && normal(syncFolderPath) === normal(folder.path)) return SYNC_FOLDER_REFUSAL;
	if (await exists(join(folder.path, 'kurumi-sync.bin'), false)) return SYNC_FOLDER_REFUSAL;
	if ((await exists(join(folder.path, '.kurumi'), true)) && (await exists(join(join(folder.path, '.kurumi'), 'metadata.json'), false))) {
		return SYNC_FOLDER_REFUSAL;
	}
	return null;
}

/** Ask for a folder in the system dialog. Null when the dialog was cancelled. */
export async function pickLinkedFolder(): Promise<PickedFolder | null> {
	return ((await invoke('folder_pick')) as PickedFolder | null) ?? null;
}

// ---- What the folder's notes look like ----------------------------------------

export interface Conventions {
	notes: number;
	withFrontmatter: number;
	/** Frontmatter fields with a plain value, most common first. */
	fields: { name: string; count: number }[];
	/** The field that looks like the notes' link key, if most have one. */
	keyField: string | null;
	/** The field that holds the title, if most have one. */
	titleField: string | null;
}

const KEY_FIELDS = ['id', 'uid', 'key', 'slug', 'permalink'];

/** What the notes' frontmatter has in common, to suggest a vault's settings. Pure. */
export function detectConventions(notes: Pick<NoteFile, 'content'>[]): Conventions {
	const counts = new Map<string, number>();
	let withFrontmatter = 0;
	for (const note of notes) {
		const fields = readFrontmatterFields(splitFrontmatter(note.content).raw);
		const names = Object.keys(fields).filter((name) => typeof fields[name] === 'string');
		if (Object.keys(fields).length) withFrontmatter++;
		for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
	}
	const fields = [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
	// "Most": at least half of the notes that have frontmatter at all.
	const common = (name: string) => withFrontmatter > 0 && (counts.get(name) ?? 0) * 2 >= withFrontmatter;
	return {
		notes: notes.length,
		withFrontmatter,
		fields,
		keyField: KEY_FIELDS.filter(common).sort((a, b) => counts.get(b)! - counts.get(a)!)[0] ?? null,
		titleField: common('title') ? 'title' : null
	};
}

/** Scan a picked folder once, without keeping it open, to see its conventions. */
export async function probeFolder(folder: PickedFolder, ignore: string[], respectGitignore: boolean): Promise<Conventions> {
	const vault = `lv-probe-${Date.now().toString(36)}`;
	try {
		const opened = (await invoke('linked_open', { vault, root: folder.path, ignore, respectGitignore, readOnly: true })) as OpenedFolder;
		return detectConventions(opened.notes);
	} finally {
		void invoke('linked_close', { vault }).catch(() => {});
	}
}
