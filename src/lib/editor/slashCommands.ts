/**
 * Slash commands plugin for Milkdown.
 *
 * Detects `/` typed at the start of a line or after whitespace and
 * opens a floating command palette filtered by what the user types
 * after the slash. Selecting a command replaces the `/query` text
 * with the command's output (a heading, list item, code block, etc.)
 * or triggers a side-effect (open search, ask Kurumi, etc.).
 *
 * Architecture:
 *
 *   1. slashCommandPlugin — ProseMirror plugin that watches keystrokes
 *      in the editor and fires callbacks to the Svelte UI layer.
 *   2. SlashCommandMenu.svelte — floating popup that renders the
 *      filtered command list and handles selection.
 *   3. Command registry — plain array of SlashCommand objects. New
 *      features (block types, AI actions, macros) just push to the
 *      registry.
 */

import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import { $prose } from '@milkdown/kit/utils';
import type { EditorView } from '@milkdown/kit/prose/view';
import { turnInto, insertMarkdownBlocks, type BlockKind } from './blocks';
import { createRegistry } from './registry';

const slashKey = new PluginKey('slash-commands');

export interface SlashCommand {
	id: string;
	label: string;
	description: string;
	icon: string; // lucide icon name (rendered by the Svelte popup)
	category: string; // e.g. "Basic", "Insert", "AI", "Navigate"
	/** Run the command. Receives the editor view and the range to
	 *  replace (the `/query` text). Return true if the command handled
	 *  the replacement itself; false to let the plugin delete the
	 *  slash-prefix for you. */
	execute: (view: EditorView, from: number, to: number) => boolean;
}

export interface SlashState {
	query: string;
	from: number;
	to: number;
	position: { x: number; y: number } | null;
}

export interface SlashCallbacks {
	onOpen: (state: SlashState) => void;
	onClose: () => void;
	onUpdate: (state: SlashState) => void;
}

// Callbacks per editor (see ./registry); looked up via the view in use.
const registry = createRegistry<SlashCallbacks>();
const callbacksFor = () => registry.get(currentView);
let currentView: EditorView | null = null;
let isOpen = false;

/** Register (or, with null, remove) the callbacks for the editor rooted at `root`. */
export function setSlashCallbacks(root: Element, cb: SlashCallbacks | null) {
	if (cb) registry.set(root, cb);
	else registry.delete(root);
}

/**
 * Execute a command, replacing the /query range with whatever the
 * command produces. Called from the Svelte popup on Enter/click.
 */
export function executeSlashCommand(command: SlashCommand) {
	if (!currentView) return;
	const slashState = getSlashState(currentView);
	if (!slashState) return;

	const handled = command.execute(currentView, slashState.from, slashState.to);
	if (!handled) {
		// Default: just delete the /query text so the cursor is clean.
		const tr = currentView.state.tr.delete(slashState.from, slashState.to);
		currentView.dispatch(tr);
	}

	currentView.focus();
	isOpen = false;
	callbacksFor()?.onClose();
}

export function closeSlashMenu() {
	isOpen = false;
	callbacksFor()?.onClose();
}

function getCursorCoords(view: EditorView, pos: number): { x: number; y: number } | null {
	try {
		const coords = view.coordsAtPos(pos);
		return { x: coords.left, y: coords.bottom + 4 };
	} catch {
		return null;
	}
}

function getSlashState(view: EditorView): SlashState | null {
	const { state } = view;
	const { selection } = state;
	if (!selection.empty) return null;

	const pos = selection.from;
	const $pos = state.doc.resolve(pos);
	const textBefore = $pos.parent.textBetween(0, $pos.parentOffset, undefined, '\ufffc');

	// Match a / at the start of a line or after whitespace, followed
	// by optional query characters (letters, digits, spaces).
	const match = textBefore.match(/(?:^|\s)\/([a-zA-Z0-9 ]*)$/);
	if (!match) return null;

	const blockStart = pos - $pos.parentOffset;
	// Skip the leading whitespace if the match was anchored on \s.
	const matchStart = match.index! + (match[0].startsWith('/') ? 0 : 1);
	const from = blockStart + matchStart;
	const query = match[1] || '';

	return {
		query,
		from,
		to: pos,
		position: getCursorCoords(view, pos)
	};
}

export const slashCommandPlugin = $prose(() => {
	return new Plugin({
		key: slashKey,
		view(editorView) {
			currentView = editorView;

			return {
				update(view) {
					currentView = view;
					const state = getSlashState(view);

					const wasOpen = isOpen;
					const nowOpen = state !== null;

					if (nowOpen && state) {
						if (!wasOpen) {
							isOpen = true;
							callbacksFor()?.onOpen(state);
						} else {
							callbacksFor()?.onUpdate(state);
						}
					} else if (wasOpen && !nowOpen) {
						isOpen = false;
						callbacksFor()?.onClose();
					}
				},
				destroy() {
					currentView = null;
					isOpen = false;
				}
			};
		}
	});
});

