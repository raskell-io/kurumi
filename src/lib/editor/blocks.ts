/**
 * Block-level editing helpers shared by the slash menu and the block
 * handle's "Turn into" menu.
 *
 * Both used to insert markdown source like `# ` as plain text, which only
 * becomes a heading when *typed* (input rules don't run on programmatic
 * inserts), so the user was left with a literal "# " paragraph. These
 * helpers build real ProseMirror nodes instead.
 */

import type { EditorView } from '@milkdown/kit/prose/view';
import type { Node as PMNode } from '@milkdown/kit/prose/model';
import { Selection, TextSelection, NodeSelection } from '@milkdown/kit/prose/state';
import { canJoin, findWrapping, liftTarget } from '@milkdown/kit/prose/transform';

export type BlockKind =
	| 'paragraph'
	| 'h1'
	| 'h2'
	| 'h3'
	| 'bullet'
	| 'ordered'
	| 'task'
	| 'quote'
	| 'code';

export const BLOCK_KINDS: { kind: BlockKind; label: string }[] = [
	{ kind: 'paragraph', label: 'Text' },
	{ kind: 'h1', label: 'Heading 1' },
	{ kind: 'h2', label: 'Heading 2' },
	{ kind: 'h3', label: 'Heading 3' },
	{ kind: 'bullet', label: 'Bulleted list' },
	{ kind: 'ordered', label: 'Numbered list' },
	{ kind: 'task', label: 'To-do list' },
	{ kind: 'quote', label: 'Quote' },
	{ kind: 'code', label: 'Code' }
];

// The editor's markdown parser, registered per view by Editor.svelte, so
// complex inserts (tables, callouts, toggles) go through the same parser
// as loading a note does.
type Parser = (markdown: string) => PMNode;
const parsers = new WeakMap<EditorView, Parser>();

export function registerMarkdownParser(view: EditorView, parser: Parser): void {
	parsers.set(view, parser);
}

export function getMarkdownParser(view: EditorView): Parser | undefined {
	return parsers.get(view);
}

/** What kind of block the textblock at `pos` currently is. */
export function blockKindAt(view: EditorView, pos: number): BlockKind {
	const $pos = view.state.doc.resolve(pos);
	const block = $pos.parent;
	if (block.type.name === 'heading') return `h${Math.min(3, block.attrs.level)}` as BlockKind;
	if (block.type.name === 'code_block') return 'code';
	for (let d = $pos.depth; d > 0; d--) {
		const node = $pos.node(d);
		if (node.type.name === 'list_item' && node.attrs.checked != null) return 'task';
		if (node.type.name === 'bullet_list') return 'bullet';
		if (node.type.name === 'ordered_list') return 'ordered';
		if (node.type.name === 'blockquote') return 'quote';
	}
	return 'paragraph';
}

/**
 * Convert the textblock containing `pos` (default: the cursor) into
 * `kind`, keeping its text. Lifts it out of any list/quote first, so
 * e.g. a to-do item can become a heading.
 */
export function turnInto(view: EditorView, kind: BlockKind, pos = view.state.selection.from): void {
	const { schema } = view.state;
	const tr = view.state.tr;
	tr.setSelection(TextSelection.near(tr.doc.resolve(pos)));

	// 1. Unwrap out of lists and quotes.
	for (let guard = 0; guard < 8; guard++) {
		const { $from, $to } = tr.selection;
		const range = $from.blockRange($to);
		if (!range || range.depth === 0) break;
		const target = liftTarget(range);
		if (target == null) break;
		tr.lift(range, target);
	}

	// 2. Normalise the textblock, then apply the target type.
	const { from, to } = tr.selection;
	const textblock = (type: string, attrs?: Record<string, unknown>) =>
		tr.setBlockType(from, to, schema.nodes[type], attrs);
	const wrap = (type: string) => {
		const range = tr.selection.$from.blockRange(tr.selection.$to);
		const wrapping = range && findWrapping(range, schema.nodes[type]);
		if (range && wrapping) tr.wrap(range, wrapping);
	};

	textblock('paragraph');
	switch (kind) {
		case 'h1':
		case 'h2':
		case 'h3':
			textblock('heading', { level: Number(kind[1]) });
			break;
		case 'code':
			textblock('code_block');
			break;
		case 'quote':
			wrap('blockquote');
			break;
		case 'bullet':
		case 'task':
			wrap('bullet_list');
			break;
		case 'ordered':
			wrap('ordered_list');
			break;
	}

	if (kind === 'bullet' || kind === 'ordered' || kind === 'task') {
		const { $from } = tr.selection;
		for (let d = $from.depth; d > 0; d--) {
			const node = $from.node(d);
			if (node.type.name !== 'list_item') continue;
			// A tight item (no blank line around it), checkbox for to-dos.
			tr.setNodeMarkup($from.before(d), undefined, {
				...node.attrs,
				spread: false,
				checked: kind === 'task' ? false : null
			});
			// Join with a list of the same type right before/after, so the
			// item continues that list instead of starting a new one.
			const listStart = $from.before(d - 1);
			const listEnd = $from.after(d - 1);
			if (canJoin(tr.doc, listEnd)) tr.join(listEnd);
			if (canJoin(tr.doc, listStart)) tr.join(listStart);
			break;
		}
	}

	view.dispatch(tr.scrollIntoView());
	view.focus();
}

