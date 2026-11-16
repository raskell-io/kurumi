/**
 * Toggles in the editor: a <details> block (toggle-markdown.ts) is a real
 * node, a title row with a caret and the blocks inside, like Notion's
 * toggle. The Markdown it writes is what was read, tag for tag.
 *
 * - The caret (a button) opens and closes it. That's a view setting, never
 *   written: a toggle starts closed unless it says `<details open>`, or the
 *   cursor is in it (a new one).
 * - Enter in the title goes inside; Enter on an empty last line leaves it.
 * - Backspace at the start of the title unwraps it: the title becomes a
 *   paragraph and the content stays where it was.
 */

import { $nodeSchema, $prose, $remark } from '@milkdown/kit/utils';
import { Plugin, PluginKey, TextSelection, type EditorState } from '@milkdown/kit/prose/state';
import type { EditorView, NodeView } from '@milkdown/kit/prose/view';
import type { Node as PMNode } from '@milkdown/kit/prose/model';
import { groupToggles, startsOpen, toggleOpening, type MdNode } from './toggle-markdown';

export const remarkKurumiToggles = $remark('kurumiToggles', () => () => (tree: unknown) => {
	groupToggles(tree as MdNode);
});

export const toggleSchema = $nodeSchema('toggle', () => ({
	group: 'block',
	content: 'toggle_summary block*',
	defining: true,
	attrs: {
		open: { default: '<details>\n<summary>' },
		close: { default: '</summary>' },
		end: { default: '</details>' }
	},
	parseDOM: [
		{
			tag: 'div[data-type="toggle"]',
			getAttrs: (dom) => {
				const el = dom as HTMLElement;
				return { open: el.dataset.open ?? '<details>\n<summary>', close: el.dataset.close ?? '</summary>', end: el.dataset.end ?? '</details>' };
			}
		}
	],
	toDOM: (node) => [
		'div',
		{ 'data-type': 'toggle', class: 'kurumi-toggle', 'data-open': node.attrs.open, 'data-close': node.attrs.close, 'data-end': node.attrs.end },
		0
	],
	parseMarkdown: {
		match: (node) => node.type === 'kurumiToggle',
		runner: (state, node, type) => {
			const data = node.data as { open: string; close: string; end: string; summary: string };
			state.openNode(type, { open: data.open, close: data.close, end: data.end });
			state.openNode(state.schema.nodes.toggle_summary);
			if (data.summary) state.addText(data.summary);
			state.closeNode();
			state.next(node.children);
			state.closeNode();
		}
	},
	toMarkdown: {
		match: (node) => node.type.name === 'toggle',
		// The paragraphs Milkdown read: one holding the opening HTML, the
		// content, one holding the closing tag.
		runner: (state, node) => {
			const summary = node.firstChild?.textContent ?? '';
			state.openNode('paragraph');
			state.addNode('html', undefined, toggleOpening(node.attrs as { open: string; close: string }, summary));
			state.closeNode();
			state.next(node.content.cut(node.firstChild?.nodeSize ?? 0));
			state.openNode('paragraph');
			state.addNode('html', undefined, node.attrs.end);
			state.closeNode();
		}
	}
}));

export const toggleSummarySchema = $nodeSchema('toggle_summary', () => ({
	content: 'text*',
	marks: '',
	defining: true,
	parseDOM: [{ tag: 'div[data-type="toggle-summary"]' }],
	toDOM: () => ['div', { 'data-type': 'toggle-summary', class: 'kurumi-toggle-summary' }, 0],
	parseMarkdown: { match: () => false, runner: () => {} },
	// Written by the toggle itself.
	toMarkdown: { match: (node) => node.type.name === 'toggle_summary', runner: () => {} }
}));

const key = new PluginKey('kurumi-toggle');
type OpenableDom = HTMLElement & { _setOpen?: (open: boolean) => void };

function toggleView(node: PMNode, view: EditorView, getPos: () => number | undefined): NodeView {
	const dom = document.createElement('div') as OpenableDom;
	dom.className = 'kurumi-toggle';
	dom.dataset.type = 'toggle';
	const caret = document.createElement('button');
	caret.type = 'button';
	caret.className = 'kurumi-toggle-caret';
	caret.contentEditable = 'false';
	caret.innerHTML =
		'<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="m9 6 6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
	const content = document.createElement('div');
	content.className = 'kurumi-toggle-content';
	dom.append(caret, content);

	// A new toggle (the cursor is in it) starts open.
	const pos = getPos();
	const { from } = view.state.selection;
	let open = startsOpen(node.attrs.open) || (pos !== undefined && from > pos && from < pos + node.nodeSize);
	const title = () => (node.firstChild?.textContent || 'Toggle').trim();
	const render = () => {
		dom.classList.toggle('is-open', open);
		dom.classList.toggle('is-empty', node.childCount < 2);
		caret.setAttribute('aria-expanded', String(open));
		caret.setAttribute('aria-label', `${open ? 'Collapse' : 'Expand'} “${title()}”`);
	};
	dom._setOpen = (next) => {
		if (next === open) return;
		open = next;
		render();
	};
	render();

	caret.addEventListener('mousedown', (event) => event.preventDefault());
	caret.addEventListener('click', (event) => {
		event.preventDefault();
		open = !open;
		render();
		// Closing it with the cursor inside: the cursor moves to the title.
		const at = getPos();
		if (!open && at !== undefined && view.editable) {
			const { from: cursor } = view.state.selection;
			const summaryEnd = at + 1 + (node.firstChild?.nodeSize ?? 2) - 1;
			if (cursor > summaryEnd && cursor < at + node.nodeSize) {
				view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, summaryEnd)));
			}
		}
	});

	return {
		dom,
		contentDOM: content,
		update(next) {
			if (next.type !== node.type) return false;
			node = next;
			render();
			return true;
		},
		stopEvent: (event) => caret.contains(event.target as Node),
		ignoreMutation: (mutation) => mutation.type !== 'selection' && (mutation.target === dom || caret.contains(mutation.target)),
		destroy() {
			delete dom._setOpen;
		}
	};
}

