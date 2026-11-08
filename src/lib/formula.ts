/**
 * Database formulas: a small expression language evaluated per row, Notion
 * style. Parsed by hand (no eval): numbers, "strings", true/false, prop("Name"),
 * + - * / %, comparisons (== != > < >= <=), && || !, parentheses, and
 * functions:
 *
 *   if(cond, then, else)   and(a, b)  or(a, b)  not(a)  empty(x)
 *   concat(a, b, …)  length(x)  lower(s)  upper(s)  contains(s, part)  join(list, sep)
 *   round(x, digits?)  floor(x)  ceil(x)  abs(x)  min(a, …)  max(a, …)  sum(list)  toNumber(x)
 *   today()  now()  dateAdd(date, n, "days"|"weeks"|"months"|"years")
 *   dateBetween(a, b, "days"|"weeks"|"months"|"years")  formatDate(date)  year(date)  month(date)  day(date)
 *
 * Dates are YYYY-MM-DD strings. Lists (multi-select, relations) are arrays.
 */

export type FormulaValue = number | string | boolean | null | FormulaValue[];

type Node =
	| { t: 'lit'; v: FormulaValue }
	| { t: 'call'; name: string; args: Node[] }
	| { t: 'un'; op: string; a: Node }
	| { t: 'bin'; op: string; a: Node; b: Node };

export class FormulaError extends Error {}

function tokenize(src: string): string[] {
	const tokens: string[] = [];
	const re = /\s*(\d+(?:\.\d+)?|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[A-Za-z_][A-Za-z0-9_]*|==|!=|>=|<=|&&|\|\||[-+*/%()<>!,])/y;
	let i = 0;
	while (i < src.length) {
		if (/^\s*$/.test(src.slice(i))) break;
		re.lastIndex = i;
		const m = re.exec(src);
		if (!m) throw new FormulaError(`Unexpected “${src.slice(i).trim()[0]}”`);
		tokens.push(m[1]);
		i = re.lastIndex;
	}
	return tokens;
}

const BINARY: Record<string, number> = { '||': 1, '&&': 2, '==': 3, '!=': 3, '>': 4, '<': 4, '>=': 4, '<=': 4, '+': 5, '-': 5, '*': 6, '/': 6, '%': 6 };

export function parseFormula(src: string): Node {
	const tokens = tokenize(src);
	let pos = 0;
	const peek = () => tokens[pos];
	const next = () => tokens[pos++];
	const expect = (t: string) => {
		if (next() !== t) throw new FormulaError(`Expected “${t}”`);
	};

	function primary(): Node {
		const t = next();
		if (t === undefined) throw new FormulaError('Unexpected end');
		if (/^\d/.test(t)) return { t: 'lit', v: Number(t) };
		if (/^["']/.test(t)) return { t: 'lit', v: t.slice(1, -1).replace(/\\(.)/g, '$1') };
		if (t === '(') {
			const e = expr(0);
			expect(')');
			return e;
		}
		if (t === '-' || t === '!') return { t: 'un', op: t, a: primary() };
		if (/^[A-Za-z_]/.test(t)) {
			if (t === 'true' || t === 'false') return { t: 'lit', v: t === 'true' };
			if (t === 'null') return { t: 'lit', v: null };
			expect('(');
			const args: Node[] = [];
			if (peek() !== ')') {
				args.push(expr(0));
				while (peek() === ',') {
					next();
					args.push(expr(0));
				}
			}
			expect(')');
			return { t: 'call', name: t, args };
		}
		throw new FormulaError(`Unexpected “${t}”`);
	}

	function expr(min: number): Node {
		let left = primary();
		while (peek() !== undefined && BINARY[peek()!] !== undefined && BINARY[peek()!] > min) {
			const op = next()!;
			left = { t: 'bin', op, a: left, b: expr(BINARY[op]) };
		}
		return left;
	}

	if (tokens.length === 0) return { t: 'lit', v: null };
	const tree = expr(0);
	if (pos < tokens.length) throw new FormulaError(`Unexpected “${tokens[pos]}”`);
	return tree;
}

// ---- Evaluation ------------------------------------------------------------------

const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const toDate = (v: string) => {
	const [y, m, d] = v.split('-').map(Number);
	return new Date(Date.UTC(y, m - 1, d));
};
const fromDate = (d: Date) => d.toISOString().slice(0, 10);

function num(v: FormulaValue): number {
	if (typeof v === 'number') return v;
	if (typeof v === 'boolean') return v ? 1 : 0;
	if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v);
	if (Array.isArray(v)) return v.length;
	return 0;
}

function truthy(v: FormulaValue): boolean {
	if (Array.isArray(v)) return v.length > 0;
	return v !== null && v !== false && v !== 0 && v !== '';
}

export function formulaText(v: FormulaValue): string {
	if (v === null) return '';
	if (Array.isArray(v)) return v.map(formulaText).join(', ');
	if (typeof v === 'boolean') return v ? '✓' : '';
	if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 1000) / 1000);
	return v;
}

const unitMs: Record<string, number> = { days: 86400000, day: 86400000, weeks: 604800000, week: 604800000 };

