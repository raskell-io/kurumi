import type { VaultCapabilities, VaultKind } from './types';

const KURUMI: VaultCapabilities = { kind: 'kurumi', editNotes: true, createNotes: true, records: true, sync: true, generated: true };
// Linked folders are read-only for now: nothing is written to their files.
const LINKED: VaultCapabilities = { kind: 'linked', editNotes: false, createNotes: false, records: false, sync: false, generated: false };

/** What a vault can do. The `currentVaultCaps` store ($lib/db) is this for the current vault. */
export function capabilitiesFor(vault: { kind?: VaultKind } | null | undefined): VaultCapabilities {
	return vault?.kind === 'linked' ? LINKED : KURUMI;
}

export const NO_NEW_NOTES = "New notes aren't available in a linked folder. Switch to a Kurumi vault to capture.";
export const NO_RECORDS = 'This vault is a linked folder. To-dos and other records are kept in Kurumi vaults.';
export const READ_ONLY_NOTE = "Notes in a linked folder can't be changed from Kurumi yet.";
