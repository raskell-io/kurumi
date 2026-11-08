/**
 * [[Wikilinks]], Obsidian's syntax:
 *
 *   [[Note]]               a link to the note titled "Note"
 *   [[Note|shown text]]    the same link, showing other text (an alias)
 *   [[Note#Heading]]       a heading in it (opens the note)
 *
 * Inside a table the bar is escaped, `[[Note\|text]]`, like Obsidian writes
 * it. Links resolve by title, case-insensitively; the alias and heading
 * never take part.
 */

export interface Wikilink {
	/** The note's title ('' for a link to a heading of the same note). */
	target: string;
	heading: string | null;
	alias: string | null;
}

/** Every [[…]] in a text; group 1 is what's between the brackets. */
export const WIKILINK_PATTERN = /\[\[([^[\]\n]+?)\]\]/g;

/** The parts of a link's inner text (`Note#Heading|alias`). */
export function parseWikilink(inner: string): Wikilink {
	const bar = inner.search(/\\?\|/);
	const ref = bar === -1 ? inner : inner.slice(0, bar);
	const alias = bar === -1 ? null : inner.slice(bar).replace(/^\\?\|/, '').trim() || null;
	const hash = ref.indexOf('#');
	return {
		target: (hash === -1 ? ref : ref.slice(0, hash)).trim(),
		heading: hash === -1 ? null : ref.slice(hash + 1).trim() || null,
		alias
	};
}

/** What a link shows: its alias, else the title (and heading). */
export function wikilinkLabel(inner: string): string {
	const { target, heading, alias } = parseWikilink(inner);
	if (alias) return alias;
	if (heading) return target ? `${target} › ${heading}` : heading;
	return target;
}

/** Replace every [[link]] in `text` with its label (plain-text excerpts). */
export function wikilinksToText(text: string): string {
	return text.replace(/\\?\[\\?\[([^[\]\n]+?)\\?\]\\?\]/g, (_, inner: string) => wikilinkLabel(inner));
}
