<script lang="ts">
	/**
	 * A database: the notes of one folder as rows, with typed properties.
	 * Views of the folder show as tabs (table, board, gallery, calendar);
	 * they share the properties, each keeps its own columns, filters and
	 * sort. Values live on the notes (customProps), so a row is just a note.
	 */
	import { goto } from '$app/navigation';
	import {
		databaseViews,
		memoryObjects,
		folders,
		updateFolder,
		addDatabaseView,
		updateDatabaseView,
		deleteDatabaseView,
		restoreDatabaseView,
		setDatabaseProperties,
		setMemoryCustomProp,
		addDatabaseRow,
		setDatabaseTemplates,
		addRowFromTemplate,
		updateMemoryObject,
		type MemoryObject,
		type DatabaseView,
		type DatabaseViewType,
		type DatabaseFilter,
		type PropertyDefinition,
		type PropertyType,
		type DatabaseTemplate
	} from '$lib/db';
	import {
		PROPERTY_TYPES,
		BUILTIN_FIELDS,
		OPERATOR_LABELS,
		newPropertyKey,
		propertyOf,
		fieldLabel,
		fieldValue,
		valueText,
		filterRows,
		sortRows,
		operatorsFor,
		operatorNeedsValue,
		optionsOf,
		optionHue,
		asList,
		isEmptyValue,
		isComputed,
		computedText,
		propertyValue,
		ROLLUP_FNS,
		groupRows
	} from '$lib/database';
	import { computeContext } from '$lib/stores/compute';
	import RelationValue from '$lib/components/RelationValue.svelte';
	import type { RollupFn } from '$lib/db/types';
	import { markdownExcerpt } from '$lib/utils/excerpt';
	import { pushUndo } from '$lib/stores/undo';
	import { showNotice } from '$lib/stores/notice';
	import PropertyValue from '$lib/components/PropertyValue.svelte';
	import Popover from '$lib/components/Popover.svelte';
	import NoteIcon from '$lib/components/NoteIcon.svelte';
	import {
		Table,
		Kanban,
		LayoutGrid,
		CalendarDays,
		Plus,
		Search,
		ListFilter,
		ArrowUpDown,
		SlidersHorizontal,
		MoreHorizontal,
		Trash2,
		Pencil,
		Eye,
		EyeOff,
		ArrowUp,
		ArrowDown,
		X,
		Database,
		Folder,
		ChevronLeft,
		ChevronRight,
		Settings2,
		List,
		ChartGantt,
		ChevronDown,
		FilePlus,
		Copy
	} from 'lucide-svelte';

	const LAYOUTS: { type: DatabaseViewType; label: string; icon: typeof Table }[] = [
		{ type: 'table', label: 'Table', icon: Table },
		{ type: 'board', label: 'Board', icon: Kanban },
		{ type: 'gallery', label: 'Gallery', icon: LayoutGrid },
		{ type: 'calendar', label: 'Calendar', icon: CalendarDays },
		{ type: 'list', label: 'List', icon: List },
		{ type: 'timeline', label: 'Timeline', icon: ChartGantt }
	];

	interface Props {
		viewId: string;
		/** Inside a note (a ```database block): compact, tabs switch in place. */
		embedded?: boolean;
	}
	let { viewId: initialViewId, embedded = false }: Props = $props();
	// Embedded databases switch views here; the page follows the URL.
	let localViewId = $state<string | null>(null);
	let viewId = $derived(embedded ? (localViewId ?? initialViewId) : initialViewId);
	function showView(id: string) {
		if (embedded) localViewId = id;
		else goto(`/database/${id}`);
	}
	let view = $derived($databaseViews.find((v) => v.id === viewId));
	let folder = $derived(view ? $folders.find((f) => f.id === view.folderId) : undefined);
	let siblings = $derived(
		view ? $databaseViews.filter((v) => v.folderId === view.folderId).sort((a, b) => a.createdAt - b.createdAt) : []
	);
	let properties = $derived(view?.properties ?? []);
	let allRows = $derived(view ? $memoryObjects.filter((m) => m.folderId === view.folderId) : []);
	let search = $state('');
	let ctx = $derived($computeContext);
	let rows = $derived(
		view ? sortRows(filterRows(allRows, view.filters ?? [], properties, search, ctx), view.sortField, view.sortDirection, properties, ctx) : []
	);
	// Other databases (for relations) by folder, named after their folder.
	let databases = $derived(
		[...new Map($databaseViews.map((v) => [v.folderId, v])).values()].map((v) => ({
			folderId: v.folderId,
			name: $folders.find((f) => f.id === v.folderId)?.name ?? v.name
		}))
	);
	function relationCandidates(prop: PropertyDefinition): MemoryObject[] {
		return prop.relationTo ? $memoryObjects.filter((m) => m.folderId === prop.relationTo) : $memoryObjects.filter((m) => m.type !== 'canvas');
	}
	function createRelated(prop: PropertyDefinition, title: string): string | null {
		if (!prop.relationTo || !title) return null;
		return addDatabaseRow(prop.relationTo, title).id;
	}
	let columns = $derived.by(() => {
		if (!view) return [];
		const cols = view.columns.filter((c) => c.visible && c.field !== 'title' && (!c.field.startsWith('prop:') || propertyOf(c.field, properties)));
		return ['title', ...cols.map((c) => c.field)];
	});
	let selectProps = $derived(properties.filter((p) => p.type === 'select'));
	let dateProps = $derived(properties.filter((p) => p.type === 'date'));

	// ---- Schema ------------------------------------------------------------

	function setProps(next: PropertyDefinition[]) {
		if (view) setDatabaseProperties(view.folderId, next);
	}

	function addProperty(label: string, type: PropertyType): PropertyDefinition {
		const prop: PropertyDefinition = { key: newPropertyKey(label, properties), label, type };
		if (type === 'select' || type === 'multiSelect') prop.options = [];
		setProps([...properties, prop]);
		return prop;
	}

	function patchProperty(key: string, patch: Partial<PropertyDefinition>) {
		setProps(properties.map((p) => (p.key === key ? { ...p, ...patch } : p)));
	}

	function changeType(prop: PropertyDefinition, type: PropertyType) {
		const patch: Partial<PropertyDefinition> = { type };
		if (type === 'select' || type === 'multiSelect') patch.options = optionsOf(prop, allRows);
		patchProperty(prop.key, patch);
	}

	function deleteProperty(prop: PropertyDefinition) {
		const before = properties;
		setProps(properties.filter((p) => p.key !== prop.key));
		// Values stay on the notes, so putting the property back restores them.
		pushUndo({ label: `Deleted property "${prop.label}"`, undo: () => setProps(before) });
	}

	function addOption(prop: PropertyDefinition, option: string) {
		const options = optionsOf(prop, allRows);
		if (!options.includes(option)) patchProperty(prop.key, { options: [...options, option] });
	}

	// ---- View --------------------------------------------------------------

	function patchView(updates: Parameters<typeof updateDatabaseView>[1]) {
		if (view) updateDatabaseView(view.id, updates);
	}

	function toggleColumn(field: string) {
		if (!view) return;
		const exists = view.columns.some((c) => c.field === field);
		patchView({
			columns: exists
				? view.columns.map((c) => (c.field === field ? { ...c, visible: !c.visible } : { ...c }))
				: [...view.columns.map((c) => ({ ...c })), { field, visible: true }]
		});
	}

	const isVisible = (field: string) => columns.includes(field);

	function sortBy(field: string, direction: 'asc' | 'desc') {
		patchView({ sortField: field, sortDirection: direction });
	}

	function addView(type: DatabaseViewType) {
		if (!view) return;
		const label = LAYOUTS.find((l) => l.type === type)!.label;
		const created = addDatabaseView({ name: label, folderId: view.folderId, viewType: type });
		const groupField = selectProps[0] ? `prop:${selectProps[0].key}` : null;
		const dateField = dateProps[0] ? `prop:${dateProps[0].key}` : null;
		updateDatabaseView(created.id, { groupField, dateField });
		addViewOpen = false;
		showView(created.id);
	}

	function removeView() {
		if (!view) return;
		const removed: DatabaseView = JSON.parse(JSON.stringify(view));
		const next = siblings.find((v) => v.id !== removed.id);
		deleteDatabaseView(removed.id);
		pushUndo({
			label: next ? `Deleted view "${removed.name}"` : `"${folder?.name ?? 'Folder'}" is a folder again`,
			undo: () => {
				restoreDatabaseView(removed);
				showView(removed.id);
			}
		});
		viewMenuOpen = false;
		if (next) showView(next.id);
		else if (!embedded) goto(folder ? `/read/folder/${folder.id}` : '/');
	}

	// ---- Rows --------------------------------------------------------------

	let newRowId = $state<string | null>(null);

	function newRow(props: Record<string, unknown> = {}, template?: DatabaseTemplate) {
		if (!view) return;
		// A new row passes the view's "is" filters, so it doesn't vanish.
		const preset: Record<string, unknown> = {};
		for (const f of view.filters ?? []) {
			const prop = propertyOf(f.field, properties);
			if (!prop || f.op !== 'is' || !f.value) continue;
			preset[prop.key] = prop.type === 'multiSelect' ? [f.value] : prop.type === 'number' ? Number(f.value) : f.value;
		}
		const memory = template
			? addRowFromTemplate(view.folderId, template, { ...preset, ...props })
			: addDatabaseRow(view.folderId, '', { ...preset, ...props });
		search = '';
		if (!template?.title) newRowId = memory.id;
		return memory;
	}

	function setValue(memory: MemoryObject, prop: PropertyDefinition, value: unknown) {
		setMemoryCustomProp(memory.id, prop.key, value);
	}

	function renameRow(memory: MemoryObject, title: string) {
		if (title.trim() !== memory.title) updateMemoryObject(memory.id, { title: title.trim() });
		newRowId = null;
	}

	// After the frame: a popover moves its content to <body>, which drops focus.
	const focusSelect = (node: HTMLInputElement) => {
		requestAnimationFrame(() => {
			node.focus();
			node.select();
		});
	};

	// ---- Popovers ----------------------------------------------------------

	let addViewOpen = $state(false);
	let addViewBtn: HTMLButtonElement | undefined = $state();
	let viewMenuOpen = $state(false);
	let viewMenuBtn: HTMLButtonElement | undefined = $state();
	let renamingView = $state(false);
	let filterOpen = $state(false);
	let filterBtn: HTMLButtonElement | undefined = $state();
	let sortOpen = $state(false);
	let sortBtn: HTMLButtonElement | undefined = $state();
	let propsOpen = $state(false);
	let propsBtn: HTMLButtonElement | undefined = $state();
	let headerMenu = $state<{ field: string; anchor: HTMLElement } | null>(null);
	let renamingProp = $state<string | null>(null);
	let addPropAnchor = $state<HTMLElement | null>(null);
	let renamingDb = $state(false);
	// The property editor: adding one (key null) or changing one's settings.
	let editor = $state<{
		key: string | null;
		name: string;
		type: PropertyType;
		relationTo: string | null;
		rollupRelation: string;
		rollupProperty: string;
		rollupFn: RollupFn;
		formula: string;
	}>({ key: null, name: '', type: 'text', relationTo: null, rollupRelation: '', rollupProperty: 'title', rollupFn: 'count', formula: '' });

	function openAddProperty(anchor: HTMLElement) {
		editor = { key: null, name: '', type: 'text', relationTo: null, rollupRelation: '', rollupProperty: 'title', rollupFn: 'count', formula: '' };
		addPropAnchor = anchor;
	}

	function openEditProperty(anchor: HTMLElement, prop: PropertyDefinition) {
		editor = {
			key: prop.key,
			name: prop.label,
			type: prop.type,
			relationTo: prop.relationTo ?? null,
			rollupRelation: prop.rollup?.relation ?? '',
			rollupProperty: prop.rollup?.property ?? 'title',
			rollupFn: prop.rollup?.fn ?? 'count',
			formula: prop.formula ?? ''
		};
		addPropAnchor = anchor;
	}

	let relationProps = $derived(properties.filter((p) => p.type === 'relation' && p.key !== editor.key));
	let rollupTargetProps = $derived.by(() => {
		const rel = properties.find((p) => p.key === editor.rollupRelation);
		return rel?.relationTo ? ctx.schemaOf(rel.relationTo).filter((p) => p.type !== 'rollup') : [];
	});
	let formulaPreview = $derived.by(() => {
		if (editor.type !== 'formula' || !editor.formula.trim() || allRows.length === 0) return null;
		const draft: PropertyDefinition = { key: editor.key ?? '__draft', label: editor.name || 'Formula', type: 'formula', formula: editor.formula };
		const others = properties.filter((p) => p.key !== draft.key);
		const v = propertyValue(allRows[0], draft, [...others, draft], ctx);
		return { row: allRows[0].title || 'Untitled', text: typeof v === 'string' && v.startsWith('#ERROR') ? v : computedText(v) || '(empty)', error: typeof v === 'string' && v.startsWith('#ERROR') };
	});

	function submitProperty() {
		const label = editor.name.trim() || PROPERTY_TYPES.find((t) => t.type === editor.type)!.label;
		const settings: Partial<PropertyDefinition> = { label, type: editor.type };
		if (editor.type === 'relation') settings.relationTo = editor.relationTo;
		if (editor.type === 'rollup') {
			if (!editor.rollupRelation) return;
			settings.rollup = { relation: editor.rollupRelation, property: editor.rollupProperty || 'title', fn: editor.rollupFn };
		}
		if (editor.type === 'formula') settings.formula = editor.formula.trim();
		if (editor.key) {
			const prop = properties.find((p) => p.key === editor.key);
			if (prop && prop.type !== editor.type) changeType(prop, editor.type);
			setProps(
				properties.map((p) => {
					if (p.key !== editor.key) return p;
					const next: PropertyDefinition = { ...p, ...settings };
					if (next.type !== 'relation') delete next.relationTo;
					if (next.type !== 'rollup') delete next.rollup;
					if (next.type !== 'formula') delete next.formula;
					if (next.type === 'select' || next.type === 'multiSelect') next.options = optionsOf(p, allRows);
					return next;
				})
			);
		} else {
			const prop = addProperty(label, editor.type);
			if (editor.type === 'relation' || editor.type === 'rollup' || editor.type === 'formula') patchProperty(prop.key, settings);
			if (view?.viewType === 'board' && !view.groupField && prop.type === 'select') patchView({ groupField: `prop:${prop.key}` });
			if (view?.viewType === 'calendar' && !view.dateField && prop.type === 'date') patchView({ dateField: `prop:${prop.key}` });
		}
		addPropAnchor = null;
	}

	// Filters
	function setFilters(next: DatabaseFilter[]) {
		patchView({ filters: next });
	}

	function addFilter() {
		const prop = properties[0];
		const field = prop ? `prop:${prop.key}` : 'title';
		setFilters([...(view?.filters ?? []), { field, op: operatorsFor(prop?.type)[0], value: '' }]);
	}

	function patchFilter(i: number, patch: Partial<DatabaseFilter>) {
		const list = (view?.filters ?? []).map((f) => ({ ...f }));
		const next = { ...list[i], ...patch };
		if (patch.field) {
			const ops = operatorsFor(propertyOf(patch.field, properties)?.type);
			if (!ops.includes(next.op)) next.op = ops[0];
			next.value = '';
		}
		list[i] = next;
		setFilters(list);
	}

	const filterCount = $derived((view?.filters ?? []).length);
	const filterFields = $derived([{ field: 'title', label: 'Title' }, ...properties.map((p) => ({ field: `prop:${p.key}`, label: p.label }))]);
	const sortFields = $derived([
		...properties.map((p) => ({ field: `prop:${p.key}`, label: p.label })),
		...BUILTIN_FIELDS.filter((b) => b.field !== 'type').map((b) => ({ field: b.field, label: b.label }))
	]);

	// ---- Grouped tables and lists -------------------------------------------

	let groups = $derived(
		view && view.groupField && (view.viewType === 'table' || view.viewType === 'list') && propertyOf(view.groupField, properties)
			? groupRows(rows, view.groupField, properties, ctx)
			: null
	);
	let collapsed = $state<Set<string>>(new Set());
	function toggleGroup(key: string) {
		const next = new Set(collapsed);
		if (next.has(key)) next.delete(key);
		else next.add(key);
		collapsed = next;
	}
	/** New row in a group: it gets the group's value. */
	function newRowIn(value: string | null) {
		const prop = view?.groupField ? propertyOf(view.groupField, properties) : undefined;
		if (!prop || value === null || isComputed(prop.type)) return newRow();
		if (prop.type === 'checkbox') return newRow({ [prop.key]: value === 'Checked' });
		if (prop.type === 'multiSelect' || prop.type === 'relation') return newRow({ [prop.key]: [value] });
		if (prop.type === 'number') return newRow({ [prop.key]: Number(value) });
		return newRow({ [prop.key]: value });
	}
	let groupableProps = $derived(properties.filter((p) => p.type !== 'url'));

	// ---- Templates -----------------------------------------------------------

	let templates = $derived(view?.templates ?? []);
	let newMenuOpen = $state(false);
	let newMenuBtn: HTMLButtonElement | undefined = $state();
	let templatesOpen = $state(false);
	let editingTemplate = $state<string | null>(null);
	function saveTemplates(next: DatabaseTemplate[]) {
		if (view) setDatabaseTemplates(view.folderId, next);
	}
	function addTemplate() {
		const t: DatabaseTemplate = { id: Math.random().toString(36).slice(2, 10), name: 'New template', title: '', body: '', props: {} };
		saveTemplates([...templates, t]);
		editingTemplate = t.id;
		templatesOpen = true;
	}
	function patchTemplate(id: string, patch: Partial<DatabaseTemplate>) {
		saveTemplates(templates.map((t) => (t.id === id ? { ...t, ...patch } : t)));
	}
	function setTemplateProp(id: string, key: string, value: unknown) {
		const t = templates.find((x) => x.id === id);
		if (!t) return;
		const props = { ...t.props };
		if (isEmptyValue(value)) delete props[key];
		else props[key] = value;
		patchTemplate(id, { props });
	}

	// ---- Timeline --------------------------------------------------------------

	let dateProp = $derived(view?.dateField ? propertyOf(view.dateField, properties) : undefined);

	let endProp = $derived(view?.endDateField ? propertyOf(view.endDateField, properties) : undefined);
	let timelineScale = $state<'day' | 'week' | 'month'>('week');
	const DAY_PX = { day: 36, week: 14, month: 4 } as const;
	const dayMs = 86400000;
	const isoDay = (iso: string) => Math.round(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / dayMs);
	const dayIso = (day: number) => new Date(day * dayMs).toISOString().slice(0, 10);
	let timelineItems = $derived.by(() => {
		if (!dateProp) return [];
		return rows
			.map((r) => {
				const start = r.customProps?.[dateProp!.key];
				if (typeof start !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(start)) return null;
				const endRaw = endProp ? r.customProps?.[endProp.key] : null;
				const s = isoDay(start);
				const e = typeof endRaw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(endRaw) ? Math.max(s, isoDay(endRaw)) : s;
				return { memory: r, start: s, end: e };
			})
			.filter((x): x is { memory: MemoryObject; start: number; end: number } => !!x)
			.sort((a, b) => a.start - b.start);
	});
	let timelineUndated = $derived(dateProp ? rows.filter((r) => !timelineItems.some((t) => t.memory.id === r.id)) : []);
	let timelineRange = $derived.by(() => {
		const today = isoDay(todayIso);
		const starts = timelineItems.map((t) => t.start);
		const ends = timelineItems.map((t) => t.end);
		let from = Math.min(today, ...starts) - 7;
		let to = Math.max(today, ...ends) + 21;
		if (to - from < 60) to = from + 60;
		// Start on a Monday (1970-01-01 was a Thursday)
		from -= (from + 3) % 7;
		return { from, to };
	});
	let timelineMonths = $derived.by(() => {
		const out: { label: string; left: number; width: number }[] = [];
		const px = DAY_PX[timelineScale];
		let d = timelineRange.from;
		while (d < timelineRange.to) {
			const date = new Date(d * dayMs);
			const next = Math.round(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1) / dayMs);
			const end = Math.min(next, timelineRange.to);
			out.push({ label: date.toLocaleDateString(undefined, { month: 'short', year: 'numeric', timeZone: 'UTC' }), left: (d - timelineRange.from) * px, width: (end - d) * px });
			d = end;
		}
		return out;
	});
	let timelineTicks = $derived.by(() => {
		const px = DAY_PX[timelineScale];
		const out: { label: string; left: number; weekend: boolean }[] = [];
		for (let d = timelineRange.from; d < timelineRange.to; d++) {
			const date = new Date(d * dayMs);
			const dow = date.getUTCDay();
			if (timelineScale === 'day' || (timelineScale === 'week' && dow === 1)) out.push({ label: String(date.getUTCDate()), left: (d - timelineRange.from) * px, weekend: dow === 0 || dow === 6 });
		}
		return out;
	});
	let barDrag = $state<{ id: string; mode: 'move' | 'end'; startX: number; start: number; end: number; delta: number } | null>(null);
	function onBarDown(e: PointerEvent, item: { memory: MemoryObject; start: number; end: number }, mode: 'move' | 'end') {
		if (e.button !== 0) return;
		e.preventDefault();
		e.stopPropagation();
		barDrag = { id: item.memory.id, mode, startX: e.clientX, start: item.start, end: item.end, delta: 0 };
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}
	function onBarMove(e: PointerEvent) {
		if (!barDrag) return;
		barDrag = { ...barDrag, delta: Math.round((e.clientX - barDrag.startX) / DAY_PX[timelineScale]) };
	}
	function onBarUp() {
		const drag = barDrag;
		barDrag = null;
		if (!drag || !dateProp) return;
		if (drag.delta === 0) {
			if (drag.mode === 'move') goto(`/memory/${drag.id}`);
			return;
		}
		if (drag.mode === 'move') {
			setMemoryCustomProp(drag.id, dateProp.key, dayIso(drag.start + drag.delta));
			if (endProp && drag.end !== drag.start) setMemoryCustomProp(drag.id, endProp.key, dayIso(drag.end + drag.delta));
		} else if (endProp) {
			setMemoryCustomProp(drag.id, endProp.key, dayIso(Math.max(drag.start, drag.end + drag.delta)));
		}
	}
	function barSpan(item: { memory: MemoryObject; start: number; end: number }) {
		const d = barDrag?.id === item.memory.id ? barDrag : null;
		const start = item.start + (d?.mode === 'move' ? d.delta : 0);
		const end = Math.max(start, item.end + (d ? d.delta : 0));
		const px = DAY_PX[timelineScale];
		return { left: (start - timelineRange.from) * px, width: Math.max(px, (end - start + 1) * px) };
	}

	// ---- Board -------------------------------------------------------------

	let groupProp = $derived(view?.groupField ? propertyOf(view.groupField, properties) : undefined);
	let lanes = $derived.by(() => {
		if (!groupProp) return [];
		const options = optionsOf(groupProp, allRows);
		const lanes = options.map((option) => ({ value: option as string | null, rows: rows.filter((r) => asList(r.customProps?.[groupProp!.key])[0] === option) }));
		lanes.push({ value: null, rows: rows.filter((r) => isEmptyValue(r.customProps?.[groupProp!.key])) });
		return lanes;
	});
	let dragging = $state<string | null>(null);
	let dropTarget = $state<string | null>(null);

	function dropOnLane(value: string | null) {
		const memory = allRows.find((r) => r.id === dragging);
		if (memory && groupProp) setMemoryCustomProp(memory.id, groupProp.key, value);
		dragging = null;
		dropTarget = null;
	}

	function addStatusProperty() {
		const prop: PropertyDefinition = {
			key: newPropertyKey('Status', properties),
			label: 'Status',
			type: 'select',
			options: ['Not started', 'In progress', 'Done']
		};
		setProps([...properties, prop]);
		patchView({ groupField: `prop:${prop.key}` });
	}

	// Card fields: visible properties with a value, other than the lane's.
	const cardProps = (memory: MemoryObject, skip?: string) =>
		properties.filter((p) => p.key !== skip && isVisible(`prop:${p.key}`) && !isEmptyValue(propertyValue(memory, p, properties, ctx)));

	// ---- Calendar ----------------------------------------------------------

	let month = $state(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
	const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
	const todayIso = iso(new Date());
	let weeks = $derived.by(() => {
		const start = new Date(month);
		start.setDate(1 - ((start.getDay() + 6) % 7)); // back to Monday
		const out: Date[][] = [];
		for (let w = 0; w < 6; w++) {
			const week: Date[] = [];
			for (let d = 0; d < 7; d++) week.push(new Date(start.getFullYear(), start.getMonth(), start.getDate() + w * 7 + d));
			if (w >= 4 && week[0].getMonth() !== month.getMonth()) break;
			out.push(week);
		}
		return out;
	});
	let byDay = $derived.by(() => {
		const map = new Map<string, MemoryObject[]>();
		if (!dateProp) return map;
		for (const r of rows) {
			const v = r.customProps?.[dateProp.key];
			if (typeof v !== 'string') continue;
			map.set(v, [...(map.get(v) ?? []), r]);
		}
		return map;
	});
	let undated = $derived(dateProp ? rows.filter((r) => typeof r.customProps?.[dateProp!.key] !== 'string') : []);
	const weekdays = Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 1 + i).toLocaleDateString(undefined, { weekday: 'short' }));

	function shiftMonth(delta: number) {
		month = new Date(month.getFullYear(), month.getMonth() + delta, 1);
	}

	function dropOnDay(day: string | null) {
		const memory = allRows.find((r) => r.id === dragging);
		if (memory && dateProp) setMemoryCustomProp(memory.id, dateProp.key, day);
		dragging = null;
		dropTarget = null;
	}

	function addDateProperty() {
		const prop: PropertyDefinition = { key: newPropertyKey('Date', properties), label: 'Date', type: 'date' };
		setProps([...properties, prop]);
		patchView({ dateField: `prop:${prop.key}` });
	}
