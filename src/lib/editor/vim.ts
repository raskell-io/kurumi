/**
 * Vim mode for the editor (Settings → Keyboard shortcuts, per device). A
 * compact Vim, not a full one:
 *
 *   Normal   h j k l, w b e, 0 ^ $, gg G (with counts: 3j, 2w)
 *            i a I A o O, x X, r<char>, J, ~, dd yy cc, D C Y, p P, u, Ctrl-R
 *            operators d c y with a motion (dw, c$, y3w, d2j) and iw / aw
 *   Visual   v starts it; motions extend; d x c y; Escape leaves
 *   Insert   typing as usual; Escape (or Ctrl-[) back to Normal
 *
 * Lines are text blocks (paragraphs, headings, list items). Each editor keeps
 * its own mode; the editor shows it in a badge.
 */

import { $prose } from '@milkdown/kit/utils';
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view';
import type { Node as PMNode, ResolvedPos } from '@milkdown/kit/prose/model';
import { undo, redo } from '@milkdown/kit/prose/history';
import { splitBlock, chainCommands, joinForward } from '@milkdown/kit/prose/commands';
import { splitListItem } from '@milkdown/kit/prose/schema-list';
import { writable, get } from 'svelte/store';

export type VimMode = 'normal' | 'insert' | 'visual';

const STORAGE_KEY = 'kurumi-vim';
export const vimEnabled = writable(typeof localStorage !== 'undefined' && localStorage.getItem(STORAGE_KEY) === 'on');
export function setVimEnabled(on: boolean) {
	vimEnabled.set(on);
	try {
		if (on) localStorage.setItem(STORAGE_KEY, 'on');
		else localStorage.removeItem(STORAGE_KEY);
	} catch {
		/* private mode */
	}
}

interface VimState {
	mode: VimMode;
	/** Pending operator or prefix: 'd', 'c', 'y', 'g', 'r', 'di', 'da', … */
	pending: string;
	count: string;
	/** Visual mode's fixed end. */
	anchor: number;
	/** Column to keep on j/k. */
	goalX: number | null;
}

const key = new PluginKey<VimState>('vim');
let register: { text: string; line: boolean } = { text: '', line: false };

type Meta = Partial<VimState>;
const setMeta = (tr: Transaction, meta: Meta) => tr.setMeta(key, meta);

// ---- Positions ---------------------------------------------------------------

/** The text block around pos and its bounds. */
function lineAt(doc: PMNode, pos: number): { start: number; end: number; text: string; node: PMNode; $pos: ResolvedPos } | null {
	const $pos = doc.resolve(Math.max(0, Math.min(pos, doc.content.size)));
	for (let d = $pos.depth; d >= 0; d--) {
		const node = $pos.node(d);
		if (node.isTextblock) {
			const start = $pos.start(d);
			return { start, end: start + node.content.size, text: node.textBetween(0, node.content.size, '\n', '￼'), node, $pos };
		}
	}
	return null;
}

/** All text blocks in order, with their start positions. */
function lines(doc: PMNode): { start: number; end: number }[] {
	const out: { start: number; end: number }[] = [];
	doc.descendants((node, pos) => {
		if (node.isTextblock) {
			out.push({ start: pos + 1, end: pos + 1 + node.content.size });
			return false;
		}
		return true;
	});
	return out;
}

const isWord = (ch: string) => /[\p{L}\p{N}_]/u.test(ch);
const charClass = (ch: string | undefined) => (ch === undefined || /\s/.test(ch) ? 0 : isWord(ch) ? 1 : 2);

/** Characters of the document as a flat sequence; block boundaries count as a newline. */
function charAt(doc: PMNode, pos: number): string | undefined {
	if (pos < 0 || pos >= doc.content.size) return undefined;
	const text = doc.textBetween(pos, pos + 1, '\n', '￼');
	return text === '' ? '\n' : text;
}

function wordForward(doc: PMNode, pos: number): number {
	const size = doc.content.size;
	let p = pos;
	const start = charClass(charAt(doc, p));
	while (p < size && start !== 0 && charClass(charAt(doc, p)) === start) p++;
	while (p < size && charClass(charAt(doc, p)) === 0) p++;
	return clampToText(doc, p, 1);
}

function wordBackward(doc: PMNode, pos: number): number {
	let p = pos - 1;
	while (p > 0 && charClass(charAt(doc, p)) === 0) p--;
	const cls = charClass(charAt(doc, p));
	while (p > 0 && charClass(charAt(doc, p - 1)) === cls) p--;
	return clampToText(doc, Math.max(0, p), -1);
}