// ---------------------------------------------------------------------------
// Built-in command registry
// ---------------------------------------------------------------------------

/**
 * Helper: replace the /query range with a markdown string and re-parse.
 * Uses `view.dispatch` to insert raw text that Milkdown's markdown
 * parser will convert to the right node type on the next tick.
 */
/**
 * Helper: delete the /query text and convert the current block, keeping
 * whatever was already typed on the line.
 */
function convertBlock(view: EditorView, from: number, to: number, kind: BlockKind): boolean {
	view.dispatch(view.state.tr.delete(from, to));
	turnInto(view, kind);
	return true;
}

/**
 * Helper: replace the /query text with real blocks parsed from markdown
 * (tables, callouts, …). Falls back to inserting the text.
 */
function insertBlocks(
	view: EditorView,
	from: number,
	to: number,
	markdown: string,
	select: 'first' | 'last' = 'last'
): boolean {
	return insertMarkdownBlocks(view, from, to, markdown, select) || replaceWithText(view, from, to, markdown);
}

function replaceWithText(
	view: EditorView,
	from: number,
	to: number,
	text: string
): boolean {
	const tr = view.state.tr.replaceWith(from, to, view.state.schema.text(text));
	view.dispatch(tr);
	return true;
}

export const builtInSlashCommands: SlashCommand[] = [
	// --- Basic blocks -------------------------------------------------------
	{
		id: 'heading1',
		label: 'Heading 1',
		description: 'Large heading',
		icon: 'heading',
		category: 'Basic',
		execute: (view, from, to) => convertBlock(view, from, to, 'h1')
	},
	{
		id: 'heading2',
		label: 'Heading 2',
		description: 'Medium heading',
		icon: 'heading',
		category: 'Basic',
		execute: (view, from, to) => convertBlock(view, from, to, 'h2')
	},
	{
		id: 'heading3',
		label: 'Heading 3',
		description: 'Small heading',
		icon: 'heading',
		category: 'Basic',
		execute: (view, from, to) => convertBlock(view, from, to, 'h3')
	},
	{
		id: 'bullet-list',
		label: 'Bullet list',
		description: 'Unordered list item',
		icon: 'list',
		category: 'Basic',
		execute: (view, from, to) => convertBlock(view, from, to, 'bullet')
	},
	{
		id: 'numbered-list',
		label: 'Numbered list',
		description: 'Ordered list item',
		icon: 'list-ordered',
		category: 'Basic',
		execute: (view, from, to) => convertBlock(view, from, to, 'ordered')
	},
	{
		id: 'checkbox',
		label: 'Checkbox',
		description: 'To-do item',
		icon: 'check-square',
		category: 'Basic',
		execute: (view, from, to) => convertBlock(view, from, to, 'task')
	},
	{
		id: 'quote',
		label: 'Quote',
		description: 'Block quote',
		icon: 'quote',
		category: 'Basic',
		execute: (view, from, to) => convertBlock(view, from, to, 'quote')
	},
	{
		id: 'divider',
		label: 'Divider',
		description: 'Horizontal rule',
		icon: 'minus',
		category: 'Basic',
		execute: (view, from, to) => insertBlocks(view, from, to, '---\n\n')
	},
	{
		id: 'code-block',
		label: 'Code block',
		description: 'Fenced code block',
		icon: 'code',
		category: 'Basic',
		execute: (view, from, to) => convertBlock(view, from, to, 'code')
	},

	// --- Insert references --------------------------------------------------
	{
		id: 'date',
		label: 'Date reference',
		description: 'Insert //YYYY-MM-DD',
		icon: 'calendar',
		category: 'Insert',
		execute: (view, from, to) => replaceWithText(view, from, to, '//')
	},
	{
		id: 'mention',
		label: 'Mention person',
		description: 'Insert @Name',
		icon: 'at-sign',
		category: 'Insert',
		execute: (view, from, to) => replaceWithText(view, from, to, '@')
	},
	{
		id: 'tag',
		label: 'Tag',
		description: 'Insert #tag',
		icon: 'hash',
		category: 'Insert',
		execute: (view, from, to) => replaceWithText(view, from, to, '#')
	},
	{
		id: 'wikilink',
		label: 'Link to note',
		description: 'Insert [[wikilink]]',
		icon: 'link',
		category: 'Insert',
		execute: (view, from, to) => replaceWithText(view, from, to, '[[')
	},
	{
		id: 'table',
		label: 'Table',
		description: 'Insert a markdown table',
		icon: 'table',
		category: 'Insert',
		execute: (view, from, to) =>
			insertBlocks(
				view,
				from,
				to,
				'| Column 1 | Column 2 | Column 3 |\n| --- | --- | --- |\n|  |  |  |\n',
				'first'
			)
	},

	// --- Insert advanced blocks ---------------------------------------------
	{
		id: 'callout-info',
		label: 'Info callout',
		description: 'Blue information box',
		icon: 'info',
		category: 'Insert',
		execute: (view, from, to) => insertBlocks(view, from, to, '> [!info]\n>\n> Write here')
	},
	{
		id: 'callout-warning',
		label: 'Warning callout',
		description: 'Yellow warning box',
		icon: 'alert-triangle',
		category: 'Insert',
		execute: (view, from, to) => insertBlocks(view, from, to, '> [!warning]\n>\n> Write here')
	},
	{
		id: 'callout-tip',
		label: 'Tip callout',
		description: 'Green tip box',
		icon: 'lightbulb',
		category: 'Insert',
		execute: (view, from, to) => insertBlocks(view, from, to, '> [!tip]\n>\n> Write here')
	},
	{
		id: 'dataview',
		label: 'Live query',
		description: 'Kurumi dataview query block',
		icon: 'database',
		category: 'Insert',
		execute: (view, from, to) =>
			insertBlocks(view, from, to, '```kurumi\ntype:note\nview: list\nlimit: 20\n```\n')
	},

	{
		id: 'highlight',
		label: 'Highlight',
		description: 'Highlight text with ==markers==',
		icon: 'minus',
		category: 'Basic',
		execute: (view, from, to) => replaceWithText(view, from, to, '==highlighted text==')
	},

	{
		id: 'camera',
		label: 'Take photo',
		description: 'Capture a photo with your camera',
		icon: 'minus',
		category: 'Insert',
		execute: (view, from, to) => {
			// Delete the /camera text and dispatch a custom event the
			// Editor component listens for to open the camera modal.
			const tr = view.state.tr.delete(from, to);
			view.dispatch(tr);
			view.focus();
			window.dispatchEvent(new CustomEvent('kurumi-open-camera'));
			return true;
		}
	},
	{
		id: 'image',
		label: 'Image',
		description: 'Upload and embed an image (auto-converts to AVIF)',
		icon: 'minus',
		category: 'Insert',
		execute: (view, from, to) => {
			// Delete the /image text first
			const tr = view.state.tr.delete(from, to);
			view.dispatch(tr);
			view.focus();

			// Open a file picker for images
			const input = document.createElement('input');
			input.type = 'file';
			input.accept = 'image/*';
			input.onchange = async () => {
				const file = input.files?.[0];
				if (!file) return;
				try {
					const { processAndStoreImage } = await import('$lib/utils/image');
					const result = await processAndStoreImage(file, file.name.replace(/\.[^.]+$/, ''));
					// Insert markdown at current cursor
					const pos = view.state.selection.from;
					const insertTr = view.state.tr.insertText(result.markdown + '\n', pos);
					view.dispatch(insertTr);
					view.focus();
				} catch (err) {
					console.error('Image upload failed:', err);
				}
			};
			input.click();
			return true;
		}
	},

	// --- Tier 2 rich blocks -----------------------------------------------
	{
		id: 'toggle',
		label: 'Toggle / collapsible',
		description: 'Expandable section',
		icon: 'list',
		category: 'Insert',
		execute: (view, from, to) =>
			insertBlocks(
				view,
				from,
				to,
				'<details>\n<summary>Toggle title</summary>\n\nContent here...\n\n</details>\n'
			)
	},
	{
		id: 'memory-embed',
		label: 'Embed memory',
		description: 'Inline preview of another note',
		icon: 'link',
		category: 'Insert',
		execute: (view, from, to) => replaceWithText(view, from, to, '![[')
	},
	{
		id: 'math-block',
		label: 'Math block',
		description: 'LaTeX math equation',
		icon: 'code',
		category: 'Insert',
		execute: (view, from, to) => insertBlocks(view, from, to, '$$\nx^2 + y^2 = z^2\n$$\n')
	},
	{
		id: 'math-inline',
		label: 'Inline math',
		description: 'Inline LaTeX expression',
		icon: 'code',
		category: 'Insert',
		execute: (view, from, to) => replaceWithText(view, from, to, '$E = mc^2$')
	}
];
