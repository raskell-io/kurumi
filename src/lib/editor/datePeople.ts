/**
 * Date, People, Tag, and URL Plugin for Milkdown
 *
 * Renders:
 * - Dates: //YYYY-MM-DD format with calendar styling
 * - People: @Full Name format with person icon
 * - Tags: #tag-name format with tag styling
 * - URLs: http/https links with link icon
 */
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';
import { createRegistry } from './registry';
import { formatDay, formatDayLong } from '$lib/dates/format';

const datePeopleKey = new PluginKey('date-people');

// Click handlers
export interface TagClickHandler {
	(tag: string): void;
}

export interface PersonClickHandler {
	(name: string): void;
}

export interface DateClickHandler {
	(date: string): void;
}

// Click handlers per editor (see ./registry).
interface ClickHandlers {
	tag?: TagClickHandler;
	person?: PersonClickHandler;
	date?: DateClickHandler;
}
const handlers = createRegistry<ClickHandlers>();

/** Register (or, with null, remove) the handlers for the editor rooted at `root`. */
export function setReferenceClickHandlers(root: Element, value: ClickHandlers | null) {
	if (value) handlers.set(root, value);
	else handlers.delete(root);
}

// Match //YYYY-MM-DD pattern
const dateRegex = /\/\/(\d{4}-\d{2}-\d{2})/g;

// Match @Name (captures until end of word or certain punctuation)
const personRegex = /@([A-Z][a-zA-Z]+(?: [A-Z][a-zA-Z]+)*)/g;

// Match #tag (alphanumeric, hyphens, underscores)
const tagRegex = /#([a-zA-Z][a-zA-Z0-9_-]*)/g;

// Match URLs (http/https)
const urlRegex = /https?:\/\/[^\s<>"\])+]+(?:\([^\s<>"]*\))?[^\s<>"\]).,;:!?'"]*/g;

/**
 * A date reads as a date ("Nov 20") unless the cursor is at it, when the
 * `//2026-11-20` it is written as shows instead, to edit.
 */
function dateWidget(date: string) {
	const label = formatDay(date) || date;
	return () => {
		const span = document.createElement('span');
		span.className = 'date-reference date-shown';
		span.dataset.date = date;
		span.title = formatDayLong(date) || date;
		span.textContent = label;
		return span;
	};
}

function findDecorations(doc: any, selection?: { from: number; to: number }): Decoration[] {
	const decorations: Decoration[] = [];

	doc.descendants((node: any, pos: number) => {
		if (node.isText && node.text) {
			// Find dates
			let match;
			dateRegex.lastIndex = 0;
			while ((match = dateRegex.exec(node.text)) !== null) {
				const start = pos + match.index;
				const end = start + match[0].length;
				const date = match[1];
				const editing = selection && selection.from <= end && selection.to >= start;

				if (editing) {
					decorations.push(
						Decoration.inline(start, end, {
							class: 'date-reference',
							'data-date': date
						})
					);
				} else {
					decorations.push(
						Decoration.inline(start, end, { class: 'date-raw-hidden' }),
						Decoration.widget(start, dateWidget(date), { side: -1, key: `date:${date}:${formatDay(date) || date}` })
					);
				}
			}

			// Find people mentions
			personRegex.lastIndex = 0;
			while ((match = personRegex.exec(node.text)) !== null) {
				const start = pos + match.index;
				const end = start + match[0].length;
				const name = match[1];

				decorations.push(
					Decoration.inline(start, end, {
						class: 'person-reference',
						'data-person': name
					})
				);
			}

			// Find tags (not a heading in a link: [[Note#Heading]])
			const linkSpans = [...node.text.matchAll(/\[\[[^[\]\n]*?\]\]/g)].map((m: RegExpMatchArray) => [m.index!, m.index! + m[0].length]);
			tagRegex.lastIndex = 0;
			while ((match = tagRegex.exec(node.text)) !== null) {
				const at = match.index;
				if (linkSpans.some(([from, to]) => at > from && at < to)) continue;
				const start = pos + match.index;
				const end = start + match[0].length;
				const tag = match[1];

				// Make sure this isn't part of a person reference (which also uses text after @)
				// Check if preceded by @ - if so, skip
				const charBefore = node.text[match.index - 1];
				if (charBefore === '@') continue;

				decorations.push(
					Decoration.inline(start, end, {
						class: 'tag-reference',
						'data-tag': tag
					})
				);
			}

			// Find URLs
			urlRegex.lastIndex = 0;
			while ((match = urlRegex.exec(node.text)) !== null) {
				const start = pos + match.index;
				const end = start + match[0].length;
				const url = match[0];

				decorations.push(
					Decoration.inline(start, end, {
						class: 'url-reference',
						'data-url': url
					})
				);
			}
		}
	});

	return decorations;
}

export const datePeoplePlugin = $prose(() => {
	return new Plugin({
		key: datePeopleKey,
		state: {
			init(_, state) {
				return DecorationSet.create(state.doc, findDecorations(state.doc, state.selection));
			},
			apply(tr, oldSet, _old, state) {
				// The selection decides which dates show how they're written.
				if (tr.docChanged || tr.selectionSet) {
					return DecorationSet.create(tr.doc, findDecorations(tr.doc, state.selection));
				}
				return oldSet.map(tr.mapping, tr.doc);
			}
		},
		props: {
			decorations(state) {
				return this.getState(state);
			},
			handleClick(view, pos, event) {
				const target = event.target as HTMLElement;
				const { tag: tagClickHandler, person: personClickHandler, date: dateClickHandler } =
					handlers.get(view) ?? {};

				// Handle tag clicks
				if (target.classList.contains('tag-reference')) {
					const tag = target.dataset.tag;
					if (tag && tagClickHandler) {
						event.preventDefault();
						tagClickHandler(tag);
						return true;
					}
				}

				// Handle person clicks
				if (target.classList.contains('person-reference')) {
					const name = target.dataset.person;
					if (name && personClickHandler) {
						event.preventDefault();
						personClickHandler(name);
						return true;
					}
				}

				// Handle date clicks
				if (target.classList.contains('date-reference')) {
					const date = target.dataset.date;
					if (date && dateClickHandler) {
						event.preventDefault();
						dateClickHandler(date);
						return true;
					}
				}

				// Handle URL clicks - open in new tab
				if (target.classList.contains('url-reference')) {
					const url = target.dataset.url;
					if (url) {
						event.preventDefault();
						window.open(url, '_blank', 'noopener,noreferrer');
						return true;
					}
				}

				return false;
			}
		}
	});
});