function call(name: string, args: FormulaValue[], today: string): FormulaValue {
	const [a, b, c] = args;
	switch (name) {
		case 'and':
			return args.every(truthy);
		case 'or':
			return args.some(truthy);
		case 'not':
			return !truthy(a);
		case 'empty':
			return !truthy(a ?? null);
		case 'concat':
			return args.map(formulaText).join('');
		case 'length':
			return Array.isArray(a) ? a.length : formulaText(a ?? null).length;
		case 'lower':
			return formulaText(a ?? null).toLowerCase();
		case 'upper':
			return formulaText(a ?? null).toUpperCase();
		case 'contains':
			return Array.isArray(a) ? a.map(formulaText).includes(formulaText(b ?? null)) : formulaText(a ?? null).includes(formulaText(b ?? null));
		case 'join':
			return (Array.isArray(a) ? a : [a ?? null]).map(formulaText).join(b === undefined ? ', ' : formulaText(b));
		case 'round': {
			const f = 10 ** num(b ?? 0);
			return Math.round(num(a ?? null) * f) / f;
		}
		case 'floor':
			return Math.floor(num(a ?? null));
		case 'ceil':
			return Math.ceil(num(a ?? null));
		case 'abs':
			return Math.abs(num(a ?? null));
		case 'min':
			return Math.min(...args.flat().map((v) => num(v as FormulaValue)));
		case 'max':
			return Math.max(...args.flat().map((v) => num(v as FormulaValue)));
		case 'sum':
			return args.flat().reduce<number>((s, v) => s + num(v as FormulaValue), 0);
		case 'toNumber':
			return num(a ?? null);
		case 'today':
			return today;
		case 'now':
			return new Date().toISOString().slice(0, 16).replace('T', ' ');
		case 'dateAdd': {
			if (!isDate(a)) return null;
			const d = toDate(a);
			const n = num(b ?? 0);
			const unit = formulaText(c ?? 'days');
			if (unit.startsWith('month')) d.setUTCMonth(d.getUTCMonth() + n);
			else if (unit.startsWith('year')) d.setUTCFullYear(d.getUTCFullYear() + n);
			else d.setTime(d.getTime() + n * (unitMs[unit] ?? unitMs.days));
			return fromDate(d);
		}
		case 'dateBetween': {
			if (!isDate(a) || !isDate(b)) return null;
			const unit = formulaText(c ?? 'days');
			const x = toDate(a);
			const y = toDate(b);
			if (unit.startsWith('month')) return (x.getUTCFullYear() - y.getUTCFullYear()) * 12 + x.getUTCMonth() - y.getUTCMonth();
			if (unit.startsWith('year')) return x.getUTCFullYear() - y.getUTCFullYear();
			return Math.round((x.getTime() - y.getTime()) / (unitMs[unit] ?? unitMs.days));
		}
		case 'formatDate':
			return isDate(a) ? toDate(a).toLocaleDateString(undefined, { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric' }) : '';
		case 'year':
			return isDate(a) ? Number(a.slice(0, 4)) : null;
		case 'month':
			return isDate(a) ? Number(a.slice(5, 7)) : null;
		case 'day':
			return isDate(a) ? Number(a.slice(8, 10)) : null;
	}
	throw new FormulaError(`No function “${name}”`);
}

function compare(a: FormulaValue, b: FormulaValue): number {
	if (typeof a === 'number' || typeof b === 'number') return num(a) - num(b);
	return formulaText(a).localeCompare(formulaText(b));
}

/**
 * Evaluate a formula for one row. `prop(name)` reads through `getProp`
 * (property labels, case-insensitive; "title" is the note's title).
 */
export function evaluateFormula(src: string | Node, getProp: (name: string) => FormulaValue, today: string): FormulaValue {
	const tree = typeof src === 'string' ? parseFormula(src) : src;
	let steps = 0;
	const ev = (n: Node): FormulaValue => {
		if (++steps > 10000) throw new FormulaError('Too complex');
		switch (n.t) {
			case 'lit':
				return n.v;
			case 'un':
				return n.op === '-' ? -num(ev(n.a)) : !truthy(ev(n.a));
			case 'call':
				if (n.name === 'prop') return getProp(formulaText(ev(n.args[0] ?? { t: 'lit', v: '' })));
				if (n.name === 'if') return truthy(ev(n.args[0])) ? ev(n.args[1] ?? { t: 'lit', v: null }) : ev(n.args[2] ?? { t: 'lit', v: null });
				return call(n.name, n.args.map(ev), today);
			case 'bin': {
				if (n.op === '&&') return truthy(ev(n.a)) && truthy(ev(n.b));
				if (n.op === '||') return truthy(ev(n.a)) || truthy(ev(n.b));
				const a = ev(n.a);
				const b = ev(n.b);
				switch (n.op) {
					case '+':
						if (isDate(a) && typeof b === 'number') return call('dateAdd', [a, b, 'days'], today);
						return typeof a === 'string' || typeof b === 'string' ? formulaText(a) + formulaText(b) : num(a) + num(b);
					case '-':
						if (isDate(a) && isDate(b)) return call('dateBetween', [a, b, 'days'], today);
						return num(a) - num(b);
					case '*':
						return num(a) * num(b);
					case '/':
						return num(b) === 0 ? null : num(a) / num(b);
					case '%':
						return num(b) === 0 ? null : num(a) % num(b);
					case '==':
						return formulaText(a) === formulaText(b);
					case '!=':
						return formulaText(a) !== formulaText(b);
					case '>':
						return compare(a, b) > 0;
					case '<':
						return compare(a, b) < 0;
					case '>=':
						return compare(a, b) >= 0;
					case '<=':
						return compare(a, b) <= 0;
				}
			}
		}
		return null;
	};
	return ev(tree);
}
