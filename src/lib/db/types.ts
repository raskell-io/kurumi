export interface Note {
	id: string;
	title: string;
	content: string;
	tags: string[];
	folderId: string | null; // null = root level
	created: number;
	modified: number;
}

export interface Folder {
	id: string;
	name: string;
	parentId: string | null; // null = root level
	created: number;
	modified: number;
}

export interface KurumiDocument {
	notes: Record<string, Note>;
	folders: Record<string, Folder>;
	version: number;
}

export function createEmptyDocument(): KurumiDocument {
	return {
		notes: {},
		folders: {},
		version: 1
	};
}

export function createNote(title: string = 'Untitled', content: string = '', folderId: string | null = null): Note {
	const now = Date.now();
	return {
		id: crypto.randomUUID(),
		title,
		content,
		tags: [],
		folderId,
		created: now,
		modified: now
	};
}

export function createFolder(name: string, parentId: string | null = null): Folder {
	const now = Date.now();
	return {
		id: crypto.randomUUID(),
		name,
		parentId,
		created: now,
		modified: now
	};
}