function wordEnd(doc: PMNode, pos: number): number {
	const size = doc.content.size;
	let p = pos + 1;
	while (p < size && charClass(charAt(doc, p)) === 0) p++;
	const cls = charClass(charAt(doc, p));
	while (p < size - 1 && charClass(charAt(doc, p + 1)) === cls) p++;
	return clampToText(doc, p, 1);
}

/** The nearest position inside a text block (block boundaries aren't places the cursor can be). */
function clampToText(doc: PMNode, pos: number, bias: 1 | -1): number {
	const p = Math.max(0, Math.min(pos, doc.content.size));
	const $p = doc.resolve(p);
	if ($p.parent.isTextblock) return p;
	const sel = TextSelection.findFrom($p, bias, true) ?? TextSelection.findFrom($p, -bias as 1 | -1, true);
	return sel ? sel.head : p;
}

/** Normal mode's cursor sits on a character, never after the last one. */
function onChar(doc: PMNode, pos: number): number {
	const line = lineAt(doc, pos);
	if (!line) return pos;
	return line.end > line.start ? Math.min(pos, line.end - 1) : line.start;
}

function vertical(view: EditorView, head: number, dir: 1 | -1, goalX: number | null): { pos: number; goalX: number } {
	const coords = view.coordsAtPos(head);
	const x = goalX ?? coords.left;
	const all = lines(view.state.doc);
	const index = all.findIndex((l) => head >= l.start && head <= l.end);
	// Wrapped lines first (same block), then the next block.
	const probe = view.posAtCoords({ left: x, top: dir > 0 ? coords.bottom + 4 : coords.top - 4 });
	if (probe && probe.pos !== head && Math.abs(view.coordsAtPos(probe.pos).top - coords.top) > 2) {
		const target = lineAt(view.state.doc, probe.pos);
		if (target && (target.start === all[index]?.start || all[index + dir]?.start === target.start)) return { pos: probe.pos, goalX: x };
	}
	const next = all[index + dir];
	if (!next) return { pos: head, goalX: x };
	const at = view.coordsAtPos(dir > 0 ? next.start : next.end);
	const hit = view.posAtCoords({ left: x, top: (at.top + at.bottom) / 2 });
	const pos = hit && hit.pos >= next.start && hit.pos <= next.end ? hit.pos : dir > 0 ? next.start : next.start;
	return { pos, goalX: x };
}

// ---- Motions -------------------------------------------------------------------

type Motion = { to: number; linewise?: boolean; inclusive?: boolean; goalX?: number };

function motion(view: EditorView, keyName: string, head: number, count: number, goalX: number | null): Motion | null {
	const { doc } = view.state;
	const line = lineAt(doc, head);
	let p = head;
	switch (keyName) {
		case 'h':
		case 'ArrowLeft':
			return { to: Math.max(line?.start ?? 0, head - count) };
		case 'l':
		case 'ArrowRight':
			return { to: Math.min(line ? Math.max(line.start, line.end - 1) : head, head + count) };
		case 'j':
		case 'ArrowDown':
		case 'k':
		case 'ArrowUp': {
			let g = goalX;
			for (let i = 0; i < count; i++) {
				const r = vertical(view, p, keyName === 'j' || keyName === 'ArrowDown' ? 1 : -1, g);
				p = r.pos;
				g = r.goalX;
			}
			return { to: p, linewise: true, goalX: g ?? undefined };
		}
		case 'w':
			for (let i = 0; i < count; i++) p = wordForward(doc, p);
			return { to: p };
		case 'b':
			for (let i = 0; i < count; i++) p = wordBackward(doc, p);
			return { to: p };
		case 'e':
			for (let i = 0; i < count; i++) p = wordEnd(doc, p);
			return { to: p, inclusive: true };
		case '0':
		case 'Home':
			return { to: line?.start ?? head };
		case '^':
			return { to: line ? line.start + (line.text.match(/^\s*/)?.[0].length ?? 0) : head };
		case '$':
		case 'End':
			return { to: line ? Math.max(line.start, line.end - 1) : head, inclusive: true };
		case 'G': {
			const all = lines(doc);
			return { to: all[all.length - 1]?.start ?? head, linewise: true };
		}
		case 'gg':
			return { to: lines(doc)[0]?.start ?? 0, linewise: true };
	}
	return null;
}

