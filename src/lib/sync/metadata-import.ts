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
import { canonicalJSON, hashText } from './folder-state';
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

type Section = 'people' | 'events' | 'actionItems' | keyof MetadataRecords['work'];

// Every list with its section name, for walking the records generically.
function sections(records: MetadataRecords): [Section, { id: string }[]][] {
	return [
		['people', records.people],
		['events', records.events],
		['actionItems', records.actionItems],
		['projects', records.work.projects],
		['decisions', records.work.decisions],
		['questions', records.work.questions],
		['meetingSeries', records.work.meetingSeries]
	];
}

const stampKey = (section: Section) => (section === 'people' || section === 'events' ? 'modified' : 'updatedAt');

function fingerprint(record: object): string {
	return hashText(canonicalJSON(record));
}

/** `<section>:<id>` → fingerprint, to compare a later file against. */
export function recordFingerprints(records: MetadataRecords): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [section, list] of sections(records)) {
		for (const record of list) out[`${section}:${record.id}`] = fingerprint(record);
	}
	return out;
}

export interface ExternalChanges {
	changes: MetadataRecords;
	/** Records marked `"deleted": true` in the file. */
	deletions: { section: Section; id: string }[];
}

/**
 * What a metadata file changes compared with the database, as a three-way
 * merge against `base`, the fingerprints of what we last wrote there:
 *
 * - not in the database, but in base: deleted in the app, stays deleted;
 * - not in the database or base: new from outside;
 * - same as base or the database: nothing happened;
 * - differs, database unchanged since base: edited outside, whatever its
 *   timestamp says (it's bumped so it wins everywhere else too);
 * - differs on both sides: the newer timestamp wins, the app on a tie.
 *
 * Without a base (first sync after picking a folder) timestamps decide: newer
 * than the local copy, or for an unknown record newer than the last sync.
 */
export function pickExternalChanges(
	incoming: MetadataRecords,
	known: MetadataRecords,
	base: Record<string, string> | undefined,
	since: number | null
): ExternalChanges {
	const knownBySection = new Map(sections(known));
	const deletions: ExternalChanges['deletions'] = [];

	const pick = <T extends { id: string }>(section: Section, list: T[]): T[] => {
		const key = stampKey(section);
		const stampOf = (record: T) => (record as unknown as Record<string, number>)[key];
		const locals = new Map((knownBySection.get(section) as T[]).map((r) => [r.id, r]));
		const out: T[] = [];
		for (const record of list) {
			const local = locals.get(record.id);
			if ((record as Record<string, unknown>).deleted === true) {
				if (local) deletions.push({ section, id: record.id });
				continue;
			}
			const seen = base?.[`${section}:${record.id}`];
			if (!base) {
				if (local ? stampOf(record) > stampOf(local) : since === null || stampOf(record) > since) out.push(record);
			} else if (!local) {
				if (seen === undefined) out.push(record);
			} else {
				const print = fingerprint(record);
				const localPrint = fingerprint(local);
				if (print === seen || print === localPrint) continue;
				if (localPrint === seen || stampOf(record) > stampOf(local)) {
					out.push({ ...record, [key]: Math.max(stampOf(record), stampOf(local) + 1) });
				}
			}
		}
		return out;
	};

	const changes: MetadataRecords = {
		people: pick('people', incoming.people),
		events: pick('events', incoming.events),
		actionItems: pick('actionItems', incoming.actionItems),
		work: {
			projects: pick('projects', incoming.work.projects),
			decisions: pick('decisions', incoming.work.decisions),
			questions: pick('questions', incoming.work.questions),
			meetingSeries: pick('meetingSeries', incoming.work.meetingSeries)
		}
	};
	return { changes, deletions };
}

export function hasRecords(records: MetadataRecords): boolean {
	return (
		[records.people, records.events, records.actionItems, ...Object.values(records.work)].some(
			(list) => list.length > 0
		)
	);
}
