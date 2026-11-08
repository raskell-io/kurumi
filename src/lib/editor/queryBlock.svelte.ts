/**
 * ```kurumi blocks (live queries) in the editor: the results, live, and the
 * query's source only while the cursor is in it, like a Mermaid diagram.
 * Wired through mermaid.ts, which owns the code_block node view.
 */

import { TextSelection } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import type { Node as ProseMirrorNode } from '@milkdown/kit/prose/model';
import { mount, unmount } from 'svelte';
import DataviewBlock from '$lib/components/DataviewBlock.svelte';

export const isQueryBlock = (node: ProseMirrorNode) =>
	node.type.name === 'code_block' && String(node.attrs.language ?? '').trim().toLowerCase() === 'kurumi';

export function queryBlockView(node: ProseMirrorNode, view: EditorView, getPos: () => number | undefined) {
	const dom = document.createElement('div');
	dom.className = 'kurumi-query';
	const pre = document.createElement('pre');
	pre.dataset.language = 'kurumi';
	const code = document.createElement('code');
	pre.appendChild(code);
	const preview = document.createElement('div');
	preview.className = 'kurumi-query-preview';
	preview.contentEditable = 'false';
	dom.append(preview, pre);

	const props = $state({ source: node.textContent });
	const component = mount(DataviewBlock, { target: preview, props });
	let timer: ReturnType<typeof setTimeout> | undefined;

	// A click outside a result's link puts the cursor in the query.
	preview.addEventListener('mousedown', (event) => {
		if ((event.target as HTMLElement).closest('a')) return;
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
			if (!isQueryBlock(next)) return false;
			clearTimeout(timer);
			timer = setTimeout(() => (props.source = next.textContent), 300);
			return true;
		},
		ignoreMutation: (mutation: MutationRecord | { type: 'selection'; target: Node }) =>
			mutation.type !== 'selection' && preview.contains(mutation.target),
		stopEvent: (event: Event) => preview.contains(event.target as Node),
		destroy() {
			clearTimeout(timer);
			void unmount(component);
		}
	};
}
