/**
 * Choosing the folder to link: the system dialog of the desktop app, and the
 * folders that must not be linked. A Kurumi sync folder is the opposite
 * arrangement (the document is the truth there and Kurumi rewrites the
 * files); linking it would set two writers with opposite rules on it.
 */

import { invoke } from '$lib/desktop/invoke';

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