/** The toggle whose title holds the cursor, and where. */
function summaryAt(state: EditorState) {
	const { $from } = state.selection;
	if ($from.parent.type.name !== 'toggle_summary') return null;
	return { togglePos: $from.before($from.depth - 1), toggle: $from.node($from.depth - 1), $from };
}

function unwrap(view: EditorView, togglePos: number, toggle: PMNode) {
	const { schema } = view.state;
	const summary = toggle.firstChild!;
	const paragraph = schema.nodes.paragraph.create(null, summary.content);
	const body = toggle.content.cut(summary.nodeSize);
	const tr = view.state.tr.replaceWith(togglePos, togglePos + toggle.nodeSize, [paragraph, ...nodesOf(body)]);
	tr.setSelection(TextSelection.create(tr.doc, togglePos + 1));
	view.dispatch(tr.scrollIntoView());
}

function nodesOf(fragment: PMNode['content']): PMNode[] {
	const nodes: PMNode[] = [];
	fragment.forEach((n) => nodes.push(n));
	return nodes;
}

export const togglePlugin = $prose(
	() =>
		new Plugin({
			key,
			props: {
				nodeViews: {
					toggle: (node, view, getPos) => toggleView(node, view, getPos as () => number | undefined)
				},
				handleKeyDown(view, event) {
					if (event.altKey || event.metaKey || event.ctrlKey || event.isComposing) return false;
					const { state } = view;
					if (event.key === 'Enter' && !event.shiftKey) {
						const at = summaryAt(state);
						if (!at) return false;
						event.preventDefault();
						// Into the toggle: its first line if that is empty, else a new one.
						(view.nodeDOM(at.togglePos) as OpenableDom | null)?._setOpen?.(true);
						const bodyStart = at.togglePos + 1 + at.toggle.firstChild!.nodeSize;
						const first = at.toggle.childCount > 1 ? at.toggle.child(1) : null;
						let tr = state.tr;
						if (!(first?.type.name === 'paragraph' && first.content.size === 0)) {
							tr = tr.insert(bodyStart, state.schema.nodes.paragraph.create());
						}
						tr.setSelection(TextSelection.create(tr.doc, bodyStart + 1));
						view.dispatch(tr.scrollIntoView());
						return true;
					}
					if (event.key === 'Backspace' && state.selection.empty) {
						const at = summaryAt(state);
						if (at && at.$from.parentOffset === 0) {
							event.preventDefault();
							unwrap(view, at.togglePos, at.toggle);
							return true;
						}
						// At the start of the toggle's first block: to the end of the
						// title, deleting that block if it is empty (no merging text
						// into the title, which holds no formatting).
						const { $from } = state.selection;
						if ($from.parentOffset !== 0 || $from.depth < 2) return false;
						const parent = $from.node($from.depth - 1);
						if (parent.type.name !== 'toggle' || $from.index($from.depth - 1) !== 1) return false;
						event.preventDefault();
						const togglePos = $from.before($from.depth - 1);
						const summaryEnd = togglePos + parent.firstChild!.nodeSize;
						let tr = state.tr;
						if ($from.parent.content.size === 0) tr = tr.delete($from.before(), $from.after());
						tr.setSelection(TextSelection.create(tr.doc, summaryEnd));
						view.dispatch(tr.scrollIntoView());
						return true;
					}
					return false;
				}
			},
			// A cursor that lands in a closed toggle's content opens it (find,
			// undo, arrow keys).
			view: () => ({
				update(view) {
					const { $from } = view.state.selection;
					for (let depth = $from.depth; depth > 0; depth--) {
						if ($from.node(depth).type.name !== 'toggle') continue;
						if ($from.index(depth) > 0) (view.nodeDOM($from.before(depth)) as OpenableDom | null)?._setOpen?.(true);
					}
				}
			})
		})
);

export const togglePlugins = [remarkKurumiToggles, toggleSchema, toggleSummarySchema, togglePlugin].flat();
