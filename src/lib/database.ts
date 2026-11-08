/**
 * Databases: a folder whose notes are rows, with typed properties stored in
 * each note's `customProps` (see DatabaseView in db/types.ts). These are the
 * pure parts shared by the database page and the note page: reading,
 * formatting, sorting and filtering values.
 */

import type { DatabaseFilter, MemoryObject, PropertyDefinition, PropertyType } from '$lib/db/types';

export const PROPERTY_TYPES: { type: PropertyType; label: string }[] = [
	{ type: 'text', label: 'Text' },
	{ type: 'number', label: 'Number' },
	{ type: 'select', label: 'Select' },
	{ type: 'multiSelect', label: 'Multi-select' },
	{ type: 'date', label: 'Date' },
	{ type: 'checkbox', label: 'Checkbox' },
	{ type: 'url', label: 'URL' },
	{ type: 'person', label: 'Person' }
];

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

/** The raw value of a column for a note. */
export function fieldValue(memory: MemoryObject, field: string): unknown {
	if (field.startsWith('prop:')) return memory.customProps?.[field.slice(5)] ?? null;
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
export function valueText(value: unknown, type?: PropertyType, field?: string): string {
	if (isEmptyValue(value)) return '';
	if (field === 'createdAt' || field === 'updatedAt') return new Date(value as number).toLocaleDateString();
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
			return ['is', 'isNot', 'empty', 'notEmpty'];
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
export function passesFilter(memory: MemoryObject, filter: DatabaseFilter, properties: PropertyDefinition[]): boolean {
	const prop = propertyOf(filter.field, properties);
	const value = fieldValue(memory, filter.field);
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
	search = ''
): MemoryObject[] {
	const needle = search.trim().toLowerCase();
	return rows.filter((memory) => {
		if (!filters.every((f) => passesFilter(memory, f, properties))) return false;
		if (!needle) return true;
		const values = properties.map((p) => valueText(memory.customProps?.[p.key], p.type)).join(' ');
		return `${memory.title}\n${memory.bodyMarkdown}\n${values}`.toLowerCase().includes(needle);
	});
}

export function sortRows(
	rows: MemoryObject[],
	field: string | null,
	direction: 'asc' | 'desc',
	properties: PropertyDefinition[]
): MemoryObject[] {
	if (!field) return rows;
	const type = propertyOf(field, properties)?.type;
	const dir = direction === 'asc' ? 1 : -1;
	return [...rows].sort((a, b) => {
		const ea = isEmptyValue(fieldValue(a, field));
		const eb = isEmptyValue(fieldValue(b, field));
		if (ea !== eb) return ea ? 1 : -1; // empty last either way
		return compareValues(fieldValue(a, field), fieldValue(b, field), type) * dir || b.updatedAt - a.updatedAt;
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
