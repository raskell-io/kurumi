/**
 * The markdown side of math (editor/math.ts): a remark plugin that parses
 * `$…$` and `$$…$$` and writes them back, with two Kurumi rules. Kept apart
 * from the Milkdown nodes so it can be tested without a DOM.
 *
 * - Pandoc's rule for single dollars: `$…$` is math only when it doesn't
 *   start or end with a space and no digit follows it ("$5 and $10" is text).
 * - `$` in text isn't escaped, so dollar amounts are stored as typed.
 */

import { math as mathSyntax } from 'micromark-extension-math';
import { mathFromMarkdown, mathToMarkdown } from 'mdast-util-math';

interface MdNode {
	type: string;
	value?: string;
	children?: MdNode[];
	position?: { start: { offset?: number }; end: { offset?: number } };
}

/** Pandoc's rule for single-dollar math; anything else goes back to text. */
export function isInlineMath(inner: string, after: string | undefined): boolean {
	return inner.length > 0 && !/^\s|\s$/.test(inner) && !/^\d/.test(after ?? '');
}

export function demoteDollarText(node: MdNode, source: string) {
	const children = node.children;
	if (!children) return;
	for (let i = 0; i < children.length; i++) {
		const child = children[i];
		if (child.type === 'inlineMath') {
			// The parser trims a space at each end (like code spans); the
			// rule looks at what was typed.
			const { start, end } = child.position ?? { start: {}, end: {} };
			const typed = start.offset !== undefined && end.offset !== undefined ? source.slice(start.offset, end.offset) : '';
			const raw = typed.startsWith('$') ? typed : `$${child.value ?? ''}$`;
			const inner = raw.replace(/^\$+|\$+$/g, '');
			const next = children[i + 1];
			const after = next?.type === 'text' ? next.value : undefined;
			if (!isInlineMath(inner, after)) children[i] = { type: 'text', value: raw };
		} else {
			demoteDollarText(child, source);
		}
	}
}

export function remarkMath(this: { data: () => Record<string, unknown[]> }) {
	const data = this.data();
	(data.micromarkExtensions ??= []).push(mathSyntax());
	(data.fromMarkdownExtensions ??= []).push(mathFromMarkdown());
	const toMarkdown = mathToMarkdown();
	toMarkdown.unsafe = (toMarkdown.unsafe ?? []).filter(
		(rule) => !(rule.character === '$' && rule.inConstruct === 'phrasing')
	);
	(data.toMarkdownExtensions ??= []).push(toMarkdown);
	return (tree: MdNode, file?: { value?: unknown }) => demoteDollarText(tree, String(file?.value ?? ''));
}
