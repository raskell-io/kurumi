export const DEFAULT_VAULT_ID = 'default-vault';

export interface Vault {
	id: string;
	name: string;
	icon?: string;
	created: number;
	modified: number;
}

export interface Note {
	id: string;
	title: string;
	content: string;
	tags: string[];
	folderId: string | null; // null = root level
	vaultId: string;
	created: number;
	modified: number;
}

export interface Folder {
	id: string;
	name: string;
	parentId: string | null; // null = root level
	vaultId: string;
	created: number;
	modified: number;
}

export interface KurumiDocument {
	notes: Record<string, Note>;
	folders: Record<string, Folder>;
	vaults: Record<string, Vault>;
	currentVaultId: string;
	version: number;
}

export function createDefaultVault(): Vault {
	const now = Date.now();
	return {
		id: DEFAULT_VAULT_ID,
		name: 'Default',
		created: now,
		modified: now
	};
}

export function createVault(name: string, icon?: string): Vault {
	const now = Date.now();
	return {
		id: crypto.randomUUID(),
		name,
		icon,
		created: now,
		modified: now
	};
}

export function createEmptyDocument(): KurumiDocument {
	const defaultVault = createDefaultVault();
	return {
		notes: {},
		folders: {},
		vaults: { [DEFAULT_VAULT_ID]: defaultVault },
		currentVaultId: DEFAULT_VAULT_ID,
		version: 2
	};
}

export function createNote(
	title: string = 'Untitled',
	content: string = '',
	folderId: string | null = null,
	vaultId: string = DEFAULT_VAULT_ID
): Note {
	const now = Date.now();
	return {
		id: crypto.randomUUID(),
		title,
		content,
		tags: [],
		folderId,
		vaultId,
		created: now,
		modified: now
	};
}

export function createFolder(
	name: string,
	parentId: string | null = null,
	vaultId: string = DEFAULT_VAULT_ID
): Folder {
	const now = Date.now();
	return {
		id: crypto.randomUUID(),
		name,
		parentId,
		vaultId,
		created: now,
		modified: now
	};
}
