/**
 * Wikilink Autocomplete Plugin for Milkdown
 *
 * Detects when user types `[[` and triggers autocomplete overlay.
 * Provides cursor position and handles text insertion.
 */
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import { $prose } from '@milkdown/kit/utils';
import type { EditorView } from '@milkdown/kit/prose/view';

const autocompleteKey = new PluginKey('wikilink-autocomplete');

export interface AutocompleteState {
	active: boolean;
	query: string;
	from: number; // Position where [[ starts
	to: number; // Current cursor position
	position: { x: number; y: number } | null;
}

export interface AutocompleteCallbacks {
	onOpen: (state: AutocompleteState) => void;
	onClose: () => void;
	onUpdate: (state: AutocompleteState) => void;
}

let callbacks: AutocompleteCallbacks | null = null;
let currentView: EditorView | null = null;
let isAutocompleteActive = false;

export function setAutocompleteCallbacks(cb: AutocompleteCallbacks) {
	callbacks = cb;
}

export function getEditorView(): EditorView | null {
	return currentView;
}

/**
 * Insert selected note title into the editor
 */
export function completeWikilink(noteTitle: string) {
	if (!currentView || !isAutocompleteActive) return;

	const state = getAutocompleteState(currentView);
	if (!state || !state.active) return;

	const { from, to } = state;

	// Replace the `[[query` with `[[noteTitle]]`
	const tr = currentView.state.tr.replaceWith(
		from,
		to,
		currentView.state.schema.text(`[[${noteTitle}]]`)
	);

	currentView.dispatch(tr);
	currentView.focus();
	isAutocompleteActive = false;

	if (callbacks) {
		callbacks.onClose();
	}
}

/**
 * Close autocomplete without inserting
 */
export function closeAutocomplete() {
	isAutocompleteActive = false;
	if (callbacks) {
		callbacks.onClose();
	}
}

/**
 * Get cursor coordinates in the viewport
 */
function getCursorCoords(view: EditorView, pos: number): { x: number; y: number } | null {
	try {
		const coords = view.coordsAtPos(pos);
		return {
			x: coords.left,
			y: coords.bottom + 4 // Slight offset below cursor
		};
	} catch {
		return null;
	}
}

/**
 * Check if we're in an autocomplete context (after `[[`)
 */
function getAutocompleteState(view: EditorView): AutocompleteState | null {
	const { state } = view;
	const { selection } = state;

	// Only work with cursor (not range selection)
	if (!selection.empty) return null;

	const pos = selection.from;
	const $pos = state.doc.resolve(pos);

	// Get the text before cursor in current text block
	const textBefore = $pos.parent.textBetween(0, $pos.parentOffset, undefined, '\ufffc');

	// Find the last `[[` that isn't closed
	const openBracketIdx = textBefore.lastIndexOf('[[');
	if (openBracketIdx === -1) return null;

	// Check if there's a closing `]]` after the opening
	const textAfterOpen = textBefore.slice(openBracketIdx + 2);
	if (textAfterOpen.includes(']]')) return null;

	// Check there's no newline in between
	if (textAfterOpen.includes('\n')) return null;

	// Calculate the absolute position of `[[`
	const blockStart = pos - $pos.parentOffset;
	const from = blockStart + openBracketIdx;
	const query = textAfterOpen;

	const position = getCursorCoords(view, pos);

	return {
		active: true,
		query,
		from,
		to: pos,
		position
	};
}

export const wikilinkAutocompletePlugin = $prose(() => {
	return new Plugin({
		key: autocompleteKey,
		view(editorView) {
			currentView = editorView;

			return {
				update(view) {
					currentView = view;
					const autocompleteState = getAutocompleteState(view);

					const wasActive = isAutocompleteActive;
					const isActive = autocompleteState !== null;

					if (isActive && autocompleteState) {
						if (!wasActive) {
							isAutocompleteActive = true;
							callbacks?.onOpen(autocompleteState);
						} else {
							callbacks?.onUpdate(autocompleteState);
						}
					} else if (wasActive && !isActive) {
						isAutocompleteActive = false;
						callbacks?.onClose();
					}
				},
				destroy() {
					currentView = null;
					isAutocompleteActive = false;
				}
			};
		}
	});
});
