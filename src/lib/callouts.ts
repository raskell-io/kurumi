/**
 * Callouts: a quote whose first line starts with `[!type]` (Obsidian's
 * syntax), optionally followed by a title:
 *
 *   > [!warning] Careful
 *   > The body.
 *
 * Read mode (MarkdownRenderer) and the editor (editor/callout.ts) both
 * read them through this module, so they agree on the types and labels.
 * Nothing here changes how a callout is written.
 */

export const CALLOUT_TYPES = ['info', 'note', 'tip', 'success', 'warning', 'danger', 'quote'] as const;
export type CalloutType = (typeof CALLOUT_TYPES)[number];

export const CALLOUT_LABELS: Record<CalloutType, string> = {
	info: 'Info',
	note: 'Note',
	tip: 'Tip',
	success: 'Success',
	warning: 'Warning',
	danger: 'Danger',
	quote: 'Quote'
};

/** `[!type]` at the start of a line, and the spaces after it. */
export const CALLOUT_MARKER = new RegExp(`^\\[!(${CALLOUT_TYPES.join('|')})\\][ \\t]*`, 'i');

export function calloutType(name: string): CalloutType | null {
	const lower = name.toLowerCase();
	return (CALLOUT_TYPES as readonly string[]).includes(lower) ? (lower as CalloutType) : null;
}

/** The marker at the start of `text`: its type and length (with the spaces after it). */
export function parseCalloutMarker(text: string): { type: CalloutType; length: number; bare: number } | null {
	const match = CALLOUT_MARKER.exec(text);
	if (!match) return null;
	const type = calloutType(match[1]);
	// `bare`: the marker without the spaces after it.
	return type ? { type, length: match[0].length, bare: match[1].length + 3 } : null;
}

/**
 * A callout's lines in Markdown, from its first line (`> [!type] Title`) up
 * to the end of the quote. A line of only `>` (what the editor writes
 * between two paragraphs) belongs to it.
 */
export const CALLOUT_BLOCK = new RegExp(`^> ?\\[!(${CALLOUT_TYPES.join('|')})\\](.*)$\\n?((?:^>.*$\\n?)*)`, 'gmi');