/** iw / aw: the word (and for aw, the space after it) around head. */
function textObject(doc: PMNode, head: number, kind: 'i' | 'a'): { from: number; to: number } | null {
	const line = lineAt(doc, head);
	if (!line) return null;
	const at = head - line.start;
	const cls = charClass(line.text[at]);
	let a = at;
	let b = at;
	while (a > 0 && charClass(line.text[a - 1]) === cls) a--;
	while (b < line.text.length && charClass(line.text[b]) === cls) b++;
	if (kind === 'a') while (b < line.text.length && /\s/.test(line.text[b])) b++;
	return { from: line.start + a, to: line.start + b };
}

// ---- Edits ---------------------------------------------------------------------

/** The block a line belongs to for dd/yy: its list item if in one, else the text block. */
function lineBlock(state: EditorState, pos: number): { from: number; to: number; text: string } | null {
	const $pos = state.doc.resolve(pos);
	for (let d = $pos.depth; d > 0; d--) {
		const node = $pos.node(d);
		if (node.type.name === 'list_item' || (node.isTextblock && $pos.node(d - 1).type.name !== 'list_item')) {
			const from = $pos.before(d);
			return { from, to: from + node.nodeSize, text: node.textContent };
		}
	}
	return null;
}

function deleteLines(view: EditorView, head: number, count: number, yankOnly = false): void {
	const { state } = view;
	const first = lineBlock(state, head);
	if (!first) return;
	let to = first.to;
	const texts = [first.text];
	for (let i = 1; i < count; i++) {
		const next = lineBlock(state, Math.min(state.doc.content.size, to + 2));
		if (!next || next.from < to) break;
		to = next.to;
		texts.push(next.text);
	}
	register = { text: texts.join('\n'), line: true };
	if (yankOnly) return void view.dispatch(setMeta(state.tr, { pending: '', count: '' }));
	let tr = state.tr.delete(first.from, to);
	if (tr.doc.content.size === 0 || tr.doc.childCount === 0) tr = tr.insert(0, state.schema.nodes.paragraph.create());
	const target = clampToText(tr.doc, Math.min(first.from + 1, tr.doc.content.size), 1);
	view.dispatch(setMeta(tr.setSelection(TextSelection.create(tr.doc, onChar(tr.doc, target))), { mode: 'normal', pending: '', count: '' }));
}

function putLines(view: EditorView, head: number, before: boolean): void {
	const { state } = view;
	const block = lineBlock(state, head);
	if (!block) return;
	const paragraphs = register.text.split('\n').map((t) => state.schema.nodes.paragraph.create(null, t ? state.schema.text(t) : null));
	const at = before ? block.from : block.to;
	const $at = state.doc.resolve(at);
	// Inside a list, a new list item; elsewhere, paragraphs.
	const inList = $at.parent.type.name.endsWith('list');
	const nodes = inList
		? paragraphs.map((p) => state.schema.nodes.list_item.create($at.parent.firstChild?.attrs ?? null, p))
		: paragraphs;
	const tr = state.tr.insert(at, nodes);
	view.dispatch(tr.setSelection(TextSelection.create(tr.doc, clampToText(tr.doc, at + (inList ? 2 : 1), 1))));
}

function openLine(view: EditorView, below: boolean): void {
	const { state } = view;
	const line = lineAt(state.doc, state.selection.head);
	if (!line) return;
	view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, below ? line.end : line.start)));
	const listItem = view.state.schema.nodes.list_item;
	const split = listItem ? chainCommands(splitListItem(listItem), splitBlock) : splitBlock;
	split(view.state, view.dispatch);
	if (!below) {
		// The new empty block is the one we split off above: step back into it.
		const prev = TextSelection.findFrom(view.state.doc.resolve(lineAt(view.state.doc, view.state.selection.head)!.start - 1), -1, true);
		if (prev) view.dispatch(view.state.tr.setSelection(prev));
	}
}

// ---- The plugin ------------------------------------------------------------------

function setMode(view: EditorView, mode: VimMode, extra: Meta = {}) {
	view.dispatch(setMeta(view.state.tr, { mode, pending: '', count: '', ...extra }));
}

