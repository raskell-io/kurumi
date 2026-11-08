/**
 * LaTeX math in the editor: `$…$` inline and `$$…$$` blocks, stored as
 * that markdown (Obsidian's syntax) and shown rendered by KaTeX.
 *
 * Math has to be its own node type: as plain text the serializer escapes
 * LaTeX (`x_1` → `x\_1`, `\{` → `\\{`) and emphasis eats `*`.
 *
 * - Inline math is an atom: click it to edit its source in a small field
 *   (Enter or leaving the field applies, Escape cancels, empty removes it).
 *   Typing `$x^2$` turns into math as the closing `$` is typed.
 * - A math block shows its source only while the cursor is in it, like a
 *   Mermaid diagram. Typing `$$` and Space or Enter in an empty line starts one.
 *
 * Dollar amounts stay text: like Pandoc and Obsidian, `$…$` is math only
 * when it doesn't start or end with a space and no digit follows it, so
 * "$5 and $10" is not math. The serializer doesn't escape `$` in text
 * either, so that sentence is stored as typed.
 */

import { $inputRule, $nodeSchema, $prose, $remark, $view } from '@milkdown/kit/utils';
import { InputRule } from '@milkdown/kit/prose/inputrules';
import { Plugin, PluginKey, TextSelection } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view';
import type { Node as ProseMirrorNode } from '@milkdown/kit/prose/model';
import { remarkMath } from './math-markdown';
import { renderMath, renderMathNow } from '$lib/math';

export const remarkKurumiMath = $remark('kurumiMath', () => remarkMath as never);

export const mathInlineSchema = $nodeSchema('math_inline', () => ({
	group: 'inline',
	inline: true,
	atom: true,
	selectable: true,
	attrs: { value: { default: '' } },
	parseDOM: [
		{
			tag: 'span[data-type="math_inline"]',
			getAttrs: (dom) => ({ value: (dom as HTMLElement).dataset.value ?? '' })
		}
	],
	toDOM: (node) => ['span', { 'data-type': 'math_inline', 'data-value': node.attrs.value }, `$${node.attrs.value}$`],
	parseMarkdown: {
		match: (node) => node.type === 'inlineMath',
		runner: (state, node, type) => {
			state.addNode(type, { value: (node.value as string) ?? '' });
		}
	},
	toMarkdown: {
		match: (node) => node.type.name === 'math_inline',
		runner: (state, node) => {
			state.addNode('inlineMath', undefined, node.attrs.value as string);
		}
	}
}));

export const mathBlockSchema = $nodeSchema('math_block', () => ({
	group: 'block',
	content: 'text*',
	marks: '',
	code: true,
	defining: true,
	parseDOM: [{ tag: 'div[data-type="math_block"]', preserveWhitespace: 'full' }],
	toDOM: () => ['div', { 'data-type': 'math_block' }, ['pre', ['code', 0]]],
	parseMarkdown: {
		match: (node) => node.type === 'math',
		runner: (state, node, type) => {
			state.openNode(type);
			if (node.value) state.addText(node.value as string);
			state.closeNode();
		}
	},
	toMarkdown: {
		match: (node) => node.type.name === 'math_block',
		runner: (state, node) => {
			state.addNode('math', undefined, node.textContent);
		}
	}
}));

function show(target: HTMLElement, source: string, display: boolean) {
	if (!source.trim()) {
		target.innerHTML = `<span class="kurumi-math-empty">${display ? 'Math block: click to write LaTeX' : 'math'}</span>`;
		return;
	}
	const html = renderMathNow(source, display);
	if (html !== null) {
		target.innerHTML = html;
		return;
	}
	target.textContent = display ? source : `$${source}$`;
	void renderMath(source, display).then((rendered) => {
		if (target.dataset.source === source) target.innerHTML = rendered;
	});
}

export const mathInlineView = $view(mathInlineSchema.node, () => (node, view, getPos) => {
	const dom = document.createElement('span');
	dom.className = 'kurumi-math-inline';
	dom.contentEditable = 'false';
	const rendered = document.createElement('span');
	dom.appendChild(rendered);
	let current = node;
	let input: HTMLInputElement | null = null;

	const paint = () => {
		rendered.dataset.source = current.attrs.value;
		dom.title = current.attrs.value;
		show(rendered, current.attrs.value, false);
	};
	paint();

	const close = (apply: boolean) => {
		if (!input) return;
		// Cleared first: removing the field fires its blur, which calls close again.
		const field = input;
		input = null;
		const value = field.value.trim();
		field.remove();
		dom.classList.remove('is-editing');
		const pos = getPos();
		if (pos === undefined) return;
		if (apply && value !== current.attrs.value) {
			const tr = value
				? view.state.tr.setNodeMarkup(pos, undefined, { value })
				: view.state.tr.delete(pos, pos + current.nodeSize);
			view.dispatch(tr);
		}
		const after = value || !apply ? pos + current.nodeSize : pos;
		view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, Math.min(after, view.state.doc.content.size))));
		view.focus();
	};

	const open = () => {
		if (input || !view.editable) return;
		input = document.createElement('input');
		input.className = 'kurumi-math-input';
		input.value = current.attrs.value;
		input.spellcheck = false;
		input.setAttribute('aria-label', 'LaTeX');
		input.addEventListener('keydown', (event) => {
			if (event.key === 'Enter') {
				event.preventDefault();
				close(true);
			} else if (event.key === 'Escape') {
				event.preventDefault();
				close(false);
			}
		});
		input.addEventListener('blur', () => close(true));
		dom.classList.add('is-editing');
		dom.appendChild(input);
		input.focus();
		input.select();
	};

	dom.addEventListener('mousedown', (event) => {
		if (event.target === input) return;
		event.preventDefault();
		open();
	});

	return {
		dom,
		update(next: ProseMirrorNode) {
			if (next.type !== current.type) return false;
			current = next;
			if (!input) paint();
			return true;
		},
		selectNode() {
			dom.classList.add('is-selected');
		},
		deselectNode() {
			dom.classList.remove('is-selected');
		},
		stopEvent: (event: Event) => !!input && input.contains(event.target as Node),
		ignoreMutation: () => true,
		destroy() {
			input?.remove();
		}
	};
});