</script>

<svelte:head>
	{#if !embedded}<title>{folder?.name ?? 'Database'} - Kurumi</title>{/if}
</svelte:head>

{#snippet rowTitle(memory: MemoryObject)}
	{#if newRowId === memory.id}
		<input
			class="db-title-input"
			placeholder="Untitled"
			value={memory.title}
			aria-label="Title"
			onkeydown={(e) => {
				if (e.key === 'Enter') renameRow(memory, e.currentTarget.value);
				if (e.key === 'Escape') newRowId = null;
			}}
			onblur={(e) => renameRow(memory, e.currentTarget.value)}
			use:focusSelect
		/>
	{:else}
		<a href="/memory/{memory.id}" class="db-title">
			<NoteIcon icon={memory.icon} class="h-3.5 w-3.5 text-[var(--color-text-faint)]" />
			<span class="truncate">{memory.title || 'Untitled'}</span>
		</a>
	{/if}
{/snippet}

{#snippet cell(memory: MemoryObject, field: string)}
	{@const prop = propertyOf(field, properties)}
	{#if prop && prop.type === 'relation'}
		<RelationValue
			{prop}
			value={propertyValue(memory, prop, properties, ctx) as string[]}
			candidates={relationCandidates(prop)}
			byId={ctx.byId}
			onChange={(ids) => setValue(memory, prop, ids)}
			onCreate={prop.relationTo ? (t) => createRelated(prop, t) : undefined}
		/>
	{:else if prop && isComputed(prop.type)}
		{@const v = propertyValue(memory, prop, properties, ctx)}
		<span class="db-static" class:db-error={typeof v === 'string' && v.startsWith('#ERROR')} title={typeof v === 'string' && v.startsWith('#ERROR') ? v : undefined}>
			{typeof v === 'string' && v.startsWith('#ERROR') ? 'Error' : computedText(v)}
		</span>
	{:else if prop}
		<PropertyValue
			{prop}
			value={memory.customProps?.[prop.key]}
			options={optionsOf(prop, allRows)}
			onChange={(v) => setValue(memory, prop, v)}
			onAddOption={(o) => addOption(prop, o)}
			placeholder=""
		/>
	{:else if field === 'tags'}
		<span class="db-static">{memory.tags.map((t) => `#${t}`).join(' ')}</span>
	{:else}
		<span class="db-static">{valueText(fieldValue(memory, field), undefined, field)}</span>
	{/if}
{/snippet}

{#snippet cardFields(memory: MemoryObject, skip?: string)}
	{#each cardProps(memory, skip) as prop (prop.key)}
		<div class="db-card-field" title={prop.label}>
			{#if prop.type === 'select' || prop.type === 'multiSelect'}
				<span class="flex flex-wrap gap-1">
					{#each asList(memory.customProps?.[prop.key]) as option (option)}<span class="k-chip hue-{optionHue(option)}">{option}</span>{/each}
				</span>
			{:else if prop.type === 'checkbox'}
				<span>{prop.label} {memory.customProps?.[prop.key] ? '✓' : '—'}</span>
			{:else}
				<span class="truncate">{valueText(propertyValue(memory, prop, properties, ctx), prop.type, undefined, ctx)}</span>
			{/if}
		</div>
	{/each}
{/snippet}

{#snippet draggableCard(memory: MemoryObject, skip?: string)}
	<a
		href="/memory/{memory.id}"
		class="db-card"
		class:is-dragging={dragging === memory.id}
		draggable="true"
		ondragstart={(e) => {
			dragging = memory.id;
			e.dataTransfer?.setData('text/plain', memory.title || 'Untitled');
			if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
		}}
		ondragend={() => {
			dragging = null;
			dropTarget = null;
		}}
	>
		<span class="db-card-title">
			<NoteIcon icon={memory.icon} class="h-3.5 w-3.5 text-[var(--color-text-faint)]" />
			<span class="truncate">{memory.title || 'Untitled'}</span>
		</span>
		{@render cardFields(memory, skip)}
	</a>
{/snippet}

{#if view}
	<div class={embedded ? 'db-embedded' : 'k-page k-page-wide'}>
		<header class={embedded ? 'mb-1' : 'mb-3'}>
			<p class="flex items-center gap-1.5 text-xs text-[var(--color-text-faint)]">
				<Database class="h-3.5 w-3.5" /> Database
				{#if embedded}
					<span>·</span>
					<a href="/database/{view.id}" class="inline-flex items-center gap-1 hover:text-[var(--color-text)]">Open as page</a>
				{:else if folder}
					<span>·</span>
					<a href="/read/folder/{folder.id}" class="inline-flex items-center gap-1 hover:text-[var(--color-text)]"><Folder class="h-3 w-3" />Read as pages</a>
				{/if}
			</p>
			{#if renamingDb && folder}
				<input
					class="k-page-title db-name-input"
					value={folder.name}
					aria-label="Database name"
					onkeydown={(e) => {
						if (e.key === 'Enter') e.currentTarget.blur();
						if (e.key === 'Escape') renamingDb = false;
					}}
					onblur={(e) => {
						const name = e.currentTarget.value.trim();
						if (name && folder && name !== folder.name) updateFolder(folder.id, { name });
						renamingDb = false;
					}}
					use:focusSelect
				/>
			{:else}
				<h1 class={embedded ? 'db-embedded-title' : 'k-page-title'}>
					<button type="button" class="db-name" onclick={() => (renamingDb = true)} title="Rename">{folder?.name ?? view.name}</button>
				</h1>
			{/if}
		</header>

		<!-- View tabs -->
		<div class="db-tabs" role="tablist" aria-label="Views">
			{#each siblings as v (v.id)}
				{@const Icon = LAYOUTS.find((l) => l.type === v.viewType)?.icon ?? Table}
				{#if v.id === view.id && renamingView}
					<input
						class="db-tab-input"
						value={v.name}
						aria-label="View name"
						onkeydown={(e) => {
							if (e.key === 'Enter') e.currentTarget.blur();
							if (e.key === 'Escape') renamingView = false;
						}}
						onblur={(e) => {
							const name = e.currentTarget.value.trim();
							if (name) patchView({ name });
							renamingView = false;
						}}
						use:focusSelect
					/>
				{:else}
					<button type="button" class="db-tab" role="tab" aria-selected={v.id === view.id} onclick={() => showView(v.id)}>
						<Icon class="h-3.5 w-3.5" />{v.name}
					</button>
				{/if}
			{/each}
			<button type="button" class="db-tab db-tab-add" bind:this={addViewBtn} onclick={() => (addViewOpen = !addViewOpen)} aria-label="Add a view" title="Add a view">
				<Plus class="h-3.5 w-3.5" />
			</button>
			<span class="flex-1"></span>
			<button type="button" class="k-icon-btn" bind:this={viewMenuBtn} onclick={() => (viewMenuOpen = !viewMenuOpen)} aria-label="View options">
				<MoreHorizontal class="h-4 w-4" />
			</button>
		</div>

		<!-- Toolbar -->
		<div class="db-toolbar">
			<label class="db-search">
				<Search class="h-3.5 w-3.5 shrink-0 text-[var(--color-text-faint)]" />
				<input bind:value={search} placeholder="Search" aria-label="Search rows" />
			</label>
			<button type="button" class="k-btn k-btn-ghost" class:is-on={filterCount > 0} bind:this={filterBtn} onclick={() => (filterOpen = !filterOpen)}>
				<ListFilter class="h-3.5 w-3.5" />Filter{#if filterCount}<span class="k-badge">{filterCount}</span>{/if}
			</button>
			<button type="button" class="k-btn k-btn-ghost" bind:this={sortBtn} onclick={() => (sortOpen = !sortOpen)}>
				<ArrowUpDown class="h-3.5 w-3.5" />Sort
			</button>
			<button type="button" class="k-btn k-btn-ghost" bind:this={propsBtn} onclick={() => (propsOpen = !propsOpen)}>
				<SlidersHorizontal class="h-3.5 w-3.5" />Properties
			</button>
			{#if view.viewType === 'board' && selectProps.length > 0}
				<select class="k-input !h-8 !w-auto !py-0 text-sm" value={view.groupField ?? ''} onchange={(e) => patchView({ groupField: e.currentTarget.value || null })} aria-label="Group by">
					{#each selectProps as p (p.key)}<option value="prop:{p.key}">Group by {p.label}</option>{/each}
				</select>
			{/if}
			{#if (view.viewType === 'calendar' || view.viewType === 'timeline') && dateProps.length > 0}
				<select class="k-input !h-8 !w-auto !py-0 text-sm" value={view.dateField ?? ''} onchange={(e) => patchView({ dateField: e.currentTarget.value || null })} aria-label="Date property">
					{#each dateProps as p (p.key)}<option value="prop:{p.key}">{view.viewType === 'timeline' ? 'From' : 'By'} {p.label}</option>{/each}
				</select>
			{/if}
			{#if view.viewType === 'timeline' && dateProps.length > 0}
				<select class="k-input !h-8 !w-auto !py-0 text-sm" value={view.endDateField ?? ''} onchange={(e) => patchView({ endDateField: e.currentTarget.value || null })} aria-label="End date property">
					<option value="">No end date</option>
					{#each dateProps.filter((p) => `prop:${p.key}` !== view.dateField) as p (p.key)}<option value="prop:{p.key}">To {p.label}</option>{/each}
				</select>
				<div class="k-segmented" role="group" aria-label="Scale">
					<button aria-pressed={timelineScale === 'day'} onclick={() => (timelineScale = 'day')}>Days</button>
					<button aria-pressed={timelineScale === 'week'} onclick={() => (timelineScale = 'week')}>Weeks</button>
					<button aria-pressed={timelineScale === 'month'} onclick={() => (timelineScale = 'month')}>Months</button>
				</div>
			{/if}
			{#if (view.viewType === 'table' || view.viewType === 'list') && groupableProps.length > 0}
				<select class="k-input !h-8 !w-auto !py-0 text-sm" value={view.groupField ?? ''} onchange={(e) => patchView({ groupField: e.currentTarget.value || null })} aria-label="Group by">
					<option value="">No grouping</option>
					{#each groupableProps as p (p.key)}<option value="prop:{p.key}">Group by {p.label}</option>{/each}
				</select>
			{/if}
			<span class="flex-1"></span>
			<span class="text-xs tabular-nums text-[var(--color-text-faint)]">{rows.length}{rows.length !== allRows.length ? ` of ${allRows.length}` : ''}</span>
			<div class="db-new-split">
				<button type="button" class="k-btn k-btn-primary" onclick={() => newRow()}>
					<Plus class="h-3.5 w-3.5" />New
				</button>
				<button type="button" class="k-btn k-btn-primary db-new-more" bind:this={newMenuBtn} onclick={() => (newMenuOpen = !newMenuOpen)} aria-label="New from a template" title="Templates">
					<ChevronDown class="h-3.5 w-3.5" />
				</button>
			</div>
		</div>

		{#if view.viewType === 'table'}
			<div class="db-table-wrap">
				<table class="db-table">
					<thead>
						<tr>
							{#each columns as field (field)}
								{@const prop = propertyOf(field, properties)}
								<th class:is-title={field === 'title'} aria-sort={view.sortField === field ? (view.sortDirection === 'asc' ? 'ascending' : 'descending') : undefined}>
									<button
										type="button"
										class="db-th"
										onclick={(e) => (headerMenu = { field, anchor: e.currentTarget })}
									>
										<span class="truncate">{fieldLabel(field, properties)}</span>
										{#if prop}<span class="db-th-type">{PROPERTY_TYPES.find((t) => t.type === prop.type)?.label}</span>{/if}
										{#if view.sortField === field}
											{#if view.sortDirection === 'asc'}<ArrowUp class="h-3 w-3 shrink-0" />{:else}<ArrowDown class="h-3 w-3 shrink-0" />{/if}
										{/if}
									</button>
								</th>
							{/each}
							<th class="db-th-add">
								<button type="button" class="db-th justify-center" onclick={(e) => openAddProperty(e.currentTarget)} aria-label="Add a property" title="Add a property">
									<Plus class="h-3.5 w-3.5" />
								</button>
							</th>
						</tr>
					</thead>
					<tbody>
						{#snippet tableRow(memory: MemoryObject)}
							<tr>
								{#each columns as field (field)}
									<td class:is-title={field === 'title'}>
										{#if field === 'title'}{@render rowTitle(memory)}{:else}{@render cell(memory, field)}{/if}
									</td>
								{/each}
								<td></td>
							</tr>
						{/snippet}
						{#if groups}
							{#each groups as group (group.key)}
								<tr class="db-group-row">
									<td colspan={columns.length + 1}>
										<button type="button" class="db-group-head" onclick={() => toggleGroup(group.key)} aria-expanded={!collapsed.has(group.key)}>
											<ChevronDown class="h-3.5 w-3.5 transition-transform {collapsed.has(group.key) ? '-rotate-90' : ''}" />
											{#if group.value !== null && propertyOf(view.groupField!, properties)?.type === 'select'}<span class="k-chip hue-{optionHue(group.value)}">{group.label}</span>{:else}<span>{group.label}</span>{/if}
											<span class="db-group-count">{group.rows.length}</span>
										</button>
									</td>
								</tr>
								{#if !collapsed.has(group.key)}
									{#each group.rows as memory (memory.id)}{@render tableRow(memory)}{/each}
									<tr class="db-new-row">
										<td colspan={columns.length + 1}>
											<button type="button" class="db-new-btn" onclick={() => newRowIn(group.value)}><Plus class="h-3.5 w-3.5" />New</button>
										</td>
									</tr>
								{/if}
							{/each}
						{:else}
							{#each rows as memory (memory.id)}{@render tableRow(memory)}{/each}
						{/if}
						<tr class="db-new-row" class:hidden={!!groups}>
							<td colspan={columns.length + 1}>
								<button type="button" class="db-new-btn" onclick={() => newRow()}><Plus class="h-3.5 w-3.5" />New</button>
							</td>
						</tr>
					</tbody>
				</table>
			</div>
			{#if allRows.length === 0}
				<p class="db-hint">Each row is a note in this folder. Add one with <strong>New</strong>, or add properties with <strong>+</strong> in the header.</p>
			{:else if rows.length === 0}
				<p class="db-hint">No rows match the search or filters.</p>
			{/if}
		{:else if view.viewType === 'board'}
			{#if !groupProp}
				<div class="k-empty">
					<Kanban />
					<p class="k-empty-title">A board groups rows by a select property</p>
					<p>Each option becomes a column; drag cards between them to change it.</p>
					<button type="button" class="k-btn k-btn-primary mt-2" onclick={addStatusProperty}><Plus class="h-3.5 w-3.5" />Add a Status property</button>
				</div>
			{:else}
				<div class="db-board">
					{#each lanes as lane (lane.value ?? '∅')}
						{@const laneKey = lane.value ?? '∅'}
						<section
							class="db-lane"
							class:is-target={dropTarget === laneKey}
							aria-label={lane.value ?? `No ${groupProp.label}`}
							ondragover={(e) => {
								if (!dragging) return;
								e.preventDefault();
								dropTarget = laneKey;
							}}
							ondragleave={() => (dropTarget = dropTarget === laneKey ? null : dropTarget)}
							ondrop={(e) => {
								e.preventDefault();
								dropOnLane(lane.value);
							}}
						>
							<header class="db-lane-head">
								{#if lane.value}<span class="k-chip hue-{optionHue(lane.value)}">{lane.value}</span>{:else}<span class="text-xs text-[var(--color-text-faint)]">No {groupProp.label}</span>{/if}
								<span class="text-xs tabular-nums text-[var(--color-text-faint)]">{lane.rows.length}</span>
							</header>
							{#each lane.rows as memory (memory.id)}
								{@render draggableCard(memory, groupProp.key)}
							{/each}
							<button type="button" class="db-new-btn" onclick={() => newRow(lane.value ? { [groupProp!.key]: lane.value } : {})}><Plus class="h-3.5 w-3.5" />New</button>
						</section>
					{/each}
				</div>
			{/if}
		{:else if view.viewType === 'gallery'}
			<div class="db-gallery">
				{#each rows as memory (memory.id)}
					<a href="/memory/{memory.id}" class="db-card db-gallery-card">
						<span class="db-card-title">
							<NoteIcon icon={memory.icon} class="h-4 w-4 text-[var(--color-text-faint)]" />
							<span class="truncate">{memory.title || 'Untitled'}</span>
						</span>
						{#if memory.bodyMarkdown.trim()}<p class="db-excerpt">{markdownExcerpt(memory.bodyMarkdown, 160)}</p>{/if}
						{@render cardFields(memory)}
					</a>
				{/each}
				<button type="button" class="db-card db-gallery-new" onclick={() => newRow()}><Plus class="h-4 w-4" />New</button>
			</div>
		{:else if view.viewType === 'list'}
			{#snippet listRow(memory: MemoryObject)}
				<li class="db-list-row">
					<span class="db-list-title">{@render rowTitle(memory)}</span>
					<span class="db-list-props">{@render cardFields(memory, view.groupField?.slice(5))}</span>
				</li>
			{/snippet}
			{#if groups}
				{#each groups as group (group.key)}
					<section class="db-list-group">
						<button type="button" class="db-group-head" onclick={() => toggleGroup(group.key)} aria-expanded={!collapsed.has(group.key)}>
							<ChevronDown class="h-3.5 w-3.5 transition-transform {collapsed.has(group.key) ? '-rotate-90' : ''}" />
							<span>{group.label}</span><span class="db-group-count">{group.rows.length}</span>
						</button>
						{#if !collapsed.has(group.key)}
							<ul class="db-list">{#each group.rows as memory (memory.id)}{@render listRow(memory)}{/each}</ul>
						{/if}
					</section>
				{/each}
			{:else}
				<ul class="db-list">{#each rows as memory (memory.id)}{@render listRow(memory)}{/each}</ul>
			{/if}
			<button type="button" class="db-new-btn" onclick={() => newRow()}><Plus class="h-3.5 w-3.5" />New</button>
		{:else if view.viewType === 'timeline'}
			{#if !dateProp}
				<div class="k-empty">
					<ChartGantt />
					<p class="k-empty-title">A timeline places rows by a date property</p>
					<p>Add a start date, and an end date for rows that span days. Drag a bar to move it, its end to change how long it runs.</p>
					<button type="button" class="k-btn k-btn-primary mt-2" onclick={addDateProperty}><Plus class="h-3.5 w-3.5" />Add a Date property</button>
				</div>
			{:else}
				{@const px = DAY_PX[timelineScale]}
				{@const width = (timelineRange.to - timelineRange.from) * px}
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div class="db-timeline" onpointermove={onBarMove} onpointerup={onBarUp}>
					<div class="db-tl-grid" style="width: calc(14rem + {width}px)">
						<div class="db-tl-head">
							<div class="db-tl-corner"></div>
							<div class="db-tl-scale" style="width: {width}px">
								{#each timelineMonths as m (m.left)}<div class="db-tl-month" style="left: {m.left}px; width: {m.width}px">{m.label}</div>{/each}
								{#each timelineTicks as t (t.left)}<div class="db-tl-tick" class:is-weekend={t.weekend} style="left: {t.left}px">{t.label}</div>{/each}
							</div>
						</div>
						<div class="db-tl-body">
							<div class="db-tl-today" style="left: calc(14rem + {(isoDay(todayIso) - timelineRange.from) * px + px / 2}px)" title="Today"></div>
							{#each timelineItems as item (item.memory.id)}
								{@const span = barSpan(item)}
								<div class="db-tl-row">
									<div class="db-tl-label">{@render rowTitle(item.memory)}</div>
									<div class="db-tl-track" style="width: {width}px">
										<!-- svelte-ignore a11y_no_static_element_interactions -->
										<div class="db-tl-bar" class:is-dragging={barDrag?.id === item.memory.id} style="left: {span.left}px; width: {span.width}px" onpointerdown={(e) => onBarDown(e, item, 'move')} title={item.memory.title || 'Untitled'}>
											<span class="truncate">{item.memory.title || 'Untitled'}</span>
											{#if endProp}
												<!-- svelte-ignore a11y_no_static_element_interactions -->
												<span class="db-tl-end" onpointerdown={(e) => onBarDown(e, item, 'end')} title="Drag to change the end"></span>
											{/if}
										</div>
									</div>
								</div>
							{/each}
						</div>
					</div>
				</div>
				{#if timelineUndated.length > 0}
					<p class="db-hint">No {dateProp.label}: {timelineUndated.map((m) => m.title || 'Untitled').join(', ')}</p>
				{/if}
			{/if}
		{:else if view.viewType === 'calendar'}
			{#if !dateProp}
				<div class="k-empty">
					<CalendarDays />
					<p class="k-empty-title">A calendar places rows by a date property</p>
					<p>Drag a row to another day to change its date.</p>
					<button type="button" class="k-btn k-btn-primary mt-2" onclick={addDateProperty}><Plus class="h-3.5 w-3.5" />Add a Date property</button>
				</div>
			{:else}
				<div class="db-cal-head">
					<button type="button" class="k-icon-btn" onclick={() => shiftMonth(-1)} aria-label="Previous month"><ChevronLeft class="h-4 w-4" /></button>
					<h2 class="min-w-40 text-center text-sm font-semibold">{month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</h2>
					<button type="button" class="k-icon-btn" onclick={() => shiftMonth(1)} aria-label="Next month"><ChevronRight class="h-4 w-4" /></button>
					<button type="button" class="k-btn k-btn-ghost" onclick={() => (month = new Date(new Date().getFullYear(), new Date().getMonth(), 1))}>Today</button>
				</div>
				<div class="db-cal" role="grid" aria-label="Calendar">
					{#each weekdays as wd (wd)}<div class="db-cal-wd" role="columnheader">{wd}</div>{/each}
					{#each weeks as week, w (w)}
						{#each week as day (iso(day))}
							{@const key = iso(day)}
							<div
								class="db-cal-day"
								class:is-other={day.getMonth() !== month.getMonth()}
								class:is-today={key === todayIso}
								class:is-target={dropTarget === key}
								role="gridcell"
								tabindex="-1"
								ondragover={(e) => {
									if (!dragging) return;
									e.preventDefault();
									dropTarget = key;
								}}
								ondrop={(e) => {
									e.preventDefault();
									dropOnDay(key);
								}}
							>
								<div class="db-cal-num">
									<span>{day.getDate()}</span>
									<button type="button" class="db-cal-add" onclick={() => newRow({ [dateProp!.key]: key })} aria-label="New row on {key}"><Plus class="h-3 w-3" /></button>
								</div>
								{#each byDay.get(key) ?? [] as memory (memory.id)}
									<a
										href="/memory/{memory.id}"
										class="db-cal-item"
										draggable="true"
										ondragstart={() => (dragging = memory.id)}
										ondragend={() => {
											dragging = null;
											dropTarget = null;
										}}
									>{memory.title || 'Untitled'}</a>
								{/each}
							</div>
						{/each}
					{/each}
				</div>
				{#if undated.length > 0}
					<section
						class="db-undated"
						class:is-target={dropTarget === 'none'}
						ondragover={(e) => {
							if (!dragging) return;
							e.preventDefault();
							dropTarget = 'none';
						}}
						ondrop={(e) => {
							e.preventDefault();
							dropOnDay(null);
						}}
						aria-label="No date"
					>
						<h3 class="mb-2 text-xs font-medium text-[var(--color-text-faint)]">No {dateProp.label} · drag onto a day</h3>
						<div class="flex flex-wrap gap-2">
							{#each undated as memory (memory.id)}{@render draggableCard(memory, dateProp.key)}{/each}
						</div>
					</section>
				{/if}
			{/if}
		{/if}
	</div>

	<!-- Popovers -->
	{#if addViewOpen && addViewBtn}
		<Popover anchor={addViewBtn} onClose={() => (addViewOpen = false)} width="12rem" label="Add a view">
			<p class="k-menu-label">Add a view</p>
			{#each LAYOUTS as layout (layout.type)}
				{@const Icon = layout.icon}
				<button type="button" class="k-menu-item" onclick={() => addView(layout.type)}><Icon class="h-4 w-4" />{layout.label}</button>
			{/each}
		</Popover>
	{/if}

	{#if viewMenuOpen && viewMenuBtn}
		<Popover anchor={viewMenuBtn} onClose={() => (viewMenuOpen = false)} width="15rem" label="View options">
			<p class="k-menu-label">Layout</p>
			{#each LAYOUTS as layout (layout.type)}
				{@const Icon = layout.icon}
				<button
					type="button"
					class="k-menu-item"
					aria-pressed={view.viewType === layout.type}
					onclick={() => {
						const updates: Parameters<typeof updateDatabaseView>[1] = { viewType: layout.type };
						if (layout.type === 'board' && !view?.groupField && selectProps[0]) updates.groupField = `prop:${selectProps[0].key}`;
						if (layout.type === 'calendar' && !view?.dateField && dateProps[0]) updates.dateField = `prop:${dateProps[0].key}`;
						patchView(updates);
						viewMenuOpen = false;
					}}
				>
					<Icon class="h-4 w-4" />{layout.label}
					{#if view.viewType === layout.type}<span class="ml-auto text-[var(--color-accent)]">✓</span>{/if}
				</button>
			{/each}
			<div class="k-menu-sep"></div>
			<button type="button" class="k-menu-item" onclick={() => { renamingView = true; viewMenuOpen = false; }}><Pencil class="h-4 w-4" />Rename view</button>
			<button
				type="button"
				class="k-menu-item"
				onclick={() => {
					void navigator.clipboard?.writeText('```database\nview: ' + view!.id + '\n```\n');
					showNotice('Copied: paste it into a note to show this database there');
					viewMenuOpen = false;
				}}
			><Copy class="h-4 w-4" />Copy embed for a note</button>
			<button type="button" class="k-menu-item danger" onclick={removeView}>
				<Trash2 class="h-4 w-4" />{siblings.length > 1 ? 'Delete view' : 'Turn back into a folder'}
			</button>
		</Popover>
	{/if}

	{#if filterOpen && filterBtn}
		<Popover anchor={filterBtn} onClose={() => (filterOpen = false)} width="26rem" label="Filters">
			{#each view.filters ?? [] as filter, i (i)}
				{@const prop = propertyOf(filter.field, properties)}
				<div class="db-filter">
					<select class="k-input !h-8 !py-0 text-sm" value={filter.field} onchange={(e) => patchFilter(i, { field: e.currentTarget.value })} aria-label="Property">
						{#each filterFields as f (f.field)}<option value={f.field}>{f.label}</option>{/each}
					</select>
					<select class="k-input !h-8 !py-0 text-sm" value={filter.op} onchange={(e) => patchFilter(i, { op: e.currentTarget.value as DatabaseFilter['op'] })} aria-label="Condition">
						{#each operatorsFor(prop?.type) as op (op)}<option value={op}>{OPERATOR_LABELS[op]}</option>{/each}
					</select>
					{#if operatorNeedsValue(filter.op)}
						{#if prop && (prop.type === 'select' || prop.type === 'multiSelect')}
							<select class="k-input !h-8 !py-0 text-sm" value={filter.value ?? ''} onchange={(e) => patchFilter(i, { value: e.currentTarget.value })} aria-label="Value">
								<option value="">Any</option>
								{#each optionsOf(prop, allRows) as o (o)}<option value={o}>{o}</option>{/each}
							</select>
						{:else}
							<input
								class="k-input !h-8 text-sm"
								type={prop?.type === 'date' ? 'date' : prop?.type === 'number' ? 'number' : 'text'}
								value={filter.value ?? ''}
								onchange={(e) => patchFilter(i, { value: e.currentTarget.value })}
								aria-label="Value"
							/>
						{/if}
					{:else}<span></span>{/if}
					<button type="button" class="k-icon-btn" onclick={() => setFilters((view?.filters ?? []).filter((_, j) => j !== i))} aria-label="Remove filter"><X class="h-3.5 w-3.5" /></button>
				</div>
			{:else}
				<p class="k-menu-label">No filters: every row shows.</p>
			{/each}
			<button type="button" class="k-menu-item" onclick={addFilter}><Plus class="h-4 w-4" />Add a filter</button>
		</Popover>
	{/if}

	{#if sortOpen && sortBtn}
		<Popover anchor={sortBtn} onClose={() => (sortOpen = false)} width="18rem" label="Sort">
			<div class="flex gap-1.5 p-1">
				<select class="k-input !h-8 !py-0 text-sm" value={view.sortField ?? ''} onchange={(e) => patchView({ sortField: e.currentTarget.value || null })} aria-label="Sort by">
					<option value="">Manual (newest first)</option>
					{#each sortFields as f (f.field)}<option value={f.field}>{f.label}</option>{/each}
				</select>
				<select class="k-input !h-8 !w-auto !py-0 text-sm" value={view.sortDirection} onchange={(e) => patchView({ sortDirection: e.currentTarget.value as 'asc' | 'desc' })} aria-label="Direction">
					<option value="asc">Ascending</option>
					<option value="desc">Descending</option>
				</select>
			</div>
		</Popover>
	{/if}

	{#if propsOpen && propsBtn}
		<Popover anchor={propsBtn} onClose={() => (propsOpen = false)} width="19rem" label="Properties">
			<p class="k-menu-label">Shown in this view</p>
			{#each properties as prop (prop.key)}
				<div class="db-prop-row">
					{#if renamingProp === prop.key}
						<input
							class="k-input !h-7 flex-1 text-sm"
							value={prop.label}
							aria-label="Property name"
							onkeydown={(e) => {
								if (e.key === 'Enter') e.currentTarget.blur();
								if (e.key === 'Escape') renamingProp = null;
							}}
							onblur={(e) => {
								const label = e.currentTarget.value.trim();
								if (label) patchProperty(prop.key, { label });
								renamingProp = null;
							}}
							use:focusSelect
						/>
					{:else}
						<button type="button" class="k-menu-item flex-1" onclick={() => toggleColumn(`prop:${prop.key}`)}>
							{#if isVisible(`prop:${prop.key}`)}<Eye class="h-4 w-4" />{:else}<EyeOff class="h-4 w-4 text-[var(--color-text-faint)]" />{/if}
							<span class="truncate">{prop.label}</span>
						</button>
					{/if}
					<select class="db-type-select" value={prop.type} onchange={(e) => changeType(prop, e.currentTarget.value as PropertyType)} aria-label="Type of {prop.label}">
						{#each PROPERTY_TYPES as t (t.type)}<option value={t.type}>{t.label}</option>{/each}
					</select>
					<button type="button" class="k-icon-btn" onclick={() => (renamingProp = prop.key)} aria-label="Rename {prop.label}"><Pencil class="h-3.5 w-3.5" /></button>
					<button type="button" class="k-icon-btn" onclick={() => { const a = propsBtn!; propsOpen = false; openEditProperty(a, prop); }} aria-label="Settings for {prop.label}" title="Settings"><Settings2 class="h-3.5 w-3.5" /></button>
					<button type="button" class="k-icon-btn hover:!text-[var(--color-danger)]" onclick={() => deleteProperty(prop)} aria-label="Delete {prop.label}"><Trash2 class="h-3.5 w-3.5" /></button>
				</div>
			{/each}
			{#each BUILTIN_FIELDS.filter((b) => b.field !== 'title') as b (b.field)}
				<button type="button" class="k-menu-item" onclick={() => toggleColumn(b.field)}>
					{#if isVisible(b.field)}<Eye class="h-4 w-4" />{:else}<EyeOff class="h-4 w-4 text-[var(--color-text-faint)]" />{/if}
					<span>{b.label}</span>
				</button>
			{/each}
			<div class="k-menu-sep"></div>
			<button type="button" class="k-menu-item" onclick={() => { const a = propsBtn!; propsOpen = false; openAddProperty(a); }}><Plus class="h-4 w-4" />Add a property</button>
		</Popover>
	{/if}

	{#if newMenuOpen && newMenuBtn}
		<Popover anchor={newMenuBtn} onClose={() => (newMenuOpen = false)} width="15rem" label="New">
			<button type="button" class="k-menu-item" onclick={() => { newMenuOpen = false; newRow(); }}><Plus class="h-4 w-4" />Empty row</button>
			{#if templates.length}
				<p class="k-menu-label">From a template</p>
				{#each templates as t (t.id)}
					<button type="button" class="k-menu-item" onclick={() => { newMenuOpen = false; newRow({}, t); }}><FilePlus class="h-4 w-4" /><span class="truncate">{t.name}</span></button>
				{/each}
			{/if}
			<div class="k-menu-sep"></div>
			<button type="button" class="k-menu-item" onclick={() => { newMenuOpen = false; if (templates.length) templatesOpen = true; else addTemplate(); }}><Settings2 class="h-4 w-4" />{templates.length ? 'Edit templates' : 'Add a template'}</button>
		</Popover>
	{/if}

	{#if templatesOpen && newMenuBtn}
		<Popover anchor={newMenuBtn} onClose={() => { templatesOpen = false; editingTemplate = null; }} width="24rem" label="Templates">
			<p class="k-menu-label">Templates for new rows · <code>{'{date}'}</code> becomes today’s date</p>
			{#each templates as t (t.id)}
				<div class="db-template">
					<div class="flex items-center gap-1">
						<button type="button" class="k-menu-item flex-1" onclick={() => (editingTemplate = editingTemplate === t.id ? null : t.id)}>
							<ChevronDown class="h-3.5 w-3.5 transition-transform {editingTemplate === t.id ? '' : '-rotate-90'}" /><span class="truncate">{t.name}</span>
						</button>
						<button type="button" class="k-icon-btn hover:!text-[var(--color-danger)]" onclick={() => saveTemplates(templates.filter((x) => x.id !== t.id))} aria-label="Delete {t.name}"><Trash2 class="h-3.5 w-3.5" /></button>
					</div>
					{#if editingTemplate === t.id}
						<div class="db-template-form">
							<label class="db-field"><span>Name</span><input class="k-input !h-8 text-sm" value={t.name} onchange={(e) => patchTemplate(t.id, { name: e.currentTarget.value.trim() || 'Template' })} /></label>
							<label class="db-field"><span>Title</span><input class="k-input !h-8 text-sm" placeholder="Weekly review {'{date}'}" value={t.title} onchange={(e) => patchTemplate(t.id, { title: e.currentTarget.value })} /></label>
							<label class="db-field db-field-top"><span>Body</span><textarea class="k-input db-formula" rows="4" placeholder="## Notes" value={t.body} onchange={(e) => patchTemplate(t.id, { body: e.currentTarget.value })}></textarea></label>
							{#each properties.filter((p) => !isComputed(p.type) && p.type !== 'relation') as prop (prop.key)}
								<div class="db-field"><span class="truncate">{prop.label}</span>
									<PropertyValue {prop} value={t.props[prop.key]} options={optionsOf(prop, allRows)} onChange={(v) => setTemplateProp(t.id, prop.key, v)} onAddOption={(o) => addOption(prop, o)} />
								</div>
							{/each}
						</div>
					{/if}
				</div>
			{/each}
			<button type="button" class="k-menu-item" onclick={addTemplate}><Plus class="h-4 w-4" />Add a template</button>
		</Popover>
	{/if}

	{#if addPropAnchor}
		<Popover anchor={addPropAnchor} onClose={() => (addPropAnchor = null)} width="19rem" label={editor.key ? 'Property settings' : 'Add a property'}>
			<form class="flex flex-col gap-2 p-1" onsubmit={(e) => { e.preventDefault(); submitProperty(); }}>
				<input class="k-input !h-8 text-sm" placeholder="Property name" bind:value={editor.name} aria-label="Property name" use:focusSelect />
				<div class="db-type-grid" role="radiogroup" aria-label="Type">
					{#each PROPERTY_TYPES as t (t.type)}
						<button type="button" role="radio" aria-checked={editor.type === t.type} class="db-type-opt" onclick={() => (editor.type = t.type)}>{t.label}</button>
					{/each}
				</div>
				{#if editor.type === 'relation'}
					<label class="db-field">
						<span>Links to</span>
						<select class="k-input !h-8 !py-0 text-sm" bind:value={editor.relationTo}>
							<option value={null}>Any note</option>
							{#each databases as d (d.folderId)}<option value={d.folderId}>{d.name}{d.folderId === view.folderId ? ' (this database)' : ''}</option>{/each}
						</select>
					</label>
				{:else if editor.type === 'rollup'}
					{#if relationProps.length === 0}
						<p class="db-help">A rollup summarises a relation. Add a relation property first.</p>
					{:else}
						<label class="db-field">
							<span>Relation</span>
							<select class="k-input !h-8 !py-0 text-sm" bind:value={editor.rollupRelation}>
								<option value="" disabled>Pick a relation</option>
								{#each relationProps as p (p.key)}<option value={p.key}>{p.label}</option>{/each}
							</select>
						</label>
						<label class="db-field">
							<span>Property</span>
							<select class="k-input !h-8 !py-0 text-sm" bind:value={editor.rollupProperty}>
								<option value="title">Title</option>
								{#each rollupTargetProps as p (p.key)}<option value={p.key}>{p.label}</option>{/each}
							</select>
						</label>
						<label class="db-field">
							<span>Show</span>
							<select class="k-input !h-8 !py-0 text-sm" bind:value={editor.rollupFn}>
								{#each ROLLUP_FNS as f (f.fn)}<option value={f.fn}>{f.label}</option>{/each}
							</select>
						</label>
					{/if}
				{:else if editor.type === 'formula'}
					<textarea class="k-input db-formula" rows="3" spellcheck="false" placeholder={'if(prop("Done"), "✓", prop("Due"))'} bind:value={editor.formula} aria-label="Formula"></textarea>
					<p class="db-help">
						<code>prop("Name")</code> reads a property. Also: <code>if</code>, <code>concat</code>, <code>round</code>,
						<code>dateBetween</code>, <code>today()</code>, + − * / and comparisons.
					</p>
					{#if formulaPreview}
						<p class="db-help" class:db-error={formulaPreview.error}>{formulaPreview.row}: {formulaPreview.text}</p>
					{/if}
				{/if}
				<button type="submit" class="k-btn k-btn-primary" disabled={editor.type === 'rollup' && !editor.rollupRelation}>{editor.key ? 'Save' : 'Add'}</button>
			</form>
		</Popover>
	{/if}

	{#if headerMenu}
		{@const prop = propertyOf(headerMenu.field, properties)}
		<Popover anchor={headerMenu.anchor} onClose={() => (headerMenu = null)} width="13rem" label={fieldLabel(headerMenu.field, properties)}>
			<button type="button" class="k-menu-item" onclick={() => { sortBy(headerMenu!.field, 'asc'); headerMenu = null; }}><ArrowUp class="h-4 w-4" />Sort ascending</button>
			<button type="button" class="k-menu-item" onclick={() => { sortBy(headerMenu!.field, 'desc'); headerMenu = null; }}><ArrowDown class="h-4 w-4" />Sort descending</button>
			{#if headerMenu.field !== 'title'}
				<button type="button" class="k-menu-item" onclick={() => { toggleColumn(headerMenu!.field); headerMenu = null; }}><EyeOff class="h-4 w-4" />Hide</button>
			{/if}
			{#if prop}
				<div class="k-menu-sep"></div>
				<button type="button" class="k-menu-item" onclick={() => { const a = headerMenu!.anchor; headerMenu = null; openEditProperty(a, prop); }}><Settings2 class="h-4 w-4" />Edit property</button>
				<button type="button" class="k-menu-item danger" onclick={() => { deleteProperty(prop); headerMenu = null; }}><Trash2 class="h-4 w-4" />Delete property</button>
			{/if}
		</Popover>
	{/if}
{:else}
	<div class="k-empty">
		<Database />
		<p class="k-empty-title">Database not found</p>
		<p>It may have been deleted, or be in another vault.</p>
		<a href="/" class="k-btn mt-2">Back to home</a>
	</div>
{/if}

<style>
	.db-embedded {
		margin: 1rem 0;
		font-family: var(--font-sans);
	}

	.db-embedded-title {
		font-size: 1.125rem;
		font-weight: 700;
		color: var(--color-text);
	}

	.db-tab {
		background: none;
	}

	.db-name {
		margin: 0 -0.25rem;
		padding: 0 0.25rem;
		border-radius: var(--radius-sm);
		text-align: left;
	}

	.db-name:hover {
		background: var(--color-hover);
	}

	.db-name-input {
		width: 100%;
		border: none;
		background: transparent;
		outline: none;
	}

	/* Tabs */
	.db-tabs {
		display: flex;
		align-items: center;
		gap: 0.125rem;
		border-bottom: 1px solid var(--color-border);
		overflow-x: auto;
	}

	.db-tab {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		margin-bottom: -1px;
		padding: 0.5rem 0.625rem;
		border-bottom: 2px solid transparent;
		font-size: 0.8125rem;
		color: var(--color-text-muted);
		white-space: nowrap;
		text-decoration: none;
	}

	.db-tab:hover {
		color: var(--color-text);
	}

	.db-tab[aria-selected='true'] {
		border-bottom-color: var(--color-text);
		color: var(--color-text);
		font-weight: 500;
	}

	.db-tab-input {
		width: 9rem;
		margin: 0.25rem;
		padding: 0.25rem 0.375rem;
		border: 1px solid var(--color-accent);
		border-radius: var(--radius-sm);
		background: var(--color-bg);
		font-size: 0.8125rem;
		outline: none;
	}

	/* Toolbar */
	.db-toolbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.375rem;
		padding: 0.625rem 0;
	}

	.db-search {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		height: 2rem;
		padding: 0 0.5rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
	}

	.db-search:focus-within {
		border-color: var(--color-accent);
	}

	.db-search input {
		width: 9rem;
		border: none;
		background: transparent;
		font-size: 0.8125rem;
		color: var(--color-text);
		outline: none;
	}

	.is-on {
		color: var(--color-accent) !important;
	}

	/* Table */
	.db-table-wrap {
		overflow-x: auto;
		border-top: 1px solid var(--color-border);
	}

	.db-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.8125rem;
	}

	.db-table th,
	.db-table td {
		min-width: 9rem;
		max-width: 22rem;
		padding: 0.125rem 0.25rem;
		border-bottom: 1px solid var(--color-border);
		border-right: 1px solid var(--color-border);
		vertical-align: middle;
		text-align: left;
	}

	.db-table th:last-child,
	.db-table td:last-child {
		min-width: 2.5rem;
		width: 2.5rem;
		border-right: none;
	}

	.db-table .is-title {
		min-width: 14rem;
	}

	.db-th {
		display: flex;
		width: 100%;
		align-items: center;
		gap: 0.375rem;
		padding: 0.375rem;
		border-radius: var(--radius-sm);
		font-size: 0.75rem;
		font-weight: 500;
		color: var(--color-text-muted);
		white-space: nowrap;
	}

	.db-th:hover {
		background: var(--color-hover);
		color: var(--color-text);
	}

	.db-th-type {
		font-weight: 400;
		color: var(--color-text-faint);
	}

	.db-table tbody tr:hover td {
		background: color-mix(in srgb, var(--color-hover) 50%, transparent);
	}

	.db-title {
		display: flex;
		min-width: 0;
		align-items: center;
		gap: 0.375rem;
		padding: 0.25rem 0.375rem;
		font-weight: 500;
		color: var(--color-text);
		text-decoration: none;
	}

	.db-title:hover span {
		text-decoration: underline;
		text-decoration-color: var(--color-text-faint);
		text-underline-offset: 2px;
	}

	.db-title-input {
		width: 100%;
		padding: 0.25rem 0.375rem;
		border: 1px solid var(--color-accent);
		border-radius: var(--radius-sm);
		background: var(--color-bg);
		font: inherit;
		font-weight: 500;
		outline: none;
	}

	.db-static {
		display: block;
		padding: 0.25rem 0.375rem;
		color: var(--color-text-muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.db-new-row td {
		border-right: none;
	}

	.db-new-btn {
		display: flex;
		width: 100%;
		align-items: center;
		gap: 0.375rem;
		padding: 0.375rem;
		border-radius: var(--radius-sm);
		font-size: 0.8125rem;
		color: var(--color-text-faint);
	}

	.db-new-btn:hover {
		background: var(--color-hover);
		color: var(--color-text);
	}

	.db-hint {
		padding: 1rem 0.25rem;
		font-size: 0.8125rem;
		color: var(--color-text-muted);
	}

	/* Cards (board, gallery, calendar) */
	.db-card {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		padding: 0.5rem 0.625rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-bg);
		box-shadow: var(--shadow-sm);
		color: var(--color-text);
		text-decoration: none;
		font-size: 0.8125rem;
	}

	.db-card:hover {
		border-color: color-mix(in srgb, var(--color-text) 20%, var(--color-border));
	}

	.db-card.is-dragging {
		opacity: 0.5;
	}

	.db-card-title {
		display: flex;
		min-width: 0;
		align-items: center;
		gap: 0.375rem;
		font-weight: 500;
	}

	.db-card-field {
		display: flex;
		min-width: 0;
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}

	/* Board */
	.db-board {
		display: flex;
		gap: 0.75rem;
		padding-bottom: 1rem;
		overflow-x: auto;
		align-items: flex-start;
	}

	.db-lane {
		display: flex;
		flex: 0 0 16rem;
		flex-direction: column;
		gap: 0.375rem;
		padding: 0.5rem;
		border: 1px dashed transparent;
		border-radius: var(--radius-lg);
		background: var(--color-bg-secondary);
	}

	.db-lane.is-target,
	.db-undated.is-target {
		border-color: var(--color-accent);
	}

	.db-lane-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.125rem 0.25rem 0.25rem;
	}

	/* Gallery */
	.db-gallery {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
		gap: 0.75rem;
	}

	.db-gallery-card {
		min-height: 8rem;
	}

	.db-excerpt {
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 4;
		line-clamp: 4;
		overflow: hidden;
		font-size: 0.75rem;
		line-height: 1.5;
		color: var(--color-text-muted);
	}

	.db-gallery-new {
		align-items: center;
		justify-content: center;
		flex-direction: row;
		border-style: dashed;
		box-shadow: none;
		color: var(--color-text-faint);
	}

	/* Calendar */
	.db-cal-head {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		margin-bottom: 0.5rem;
	}

	.db-cal {
		display: grid;
		grid-template-columns: repeat(7, minmax(0, 1fr));
		border-top: 1px solid var(--color-border);
		border-left: 1px solid var(--color-border);
	}

	.db-cal-wd {
		padding: 0.375rem;
		border-right: 1px solid var(--color-border);
		border-bottom: 1px solid var(--color-border);
		font-size: 0.6875rem;
		color: var(--color-text-faint);
		text-align: right;
	}

	.db-cal-day {
		display: flex;
		min-height: 6.5rem;
		min-width: 0;
		flex-direction: column;
		gap: 0.125rem;
		padding: 0.25rem;
		border-right: 1px solid var(--color-border);
		border-bottom: 1px solid var(--color-border);
	}

	.db-cal-day.is-other {
		background: var(--color-bg-secondary);
	}

	.db-cal-day.is-target {
		box-shadow: inset 0 0 0 2px var(--color-accent);
	}

	.db-cal-num {
		display: flex;
		align-items: center;
		justify-content: space-between;
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}

	.db-cal-day.is-today .db-cal-num span {
		padding: 0 0.375rem;
		border-radius: 999px;
		background: var(--color-accent);
		color: var(--color-bg);
		font-weight: 600;
	}

	.db-cal-add {
		order: -1;
		display: inline-flex;
		padding: 0.125rem;
		border-radius: var(--radius-sm);
		color: var(--color-text-faint);
		opacity: 0;
	}

	.db-cal-day:hover .db-cal-add,
	.db-cal-add:focus-visible {
		opacity: 1;
	}

	.db-cal-add:hover {
		background: var(--color-hover);
	}

	.db-cal-item {
		display: block;
		padding: 0.125rem 0.375rem;
		border-radius: var(--radius-sm);
		background: var(--color-accent-soft);
		font-size: 0.75rem;
		color: var(--color-text);
		text-decoration: none;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.db-undated {
		margin-top: 1rem;
		padding: 0.75rem;
		border: 1px dashed var(--color-border);
		border-radius: var(--radius-lg);
	}

	.db-undated :global(.db-card) {
		width: 14rem;
	}

	/* Popovers */
	.db-filter {
		display: grid;
		grid-template-columns: 1fr 1fr 1fr auto;
		gap: 0.375rem;
		align-items: center;
		padding: 0.25rem;
	}

	.db-prop-row {
		display: flex;
		align-items: center;
		gap: 0.125rem;
	}

	.db-type-select {
		max-width: 6.5rem;
		padding: 0.125rem 0.25rem;
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
		background: transparent;
		font-size: 0.75rem;
		color: var(--color-text-faint);
	}

	.db-type-select:hover {
		border-color: var(--color-border);
	}

	.db-new-split {
		display: inline-flex;
	}

	.db-new-split > :first-child {
		border-top-right-radius: 0;
		border-bottom-right-radius: 0;
	}

	.db-new-more {
		padding-inline: 0.375rem;
		border-left: 1px solid color-mix(in srgb, var(--color-bg) 30%, transparent);
		border-top-left-radius: 0;
		border-bottom-left-radius: 0;
	}

	.db-group-row td {
		padding: 0;
		border-right: none;
		background: var(--color-bg-secondary);
	}

	.db-group-head {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.375rem 0.5rem;
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--color-text);
	}

	.db-group-count {
		font-weight: 400;
		color: var(--color-text-faint);
	}

	.db-list {
		display: flex;
		flex-direction: column;
		border-top: 1px solid var(--color-border);
	}

	.db-list-row {
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 0.125rem 0.25rem;
		border-bottom: 1px solid var(--color-border);
	}

	.db-list-title {
		min-width: 0;
		flex: 1;
	}

	.db-list-props {
		display: flex;
		flex-shrink: 0;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 0.75rem;
		max-width: 60%;
	}

	.db-list-group {
		margin-top: 0.5rem;
	}

	.db-timeline {
		overflow: auto;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		user-select: none;
	}

	.db-tl-grid {
		position: relative;
		min-width: 100%;
	}

	.db-tl-head {
		position: sticky;
		top: 0;
		z-index: 3;
		display: flex;
		background: var(--color-bg-secondary);
		border-bottom: 1px solid var(--color-border);
	}

	.db-tl-corner {
		position: sticky;
		left: 0;
		z-index: 2;
		width: 14rem;
		flex-shrink: 0;
		background: var(--color-bg-secondary);
		border-right: 1px solid var(--color-border);
	}

	.db-tl-scale {
		position: relative;
		height: 2.75rem;
	}

	.db-tl-month {
		position: absolute;
		top: 0;
		height: 1.375rem;
		padding: 0.25rem 0.5rem;
		border-left: 1px solid var(--color-border);
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--color-text-muted);
		white-space: nowrap;
		overflow: hidden;
	}

	.db-tl-tick {
		position: absolute;
		top: 1.375rem;
		padding: 0.25rem 0.25rem;
		font-size: 0.6875rem;
		color: var(--color-text-faint);
	}

	.db-tl-tick.is-weekend {
		opacity: 0.6;
	}

	.db-tl-body {
		position: relative;
	}

	.db-tl-today {
		position: absolute;
		top: 0;
		bottom: 0;
		z-index: 1;
		width: 2px;
		background: var(--color-accent);
		opacity: 0.6;
		pointer-events: none;
	}

	.db-tl-row {
		display: flex;
		border-bottom: 1px solid var(--color-border);
	}

	.db-tl-label {
		position: sticky;
		left: 0;
		z-index: 2;
		width: 14rem;
		flex-shrink: 0;
		padding: 0.125rem 0.25rem;
		background: var(--color-bg);
		border-right: 1px solid var(--color-border);
		font-size: 0.8125rem;
	}

	.db-tl-track {
		position: relative;
		height: 2.25rem;
	}

	.db-tl-bar {
		position: absolute;
		top: 0.375rem;
		display: flex;
		height: 1.5rem;
		align-items: center;
		padding: 0 0.5rem;
		border-radius: var(--radius-sm);
		background: color-mix(in srgb, var(--color-accent) 30%, var(--color-bg));
		border: 1px solid color-mix(in srgb, var(--color-accent) 60%, transparent);
		font-size: 0.75rem;
		color: var(--color-text);
		cursor: grab;
		overflow: hidden;
	}

	.db-tl-bar.is-dragging {
		cursor: grabbing;
		box-shadow: var(--shadow-md);
	}

	.db-tl-end {
		position: absolute;
		top: 0;
		right: 0;
		bottom: 0;
		width: 0.5rem;
		cursor: ew-resize;
	}

	.db-template {
		padding: 0 0.125rem;
	}

	.db-template-form {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		padding: 0.25rem 0.5rem 0.75rem;
	}

	.db-field-top {
		align-items: start;
	}

	.db-field {
		display: grid;
		grid-template-columns: 5rem 1fr;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}

	.db-help {
		font-size: 0.75rem;
		line-height: 1.45;
		color: var(--color-text-muted);
	}

	.db-error {
		color: var(--color-danger) !important;
	}

	.db-formula {
		height: auto;
		font-family: var(--font-mono);
		font-size: 0.75rem;
	}

	.db-type-grid {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 0.25rem;
	}

	.db-type-opt {
		padding: 0.3125rem 0.5rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		font-size: 0.75rem;
		text-align: left;
		color: var(--color-text-muted);
	}

	.db-type-opt[aria-checked='true'] {
		border-color: var(--color-accent);
		background: var(--color-accent-soft);
		color: var(--color-text);
	}

	@media (max-width: 640px) {
		.db-filter {
			grid-template-columns: 1fr 1fr;
		}

		.db-cal-day {
			min-height: 4.5rem;
		}
	}
</style>
