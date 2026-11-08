/**
 * Columns in markdown (editor/columns.ts): generic container directives,
 * the only kind Kurumi reads:
 *
 *   ::::columns
 *   :::column
 *   Left
 *   :::
 *
 *   :::column
 *   Right
 *   :::
 *   ::::
 *
 * Only the `:::` container syntax is turned on: inline `:name` and leaf `::name`
 * directives would change how ordinary text ("Status:done") is read. Other
 * containers (`:::note`) stay as written (raw), and a column outside columns,
 * or columns with fewer than two, lose their wrapper and keep their content.
 */

import { directive } from 'micromark-extension-directive';
import { directiveFromMarkdown, directiveToMarkdown } from 'mdast-util-directive';

interface MdNode {
	type: string;
	name?: string;
	value?: string;
	children?: MdNode[];
	position?: { start: { offset?: number }; end: { offset?: number } };
}

const isDirective = (n: MdNode, name?: string) => n.type === 'containerDirective' && (name === undefined || n.name === name);

function normalize(node: MdNode, source: string, inColumns = false): MdNode[] {
	if (node.type === 'containerDirective') {
		if (node.name === 'columns' && !inColumns) {
			const columns: MdNode[] = [];
			let loose: MdNode[] = [];
			const flush = () => {
				if (loose.length) columns.push({ type: 'containerDirective', name: 'column', children: loose });
				loose = [];
			};
			for (const child of node.children ?? []) {
				if (isDirective(child, 'column')) {
					flush();
					columns.push({ ...child, children: (child.children ?? []).flatMap((c) => normalize(c, source, true)) });
				} else loose.push(...normalize(child, source, true));
			}
			flush();
			for (const c of columns) if (!c.children?.length) c.children = [{ type: 'paragraph', children: [] }];
			if (columns.length >= 2) return [{ ...node, children: columns }];
			return columns.flatMap((c) => c.children ?? []);
		}
		if (node.name === 'column' || node.name === 'columns') return (node.children ?? []).flatMap((c) => normalize(c, source, inColumns));
		// Some other container: keep exactly what was written.
		const { start, end } = node.position ?? { start: {}, end: {} };
		if (start.offset !== undefined && end.offset !== undefined && source) {
			return [{ type: 'html', value: source.slice(start.offset, end.offset) }];
		}
		return node.children ?? [];
	}
	if (node.children) node.children = node.children.flatMap((c) => normalize(c, source, inColumns));
	return [node];
}

export function remarkColumns(this: { data: () => Record<string, unknown[]> }) {
	const data = this.data();
	const flow = directive().flow as unknown as Record<number, unknown[]>;
	const container = flow[58][0]; // [directiveContainer, directiveLeaf]
	(data.micromarkExtensions ??= []).push({ flow: { 58: [container] } });
	(data.fromMarkdownExtensions ??= []).push(directiveFromMarkdown());
	const toMarkdown = directiveToMarkdown();
	// Inline directives are off, so a colon before a letter needn't be escaped.
	toMarkdown.unsafe = (toMarkdown.unsafe ?? []).filter((rule) => !(rule.character === ':' && rule.after === '[A-Za-z]'));
	(data.toMarkdownExtensions ??= []).push(toMarkdown);
	return (tree: MdNode, file?: { value?: unknown }) => {
		normalize(tree, String(file?.value ?? ''));
	};
}

/** Markdown for new columns (slash commands). */
export function columnsMarkdown(count: number): string {
	const cols = Array.from({ length: count }, () => ':::column\n​\n:::').join('\n\n');
	return `::::columns\n${cols}\n::::\n`;
}
