/**
 * Databases: a folder whose notes are rows, with typed properties stored in
 * each note's `customProps` (see DatabaseView in db/types.ts). These are the
 * pure parts shared by the database page and the note page: reading,
 * formatting, sorting and filtering values.
 */

import type { DatabaseFilter, MemoryObject, PropertyDefinition, PropertyType, RollupFn } from '$lib/db/types';
import { evaluateFormula, formulaText, parseFormula, FormulaError, type FormulaValue } from '$lib/formula';

export const PROPERTY_TYPES: { type: PropertyType; label: string }[] = [
	{ type: 'text', label: 'Text' },
	{ type: 'number', label: 'Number' },
	{ type: 'select', label: 'Select' },
	{ type: 'multiSelect', label: 'Multi-select' },
	{ type: 'date', label: 'Date' },
	{ type: 'checkbox', label: 'Checkbox' },
	{ type: 'url', label: 'URL' },
	{ type: 'person', label: 'Person' },
	{ type: 'relation', label: 'Relation' },
	{ type: 'rollup', label: 'Rollup' },
	{ type: 'formula', label: 'Formula' }
];

export const ROLLUP_FNS: { fn: RollupFn; label: string }[] = [
	{ fn: 'count', label: 'Count all' },
	{ fn: 'countValues', label: 'Count values' },
	{ fn: 'countUnique', label: 'Count unique' },
	{ fn: 'sum', label: 'Sum' },
	{ fn: 'average', label: 'Average' },
	{ fn: 'min', label: 'Min' },
	{ fn: 'max', label: 'Max' },
	{ fn: 'earliest', label: 'Earliest date' },
	{ fn: 'latest', label: 'Latest date' },
	{ fn: 'percentChecked', label: 'Percent checked' },
	{ fn: 'list', label: 'Show values' }
];

/** Types whose values are worked out, not typed in. */
export const isComputed = (type: PropertyType | undefined) => type === 'rollup' || type === 'formula';

/**
 * What computed values need: every note by id, each database's properties
 * (by folder), and today's date for formulas.
 */
export interface ComputeContext {
	byId: Map<string, MemoryObject>;
	schemaOf: (folderId: string | null | undefined) => PropertyDefinition[];
	today: string;
}

const parsed = new Map<string, ReturnType<typeof parseFormula> | FormulaError>();
function parsedFormula(src: string) {
	if (!parsed.has(src)) {
		try {
			parsed.set(src, parseFormula(src));
		} catch (err) {
			parsed.set(src, err instanceof FormulaError ? err : new FormulaError(String(err)));
		}
	}
	return parsed.get(src)!;
}

/** A property's value for a note: stored, or worked out for rollups and formulas. */
export function propertyValue(
	memory: MemoryObject,
	prop: PropertyDefinition,
	properties: PropertyDefinition[],
	ctx?: ComputeContext,
	depth = 0
): unknown {
	const stored = memory.customProps?.[prop.key] ?? null;
	if (prop.type === 'relation') {
		const ids = asList(stored);
		return ctx ? ids.filter((id) => ctx.byId.has(id) && !ctx.byId.get(id)!.deletedAt) : ids;
	}
	if (!ctx || depth > 4) return isComputed(prop.type) ? null : stored;
	if (prop.type === 'rollup' && prop.rollup) {
		const relation = properties.find((p) => p.key === prop.rollup!.relation && p.type === 'relation');
		if (!relation) return null;
		const rows = (propertyValue(memory, relation, properties, ctx, depth + 1) as string[]).map((id) => ctx.byId.get(id)!);
		const target = prop.rollup.property;
		const values = rows.map((row) => {
			if (target === 'title') return row.title || 'Untitled';
			const schema = ctx.schemaOf(row.folderId);
			const p = schema.find((x) => x.key === target);
			return p ? propertyValue(row, p, schema, ctx, depth + 1) : null;
		});
		return rollupOf(values, prop.rollup.fn, rows.length);
	}
	if (prop.type === 'formula' && prop.formula) {
		const tree = parsedFormula(prop.formula);
		if (tree instanceof FormulaError) return `#ERROR ${tree.message}`;
		try {
			return evaluateFormula(
				tree,
				(name) => {
					const key = name.trim().toLowerCase();
					if (key === 'title' || key === 'name') return memory.title || '';
					if (key === 'created') return new Date(memory.createdAt).toISOString().slice(0, 10);
					if (key === 'updated') return new Date(memory.updatedAt).toISOString().slice(0, 10);
					const p = properties.find((x) => x.label.toLowerCase() === key);
					if (!p || p.key === prop.key) return null;
					const v = propertyValue(memory, p, properties, ctx, depth + 1);
					if (p.type === 'relation') return (v as string[]).map((id) => ctx.byId.get(id)?.title || 'Untitled');
					if (p.type === 'checkbox') return !!v;
					return (v ?? null) as FormulaValue;
				},
				ctx.today
			);
		} catch (err) {
			return `#ERROR ${err instanceof Error ? err.message : String(err)}`;
		}
	}
	return stored;
}

