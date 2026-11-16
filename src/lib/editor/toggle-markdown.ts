/**
 * Toggles in Markdown (editor/toggle.ts): HTML's <details>, as GitHub and
 * Obsidian write it, with Markdown between the tags:
 *
 *   <details>
 *   <summary>Title</summary>
 *
 *   Anything, in Markdown.
 *
 *   </details>
 *
 * Read with Milkdown's commonmark preset, the two tags are paragraphs that
 * hold one `html` node each (its remarkHtmlTransformer wraps block HTML in
 * a paragraph), with the content as their siblings. `groupToggles` turns
 * such a run into one `kurumiToggle` node and keeps the tags' exact text
 * around the title, so the editor writes the same paragraphs and the same
 * HTML back (`toggleParts` / `toggleOpening`): the Markdown doesn't change
 * by a byte. Anything else with <details> (all on one line, a title with
 * markup in it, no closing tag) stays as it was.
 */

export interface MdNode {
	type: string;
	value?: string;
	children?: MdNode[];
	data?: Record<string, unknown>;
}

/** `<details …>` (and the line break after it) `<summary>`, the title, `</summary>`. */
const OPENING = /^(<details(?:\s[^>]*)?>\s*<summary>)([^<\n]*)(<\/summary>[ \t]*)$/i;
const CLOSING = /^<\/details>[ \t]*$/i;

export interface ToggleTags {
	/** `<details>\n<summary>`, as written. */
	open: string;
	/** `</summary>`, as written. */
	close: string;
	/** `</details>`, as written. */
	end: string;
}

/** The title and tags of an opening `<details>…</summary>`, or null. */
export function toggleParts(html: string): { tags: Omit<ToggleTags, 'end'>; summary: string } | null {
	const match = OPENING.exec(html);
	return match ? { tags: { open: match[1], close: match[3] }, summary: match[2] } : null;
}

/** The opening HTML for `summary` with these tags. */
export function toggleOpening(tags: Pick<ToggleTags, 'open' | 'close'>, summary: string): string {
	return `${tags.open}${summary}${tags.close}`;
}

/** Whether `<details …>` says it starts open. */
export const startsOpen = (open: string) => /^<details\s[^>]*\bopen\b/i.test(open);

/** The HTML a paragraph holds when it holds nothing else. */
function htmlOf(node: MdNode): string | null {
	if (node.type !== 'paragraph' || node.children?.length !== 1) return null;
	const only = node.children[0];
	return only.type === 'html' && typeof only.value === 'string' ? only.value : null;
}

const isClosing = (node: MdNode) => CLOSING.test(htmlOf(node) ?? '');
const isOpening = (node: MdNode) => toggleParts(htmlOf(node) ?? '') !== null;

function group(children: MdNode[]): MdNode[] {
	const out: MdNode[] = [];
	for (let i = 0; i < children.length; i++) {
		const node = children[i];
		const parts = isOpening(node) ? toggleParts(htmlOf(node)!) : null;
		if (!parts) {
			walk(node);
			out.push(node);
			continue;
		}
		// The </details> that closes this one: nested toggles have their own.
		let depth = 0;
		let end = -1;
		for (let j = i + 1; j < children.length; j++) {
			if (isOpening(children[j])) depth++;
			else if (isClosing(children[j])) {
				if (depth === 0) {
					end = j;
					break;
				}
				depth--;
			}
		}
		if (end === -1) {
			out.push(node);
			continue;
		}
		const body = children.slice(i + 1, end);
		out.push({
			type: 'kurumiToggle',
			data: { ...parts.tags, end: htmlOf(children[end])!, summary: parts.summary },
			children: group(body)
		});
		i = end;
	}
	return out;
}

function walk(node: MdNode) {
	// Only where a block can start with a toggle: the note and quotes (a list
	// item has to start with a paragraph).
	if (!node.children) return;
	if (node.type === 'root' || node.type === 'blockquote') node.children = group(node.children);
	else for (const child of node.children) walk(child);
}

/** Group every toggle in a (Milkdown-transformed) Markdown tree, in place. */
export function groupToggles(tree: MdNode): MdNode {
	walk(tree);
	return tree;
}

/** The inverse, for tests: a toggle back to its paragraphs. */
export function ungroupToggles(tree: MdNode): MdNode {
	if (!tree.children) return tree;
	tree.children = tree.children.flatMap((child) => {
		ungroupToggles(child);
		if (child.type !== 'kurumiToggle') return [child];
		const data = child.data as unknown as ToggleTags & { summary: string };
		const para = (value: string): MdNode => ({ type: 'paragraph', children: [{ type: 'html', value }] });
		return [para(toggleOpening(data, data.summary)), ...(child.children ?? []), para(data.end)];
	});
	return tree;
}