function moveTo(view: EditorView, pos: number, meta: Meta = {}) {
	const { state } = view;
	const vim = key.getState(state)!;
	const head = vim.mode === 'visual' ? pos : onChar(state.doc, pos);
	const sel =
		vim.mode === 'visual'
			? TextSelection.create(state.doc, vim.anchor, head >= vim.anchor ? Math.min(head + 1, state.doc.content.size) : head)
			: TextSelection.create(state.doc, head);
	view.dispatch(setMeta(state.tr.setSelection(sel).scrollIntoView(), { pending: '', count: '', ...meta }));
}

/** Visual mode's selection as a range (both ends inclusive of the cursor's character). */
function visualRange(state: EditorState): { from: number; to: number } {
	return { from: state.selection.from, to: state.selection.to };
}

function applyOperator(view: EditorView, op: string, from: number, to: number, linewise: boolean, count: number) {
	const { state } = view;
	if (linewise) {
		const a = lineBlock(state, Math.min(from, to));
		const b = lineBlock(state, Math.max(from, to));
		if (!a || !b) return;
		if (op === 'y') {
			register = { text: state.doc.textBetween(a.from, b.to, '\n'), line: true };
			return setMode(view, 'normal');
		}
		register = { text: state.doc.textBetween(a.from, b.to, '\n'), line: true };
		if (op === 'c') {
			const line = lineAt(state.doc, a.from + 1)!;
			view.dispatch(state.tr.delete(line.start, line.end));
			return setMode(view, 'insert');
		}
		deleteLines(view, a.from + 1, Math.max(1, count));
		return;
	}
	const start = Math.min(from, to);
	const end = Math.max(from, to);
	if (end <= start) return setMode(view, op === 'c' ? 'insert' : 'normal');
	register = { text: state.doc.textBetween(start, end, '\n'), line: false };
	if (op === 'y') {
		view.dispatch(setMeta(state.tr.setSelection(TextSelection.create(state.doc, onChar(state.doc, start))), { mode: 'normal', pending: '', count: '' }));
		return;
	}
	const tr = state.tr.delete(start, end);
	const mode: VimMode = op === 'c' ? 'insert' : 'normal';
	const at = mode === 'normal' ? onChar(tr.doc, start) : start;
	view.dispatch(setMeta(tr.setSelection(TextSelection.create(tr.doc, at)), { mode, pending: '', count: '' }));
}

