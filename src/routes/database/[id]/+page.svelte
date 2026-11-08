<script lang="ts">
	/**
	 * A database: the notes of one folder as rows, with typed properties.
	 * Views of the folder show as tabs (table, board, gallery, calendar);
	 * they share the properties, each keeps its own columns, filters and
	 * sort. Values live on the notes (customProps), so a row is just a note.
	 */
	import { page } from '$app/stores';
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
		updateMemoryObject,
		type MemoryObject,
		type DatabaseView,
		type DatabaseViewType,
		type DatabaseFilter,
		type PropertyDefinition,
		type PropertyType
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
		isEmptyValue
	} from '$lib/database';
	import { markdownExcerpt } from '$lib/utils/excerpt';
	import { pushUndo } from '$lib/stores/undo';
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
		ChevronRight
	} from 'lucide-svelte';

	const LAYOUTS: { type: DatabaseViewType; label: string; icon: typeof Table }[] = [
		{ type: 'table', label: 'Table', icon: Table },
		{ type: 'board', label: 'Board', icon: Kanban },
		{ type: 'gallery', label: 'Gallery', icon: LayoutGrid },
		{ type: 'calendar', label: 'Calendar', icon: CalendarDays }
	];

	let viewId = $derived($page.params.id ?? '');
	let view = $derived($databaseViews.find((v) => v.id === viewId));
	let folder = $derived(view ? $folders.find((f) => f.id === view.folderId) : undefined);
	let siblings = $derived(
		view ? $databaseViews.filter((v) => v.folderId === view.folderId).sort((a, b) => a.createdAt - b.createdAt) : []
	);
	let properties = $derived(view?.properties ?? []);
	let allRows = $derived(view ? $memoryObjects.filter((m) => m.folderId === view.folderId) : []);
	let search = $state('');
	let rows = $derived(
		view ? sortRows(filterRows(allRows, view.filters ?? [], properties, search), view.sortField, view.sortDirection, properties) : []
	);
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
		goto(`/database/${created.id}`);
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
				goto(`/database/${removed.id}`);
			}
		});
		viewMenuOpen = false;
		goto(next ? `/database/${next.id}` : folder ? `/read/folder/${folder.id}` : '/');
	}

	// ---- Rows --------------------------------------------------------------

	let newRowId = $state<string | null>(null);

	function newRow(props: Record<string, unknown> = {}) {
		if (!view) return;
		// A new row passes the view's "is" filters, so it doesn't vanish.
		const preset: Record<string, unknown> = {};
		for (const f of view.filters ?? []) {
			const prop = propertyOf(f.field, properties);
			if (!prop || f.op !== 'is' || !f.value) continue;
			preset[prop.key] = prop.type === 'multiSelect' ? [f.value] : prop.type === 'number' ? Number(f.value) : f.value;
		}
		const memory = addDatabaseRow(view.folderId, '', { ...preset, ...props });
		search = '';
		newRowId = memory.id;
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
	let newPropName = $state('');
	let newPropType = $state<PropertyType>('text');
	let renamingDb = $state(false);

	function openAddProperty(anchor: HTMLElement) {
		newPropName = '';
		newPropType = 'text';
		addPropAnchor = anchor;
	}

	function submitAddProperty() {
		const label = newPropName.trim() || PROPERTY_TYPES.find((t) => t.type === newPropType)!.label;
		const prop = addProperty(label, newPropType);
		if (view?.viewType === 'board' && !view.groupField && prop.type === 'select') patchView({ groupField: `prop:${prop.key}` });
		if (view?.viewType === 'calendar' && !view.dateField && prop.type === 'date') patchView({ dateField: `prop:${prop.key}` });
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
		properties.filter((p) => p.key !== skip && isVisible(`prop:${p.key}`) && !isEmptyValue(memory.customProps?.[p.key]));

	// ---- Calendar ----------------------------------------------------------

	let dateProp = $derived(view?.dateField ? propertyOf(view.dateField, properties) : undefined);
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
	<title>{folder?.name ?? 'Database'} - Kurumi</title>
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
	{#if prop}
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
				<span class="truncate">{valueText(memory.customProps?.[prop.key], prop.type)}</span>
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
	<div class="k-page k-page-wide">
		<header class="mb-3">
			<p class="flex items-center gap-1.5 text-xs text-[var(--color-text-faint)]">
				<Database class="h-3.5 w-3.5" /> Database
				{#if folder}
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
				<h1 class="k-page-title">
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
					<a href="/database/{v.id}" class="db-tab" role="tab" aria-selected={v.id === view.id}>
						<Icon class="h-3.5 w-3.5" />{v.name}
					</a>
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
			{#if view.viewType === 'calendar' && dateProps.length > 0}
				<select class="k-input !h-8 !w-auto !py-0 text-sm" value={view.dateField ?? ''} onchange={(e) => patchView({ dateField: e.currentTarget.value || null })} aria-label="Date property">
					{#each dateProps as p (p.key)}<option value="prop:{p.key}">By {p.label}</option>{/each}
				</select>
			{/if}
			<span class="flex-1"></span>
			<span class="text-xs tabular-nums text-[var(--color-text-faint)]">{rows.length}{rows.length !== allRows.length ? ` of ${allRows.length}` : ''}</span>
			<button type="button" class="k-btn k-btn-primary" onclick={() => newRow()}>
				<Plus class="h-3.5 w-3.5" />New
			</button>
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
						{#each rows as memory (memory.id)}
							<tr>
								{#each columns as field (field)}
									<td class:is-title={field === 'title'}>
										{#if field === 'title'}{@render rowTitle(memory)}{:else}{@render cell(memory, field)}{/if}
									</td>
								{/each}
								<td></td>
							</tr>
						{/each}
						<tr class="db-new-row">
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

	{#if addPropAnchor}
		<Popover anchor={addPropAnchor} onClose={() => (addPropAnchor = null)} width="16rem" label="Add a property">
			<form class="flex flex-col gap-2 p-1" onsubmit={(e) => { e.preventDefault(); submitAddProperty(); }}>
				<input class="k-input !h-8 text-sm" placeholder="Property name" bind:value={newPropName} aria-label="Property name" use:focusSelect />
				<div class="db-type-grid" role="radiogroup" aria-label="Type">
					{#each PROPERTY_TYPES as t (t.type)}
						<button type="button" role="radio" aria-checked={newPropType === t.type} class="db-type-opt" onclick={() => (newPropType = t.type)}>{t.label}</button>
					{/each}
				</div>
				<button type="submit" class="k-btn k-btn-primary">Add</button>
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
				<button type="button" class="k-menu-item" onclick={() => { headerMenu = null; propsOpen = true; renamingProp = prop.key; }}><Pencil class="h-4 w-4" />Rename</button>
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