function rollupOf(values: unknown[], fn: RollupFn, count: number): unknown {
	const flat = values.flatMap((v) => (Array.isArray(v) ? v : [v])).filter((v) => !isEmptyValue(v));
	const nums = flat.map(Number).filter((n) => Number.isFinite(n));
	const dates = flat.filter((v): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)).sort();
	switch (fn) {
		case 'count':
			return count;
		case 'countValues':
			return flat.length;
		case 'countUnique':
			return new Set(flat.map(String)).size;
		case 'sum':
			return nums.reduce((a, b) => a + b, 0);
		case 'average':
			return nums.length ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100 : null;
		case 'min':
			return nums.length ? Math.min(...nums) : null;
		case 'max':
			return nums.length ? Math.max(...nums) : null;
		case 'earliest':
			return dates[0] ?? null;
		case 'latest':
			return dates[dates.length - 1] ?? null;
		case 'percentChecked':
			return values.length ? `${Math.round((values.filter((v) => v === true).length / values.length) * 100)}%` : null;
		case 'list':
			return flat.map((v) => (typeof v === 'boolean' ? (v ? '✓' : '') : String(v))).filter(Boolean);
	}
}

/** Text for a computed value (formula results, rollups). */
export function computedText(value: unknown): string {
	if (value === null || value === undefined) return '';
	if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return formatDate(value);
	return formulaText(value as FormulaValue);
}

/** Built-in note fields a view can show next to the properties. */
export const BUILTIN_FIELDS: { field: string; label: string }[] = [
	{ field: 'title', label: 'Title' },
	{ field: 'tags', label: 'Tags' },
	{ field: 'createdAt', label: 'Created' },
	{ field: 'updatedAt', label: 'Updated' },
	{ field: 'type', label: 'Type' }
];

/** A key for a new property: from its label, unique among `existing`. */
export function newPropertyKey(label: string, existing: PropertyDefinition[]): string {
	const base =
		label
			.toLowerCase()
			.normalize('NFKD')
			.replace(/[^\w]+/g, '-')
			.replace(/^-+|-+$/g, '') || 'property';
	let key = base;
	for (let n = 2; existing.some((p) => p.key === key); n++) key = `${base}-${n}`;
	return key;
}

export function propertyOf(field: string, properties: PropertyDefinition[]): PropertyDefinition | undefined {
	return field.startsWith('prop:') ? properties.find((p) => p.key === field.slice(5)) : undefined;
}

export function fieldLabel(field: string, properties: PropertyDefinition[]): string {
	return propertyOf(field, properties)?.label ?? BUILTIN_FIELDS.find((b) => b.field === field)?.label ?? field;
}

/** The value of a column for a note (computed ones need `ctx`). */
export function fieldValue(memory: MemoryObject, field: string, properties: PropertyDefinition[] = [], ctx?: ComputeContext): unknown {
	if (field.startsWith('prop:')) {
		const prop = propertyOf(field, properties);
		return prop ? propertyValue(memory, prop, properties, ctx) : (memory.customProps?.[field.slice(5)] ?? null);
	}
	switch (field) {
		case 'title':
			return memory.title || '';
		case 'tags':
			return memory.tags;
		case 'createdAt':
			return memory.createdAt;
		case 'updatedAt':
			return memory.updatedAt;
		case 'type':
			return memory.type;
		default:
			return null;
	}
}