function handleKey(view: EditorView, event: KeyboardEvent): boolean {
	const vim = key.getState(view.state);
	if (!vim || !get(vimEnabled)) return false;
	const k = event.key;
	const { state } = view;
	const head = state.selection.head;

	if (vim.mode === 'insert') {
		if (k === 'Escape' || (event.ctrlKey && k === '[')) {
			const line = lineAt(state.doc, head);
			const back = line && head > line.start ? head - 1 : head;
			view.dispatch(setMeta(state.tr.setSelection(TextSelection.create(state.doc, onChar(state.doc, back))), { mode: 'normal', pending: '', count: '' }));
			return true;
		}
		return false;
	}

	// Normal and Visual. Let shortcuts with Cmd/Ctrl/Alt through, except a few.
	if (event.ctrlKey && k === 'r') {
		redo(state, view.dispatch);
		return true;
	}
	if (event.metaKey || event.ctrlKey || event.altKey) return false;
	if (k === 'Shift' || k === 'Control' || k === 'Alt' || k === 'Meta' || k === 'Tab') return false;

	if (k === 'Escape') {
		if (vim.mode === 'visual') moveTo(view, head > vim.anchor ? head - 1 : head, { mode: 'normal' });
		else setMode(view, 'normal');
		// Let the app see Escape too (closing popups) when nothing was pending.
		return vim.mode === 'visual' || !!vim.pending;
	}

	const count = Math.max(1, parseInt(vim.count || '1', 10));
	const cursor = vim.mode === 'visual' && head > vim.anchor ? head - 1 : head;

	// r<char>: replace the character under the cursor.
	if (vim.pending === 'r') {
		if (k.length === 1) {
			const line = lineAt(state.doc, cursor);
			if (line && cursor < line.end) view.dispatch(state.tr.insertText(k, cursor, Math.min(line.end, cursor + count)));
		}
		setMode(view, 'normal');
		return true;
	}

	// Counts
	if (/^[0-9]$/.test(k) && (k !== '0' || vim.count)) {
		view.dispatch(setMeta(state.tr, { count: vim.count + k }));
		return true;
	}

	// Operator pending: d/c/y + motion, doubled for lines, or i/a + w
	if (vim.pending && /^[dcy]/.test(vim.pending)) {
		const op = vim.pending[0];
		if (vim.pending.length === 2) {
			if (k === 'w') {
				const range = textObject(state.doc, cursor, vim.pending[1] as 'i' | 'a');
				if (range) applyOperator(view, op, range.from, range.to, false, count);
			} else setMode(view, 'normal');
			return true;
		}
		if (k === op) {
			if (op === 'y') deleteLines(view, cursor, count, true);
			else if (op === 'c') applyOperator(view, 'c', cursor, cursor, true, 1);
			else deleteLines(view, cursor, count);
			if (op !== 'd') setMode(view, op === 'c' ? 'insert' : 'normal');
			return true;
		}
		if (k === 'i' || k === 'a') {
			view.dispatch(setMeta(state.tr, { pending: op + k }));
			return true;
		}
		if (k === 'g') {
			view.dispatch(setMeta(state.tr, { pending: op + 'g' }));
			return true;
		}
		const m = motion(view, vim.pending === op + 'g' && k === 'g' ? 'gg' : k === 'w' && op === 'c' ? 'e' : k, cursor, count, vim.goalX);
		if (!m) {
			setMode(view, 'normal');
			return true;
		}
		const inclusive = m.inclusive || (k === 'w' && op === 'c');
		applyOperator(view, op, cursor, m.linewise ? m.to : inclusive ? m.to + 1 : m.to, !!m.linewise, count);
		return true;
	}

	if (vim.pending === 'g') {
		if (k === 'g') {
			const m = motion(view, 'gg', cursor, count, null)!;
			moveTo(view, m.to, { goalX: null });
		} else setMode(view, vim.mode);
		return true;
	}

	// Visual-mode actions
	if (vim.mode === 'visual' && /^[dxcy]$/.test(k)) {
		const { from, to } = visualRange(state);
		applyOperator(view, k === 'x' ? 'd' : k, from, to, false, 1);
		return true;
	}

	// Motions
	const m = motion(view, k, cursor, count, vim.goalX);
	if (m) {
		moveTo(view, m.to, { goalX: m.goalX ?? null });
		return true;
	}

	switch (k) {
		case 'i':
			setMode(view, 'insert');
			return true;
		case 'a': {
			const line = lineAt(state.doc, head);
			const to = line && line.end > head ? head + 1 : head;
			view.dispatch(setMeta(state.tr.setSelection(TextSelection.create(state.doc, to)), { mode: 'insert', pending: '', count: '' }));
			return true;
		}
		case 'I':
		case 'A': {
			const line = lineAt(state.doc, head);
			if (!line) return true;
			const to = k === 'I' ? line.start + (line.text.match(/^\s*/)?.[0].length ?? 0) : line.end;
			view.dispatch(setMeta(state.tr.setSelection(TextSelection.create(state.doc, to)), { mode: 'insert', pending: '', count: '' }));
			return true;
		}
		case 'o':
		case 'O':
			openLine(view, k === 'o');
			setMode(view, 'insert');
			return true;
		case 'v':
			if (vim.mode === 'visual') moveTo(view, cursor, { mode: 'normal' });
			else {
				view.dispatch(
					setMeta(state.tr.setSelection(TextSelection.create(state.doc, head, Math.min(head + 1, lineAt(state.doc, head)?.end ?? head))), {
						mode: 'visual',
						anchor: head,
						pending: '',
						count: ''
					})
				);
			}
			return true;
		case 'x':
		case 'X': {
			const line = lineAt(state.doc, head);
			if (!line) return true;
			const from = k === 'x' ? head : Math.max(line.start, head - count);
			const to = k === 'x' ? Math.min(line.end, head + count) : head;
			if (to > from) {
				register = { text: state.doc.textBetween(from, to), line: false };
				const tr = state.tr.delete(from, to);
				view.dispatch(setMeta(tr.setSelection(TextSelection.create(tr.doc, onChar(tr.doc, from))), { count: '' }));
			}
			return true;
		}
		case 'D':
		case 'C': {
			const line = lineAt(state.doc, head);
			if (!line) return true;
			applyOperator(view, k === 'D' ? 'd' : 'c', head, line.end, false, 1);
			return true;
		}
		case 'Y':
			deleteLines(view, head, count, true);
			return true;
		case 'p':
		case 'P':
			if (register.line) putLines(view, head, k === 'P');
			else if (register.text) {
				const line = lineAt(state.doc, head);
				const at = k === 'p' && line && line.end > head ? head + 1 : head;
				const tr = state.tr.insertText(register.text, at);
				view.dispatch(tr.setSelection(TextSelection.create(tr.doc, onChar(tr.doc, at + register.text.length - 1))));
			}
			return true;
		case 'u':
			for (let i = 0; i < count; i++) undo(view.state, view.dispatch);
			return true;
		case 'J': {
			const line = lineAt(state.doc, head);
			if (line) {
				view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, line.end)));
				joinForward(view.state, view.dispatch);
				view.dispatch(view.state.tr.insertText(' '));
			}
			return true;
		}
		case '~': {
			const ch = state.doc.textBetween(head, head + 1);
			if (ch) {
				const flipped = ch === ch.toUpperCase() ? ch.toLowerCase() : ch.toUpperCase();
				const tr = state.tr.insertText(flipped, head, head + 1);
				view.dispatch(tr.setSelection(TextSelection.create(tr.doc, onChar(tr.doc, head + 1))));
			}
			return true;
		}
		case 'd':
		case 'c':
		case 'y':
		case 'g':
		case 'r':
			view.dispatch(setMeta(state.tr, { pending: k }));
			return true;
	}
	// Any other printable key does nothing in Normal mode.
	return k.length === 1;
}

