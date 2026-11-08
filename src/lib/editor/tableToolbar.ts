/**
 * Table toolbar: while the cursor is in a table, a small bar above it adds
 * rows and columns, aligns and sorts the current column, and (in its ⋯ menu)
 * moves or deletes rows and columns, or the table.
 *
 * Edits rebuild the table from a grid of cells (`tableGrid.ts`), so the
 * header row always stays first, as GFM requires. Tab / Shift+Tab between
 * cells come from Milkdown's GFM preset.
 */

import { Plugin, PluginKey, TextSelection, type EditorState } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import type { Node as ProseMirrorNode } from '@milkdown/kit/prose/model';
import { $prose } from '@milkdown/kit/utils';
import { mount, unmount, type Component } from 'svelte';
import BetweenHorizontalStart from 'lucide-svelte/icons/between-horizontal-start';
import BetweenHorizontalEnd from 'lucide-svelte/icons/between-horizontal-end';
import BetweenVerticalStart from 'lucide-svelte/icons/between-vertical-start';
import BetweenVerticalEnd from 'lucide-svelte/icons/between-vertical-end';
import TextAlignStart from 'lucide-svelte/icons/text-align-start';
import TextAlignCenter from 'lucide-svelte/icons/text-align-center';
import TextAlignEnd from 'lucide-svelte/icons/text-align-end';
import ArrowUpNarrowWide from 'lucide-svelte/icons/arrow-up-narrow-wide';
import ArrowDownWideNarrow from 'lucide-svelte/icons/arrow-down-wide-narrow';
import Ellipsis from 'lucide-svelte/icons/ellipsis';
import {
	deleteColumn,
	deleteRow,
	insertColumn,
	insertRow,
	moveColumn,
	moveRow,
	sortByColumn,
	type Alignment,
	type Grid
} from './tableGrid';

const key = new PluginKey('kurumi-table-toolbar');

interface TableAt {
	table: ProseMirrorNode;
	pos: number;
	row: number;
	col: number;
}

/** The table the cursor is in, with the cursor's row and column. */
export function tableAt(state: EditorState): TableAt | null {
	const { $from } = state.selection;
	for (let depth = $from.depth; depth > 2; depth--) {
		const cell = $from.node(depth);
		if (cell.type.name !== 'table_cell' && cell.type.name !== 'table_header') continue;
		const table = $from.node(depth - 2);
		if (table.type.name !== 'table') return null;
		return { table, pos: $from.before(depth - 2), row: $from.index(depth - 2), col: $from.index(depth - 1) };
	}
	return null;
}

const toGrid = (table: ProseMirrorNode): Grid<ProseMirrorNode> => {
	const grid: Grid<ProseMirrorNode> = [];
	table.forEach((row) => {
		const cells: ProseMirrorNode[] = [];
		row.forEach((cell) => cells.push(cell));
		grid.push(cells);
	});
	return grid;
};

/** A cell of the type its row needs (header cells in row 0), keeping its content. */
function cellFor(state: EditorState, cell: ProseMirrorNode, row: number): ProseMirrorNode {
	const type = state.schema.nodes[row === 0 ? 'table_header' : 'table_cell'];
	return cell.type === type ? cell : type.create(cell.attrs, cell.content, cell.marks);
}

function fromGrid(state: EditorState, grid: Grid<ProseMirrorNode>, table: ProseMirrorNode): ProseMirrorNode {
	const { table_header_row, table_row } = state.schema.nodes;
	const rows = grid.map((cells, i) =>
		(i === 0 ? table_header_row : table_row).create(null, cells.map((cell) => cellFor(state, cell, i)))
	);
	return table.type.create(table.attrs, rows);
}

function emptyCell(state: EditorState, row: number, alignment: string): ProseMirrorNode {
	return state.schema.nodes[row === 0 ? 'table_header' : 'table_cell'].createAndFill({ alignment })!;
}

