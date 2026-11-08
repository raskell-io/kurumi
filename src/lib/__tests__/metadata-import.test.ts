import { describe, it, expect, vi } from 'vitest';
import guide from '../sync/agent-guide.md?raw';
import { readMetadataRecords, pickExternalChanges, hasRecords, recordFingerprints } from '../sync/metadata-import';
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
	const pick = (file: object, known: object, base?: object, since: number | null = LAST_SYNC) =>
		pickExternalChanges(
			read(file as never),
			read(known as never),
			base ? recordFingerprints(read(base as never)) : undefined,
			since
		);
	const a = (stamp: number, extra: object = {}) => ({ a: todo('a', stamp, extra) });

	it('takes a new record whatever its timestamp', () => {
		expect(pick(a(5), {}, {}).changes.actionItems).toHaveLength(1);
	});

	it('does not bring back a record deleted in the app', () => {
		expect(hasRecords(pick(a(5), {}, a(5)).changes)).toBe(false);
	});

	it('sees nothing in an untouched file, or a reordered one', () => {
		expect(hasRecords(pick(a(5), a(5), a(5)).changes)).toBe(false);
		const reordered = { a: { updatedAt: 5, text: 'a', id: 'a' } };
		expect(hasRecords(pick(reordered, a(5), a(5)).changes)).toBe(false);
	});

	it('takes an outside edit with an old stamp, and bumps it past the local copy', () => {
		const { changes } = pick(a(5, { status: 'done' }), a(5), a(5));
		expect(changes.actionItems[0].status).toBe('done');
		expect(changes.actionItems[0].updatedAt).toBe(5001); // small numbers read as seconds
	});

	it('keeps an app edit when the file still has the old version', () => {
		expect(hasRecords(pick(a(5), a(9, { status: 'done' }), a(5)).changes)).toBe(false);
	});

	it('lets the newer stamp win when both sides changed', () => {
		const both = (fileStamp: number) =>
			pick(a(fileStamp, { status: 'done' }), a(9, { status: 'cancelled' }), a(5)).changes.actionItems;
		expect(both(8)).toHaveLength(0);
		expect(both(10)[0].status).toBe('done');
	});

	it('merges changes to different fields when both sides changed', () => {
		const record = (extra: object) => ({ a: todo('a', 2_000_000_000_000, extra) });
		const merged = pickExternalChanges(
			read(record({ status: 'done' }) as never),
			read({ a: todo('a', 2_000_000_000_001, { dueDate: '2030-01-01' }) } as never),
			recordFingerprints(read(record({}) as never)),
			LAST_SYNC,
			read(record({}) as never)
		).changes.actionItems[0];
		expect([merged.status, merged.dueDate]).toEqual(['done', '2030-01-01']);
	});

	it('reports records marked deleted', () => {
		const { deletions, changes } = pick(a(5, { deleted: true }), a(5), a(5));
		expect(deletions).toEqual([{ section: 'actionItems', id: 'a' }]);
		expect(hasRecords(changes)).toBe(false);
	});

	it('falls back to timestamps without a record of the last write', () => {
		expect(pick(a(LAST_SYNC + 1), {}).changes.actionItems).toHaveLength(1);
		expect(hasRecords(pick(a(LAST_SYNC - 1), {}).changes)).toBe(false);
		expect(pick(a(5), {}, undefined, null).changes.actionItems).toHaveLength(1);
		expect(pick(a(LAST_SYNC - 1), a(5)).changes.actionItems).toHaveLength(1);
	});
});

describe('agent guide', () => {
	// What the guide tells agents to write has to be what the app accepts.
	const blocks = [...guide.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => JSON.parse(m[1]));
	// Sections can be split over several examples (work.databaseViews has its own).
	const merged = Object.assign({}, ...blocks, {
		work: Object.assign({}, ...blocks.map((b) => b.work ?? {}))
	}) as Partial<GitMetadata>;
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

	it('says when to use each kind of object', () => {
		const table = guide.slice(guide.indexOf('## What to use when'), guide.indexOf('## Rules'));
		for (const kind of ['Note', 'Daily note', 'To-do', 'Reminder proposal', 'Draft proposal', 'Decision', 'Question', 'Project', 'Meeting', 'Person', 'Event', 'Template', 'Blob']) {
			expect(table).toContain(`**${kind}**`);
		}
	});

	it('uses blob ids that blob references can match', () => {
		const ids = [...guide.matchAll(/[("]blob:([^)"]+)[)"]/g)].map((m) => m[1]);
		expect(ids.length).toBeGreaterThan(0);
		for (const id of ids) expect(id).toMatch(/^[0-9A-Za-z]+$/);
	});
});
