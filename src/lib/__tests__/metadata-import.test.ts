import { describe, it, expect, vi } from 'vitest';
import guide from '../sync/agent-guide.md?raw';
import { readMetadataRecords, pickExternalChanges, hasRecords } from '../sync/metadata-import';
import type { GitMetadata } from '../git/convert';

const LAST_SYNC = 2_000_000_000_000;

function metadata(extra: Partial<GitMetadata>): GitMetadata {
	return {
		version: 2,
		vault: { id: 'v1', name: 'Work' },
		folders: {},
		noteIds: {},
		people: {},
		events: {},
		...extra
	};
}

const todo = (id: string, updatedAt: number, extra: object = {}) => ({ id, text: id, updatedAt, ...extra });
const none = readMetadataRecords(metadata({}), 'v1');

describe('readMetadataRecords', () => {
	it('fills a minimal hand-written to-do in', () => {
		const { actionItems } = readMetadataRecords(
			metadata({ actionItems: { a: todo('a', LAST_SYNC) } as never }),
			'other'
		);
		expect(actionItems[0]).toEqual({
			id: 'a',
			text: 'a',
			memoryObjectId: null,
			assignee: null,
			dueDate: null,
			status: 'open',
			confidence: 1,
			recurrence: 'none',
			vaultId: 'v1',
			createdAt: LAST_SYNC,
			updatedAt: LAST_SYNC
		});
	});

	it('assigns records to the vault of the file, whatever they say', () => {
		const { actionItems } = readMetadataRecords(
			metadata({ actionItems: { a: todo('a', LAST_SYNC, { vaultId: 'elsewhere' }) } as never }),
			'current'
		);
		expect(actionItems[0].vaultId).toBe('v1');
	});

	it('accepts seconds and ISO timestamps', () => {
		const { actionItems } = readMetadataRecords(
			metadata({
				actionItems: {
					s: todo('s', 2_000_000_000),
					iso: todo('iso', '2033-05-18T03:33:20.000Z' as never)
				} as never
			}),
			'v1'
		);
		expect(actionItems.map((a) => a.updatedAt)).toEqual([LAST_SYNC, LAST_SYNC]);
	});

	it('drops what the app could not show, and bad statuses fall back', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const { actionItems, people, events } = readMetadataRecords(
			metadata({
				actionItems: {
					noText: { id: 'noText', updatedAt: LAST_SYNC },
					noStamp: { id: 'noStamp', text: 'x' },
					noId: { text: 'x', updatedAt: LAST_SYNC },
					odd: todo('odd', LAST_SYNC, { status: 'finished' })
				} as never,
				people: { p: { id: 'p', modified: LAST_SYNC } } as never,
				events: { e: { id: 'e', date: 'soon', modified: LAST_SYNC } } as never
			}),
			'v1'
		);
		expect(actionItems.map((a) => [a.id, a.status])).toEqual([['odd', 'open']]);
		expect(people).toEqual([]);
		expect(events).toEqual([]);
		warn.mockRestore();
	});

	it('survives a file with sections missing', () => {
		const empty = readMetadataRecords({ vault: { id: 'v1' } } as GitMetadata, 'v1');
		expect(hasRecords(empty)).toBe(false);
	});
});

describe('pickExternalChanges', () => {
	const read = (items: Record<string, object>) =>
		readMetadataRecords(metadata({ actionItems: items as never }), 'v1');

	it('takes a new record written since the last sync', () => {
		const changes = pickExternalChanges(read({ a: todo('a', LAST_SYNC + 1) }), none, LAST_SYNC);
		expect(changes.actionItems.map((a) => a.id)).toEqual(['a']);
	});

	it('does not bring back a record deleted in the app', () => {
		// Still in the file from the previous sync, gone from the database.
		const changes = pickExternalChanges(read({ a: todo('a', LAST_SYNC - 1) }), none, LAST_SYNC);
		expect(hasRecords(changes)).toBe(false);
	});

	it('takes everything unknown on a first sync', () => {
		const changes = pickExternalChanges(read({ a: todo('a', 5) }), none, null);
		expect(changes.actionItems).toHaveLength(1);
	});

	it('takes an edit only when newer than the local copy', () => {
		const known = read({ a: todo('a', LAST_SYNC) });
		const same = pickExternalChanges(read({ a: todo('a', LAST_SYNC) }), known, LAST_SYNC);
		const older = pickExternalChanges(read({ a: todo('a', LAST_SYNC - 1) }), known, LAST_SYNC);
		const newer = pickExternalChanges(
			read({ a: todo('a', LAST_SYNC + 1, { status: 'done' }) }),
			known,
			LAST_SYNC
		);
		expect(hasRecords(same)).toBe(false);
		expect(hasRecords(older)).toBe(false);
		expect(newer.actionItems[0].status).toBe('done');
	});
});

describe('agent guide', () => {
	// What the guide tells agents to write has to be what the app accepts.
	const blocks = [...guide.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => JSON.parse(m[1]));
	const merged = Object.assign({}, ...blocks) as Partial<GitMetadata>;
	const warn = vi.spyOn(console, 'warn');
	const records = readMetadataRecords(metadata(merged), 'v1');

	it('has examples for every kind of record, all accepted', () => {
		expect(warn).not.toHaveBeenCalled();
		expect(records.actionItems).toHaveLength(1);
		expect(records.people).toHaveLength(1);
		expect(records.events).toHaveLength(1);
		for (const list of Object.values(records.work)) expect(list).toHaveLength(1);
	});

	it('keeps each example as written (no field falls back to a default)', () => {
		const written = merged.actionItems!['a41c9e07d2b8f365'];
		expect(records.actionItems[0]).toEqual({ ...written, vaultId: 'v1' });
		const question = (merged.work!.questions as object[])[0];
		expect(records.work.questions[0]).toEqual({ ...question, vaultId: 'v1' });
	});

	it('uses blob ids that blob references can match', () => {
		const ids = [...guide.matchAll(/[("]blob:([^)"]+)[)"]/g)].map((m) => m[1]);
		expect(ids.length).toBeGreaterThan(0);
		for (const id of ids) expect(id).toMatch(/^[0-9A-Za-z]+$/);
	});
});
