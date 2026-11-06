/**
 * Mermaid diagrams in the editor: a ```mermaid code block shows the diagram,
 * and its source only while the cursor is in it (click the diagram to edit).
 * The markdown stays an ordinary code block; other code blocks are untouched.
 */

import { Plugin, PluginKey, TextSelection } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';
import type { Node as ProseMirrorNode } from '@milkdown/kit/prose/model';
import { renderMermaid } from '$lib/mermaid';

const key = new PluginKey('kurumi-mermaid');
const isMermaid = (node: ProseMirrorNode) =>
	node.type.name === 'code_block' && String(node.attrs.language ?? '').trim().toLowerCase() === 'mermaid';

function mermaidView(node: ProseMirrorNode, view: EditorView, getPos: () => number | undefined) {
	const dom = document.createElement('div');
	dom.className = 'kurumi-mermaid';
	const pre = document.createElement('pre');
	pre.dataset.language = 'mermaid';
	const code = document.createElement('code');
	pre.appendChild(code);
	const preview = document.createElement('div');
	preview.className = 'kurumi-mermaid-preview';
	preview.contentEditable = 'false';
	preview.title = 'Click to edit the diagram';
	dom.append(preview, pre);

	let source: string | null = null;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const render = (text: string) => {
		if (text === source) return;
		source = text;
		clearTimeout(timer);
		timer = setTimeout(async () => {
			if (!text.trim()) {
				preview.innerHTML = '<div class="kurumi-mermaid-empty">Mermaid diagram: click to write it</div>';
				return;
			}
			const result = await renderMermaid(text);
			if (text !== source) return; // edited meanwhile
			if ('svg' in result) {
				preview.innerHTML = result.svg;
				preview.classList.remove('has-error');
			} else {
				preview.classList.add('has-error');
				const message = document.createElement('div');
				message.className = 'kurumi-mermaid-error';
				message.textContent = `Diagram error: ${result.error.split('\n')[0]}`;
				// Keep the last good diagram above the message, if any.
				preview.querySelector('.kurumi-mermaid-error')?.remove();
				preview.querySelector('.kurumi-mermaid-empty')?.remove();
				preview.appendChild(message);
			}
		}, source === null ? 0 : 400);
	};
	render(node.textContent);

	// Clicking the diagram puts the cursor at the end of its source.
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
			if (!isMermaid(next)) return false; // language changed: back to a plain block
			render(next.textContent);
			return true;
		},
		ignoreMutation(mutation: MutationRecord | { type: 'selection'; target: Node }) {
			return mutation.type !== 'selection' && preview.contains(mutation.target);
		},
		stopEvent(event: Event) {
			return preview.contains(event.target as Node);
		},
		destroy() {
			clearTimeout(timer);
		}
	};
}

export const mermaidPlugin = $prose(
	() =>
		new Plugin({
			key,
			props: {
				nodeViews: {
					code_block(node, view, getPos) {
						if (!isMermaid(node)) return null as never; // default rendering
						return mermaidView(node, view, getPos as () => number | undefined);
					}
				},
				// Show the source of the diagram the cursor is in.
				decorations(state) {
					const { $from } = state.selection;
					for (let depth = $from.depth; depth > 0; depth--) {
						const node = $from.node(depth);
						if (isMermaid(node)) {
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