/** Replace the table with `grid` and put the cursor in cell (`row`, `col`). */
function apply(view: EditorView, at: TableAt, grid: Grid<ProseMirrorNode>, row: number, col: number) {
	const { state } = view;
	const table = fromGrid(state, grid, at.table);
	const tr = state.tr.replaceWith(at.pos, at.pos + at.table.nodeSize, table);
	let cellPos = at.pos + 1;
	const r = Math.max(0, Math.min(row, table.childCount - 1));
	for (let i = 0; i < r; i++) cellPos += table.child(i).nodeSize;
	const rowNode = table.child(r);
	const c = Math.max(0, Math.min(col, rowNode.childCount - 1));
	cellPos += 1;
	for (let i = 0; i < c; i++) cellPos += rowNode.child(i).nodeSize;
	tr.setSelection(TextSelection.near(tr.doc.resolve(cellPos + 2)));
	view.dispatch(tr.scrollIntoView());
	view.focus();
}

const alignmentOf = (at: TableAt): Alignment => (at.table.firstChild?.maybeChild(at.col)?.attrs.alignment ?? 'left') as Alignment;

export type TableAction =
	| 'row-above'
	| 'row-below'
	| 'row-up'
	| 'row-down'
	| 'row-delete'
	| 'col-left'
	| 'col-right'
	| 'col-move-left'
	| 'col-move-right'
	| 'col-delete'
	| 'align-left'
	| 'align-center'
	| 'align-right'
	| 'sort-asc'
	| 'sort-desc'
	| 'table-delete';

/** Whether `action` does anything for the cursor's cell (e.g. no row above the header). */
export function canRun(at: TableAt, action: TableAction): boolean {
	const rows = at.table.childCount;
	const cols = at.table.firstChild?.childCount ?? 0;
	switch (action) {
		case 'row-above':
			return at.row > 0;
		case 'row-up':
			return at.row > 1;
		case 'row-down':
			return at.row > 0 && at.row < rows - 1;
		case 'row-delete':
			return at.row > 0 && rows > 2;
		case 'col-move-left':
			return at.col > 0;
		case 'col-move-right':
			return at.col < cols - 1;
		case 'col-delete':
			return cols > 1;
		case 'sort-asc':
		case 'sort-desc':
			return rows > 2;
		default:
			return true;
	}
}

export function runTableAction(view: EditorView, action: TableAction): boolean {
	const at = tableAt(view.state);
	if (!at || !canRun(at, action)) return false;
	const { state } = view;
	const grid = toGrid(at.table);
	const align = alignmentOf(at);
	const rowCell = (row: number) => (col: number) =>
		emptyCell(state, row, (grid[0][col]?.attrs.alignment as string) ?? 'left');
	switch (action) {
		case 'row-above':
			apply(view, at, insertRow(grid, at.row, rowCell(1)), at.row, at.col);
			break;
		case 'row-below':
			apply(view, at, insertRow(grid, at.row + 1, rowCell(1)), at.row + 1, at.col);
			break;
		case 'row-up':
			apply(view, at, moveRow(grid, at.row, at.row - 1), at.row - 1, at.col);
			break;
		case 'row-down':
			apply(view, at, moveRow(grid, at.row, at.row + 1), at.row + 1, at.col);
			break;
		case 'row-delete':
			apply(view, at, deleteRow(grid, at.row), Math.min(at.row, grid.length - 2), at.col);
			break;
		case 'col-left':
			apply(view, at, insertColumn(grid, at.col, (row) => emptyCell(state, row, 'left')), at.row, at.col);
			break;
		case 'col-right':
			apply(view, at, insertColumn(grid, at.col + 1, (row) => emptyCell(state, row, 'left')), at.row, at.col + 1);
			break;
		case 'col-move-left':
			apply(view, at, moveColumn(grid, at.col, at.col - 1), at.row, at.col - 1);
			break;
		case 'col-move-right':
			apply(view, at, moveColumn(grid, at.col, at.col + 1), at.row, at.col + 1);
			break;
		case 'col-delete':
			apply(view, at, deleteColumn(grid, at.col), at.row, Math.min(at.col, grid[0].length - 2));
			break;
		case 'align-left':
		case 'align-center':
		case 'align-right': {
			const alignment = action.slice('align-'.length);
			if (alignment === align) return true;
			const next = grid.map((cells) =>
				cells.map((cell, col) => (col === at.col ? cell.type.create({ ...cell.attrs, alignment }, cell.content, cell.marks) : cell))
			);
			apply(view, at, next, at.row, at.col);
			break;
		}
		case 'sort-asc':
		case 'sort-desc':
			apply(view, at, sortByColumn(grid, at.col, (cell) => cell.textContent, action === 'sort-desc'), at.row, at.col);
			break;
		case 'table-delete': {
			const tr = state.tr.delete(at.pos, at.pos + at.table.nodeSize);
			tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(at.pos, tr.doc.content.size))));
			view.dispatch(tr.scrollIntoView());
			view.focus();
			break;
		}
	}
	return true;
}