/**
 * Replace `from..to` (e.g. the `/query` text) with blocks parsed from
 * `markdown`. If that leaves the current textblock empty, the blocks
 * replace it; otherwise they go right after it. `select` puts the cursor
 * in the first or last inserted textblock, selecting placeholder text so
 * typing replaces it.
 */
export function insertMarkdownBlocks(
	view: EditorView,
	from: number,
	to: number,
	markdown: string,
	select: 'first' | 'last' = 'last'
): boolean {
	const parse = parsers.get(view);
	if (!parse) return false;
	const content = parse(markdown).content;

	const tr = view.state.tr.delete(from, to);
	const $pos = tr.doc.resolve(tr.mapping.map(from));
	const block = $pos.parent;
	let start: number;
	if (block.isTextblock && block.content.size === 0) {
		start = $pos.before();
		tr.replaceWith(start, $pos.after(), content);
	} else {
		start = $pos.after();
		tr.insert(start, content);
	}
	const end = start + content.size;

	// Find the first/last textblock inside what we inserted.
	let target: { pos: number; node: PMNode } | null = null;
	tr.doc.nodesBetween(start, end, (node, pos) => {
		if (!node.isTextblock) return true;
		if (select === 'last' || !target) target = { pos, node };
		return false;
	});
	if (target) {
		const { pos, node } = target as { pos: number; node: PMNode };
		tr.setSelection(TextSelection.create(tr.doc, pos + 1, pos + 1 + node.content.size));
	} else {
		tr.setSelection(Selection.near(tr.doc.resolve(end)));
	}

	view.dispatch(tr.scrollIntoView());
	view.focus();
	return true;
}

/** Insert an empty paragraph after the top-level block at `pos` and focus it. */
export function insertParagraphAfter(view: EditorView, blockPos: number): void {
	const node = view.state.doc.nodeAt(blockPos);
	if (!node) return;
	const after = blockPos + node.nodeSize;
	const tr = view.state.tr.insert(after, view.state.schema.nodes.paragraph.create());
	tr.setSelection(TextSelection.create(tr.doc, after + 1));
	view.dispatch(tr.scrollIntoView());
	view.focus();
}

/** Duplicate the block at `pos` (a block node position, not inside it). */
export function duplicateBlock(view: EditorView, blockPos: number): void {
	const node = view.state.doc.nodeAt(blockPos);
	if (!node) return;
	view.dispatch(view.state.tr.insert(blockPos + node.nodeSize, node.copy(node.content)).scrollIntoView());
	view.focus();
}

/** Delete the block at `pos` (a block node position). */
export function deleteBlock(view: EditorView, blockPos: number): void {
	const node = view.state.doc.nodeAt(blockPos);
	if (!node) return;
	const tr = view.state.tr.delete(blockPos, blockPos + node.nodeSize);
	if (tr.doc.childCount === 0) tr.insert(0, view.state.schema.nodes.paragraph.create());
	view.dispatch(tr.scrollIntoView());
	view.focus();
}

/** Select the whole block at `pos`, e.g. to show what a menu acts on. */
export function selectBlock(view: EditorView, blockPos: number): void {
	try {
		view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, blockPos)));
	} catch {
		// Not selectable; nothing to highlight.
	}
}
