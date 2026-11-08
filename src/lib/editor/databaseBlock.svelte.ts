/**
 * ```database blocks: a database shown inside a note (Notion's inline
 * database). The block holds the view's id (`view: <id>`); the editor shows
 * the live database, and the source only while the cursor is in the block.
 * Wired through mermaid.ts, which owns the code_block node view.
 */

import { TextSelection } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import type { Node as ProseMirrorNode } from '@milkdown/kit/prose/model';
import { mount, unmount } from 'svelte';
import DatabaseBlock from '$lib/components/database/DatabaseBlock.svelte';

export const isDatabaseBlock = (node: ProseMirrorNode) =>
	node.type.name === 'code_block' && String(node.attrs.language ?? '').trim().toLowerCase() === 'database';

/** The view id in a block's source: `view: <id>` or the bare id. */
export function databaseBlockViewId(source: string): string {
	const line = source.trim().split('\n')[0] ?? '';
	return line.replace(/^view\s*:\s*/i, '').trim();
}

export function databaseBlockView(node: ProseMirrorNode, view: EditorView, getPos: () => number | undefined) {
	const dom = document.createElement('div');
	dom.className = 'kurumi-database';
	const pre = document.createElement('pre');
	pre.dataset.language = 'database';
	const code = document.createElement('code');
	pre.appendChild(code);
	const preview = document.createElement('div');
	preview.className = 'kurumi-database-preview';
	preview.contentEditable = 'false';
	dom.append(preview, pre);

	const props = $state({ viewId: databaseBlockViewId(node.textContent), onEditSource: () => {} });
	props.onEditSource = () => {
		const pos = getPos();
		if (pos === undefined) return;
		const end = pos + 1 + view.state.doc.nodeAt(pos)!.content.size;
		view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, end)));
		view.focus();
	};
	const component = mount(DatabaseBlock, { target: preview, props });

	return {
		dom,
		contentDOM: code,
		update(next: ProseMirrorNode) {
			if (!isDatabaseBlock(next)) return false;
			props.viewId = databaseBlockViewId(next.textContent);
			return true;
		},
		ignoreMutation: (mutation: MutationRecord | { type: 'selection'; target: Node }) =>
			mutation.type !== 'selection' && preview.contains(mutation.target),
		stopEvent: (event: Event) => preview.contains(event.target as Node),
		destroy() {
			void unmount(component);
		}
	};
}
