/**
 * Date, People, and Tag Autocomplete Plugin for Milkdown
 *
 * Detects:
 * - // for date insertion
 * - @ for people mentions
 * - # for tag insertion
 */
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import { $prose } from '@milkdown/kit/utils';
import type { EditorView } from '@milkdown/kit/prose/view';

const autocompleteKey = new PluginKey('date-people-autocomplete');

export type AutocompleteType = 'date' | 'person' | 'tag' | null;

export interface AutocompleteState {
	type: AutocompleteType;
	query: string;
	from: number;
	to: number;
	position: { x: number; y: number } | null;
}

export interface AutocompleteCallbacks {
	onOpen: (state: AutocompleteState) => void;
	onClose: () => void;
	onUpdate: (state: AutocompleteState) => void;
}

let callbacks: AutocompleteCallbacks | null = null;
let currentView: EditorView | null = null;
let activeType: AutocompleteType = null;

export function setDatePeopleCallbacks(cb: AutocompleteCallbacks) {
	callbacks = cb;
}

/**
 * Insert a date at the current position
 */
export function insertDate(date: string) {
	if (!currentView || activeType !== 'date') return;

	const state = getAutocompleteState(currentView);
	if (!state || state.type !== 'date') return;

	const { from, to } = state;

	// Replace `//query` with `//YYYY-MM-DD`
	const tr = currentView.state.tr.replaceWith(
		from,
		to,
		currentView.state.schema.text(`//${date}`)
	);

	currentView.dispatch(tr);
	currentView.focus();
	activeType = null;
	callbacks?.onClose();
}

/**
 * Insert a person mention at the current position
 */
export function insertPerson(name: string) {
	if (!currentView || activeType !== 'person') return;

	const state = getAutocompleteState(currentView);
	if (!state || state.type !== 'person') return;

	const { from, to } = state;

	// Replace `@query` with `@Full Name`
	const tr = currentView.state.tr.replaceWith(
		from,
		to,
		currentView.state.schema.text(`@${name} `)
	);

	currentView.dispatch(tr);
	currentView.focus();
	activeType = null;
	callbacks?.onClose();
}

/**
 * Insert a tag at the current position
 */
export function insertTag(tag: string) {
	if (!currentView || activeType !== 'tag') return;

	const state = getAutocompleteState(currentView);
	if (!state || state.type !== 'tag') return;

	const { from, to } = state;

	// Replace `#query` with `#tag`
	const tr = currentView.state.tr.replaceWith(
		from,
		to,
		currentView.state.schema.text(`#${tag} `)
	);

	currentView.dispatch(tr);
	currentView.focus();
	activeType = null;
	callbacks?.onClose();
}

export function closeAutocomplete() {
	activeType = null;
	callbacks?.onClose();
}

function getCursorCoords(view: EditorView, pos: number): { x: number; y: number } | null {
	try {
		const coords = view.coordsAtPos(pos);
		return {
			x: coords.left,
			y: coords.bottom + 4
		};
	} catch {
		return null;
	}
}

function getAutocompleteState(view: EditorView): AutocompleteState | null {
	const { state } = view;
	const { selection } = state;

	if (!selection.empty) return null;

	const pos = selection.from;
	const $pos = state.doc.resolve(pos);

	const textBefore = $pos.parent.textBetween(0, $pos.parentOffset, undefined, '\ufffc');

	// Check for date trigger: //
	const dateMatch = textBefore.match(/\/\/([^\s]*)$/);
	if (dateMatch) {
		const blockStart = pos - $pos.parentOffset;
		const from = blockStart + dateMatch.index!;
		const query = dateMatch[1] || '';

		// Don't trigger if it looks like a complete date already
		if (/^\d{4}-\d{2}-\d{2}$/.test(query)) return null;

		return {
			type: 'date',
			query,
			from,
			to: pos,
			position: getCursorCoords(view, pos)
		};
	}

	// Check for person trigger: @
	const personMatch = textBefore.match(/@([A-Za-z ]*)$/);
	if (personMatch) {
		const blockStart = pos - $pos.parentOffset;
		const from = blockStart + personMatch.index!;
		const query = personMatch[1] || '';

		return {
			type: 'person',
			query,
			from,
			to: pos,
			position: getCursorCoords(view, pos)
		};
	}

	// Check for tag trigger: # (but not at start of line - that's a markdown heading)
	// Only match # when preceded by whitespace
	const tagMatch = textBefore.match(/(?:^|\s)#([a-zA-Z0-9_-]*)$/);
	if (tagMatch) {
		const blockStart = pos - $pos.parentOffset;
		// Adjust index: if matched with leading space, add 1 to skip the space
		const matchStart = tagMatch.index! + (tagMatch[0].startsWith('#') ? 0 : 1);
		const from = blockStart + matchStart;
		const query = tagMatch[1] || '';

		// Don't trigger at start of line (markdown heading)
		if (matchStart === 0) return null;

		return {
			type: 'tag',
			query,
			from,
			to: pos,
			position: getCursorCoords(view, pos)
		};
	}

	return null;
}

export const datePeopleAutocompletePlugin = $prose(() => {
	return new Plugin({
		key: autocompleteKey,
		view(editorView) {
			currentView = editorView;

			return {
				update(view) {
					currentView = view;
					const state = getAutocompleteState(view);

					const wasActive = activeType !== null;
					const isActive = state !== null;

					if (isActive && state) {
						if (!wasActive || activeType !== state.type) {
							activeType = state.type;
							callbacks?.onOpen(state);
						} else {
							callbacks?.onUpdate(state);
						}
					} else if (wasActive && !isActive) {
						activeType = null;
						callbacks?.onClose();
					}
				},
				destroy() {
					currentView = null;
					activeType = null;
				}
			};
		}
	});
});