export const mathBlockView = $view(mathBlockSchema.node, () => (node, view, getPos) => {
	const dom = document.createElement('div');
	dom.className = 'kurumi-math-block';
	const preview = document.createElement('div');
	preview.className = 'kurumi-math-preview';
	preview.contentEditable = 'false';
	preview.title = 'Click to edit';
	const pre = document.createElement('pre');
	const code = document.createElement('code');
	pre.appendChild(code);
	dom.append(preview, pre);

	let source: string | null = null;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const paint = (text: string) => {
		if (text === source) return;
		const first = source === null;
		source = text;
		clearTimeout(timer);
		timer = setTimeout(() => {
			preview.dataset.source = text;
			show(preview, text, true);
		}, first ? 0 : 250);
	};
	paint(node.textContent);

	// Clicking the formula puts the cursor at the end of its source.
	preview.addEventListener('mousedown', (event) => {
		event.preventDefault();
		const pos = getPos();
		if (pos === undefined) return;
		const end = pos + 1 + view.state.doc.nodeAt(pos)!.content.size;
		view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, end)));
		view.focus();
	});

	return {
		dom,
		contentDOM: code,
		update(next: ProseMirrorNode) {
			if (next.type.name !== 'math_block') return false;
			paint(next.textContent);
			return true;
		},
		ignoreMutation: (mutation: MutationRecord | { type: 'selection'; target: Node }) =>
			mutation.type !== 'selection' && preview.contains(mutation.target),
		stopEvent: (event: Event) => preview.contains(event.target as Node),
		destroy() {
			clearTimeout(timer);
		}
	};
});

/** Show the source of the math block the cursor is in. */
const mathEditingKey = new PluginKey('kurumi-math-editing');
export const mathEditingPlugin = $prose(
	() =>
		new Plugin({
			key: mathEditingKey,
			props: {
				// `$$` + Enter in an otherwise empty paragraph starts a block.
				handleKeyDown(view, event) {
					if (event.key !== 'Enter' || event.shiftKey || event.metaKey || event.ctrlKey) return false;
					const { $from, empty } = view.state.selection;
					if (!empty || $from.parent.type.name !== 'paragraph' || $from.parent.textContent !== '$$') return false;
					const type = view.state.schema.nodes.math_block;
					if (!type) return false;
					const tr = view.state.tr.replaceRangeWith($from.before(), $from.after(), type.create());
					view.dispatch(tr.setSelection(TextSelection.create(tr.doc, $from.before() + 1)));
					return true;
				},
				decorations(state) {
					const { $from } = state.selection;
					for (let depth = $from.depth; depth > 0; depth--) {
						const node = $from.node(depth);
						if (node.type.name === 'math_block') {
							const pos = $from.before(depth);
							return DecorationSet.create(state.doc, [
								Decoration.node(pos, pos + node.nodeSize, { class: 'is-editing' })
							]);
						}
					}
					return null;
				}
			}
		})
);

/** `$x^2$` becomes math when its closing `$` is typed. */
export const mathInlineInputRule = $inputRule(
	(ctx) =>
		new InputRule(
			/(^|[^$\\\w])\$([^\s$](?:[^$]*[^\s$])?)\$$/,
			(state, match, start, end) => {
				const value = match[2];
				const from = start + match[1].length;
				return state.tr.replaceWith(from, end, mathInlineSchema.type(ctx).create({ value }));
			},
			{ inCodeMark: false }
		)
);

/** `$$` then Space or Enter in an empty paragraph starts a math block. */
export const mathBlockInputRule = $inputRule(
	(ctx) =>
		new InputRule(/^\$\$\s$/, (state, _match, start, end) => {
			const $start = state.doc.resolve(start);
			if ($start.parent.type.name !== 'paragraph' || $start.parent.textContent.trim() !== '$$') return null;
			const block = mathBlockSchema.type(ctx).create();
			const tr = state.tr.replaceRangeWith($start.before(), $start.after(), block);
			return tr.setSelection(TextSelection.create(tr.doc, $start.before() + 1));
		})
);

/** Insert inline math at the cursor (the /math command). */
export function insertInlineMath(view: EditorView, from: number, to: number, value: string): boolean {
	const type = view.state.schema.nodes.math_inline;
	if (!type) return false;
	view.dispatch(view.state.tr.replaceWith(from, to, type.create({ value })));
	return true;
}

export const mathPlugins = [
	remarkKurumiMath,
	mathInlineSchema,
	mathBlockSchema,
	mathInlineView,
	mathBlockView,
	mathEditingPlugin,
	mathInlineInputRule,
	mathBlockInputRule
].flat();
