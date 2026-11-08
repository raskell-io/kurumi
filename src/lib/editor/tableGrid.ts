/**
 * Table edits as operations on a grid of cells (rows × columns). GFM tables
 * have no merged cells, so a table is always a rectangle; row 0 is the header.
 * Kept free of ProseMirror so it can be tested on plain values
 * (`tableToolbar.ts` applies the results to the document).
 */

export type Grid<T> = T[][];
export type Alignment = 'left' | 'center' | 'right';

export function insertRow<T>(grid: Grid<T>, at: number, make: (col: number) => T): Grid<T> {
	const index = Math.max(1, Math.min(at, grid.length)); // never above the header
	const width = grid[0]?.length ?? 0;
	const row = Array.from({ length: width }, (_, col) => make(col));
	return [...grid.slice(0, index), row, ...grid.slice(index)];
}

export function deleteRow<T>(grid: Grid<T>, row: number): Grid<T> {
	// The header stays, and a table keeps at least one body row (GFM needs one).
	if (row < 1 || grid.length <= 2) return grid;
	return grid.filter((_, i) => i !== row);
}

export function insertColumn<T>(grid: Grid<T>, at: number, make: (row: number) => T): Grid<T> {
	const index = Math.max(0, Math.min(at, grid[0]?.length ?? 0));
	return grid.map((cells, row) => [...cells.slice(0, index), make(row), ...cells.slice(index)]);
}

export function deleteColumn<T>(grid: Grid<T>, col: number): Grid<T> {
	if ((grid[0]?.length ?? 0) <= 1) return grid;
	return grid.map((cells) => cells.filter((_, i) => i !== col));
}

export function moveRow<T>(grid: Grid<T>, from: number, to: number): Grid<T> {
	if (from < 1 || to < 1 || from >= grid.length || to >= grid.length || from === to) return grid;
	const next = [...grid];
	const [row] = next.splice(from, 1);
	next.splice(to, 0, row);
	return next;
}

export function moveColumn<T>(grid: Grid<T>, from: number, to: number): Grid<T> {
	const width = grid[0]?.length ?? 0;
	if (from < 0 || to < 0 || from >= width || to >= width || from === to) return grid;
	return grid.map((cells) => {
		const next = [...cells];
		const [cell] = next.splice(from, 1);
		next.splice(to, 0, cell);
		return next;
	});
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** Compare cell texts: numbers by value, text naturally ("item 2" < "item 10"), empty last. */
export function compareCells(a: string, b: string): number {
	const x = a.trim();
	const y = b.trim();
	if (!x || !y) return x ? -1 : y ? 1 : 0;
	const nx = Number(x.replace(/[,\s]/g, ''));
	const ny = Number(y.replace(/[,\s]/g, ''));
	if (x.match(/\d/) && y.match(/\d/) && Number.isFinite(nx) && Number.isFinite(ny)) return nx - ny;
	return collator.compare(x, y);
}

/** Body rows sorted by column `col` (stable); the header stays on top. Empty cells sort last either way. */
export function sortByColumn<T>(grid: Grid<T>, col: number, text: (cell: T) => string, descending = false): Grid<T> {
	const [header, ...body] = grid;
	const sorted = body
		.map((row, index) => ({ row, index, key: text(row[col]) }))
		.sort((a, b) => {
			const emptyA = !a.key.trim();
			const emptyB = !b.key.trim();
			if (emptyA !== emptyB) return emptyA ? 1 : -1;
			const order = compareCells(a.key, b.key);
			return (descending ? -order : order) || a.index - b.index;
		})
		.map((entry) => entry.row);
	return [header, ...sorted];
}
