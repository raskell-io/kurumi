/**
 * Link suggestions while writing: the first unlinked mention of another
 * note's title gets a dotted underline (after a pause in typing). Clicking it
 * offers "Link" (turns it into a [[link]]) or "Dismiss" (not suggested in this
 * note again, on this device). Matching: `$lib/link-suggestions`.
 *
 * Off with Settings → AI assistant → Suggestions while writing.
 */

import { Plugin, PluginKey, type EditorState, type Transaction } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';
import { get } from 'svelte/store';
import { memoryObjects, type MemoryObject } from '$lib/db';
import { parseWikilink } from '$lib/wikilinks';
import { buildTitleIndex, findLinkSuggestions, linkFor, type TitleEntry } from '$lib/link-suggestions';

const key = new PluginKey<DecorationSet>('kurumi-link-suggest');
const MAX_SUGGESTIONS = 12;

export function linkSuggestionsEnabled(): boolean {
	try {
		return localStorage.getItem('kurumi-link-suggest') !== 'off';
	} catch {
		return true;
	}
}

export function setLinkSuggestionsEnabled(on: boolean): void {
	try {
		localStorage.setItem('kurumi-link-suggest', on ? 'on' : 'off');
	} catch {
		// Private mode: nothing to remember.
	}
}

const dismissedKey = (noteId: string) => `kurumi-link-dismissed:${noteId}`;
function dismissed(noteId: string): Set<string> {
	try {
		return new Set(JSON.parse(localStorage.getItem(dismissedKey(noteId)) ?? '[]'));
	} catch {
		return new Set();
	}
}
function dismiss(noteId: string, targetId: string) {
	const set = dismissed(noteId);
	set.add(targetId);
	try {
		localStorage.setItem(dismissedKey(noteId), JSON.stringify([...set]));
	} catch {
		// Shown again next time; harmless.
	}
}

// The title index, rebuilt when the notes change.
let indexFor: MemoryObject[] | null = null;
let index = new Map<string, TitleEntry>();
function titleIndex(): Map<string, TitleEntry> {
	const notes = get(memoryObjects);
	if (notes !== indexFor) {
		indexFor = notes;
		index = buildTitleIndex(notes.filter((m) => m.type !== 'canvas'));
	}
	return index;
}

interface Spec {
	id: string;
	title: string;
}

function compute(state: EditorState, noteId: string | undefined): DecorationSet {
	if (!linkSuggestionsEnabled()) return DecorationSet.empty;
	const idx = titleIndex();
	if (idx.size === 0) return DecorationSet.empty;
	// Not this note, not notes it already links to, not dismissed ones.
	const skip = noteId ? dismissed(noteId) : new Set<string>();
	if (noteId) skip.add(noteId);
	const linked = new Set<string>();
	state.doc.descendants((node) => {
		if (!node.isText) return true;
		for (const match of node.text!.matchAll(/\[\[([^\]\n]+)\]\]/g)) linked.add(parseWikilink(match[1]).target.toLowerCase());
		return false;
	});
	for (const entry of idx.values()) if (linked.has(entry.title.toLowerCase())) skip.add(entry.id);

	const decorations: Decoration[] = [];
	state.doc.descendants((node, pos, parent) => {
		if (decorations.length >= MAX_SUGGESTIONS) return false;
		if (node.type.name === 'code_block' || node.type.spec.code) return false;
		if (!node.isText) return true;
		if (parent?.type.spec.code || node.marks.some((m) => m.type.name === 'link' || m.type.name === 'inlineCode' || m.type.spec.code)) return false;
		for (const suggestion of findLinkSuggestions(node.text!, idx, skip)) {
			if (decorations.length >= MAX_SUGGESTIONS) break;
			skip.add(suggestion.id); // first mention only
			decorations.push(
				Decoration.inline(
					pos + suggestion.from,
					pos + suggestion.to,
					{ class: 'kurumi-link-suggestion', title: `Link to “${suggestion.title}”?` },
					{ id: suggestion.id, title: suggestion.title } satisfies Spec
				)
			);
		}
		return false;
	});
	return DecorationSet.create(state.doc, decorations);
}

