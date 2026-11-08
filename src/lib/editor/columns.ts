/**
 * Columns in the editor: a `columns` block holding two or more `column`s,
 * each with any blocks inside (Notion's columns). Stored as container
 * directives (columns-markdown.ts). Type in any column; the block handle
 * moves or deletes the whole set.
 */

import { $nodeSchema, $remark } from '@milkdown/kit/utils';
import { remarkColumns } from './columns-markdown';

export const remarkKurumiColumns = $remark('kurumiColumns', () => remarkColumns as never);

export const columnsSchema = $nodeSchema('columns', () => ({
	group: 'block',
	content: 'column{2,}',
	isolating: true,
	parseDOM: [{ tag: 'div[data-type="columns"]' }],
	toDOM: () => ['div', { 'data-type': 'columns', class: 'kurumi-columns' }, 0],
	parseMarkdown: {
		match: (node) => node.type === 'containerDirective' && node.name === 'columns',
		runner: (state, node, type) => {
			state.openNode(type);
			state.next(node.children);
			state.closeNode();
		}
	},
	toMarkdown: {
		match: (node) => node.type.name === 'columns',
		runner: (state, node) => {
			state.openNode('containerDirective', undefined, { name: 'columns' });
			state.next(node.content);
			state.closeNode();
		}
	}
}));

export const columnSchema = $nodeSchema('column', () => ({
	content: 'block+',
	isolating: true,
	defining: true,
	parseDOM: [{ tag: 'div[data-type="column"]' }],
	toDOM: () => ['div', { 'data-type': 'column', class: 'kurumi-column' }, 0],
	parseMarkdown: {
		match: (node) => node.type === 'containerDirective' && node.name === 'column',
		runner: (state, node, type) => {
			state.openNode(type);
			state.next(node.children);
			state.closeNode();
		}
	},
	toMarkdown: {
		match: (node) => node.type.name === 'column',
		runner: (state, node) => {
			state.openNode('containerDirective', undefined, { name: 'column' });
			state.next(node.content);
			state.closeNode();
		}
	}
}));

export const columnsPlugins = [remarkKurumiColumns, columnsSchema, columnSchema].flat();
