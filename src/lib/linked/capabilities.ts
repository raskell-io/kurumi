import type { VaultCapabilities, VaultKind } from './types';

const KURUMI: VaultCapabilities = { kind: 'kurumi', editNotes: true, createNotes: true, records: true, sync: true, generated: true };
// A linked folder has notes only, and is read-only unless its settings say otherwise.
const LINKED: VaultCapabilities = { kind: 'linked', editNotes: false, createNotes: false, records: false, sync: false, generated: false };
const LINKED_WRITABLE: VaultCapabilities = { ...LINKED, editNotes: true, createNotes: true };

/**
 * What a vault can do. The `currentVaultCaps` store ($lib/db) is this for the
 * current vault. `readOnly` is the linked folder's setting (default: read-only).
 */
export function capabilitiesFor(vault: { kind?: VaultKind } | null | undefined, readOnly = true): VaultCapabilities {
	return vault?.kind !== 'linked' ? KURUMI : readOnly ? LINKED : LINKED_WRITABLE;
}

export const NO_NEW_NOTES = "New notes aren't available in a read-only linked folder. Turn on editing in its settings, or switch to a Kurumi vault to capture.";
export const NO_CAPTURE = "Recordings and uploads aren't available in a linked folder. Switch to a Kurumi vault to capture.";
export const NO_RECORDS = 'This vault is a linked folder. To-dos and other records are kept in Kurumi vaults.';
export const READ_ONLY_NOTE = 'This linked folder is read-only. Editing can be turned on in its settings.';
/** Images, photos and attachments: Kurumi keeps those as its own blobs, which a file in a linked folder can't point at. */
export const NO_FILES = "Files can't be added to a note of a linked folder yet.";
/** For what Kurumi never does in a linked folder, writable or not: moving, renaming, deleting, icons, favourites. */
export const NOT_IN_LINKED = "That isn't available in a linked folder: Kurumi reads and edits its notes, and leaves the rest to you.";