interface ButtonSpec {
	action: TableAction;
	label: string;
	icon: Component<{ size?: number }>;
}

const QUICK: (ButtonSpec | 'sep')[] = [
	{ action: 'row-above', label: 'Insert row above', icon: BetweenHorizontalStart as never },
	{ action: 'row-below', label: 'Insert row below', icon: BetweenHorizontalEnd as never },
	{ action: 'col-left', label: 'Insert column left', icon: BetweenVerticalStart as never },
	{ action: 'col-right', label: 'Insert column right', icon: BetweenVerticalEnd as never },
	'sep',
	{ action: 'align-left', label: 'Align column left', icon: TextAlignStart as never },
	{ action: 'align-center', label: 'Center column', icon: TextAlignCenter as never },
	{ action: 'align-right', label: 'Align column right', icon: TextAlignEnd as never },
	'sep',
	{ action: 'sort-asc', label: 'Sort by this column, A → Z', icon: ArrowUpNarrowWide as never },
	{ action: 'sort-desc', label: 'Sort by this column, Z → A', icon: ArrowDownWideNarrow as never }
];

const MENU: ({ action: TableAction; label: string; danger?: boolean } | 'sep')[] = [
	{ action: 'row-up', label: 'Move row up' },
	{ action: 'row-down', label: 'Move row down' },
	{ action: 'col-move-left', label: 'Move column left' },
	{ action: 'col-move-right', label: 'Move column right' },
	'sep',
	{ action: 'row-delete', label: 'Delete row', danger: true },
	{ action: 'col-delete', label: 'Delete column', danger: true },
	{ action: 'table-delete', label: 'Delete table', danger: true }
];

class TableToolbar {
	private bar: HTMLDivElement;
	private menu: HTMLDivElement | null = null;
	private buttons = new Map<TableAction, HTMLButtonElement>();
	private icons: ReturnType<typeof mount>[] = [];
	private tableDom: HTMLElement | null = null;

	constructor(private view: EditorView) {
		this.bar = document.createElement('div');
		this.bar.className = 'kurumi-table-toolbar';
		this.bar.setAttribute('role', 'toolbar');
		this.bar.setAttribute('aria-label', 'Table');
		this.bar.hidden = true;
		// Keep the editor's selection while clicking the bar.
		this.bar.addEventListener('mousedown', (event) => event.preventDefault());
		for (const spec of QUICK) {
			if (spec === 'sep') {
				const sep = document.createElement('span');
				sep.className = 'kurumi-table-toolbar-sep';
				this.bar.appendChild(sep);
				continue;
			}
			this.bar.appendChild(this.button(spec.action, spec.label, spec.icon));
		}
		const more = this.button(null, 'More table actions', Ellipsis as never);
		more.addEventListener('click', () => this.toggleMenu(more));
		this.bar.appendChild(more);
		document.body.appendChild(this.bar);
		window.addEventListener('scroll', this.position, true);
		window.addEventListener('resize', this.position);
		this.update(view);
	}

	private button(action: TableAction | null, label: string, icon: Component<{ size?: number }>) {
		const button = document.createElement('button');
		button.type = 'button';
		button.className = 'kurumi-table-toolbar-btn';
		button.title = label;
		button.setAttribute('aria-label', label);
		this.icons.push(mount(icon, { target: button, props: { size: 15 } }));
		if (action) {
			button.dataset.action = action;
			button.addEventListener('click', () => runTableAction(this.view, action));
			this.buttons.set(action, button);
		}
		return button;
	}