/** Called with the mode whenever it changes, per editor (for the badge). */
const listeners = new WeakMap<Element, (mode: VimMode | null) => void>();
export function onVimMode(root: Element, listener: ((mode: VimMode | null) => void) | null) {
	if (listener) listeners.set(root, listener);
	else listeners.delete(root);
}

export const vimPlugin = $prose(
	() =>
		new Plugin<VimState>({
			key,
			state: {
				init: () => ({ mode: 'normal', pending: '', count: '', anchor: 0, goalX: null }),
				apply(tr, value) {
					const meta = tr.getMeta(key) as Meta | undefined;
					let next = meta ? { ...value, ...meta } : value;
					// Mouse selections in Normal mode with a range: Visual.
					if (!meta && tr.selectionSet && next.mode === 'normal' && !tr.selection.empty && !tr.docChanged) {
						next = { ...next, mode: 'visual', anchor: tr.selection.anchor };
					}
					// A move that isn't j/k (a click, typing) forgets the column.
					if (!meta && tr.selectionSet) next = { ...next, goalX: null };
					return next;
				}
			},
			props: {
				handleKeyDown: (view, event) => handleKey(view, event),
				// Typing (also IME and mobile keyboards) only lands in Insert mode.
				handleTextInput: (view) => !!get(vimEnabled) && key.getState(view.state)?.mode !== 'insert',
				decorations(state) {
					const vim = key.getState(state);
					if (!vim || !get(vimEnabled) || vim.mode === 'insert') return null;
					const head = vim.mode === 'visual' && state.selection.head > vim.anchor ? state.selection.head - 1 : state.selection.head;
					const line = lineAt(state.doc, head);
					if (!line) return null;
					if (head < line.end) return DecorationSet.create(state.doc, [Decoration.inline(head, head + 1, { class: 'vim-cursor' })]);
					return DecorationSet.create(state.doc, [
						Decoration.widget(head, () => {
							const el = document.createElement('span');
							el.className = 'vim-cursor vim-cursor-empty';
							el.textContent = ' ';
							return el;
						}, { side: 1 })
					]);
				},
				attributes(state): Record<string, string> {
					const vim = key.getState(state);
					return get(vimEnabled) && vim ? { class: `vim vim-${vim.mode}` } : {};
				}
			},
			view(view) {
				let last: VimMode | null = null;
				const report = () => {
					const mode = get(vimEnabled) ? (key.getState(view.state)?.mode ?? null) : null;
					if (mode === last) return;
					last = mode;
					for (let el: Element | null = view.dom; el; el = el.parentElement) {
						const listener = listeners.get(el);
						if (listener) {
							listener(mode);
							break;
						}
					}
				};
				let first = true;
				const unsubscribe = vimEnabled.subscribe(() => {
					// Re-render decorations and attributes when turned on or off
					// (not during setup: the view is still being built).
					if (first) return void (first = false);
					view.dispatch(view.state.tr.setMeta(key, { mode: 'normal', pending: '', count: '' }));
				});
				queueMicrotask(report);
				return {
					update: report,
					destroy: unsubscribe
				};
			}
		})
);
