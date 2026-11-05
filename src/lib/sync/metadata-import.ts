/**
 * Reading records back out of `.kurumi/metadata.json`, which people and
 * coding agents can edit by hand (the format they're told about is
 * `agent-guide.md`, written next to that file).
 *
 * A record from the file is taken as-is where it's valid and filled in with
 * neutral defaults where it isn't complete, so a hand-written one can't put
 * something into the database the app can't display.
 */

import type { GitMetadata } from '$lib/git/convert';
import type {
	ActionItem,
	Decision,
	Event,
	MeetingSeries,
	Person,
	Project,
	Question
} from '$lib/db/types';

export interface MetadataRecords {
	people: Person[];
	events: Event[];
	actionItems: ActionItem[];
	work: {
		projects: Project[];
		decisions: Decision[];
		questions: Question[];
		meetingSeries: MeetingSeries[];
	};
}

type Raw = Record<string, unknown>;

/** Milliseconds from what a hand-written record may hold (ms, s or ISO). */
function timeOf(value: unknown): number | null {
	if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
		return value < 1e11 ? value * 1000 : value;
	}
	if (typeof value === 'string') {
		const parsed = Date.parse(value);
		return Number.isNaN(parsed) ? null : parsed;
	}
	return null;
}

const present = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';
const orNull = (value: unknown): string | null => (present(value) ? value : null);
const orEmpty = (value: unknown): string => (typeof value === 'string' ? value : '');
const stringList = (value: unknown): string[] =>
	Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
	allowed.includes(value as T) ? (value as T) : fallback;

// One collection: valid records only, with their timestamps as numbers and
// `vaultId` set to the vault the file belongs to.
function readList<T>(
	source: unknown,
	vaultId: string,
	[createdKey, updatedKey]: [string, string],
	build: (raw: Raw) => object | null
): T[] {
	if (!source || typeof source !== 'object') return [];
	const out: T[] = [];
	for (const value of Object.values(source)) {
		if (!value || typeof value !== 'object') continue;
		const raw = value as Raw;
		const updated = timeOf(raw[updatedKey]);
		const fields = present(raw.id) && updated !== null ? build(raw) : null;
		if (!fields) {
			console.warn('Ignoring invalid record in .kurumi/metadata.json:', raw.id ?? raw);
			continue;
		}
		out.push({
			...raw,
			...fields,
			vaultId,
			[createdKey]: timeOf(raw[createdKey]) ?? updated,
			[updatedKey]: updated
		} as T);
	}
	return out;
}

const CREATED_UPDATED: [string, string] = ['createdAt', 'updatedAt'];
const CREATED_MODIFIED: [string, string] = ['created', 'modified'];

/** The records a metadata file holds. */
export function readMetadataRecords(metadata: GitMetadata, fallbackVaultId: string): MetadataRecords {
	const vaultId = metadata.vault?.id || fallbackVaultId;
	const work = (metadata.work ?? {}) as Partial<Record<keyof MetadataRecords['work'], unknown>>;
	return {
		people: readList<Person>(metadata.people, vaultId, CREATED_MODIFIED, (r) => (present(r.name) ? {} : null)),
		events: readList<Event>(metadata.events, vaultId, CREATED_MODIFIED, (r) =>
			typeof r.date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(r.date) ? {} : null
		),
		actionItems: readList<ActionItem>(metadata.actionItems, vaultId, CREATED_UPDATED, (r) =>
			present(r.text)
				? {
						memoryObjectId: orNull(r.memoryObjectId),
						assignee: orNull(r.assignee),
						dueDate: orNull(r.dueDate),
						status: oneOf(r.status, ['open', 'in_progress', 'done', 'cancelled'], 'open'),
						confidence: typeof r.confidence === 'number' ? r.confidence : 1,
						recurrence: oneOf(r.recurrence, ['none', 'daily', 'weekly', 'monthly', 'yearly'], 'none')
					}
				: null
		),
		work: {
			projects: readList<Project>(work.projects, vaultId, CREATED_UPDATED, (r) =>
				present(r.name)
					? {
							status: oneOf(r.status, ['active', 'paused', 'done', 'archived'], 'active'),
							owner: orNull(r.owner),
							dueDate: orNull(r.dueDate),
							description: orEmpty(r.description)
						}
					: null
			),
			decisions: readList<Decision>(work.decisions, vaultId, CREATED_UPDATED, (r) =>
				present(r.text)
					? {
							rationale: orEmpty(r.rationale),
							decidedOn: present(r.decidedOn)
								? r.decidedOn
								: new Date(timeOf(r.updatedAt)!).toISOString().slice(0, 10),
							decidedBy: stringList(r.decidedBy),
							memoryId: orNull(r.memoryId),
							projectId: orNull(r.projectId)
						}
					: null
			),
			questions: readList<Question>(work.questions, vaultId, CREATED_UPDATED, (r) =>
				present(r.text)
					? {
							status: oneOf(r.status, ['open', 'answered', 'dropped'], 'open'),
							assignee: orNull(r.assignee),
							answer: orEmpty(r.answer),
							answerMemoryId: orNull(r.answerMemoryId),
							memoryId: orNull(r.memoryId),
							projectId: orNull(r.projectId),
							resolvedAt: timeOf(r.resolvedAt)
						}
					: null
			),
			meetingSeries: readList<MeetingSeries>(work.meetingSeries, vaultId, CREATED_UPDATED, (r) =>
				present(r.name)
					? {
							people: stringList(r.people),
							cadence: oneOf(r.cadence, ['weekly', 'biweekly', 'monthly', 'none'], 'none'),
							projectId: orNull(r.projectId),
							agenda: Array.isArray(r.agenda)
								? r.agenda.filter((a) => present(a?.id) && present(a?.text))
								: []
						}
					: null
			)
		}
	};
}

// Newer than the local copy; or, with no local copy, written since the last
// sync. Without that second condition a record deleted in the app would come
// back from the file, which still lists it until this sync rewrites it.
function pick<T extends { id: string }>(
	incoming: T[],
	known: T[],
	since: number | null,
	stampOf: (record: T) => number
): T[] {
	const byId = new Map(known.map((record) => [record.id, record]));
	return incoming.filter((record) => {
		const local = byId.get(record.id);
		if (local) return stampOf(record) > stampOf(local);
		return since === null || stampOf(record) > since;
	});
}

const updatedAt = (record: { updatedAt: number }) => record.updatedAt;
const modified = (record: { modified: number }) => record.modified;

/** What a metadata file changes compared with the database (local folder). */
export function pickExternalChanges(
	incoming: MetadataRecords,
	known: MetadataRecords,
	since: number | null
): MetadataRecords {
	return {
		people: pick(incoming.people, known.people, since, modified),
		events: pick(incoming.events, known.events, since, modified),
		actionItems: pick(incoming.actionItems, known.actionItems, since, updatedAt),
		work: {
			projects: pick(incoming.work.projects, known.work.projects, since, updatedAt),
			decisions: pick(incoming.work.decisions, known.work.decisions, since, updatedAt),
			questions: pick(incoming.work.questions, known.work.questions, since, updatedAt),
			meetingSeries: pick(incoming.work.meetingSeries, known.work.meetingSeries, since, updatedAt)
		}
	};
}

export function hasRecords(records: MetadataRecords): boolean {
	return (
		[records.people, records.events, records.actionItems, ...Object.values(records.work)].some(
			(list) => list.length > 0
		)
	);
}