/** A value as a list of strings (select and multi-select read the same way). */
export function asList(value: unknown): string[] {
	if (Array.isArray(value)) return value.filter((v) => v !== null && v !== '').map(String);
	if (value === null || value === undefined || value === '') return [];
	return [String(value)];
}

export function isEmptyValue(value: unknown): boolean {
	return value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0);
}

/** A YYYY-MM-DD date as a readable one, in the local time zone. */
export function formatDate(iso: string): string {
	const [y, m, d] = iso.split('-').map(Number);
	if (!y || !m || !d) return iso;
	return new Date(y, m - 1, d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/** Plain text for a value (sorting fallbacks, search, CSV). */
export function valueText(value: unknown, type?: PropertyType, field?: string, ctx?: ComputeContext): string {
	if (isEmptyValue(value)) return '';
	if (field === 'createdAt' || field === 'updatedAt') return new Date(value as number).toLocaleDateString();
	if (type === 'relation') return asList(value).map((id) => ctx?.byId.get(id)?.title || 'Untitled').join(', ');
	if (isComputed(type)) return computedText(value);
	if (type === 'checkbox') return value ? 'Yes' : 'No';
	if (type === 'date' && typeof value === 'string') return formatDate(value);
	return asList(value).join(', ');
}

/** Sort comparison for two values of a column (empty values last). */
export function compareValues(a: unknown, b: unknown, type?: PropertyType): number {
	const ea = isEmptyValue(a);
	const eb = isEmptyValue(b);
	if (ea || eb) return ea === eb ? 0 : ea ? 1 : -1;
	if (type === 'number' || (typeof a === 'number' && typeof b === 'number')) return Number(a) - Number(b);
	if (type === 'checkbox') return Number(!!a) - Number(!!b);
	return asList(a).join(', ').localeCompare(asList(b).join(', '), undefined, { numeric: true, sensitivity: 'base' });
}

/** The filter operators that make sense for a column. */
export function operatorsFor(type: PropertyType | undefined): DatabaseFilter['op'][] {
	switch (type) {
		case 'checkbox':
			return ['checked', 'unchecked'];
		case 'select':
		case 'multiSelect':
		case 'relation':
			return ['is', 'isNot', 'contains', 'empty', 'notEmpty'];
		case 'rollup':
		case 'formula':
			return ['is', 'isNot', 'contains', 'before', 'after', 'empty', 'notEmpty'];
		case 'date':
			return ['is', 'before', 'after', 'empty', 'notEmpty'];
		case 'number':
			return ['is', 'isNot', 'before', 'after', 'empty', 'notEmpty'];
		default:
			return ['contains', 'is', 'isNot', 'empty', 'notEmpty'];
	}
}

export const OPERATOR_LABELS: Record<DatabaseFilter['op'], string> = {
	contains: 'contains',
	is: 'is',
	isNot: 'is not',
	empty: 'is empty',
	notEmpty: 'is not empty',
	checked: 'is checked',
	unchecked: 'is not checked',
	before: 'is before',
	after: 'is after'
};

export const operatorNeedsValue = (op: DatabaseFilter['op']) =>
	!['empty', 'notEmpty', 'checked', 'unchecked'].includes(op);

/** Whether a note passes one filter. */
export function passesFilter(memory: MemoryObject, filter: DatabaseFilter, properties: PropertyDefinition[], ctx?: ComputeContext): boolean {
	const prop = propertyOf(filter.field, properties);
	const raw = fieldValue(memory, filter.field, properties, ctx);
	// Relations compare by the related notes' titles, computed values by their text.
	const value = prop?.type === 'relation' ? asList(raw).map((id) => ctx?.byId.get(id)?.title ?? id) : isComputed(prop?.type) && !(typeof raw === 'number') ? computedText(raw) || null : raw;
	const wanted = (filter.value ?? '').trim().toLowerCase();
	const list = asList(value).map((v) => v.toLowerCase());
	switch (filter.op) {
		case 'empty':
			return isEmptyValue(value);
		case 'notEmpty':
			return !isEmptyValue(value);
		case 'checked':
			return !!value;
		case 'unchecked':
			return !value;
		case 'contains':
			return !wanted || list.some((v) => v.includes(wanted));
		case 'is':
			return !wanted || list.includes(wanted);
		case 'isNot':
			return !wanted || !list.includes(wanted);
		case 'before':
		case 'after': {
			if (!wanted || isEmptyValue(value)) return !wanted;
			const cmp =
				prop?.type === 'number' ? Number(value) - Number(wanted) : String(value).localeCompare(filter.value ?? '');
			return filter.op === 'before' ? cmp < 0 : cmp > 0;
		}
	}
}

/** Rows that pass every filter and contain the search text (title, body, values). */
export function filterRows(
	rows: MemoryObject[],
	filters: DatabaseFilter[],
	properties: PropertyDefinition[],
	search = '',
	ctx?: ComputeContext
): MemoryObject[] {
	const needle = search.trim().toLowerCase();
	return rows.filter((memory) => {
		if (!filters.every((f) => passesFilter(memory, f, properties, ctx))) return false;
		if (!needle) return true;
		const values = properties.map((p) => valueText(propertyValue(memory, p, properties, ctx), p.type, undefined, ctx)).join(' ');
		return `${memory.title}\n${memory.bodyMarkdown}\n${values}`.toLowerCase().includes(needle);
	});
}

export function sortRows(
	rows: MemoryObject[],
	field: string | null,
	direction: 'asc' | 'desc',
	properties: PropertyDefinition[],
	ctx?: ComputeContext
): MemoryObject[] {
	if (!field) return rows;
	const type = propertyOf(field, properties)?.type;
	const dir = direction === 'asc' ? 1 : -1;
	const keyOf = (m: MemoryObject) => {
		const v = fieldValue(m, field, properties, ctx);
		return type === 'relation' ? valueText(v, type, undefined, ctx) : v;
	};
	const keys = new Map(rows.map((m) => [m.id, keyOf(m)]));
	return [...rows].sort((a, b) => {
		const va = keys.get(a.id);
		const vb = keys.get(b.id);
		const ea = isEmptyValue(va);
		const eb = isEmptyValue(vb);
		if (ea !== eb) return ea ? 1 : -1; // empty last either way
		return compareValues(va, vb, type === 'relation' ? 'text' : type) * dir || b.updatedAt - a.updatedAt;
	});
}

/**
 * A value typed in by hand, as the property's type stores it: numbers as
 * numbers, multi-select as a list, a checkbox as a boolean, dates as
 * YYYY-MM-DD. Null for nothing.
 */
export function parseInput(type: PropertyType, input: string): unknown {
	const text = input.trim();
	if (!text) return null;
	switch (type) {
		case 'number': {
			const n = Number(text.replace(/,/g, ''));
			return Number.isFinite(n) ? n : null;
		}
		case 'checkbox':
			return /^(true|yes|y|1|x|✓|checked)$/i.test(text);
		case 'multiSelect':
			return [...new Set(text.split(',').map((s) => s.trim()).filter(Boolean))];
		case 'date':
			return toIsoDate(text);
		default:
			return text;
	}
}

const MONTH = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\b/i;

/** YYYY-MM-DD for a date in common formats, or null. */
export function toIsoDate(text: string): string | null {
	const t = text.trim();
	let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(t);
	if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
	m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t); // US: 11/05/2026
	if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
	if (MONTH.test(t) && /\d{4}/.test(t)) {
		// "November 5, 2026" (Notion), "5 Nov 2026"; drop a time ("… 3:00 PM")
		const parsed = new Date(t.replace(/\s+\d{1,2}:\d{2}.*$/, '').replace(/\s*→.*$/, ''));
		if (!Number.isNaN(parsed.getTime())) {
			const y = parsed.getFullYear();
			const mo = String(parsed.getMonth() + 1).padStart(2, '0');
			const d = String(parsed.getDate()).padStart(2, '0');
			return `${y}-${mo}-${d}`;
		}
	}
	return null;
}

/** A stable colour (0–7) for a select option. */
export function optionHue(option: string): number {
	let hash = 0;
	for (const ch of option) hash = (hash * 31 + ch.codePointAt(0)!) >>> 0;
	return hash % 8;
}

/** Options of a select property, plus values in use that aren't listed. */
export function optionsOf(prop: PropertyDefinition, rows: MemoryObject[] = []): string[] {
	const options = [...(prop.options ?? [])];
	for (const row of rows) {
		for (const v of asList(row.customProps?.[prop.key])) if (!options.includes(v)) options.push(v);
	}
	return options;
}

/**
 * A property type for a column of imported values (Notion's CSV export):
 * Yes/No → checkbox, numbers, dates, links, a few repeated values → select,
 * comma-separated repeated values → multi-select, else text.
 */
export function inferPropertyType(values: string[]): { type: PropertyType; options?: string[] } {
	const filled = values.map((v) => v.trim()).filter(Boolean);
	if (filled.length === 0) return { type: 'text' };
	if (filled.every((v) => /^(yes|no)$/i.test(v))) return { type: 'checkbox' };
	if (filled.every((v) => /^-?\d{1,3}(,\d{3})*(\.\d+)?$|^-?\d+(\.\d+)?$/.test(v))) return { type: 'number' };
	if (filled.every((v) => /^https?:\/\/\S+$/i.test(v))) return { type: 'url' };
	if (filled.every((v) => toIsoDate(v) !== null)) return { type: 'date' };
	const short = filled.every((v) => v.length <= 60);
	const distinct = [...new Set(filled)];
	const limit = Math.max(3, Math.min(20, Math.ceil(filled.length * 0.6)));
	if (short && filled.some((v) => v.includes(','))) {
		const tokens = filled.flatMap((v) => v.split(',').map((t) => t.trim()).filter(Boolean));
		const distinctTokens = [...new Set(tokens)];
		if (distinctTokens.length < tokens.length && distinctTokens.length <= Math.max(limit, 30)) {
			return { type: 'multiSelect', options: distinctTokens };
		}
		return { type: 'text' };
	}
	if (short && filled.length >= 2 && distinct.length < filled.length && distinct.length <= limit) {
		return { type: 'select', options: distinct };
	}
	return { type: 'text' };
}

// ---- Property conditions in live queries ------------------------------------
// A ```kurumi block's `where:` lines: `Status = Done`, `Rating > 3`,
// `Due before today`, `Tags contains ux`, `Fiction`, `not Fiction`,
// `Owner is empty`. Labels match properties case-insensitively, in the
// database (folder) each note belongs to.

export interface PropertyCondition {
	label: string;
	op: DatabaseFilter['op'] | 'atLeast' | 'atMost' | 'truthy' | 'falsy';
	value?: string;
}

const CONDITION =
	/^(.*?)\s+(is\s+not\s+empty|is\s+empty|is\s+not|!=|==|=|is|>=|<=|>|<|after|before|contains)(?:\s+(.*))?$/i;

export function parseCondition(text: string): PropertyCondition | null {
	const t = text.trim();
	if (!t) return null;
	const m = CONDITION.exec(t);
	const unquote = (v: string | undefined) => (v ?? '').trim().replace(/^["'](.*)["']$/, '$1');
	if (m && m[1].trim()) {
		const label = unquote(m[1]);
		const op = m[2].toLowerCase().replace(/\s+/g, ' ');
		const value = unquote(m[3]);
		const ops: Record<string, PropertyCondition['op']> = {
			'is not empty': 'notEmpty',
			'is empty': 'empty',
			'is not': 'isNot',
			'!=': 'isNot',
			'==': 'is',
			'=': 'is',
			is: 'is',
			'>=': 'atLeast',
			'<=': 'atMost',
			'>': 'after',
			after: 'after',
			'<': 'before',
			before: 'before',
			contains: 'contains'
		};
		const mapped = ops[op];
		if (mapped === 'empty' || mapped === 'notEmpty') return { label, op: mapped };
		if (value) return { label, op: mapped, value };
	}
	const negated = /^not\s+(.+)$/i.exec(t);
	if (negated) return { label: unquote(negated[1]), op: 'falsy' };
	return { label: unquote(t), op: 'truthy' };
}

/** Whether a note meets a condition, given the properties of its database. */
export function meetsCondition(memory: MemoryObject, cond: PropertyCondition, properties: PropertyDefinition[], today: string, ctx?: ComputeContext): boolean {
	const prop = properties.find((p) => p.label.toLowerCase() === cond.label.toLowerCase());
	if (!prop) return cond.op === 'falsy' || cond.op === 'empty';
	const field = `prop:${prop.key}`;
	const value = cond.value?.toLowerCase() === 'today' ? today : cond.value;
	const test = (op: DatabaseFilter['op']) => passesFilter(memory, { field, op, value }, properties, ctx);
	switch (cond.op) {
		case 'truthy':
			return prop.type === 'checkbox' ? test('checked') : test('notEmpty');
		case 'falsy':
			return prop.type === 'checkbox' ? test('unchecked') : test('empty');
		case 'atLeast':
			return !test('notEmpty') ? false : !test('before');
		case 'atMost':
			return !test('notEmpty') ? false : !test('after');
		case 'is':
		case 'isNot':
			if (prop.type === 'checkbox') {
				const yes = /^(yes|true|checked|1)$/i.test(value ?? '');
				return (cond.op === 'is') === (yes ? test('checked') : test('unchecked'));
			}
			return test(cond.op);
		default:
			return test(cond.op);
	}
}

/**
 * Rows grouped by a column's value, for grouped tables and lists: a select's
 * options in their order, then other values A–Z, then the empty group. A
 * row with several values (multi-select, relation) is in each of them.
 */
export function groupRows(
	rows: MemoryObject[],
	field: string,
	properties: PropertyDefinition[],
	ctx?: ComputeContext
): { key: string; label: string; value: string | null; rows: MemoryObject[] }[] {
	const prop = propertyOf(field, properties);
	const groups = new Map<string, { label: string; value: string | null; rows: MemoryObject[] }>();
	const empty: MemoryObject[] = [];
	for (const row of rows) {
		const raw = fieldValue(row, field, properties, ctx);
		let values: string[];
		if (prop?.type === 'checkbox') values = [raw ? 'Checked' : 'Not checked'];
		else if (prop?.type === 'relation') values = asList(raw);
		else if (isComputed(prop?.type)) values = computedText(raw) ? [computedText(raw)] : [];
		else if (prop?.type === 'date' && typeof raw === 'string') values = [raw];
		else values = asList(raw);
		if (values.length === 0) empty.push(row);
		for (const v of values) {
			const label = prop?.type === 'relation' ? ctx?.byId.get(v)?.title || 'Untitled' : prop?.type === 'date' ? formatDate(v) : v;
			const g = groups.get(v) ?? { label, value: v, rows: [] };
			g.rows.push(row);
			groups.set(v, g);
		}
	}
	const order = prop?.options ?? [];
	const sorted = [...groups.entries()].sort(([a, ga], [b, gb]) => {
		const ia = order.indexOf(a);
		const ib = order.indexOf(b);
		if (ia !== -1 || ib !== -1) return (ia === -1 ? 1e9 : ia) - (ib === -1 ? 1e9 : ib);
		return ga.label.localeCompare(gb.label, undefined, { numeric: true });
	});
	const out = sorted.map(([key, g]) => ({ key, ...g }));
	if (empty.length) out.push({ key: '∅', label: `No ${prop?.label ?? fieldLabel(field, properties)}`, value: null, rows: empty });
	return out;
}

/** The view a ```database block shows: its first line (`view: <id>`, or the id alone). */
export function databaseBlockViewId(source: string): string {
	const line = source.trim().split('\n')[0] ?? '';
	return line.replace(/^view\s*:\s*/i, '').trim();
}