let popover: HTMLDivElement | null = null;
function closePopover() {
	popover?.remove();
	popover = null;
	document.removeEventListener('mousedown', outside, true);
}
function outside(event: MouseEvent) {
	if (!popover?.contains(event.target as Node)) closePopover();
}

function openPopover(view: EditorView, from: number, to: number, spec: Spec, noteId: string | undefined, anchor: DOMRect) {
	closePopover();
	const box = document.createElement('div');
	box.className = 'k-menu kurumi-link-suggest-menu';
	box.setAttribute('role', 'dialog');
	box.setAttribute('aria-label', 'Link suggestion');
	box.addEventListener('mousedown', (event) => event.preventDefault());
	const label = document.createElement('div');
	label.className = 'k-menu-label';
	label.textContent = 'Mentions another note';
	const link = document.createElement('button');
	link.type = 'button';
	link.className = 'k-menu-item';
	link.dataset.action = 'link';
	link.textContent = `Link to “${spec.title}”`;
	link.addEventListener('click', () => {
		closePopover();
		const text = view.state.doc.textBetween(from, to);
		view.dispatch(view.state.tr.insertText(linkFor(spec.title, text), from, to));
		view.focus();
	});
	const skip = document.createElement('button');
	skip.type = 'button';
	skip.className = 'k-menu-item';
	skip.dataset.action = 'dismiss';
	skip.textContent = 'Dismiss';
	skip.addEventListener('click', () => {
		closePopover();
		if (noteId) dismiss(noteId, spec.id);
		view.dispatch(view.state.tr.setMeta(key, compute(view.state, noteId)));
		view.focus();
	});
	box.append(label, link, skip);
	document.body.appendChild(box);
	box.style.top = `${anchor.bottom + 4}px`;
	box.style.left = `${Math.max(8, Math.min(anchor.left, window.innerWidth - box.offsetWidth - 8))}px`;
	popover = box;
	setTimeout(() => document.addEventListener('mousedown', outside, true));
}

const noteIdOf = (view: EditorView) => (view.dom.closest('[data-note-id]') as HTMLElement | null)?.dataset.noteId;

export const linkSuggestPlugin = $prose(
	() =>
		new Plugin<DecorationSet>({
			key,
			state: {
				init: () => DecorationSet.empty,
				apply(tr: Transaction, set: DecorationSet) {
					const next = tr.getMeta(key) as DecorationSet | undefined;
					if (next) return next;
					// While typing, keep the underlines that the edit didn't touch.
					if (!tr.docChanged) return set;
					let mapped = set.map(tr.mapping, tr.doc);
					tr.mapping.maps.forEach((map) =>
						map.forEach((_from, _to, start, end) => {
							mapped = mapped.remove(mapped.find(Math.max(0, start - 1), end + 1));
						})
					);
					return mapped;
				}
			},
			view(view) {
				let timer: ReturnType<typeof setTimeout> | undefined;
				const schedule = (delay: number) => {
					clearTimeout(timer);
					timer = setTimeout(() => {
						if ((view as EditorView & { isDestroyed?: boolean }).isDestroyed || !view.editable) return;
						view.dispatch(view.state.tr.setMeta(key, compute(view.state, noteIdOf(view))));
					}, delay);
				};
				schedule(600);
				// New notes elsewhere can be suggested once the list changes.
				const unsubscribe = memoryObjects.subscribe(() => schedule(2000));
				return {
					update(next, previous) {
						if (next.state.doc !== previous.doc) schedule(1500);
					},
					destroy() {
						clearTimeout(timer);
						unsubscribe();
						closePopover();
					}
				};
			},
			props: {
				decorations: (state) => key.getState(state),
				handleClick(view, pos, event) {
					const target = (event.target as HTMLElement | null)?.closest?.('.kurumi-link-suggestion');
					if (!target) return false;
					const found = key.getState(view.state)?.find(pos, pos);
					const hit = found?.[0];
					if (!hit) return false;
					openPopover(view, hit.from, hit.to, hit.spec as Spec, noteIdOf(view), target.getBoundingClientRect());
					return false; // the cursor still moves there
				}
			}
		})
);
