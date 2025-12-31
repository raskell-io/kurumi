export const DEFAULT_VAULT_ID = 'default-vault';

// Compact ID generator - 12 chars of base62 (~71 bits of entropy)
const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

export function generateId(length: number = 12): string {
	const bytes = new Uint8Array(length);
	crypto.getRandomValues(bytes);
	let id = '';
	for (let i = 0; i < length; i++) {
		id += BASE62[bytes[i] % 62];
	}
	return id;
}

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

// Reference objects - first-class entities for people and events
export interface Person {
	id: string;
	name: string; // The @Name reference
	email?: string;
	phone?: string;
	company?: string;
	title?: string;
	customFields?: Record<string, string>;
	vaultId: string;
	created: number;
	modified: number;
}

export interface Event {
	id: string;
	date: string; // The //YYYY-MM-DD reference
	title?: string;
	time?: string;
	duration?: string;
	location?: string;
	attendees?: string[];
	customFields?: Record<string, string>;
	vaultId: string;
	created: number;
	modified: number;
}

export interface KurumiDocument {
	notes: Record<string, Note>;
	folders: Record<string, Folder>;
	vaults: Record<string, Vault>;
	people: Record<string, Person>;
	events: Record<string, Event>;
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
		id: generateId(),
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
		people: {},
		events: {},
		currentVaultId: DEFAULT_VAULT_ID,
		version: 3
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
		id: generateId(),
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
		id: generateId(),
		name,
		parentId,
		vaultId,
		created: now,
		modified: now
	};
}

export function createPerson(
	name: string,
	vaultId: string = DEFAULT_VAULT_ID,
	fields?: Partial<Omit<Person, 'id' | 'name' | 'vaultId' | 'created' | 'modified'>>
): Person {
	const now = Date.now();
	return {
		id: generateId(),
		name,
		vaultId,
		created: now,
		modified: now,
		...fields
	};
}

export function createEvent(
	date: string,
	vaultId: string = DEFAULT_VAULT_ID,
	fields?: Partial<Omit<Event, 'id' | 'date' | 'vaultId' | 'created' | 'modified'>>
): Event {
	const now = Date.now();
	return {
		id: generateId(),
		date,
		vaultId,
		created: now,
		modified: now,
		...fields
	};
}