	private toggleMenu(anchor: HTMLElement) {
		if (this.menu) return this.closeMenu();
		const at = tableAt(this.view.state);
		if (!at) return;
		const menu = document.createElement('div');
		menu.className = 'k-menu kurumi-table-menu';
		menu.setAttribute('role', 'menu');
		menu.addEventListener('mousedown', (event) => event.preventDefault());
		for (const item of MENU) {
			if (item === 'sep') {
				const sep = document.createElement('div');
				sep.className = 'k-menu-sep';
				menu.appendChild(sep);
				continue;
			}
			const button = document.createElement('button');
			button.type = 'button';
			button.className = `k-menu-item${item.danger ? ' danger' : ''}`;
			button.setAttribute('role', 'menuitem');
			button.textContent = item.label;
			button.dataset.action = item.action;
			button.disabled = !canRun(at, item.action);
			button.addEventListener('click', () => {
				this.closeMenu();
				runTableAction(this.view, item.action);
			});
			menu.appendChild(button);
		}
		document.body.appendChild(menu);
		const rect = anchor.getBoundingClientRect();
		menu.style.top = `${rect.bottom + 4}px`;
		menu.style.left = `${Math.max(8, Math.min(rect.right - menu.offsetWidth, window.innerWidth - menu.offsetWidth - 8))}px`;
		this.menu = menu;
		setTimeout(() => document.addEventListener('mousedown', this.outside, true));
	}

	private outside = (event: MouseEvent) => {
		if (this.menu?.contains(event.target as Node)) return;
		this.closeMenu();
	};

	private closeMenu() {
		this.menu?.remove();
		this.menu = null;
		document.removeEventListener('mousedown', this.outside, true);
	}

	update(view: EditorView) {
		this.view = view;
		const at = view.editable && view.hasFocus() ? tableAt(view.state) : null;
		if (!at) {
			this.tableDom = null;
			this.bar.hidden = true;
			this.closeMenu();
			return;
		}
		const dom = view.nodeDOM(at.pos);
		this.tableDom = dom instanceof HTMLElement ? dom : null;
		const align = alignmentOf(at);
		for (const [action, button] of this.buttons) {
			button.disabled = !canRun(at, action);
			button.classList.toggle('is-active', action === `align-${align}`);
		}
		this.bar.hidden = false;
		this.position();
	}

	private position = () => {
		if (!this.tableDom || this.bar.hidden) return;
		const rect = this.tableDom.getBoundingClientRect();
		const height = this.bar.offsetHeight || 32;
		// Above the table; pinned to the top of the screen while the table scrolls under it.
		const top = Math.min(Math.max(rect.top - height - 6, 8), rect.bottom - height);
		this.bar.style.top = `${top}px`;
		this.bar.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - this.bar.offsetWidth - 8))}px`;
		if (this.menu) this.closeMenu();
	};

	destroy() {
		window.removeEventListener('scroll', this.position, true);
		window.removeEventListener('resize', this.position);
		this.closeMenu();
		for (const icon of this.icons) void unmount(icon);
		this.bar.remove();
	}
}

export const tableToolbarPlugin = $prose(
	() =>
		new Plugin({
			key,
			view: (view) => new TableToolbar(view),
			props: {
				// Tab in the last cell adds a row (Milkdown's Tab stops there).
				handleKeyDown(view, event) {
					if (event.key !== 'Tab' || event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) return false;
					const at = tableAt(view.state);
					if (!at || at.row !== at.table.childCount - 1 || at.col !== at.table.child(at.row).childCount - 1) return false;
					const grid = toGrid(at.table);
					const next = insertRow(grid, grid.length, (col) =>
						emptyCell(view.state, 1, (grid[0][col]?.attrs.alignment as string) ?? 'left')
					);
					apply(view, at, next, grid.length, 0);
					event.preventDefault();
					return true;
				},
				handleDOMEvents: {
					// The bar follows focus: hide it when the editor loses focus.
					blur: (view) => {
						setTimeout(() => !view.isDestroyed && view.dispatch(view.state.tr.setMeta(key, 'blur')));
						return false;
					},
					focus: (view) => {
						setTimeout(() => !view.isDestroyed && view.dispatch(view.state.tr.setMeta(key, 'focus')));
						return false;
					}
				}
			}
		})
);
