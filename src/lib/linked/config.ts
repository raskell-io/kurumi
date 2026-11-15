/**
 * The linked folders of this device: `LinkedVaultConfig[]` in localStorage,
 * like other per-device settings. Never in the document: other devices
 * don't have the folder, and a local path has no place in sync storage.
 */

import { writable, type Readable } from 'svelte/store';
import type { LinkedVaultConfig } from './types';

const VAULTS_KEY = 'kurumi-linked-vaults';
const ACTIVE_KEY = 'kurumi-active-linked-vault';

export const DEFAULT_IGNORE = ['.git/', '.obsidian/', '.trash/', 'node_modules/', 'target/', '.kurumi/', '.claude/'];

/** Ids of linked vaults start with this; document vault ids (12 letters and digits, or 'default-vault') never do. */
const LINKED_VAULT_PREFIX = 'lv-';
export const isLinkedVaultId = (id: string | null | undefined): boolean => !!id && id.startsWith(LINKED_VAULT_PREFIX);

function newId(): string {
	const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
	const bytes = new Uint8Array(8);
	crypto.getRandomValues(bytes);
	return LINKED_VAULT_PREFIX + [...bytes].map((b) => chars[b % chars.length]).join('');
}

/** A config with the defaults, for a folder just picked. */
export function newLinkedVaultConfig(fields: { name: string; path: string } & Partial<LinkedVaultConfig>): LinkedVaultConfig {
	return {
		id: newId(),
		linkKey: 'frontmatter',
		linkKeyField: 'id',
		linkFallback: ['title', 'filename'],
		titleField: 'title',
		summaryField: 'summary',
		tagFields: ['type', 'status'],
		ignore: [...DEFAULT_IGNORE],
		respectGitignore: true,
		readOnly: true,
		updatedField: null,
		updatedFormat: 'date',
		newNoteDir: '',
		newNoteFilename: '{title}',
		newNoteTemplate: '',
		created: Date.now(),
		...fields
	};
}

const strings = (value: unknown): string[] | null =>
	Array.isArray(value) && value.every((v) => typeof v === 'string') ? (value as string[]) : null;

/** A stored entry as a config, or null if it can't be one. Missing settings get their defaults. */
export function validateLinkedVaultConfig(raw: unknown): LinkedVaultConfig | null {
	if (!raw || typeof raw !== 'object') return null;
	const r = raw as Record<string, unknown>;
	if (typeof r.id !== 'string' || !isLinkedVaultId(r.id) || typeof r.path !== 'string' || !r.path) return null;
	if (typeof r.name !== 'string' || !r.name.trim()) return null;
	const base = newLinkedVaultConfig({ name: r.name, path: r.path, id: r.id });
	const field = (value: unknown, fallback: string | null) => (value === null ? null : typeof value === 'string' && value.trim() ? value.trim() : fallback);
	return {
		...base,
		...(typeof r.icon === 'string' && r.icon ? { icon: r.icon } : {}),
		linkKey: r.linkKey === 'title' || r.linkKey === 'filename' ? r.linkKey : 'frontmatter',
		linkKeyField: field(r.linkKeyField, base.linkKeyField) ?? base.linkKeyField,
		linkFallback: (strings(r.linkFallback) ?? base.linkFallback).filter((f): f is 'title' | 'filename' => f === 'title' || f === 'filename'),
		titleField: field(r.titleField, base.titleField),
		summaryField: field(r.summaryField, base.summaryField),
		tagFields: strings(r.tagFields) ?? base.tagFields,
		ignore: (strings(r.ignore) ?? base.ignore).map((p) => p.trim()).filter(Boolean),
		respectGitignore: typeof r.respectGitignore === 'boolean' ? r.respectGitignore : true,
		readOnly: typeof r.readOnly === 'boolean' ? r.readOnly : true,
		updatedField: field(r.updatedField, null),
		updatedFormat: r.updatedFormat === 'datetime' ? 'datetime' : 'date',
		newNoteDir: typeof r.newNoteDir === 'string' ? r.newNoteDir.replace(/^\/+|\/+$/g, '') : '',
		newNoteFilename: typeof r.newNoteFilename === 'string' && r.newNoteFilename.trim() ? r.newNoteFilename.trim() : base.newNoteFilename,
		newNoteTemplate: typeof r.newNoteTemplate === 'string' ? r.newNoteTemplate : '',
		created: typeof r.created === 'number' ? r.created : base.created
	};
}

function read(): LinkedVaultConfig[] {
	try {
		const stored = JSON.parse(localStorage.getItem(VAULTS_KEY) ?? '[]');
		if (!Array.isArray(stored)) return [];
		return stored.map(validateLinkedVaultConfig).filter((c): c is LinkedVaultConfig => c !== null);
	} catch {
		return [];
	}
}

const configs = writable<LinkedVaultConfig[]>(read());

/** The linked folders of this device, oldest first. */
export const linkedVaultConfigs: Readable<LinkedVaultConfig[]> = { subscribe: configs.subscribe };

function write(list: LinkedVaultConfig[]): void {
	const sorted = [...list].sort((a, b) => a.created - b.created);
	try {
		localStorage.setItem(VAULTS_KEY, JSON.stringify(sorted));
	} catch {
		// Private mode: the link lasts until the window closes.
	}
	configs.set(sorted);
}

export function getLinkedVaults(): LinkedVaultConfig[] {
	let list: LinkedVaultConfig[] = [];
	configs.subscribe((value) => (list = value))();
	return list;
}

export function getLinkedVault(id: string): LinkedVaultConfig | undefined {
	return getLinkedVaults().find((c) => c.id === id);
}

/** Add a linked folder, or replace the one with this id. */
export function saveLinkedVault(config: LinkedVaultConfig): void {
	write([...getLinkedVaults().filter((c) => c.id !== config.id), config]);
}

/** Forget a linked folder. Its files are not touched. */
export function removeLinkedVault(id: string): void {
	write(getLinkedVaults().filter((c) => c.id !== id));
	if (getActiveLinkedVaultId() === id) setActiveLinkedVaultId(null);
}

/** The linked vault that is current on this device, if one is. */
export function getActiveLinkedVaultId(): string | null {
	try {
		return localStorage.getItem(ACTIVE_KEY) || null;
	} catch {
		return null;
	}
}

export function setActiveLinkedVaultId(id: string | null): void {
	try {
		if (id) localStorage.setItem(ACTIVE_KEY, id);
		else localStorage.removeItem(ACTIVE_KEY);
	} catch {
		// Private mode: nothing to remember.
	}
}
