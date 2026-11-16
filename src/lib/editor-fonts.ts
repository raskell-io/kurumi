/**
 * The typefaces a note can be set in (Settings → Appearance → Editor font).
 *
 * Four voices, each for something: a writer's duospace (the default), a plain
 * sans, a book serif, and a face drawn to be unmistakable. The choice is kept
 * per device (`kurumi-editor-font`) and applied as a class on <html>
 * (`font-<id>`, before first paint in app.html); app.css gives each class its
 * stack, and its own size and line height so every face looks intended at
 * the same "Medium".
 *
 * Cost: the two that ship with the app shell (Quattro and Geist, which the
 * interface uses too) are precached. The others live in /fonts/optional/ and
 * are fetched only when chosen, or previewed in the picker; `keepEditorFont`
 * puts the chosen one in a cache the service worker answers from
 * (vite.config.ts, `kurumi-fonts`), so it is there offline, italics included.
 * Their licences are in /fonts/licenses/.
 */

export interface EditorFont {
	id: string;
	/** Shown in the picker, set in the face itself. */
	name: string;
	/** One line: what the face is for. */
	blurb: string;
	/** The CSS family name (for the preview and tests). */
	family: string;
	/** Files beyond the app shell; fetched on demand. Empty for bundled faces. */
	files: string[];
	/** Scripts the face has; anything else falls back to the device's fonts. */
	scripts: string;
}

export const EDITOR_FONTS: EditorFont[] = [
	{
		id: 'quattro',
		name: 'iA Writer Quattro',
		blurb: 'A writer’s typewriter: four widths, steady rhythm, every character plain to see.',
		family: 'iA Writer Quattro S',
		files: [],
		scripts: 'Latin, Latin Extended, Cyrillic, Greek'
	},
	{
		id: 'geist',
		name: 'Geist',
		blurb: 'The interface’s own sans: neutral, compact, for notes that are mostly lists and facts.',
		family: 'Geist',
		files: [],
		scripts: 'Latin, Latin Extended, Cyrillic'
	},
	{
		id: 'newsreader',
		name: 'Newsreader',
		blurb: 'A book serif made for screens, with true italics: a note reads like a page.',
		family: 'Newsreader',
		files: ['/fonts/optional/Newsreader-Variable.woff2', '/fonts/optional/Newsreader-Italic-Variable.woff2'],
		scripts: 'Latin, Latin Extended, Vietnamese'
	},
	{
		id: 'atkinson',
		name: 'Atkinson Hyperlegible',
		blurb: 'Drawn so no two characters can be mistaken for each other: for tired eyes and small type.',
		family: 'Atkinson Hyperlegible Next',
		files: ['/fonts/optional/AtkinsonHyperlegibleNext-Variable.woff2', '/fonts/optional/AtkinsonHyperlegibleNext-Italic-Variable.woff2'],
		scripts: 'Latin, Latin Extended'
	}
];

export const DEFAULT_EDITOR_FONT = 'quattro';
export const EDITOR_FONT_KEY = 'kurumi-editor-font';
/** The cache the service worker serves /fonts/optional/ from (vite.config.ts). */
export const FONT_CACHE = 'kurumi-fonts';

/** The face for a stored value. Anything unknown (a newer Kurumi's choice on this device, a typo) is the default. */
export function editorFont(value: unknown): EditorFont {
	return EDITOR_FONTS.find((f) => f.id === value) ?? EDITOR_FONTS.find((f) => f.id === DEFAULT_EDITOR_FONT)!;
}

/** The stored choice. */
export function savedEditorFont(): EditorFont {
	try {
		return editorFont(localStorage.getItem(EDITOR_FONT_KEY));
	} catch {
		return editorFont(null);
	}
}

/** Apply a face to the page and remember it. */
export function applyEditorFont(id: string, { save = true }: { save?: boolean } = {}): EditorFont {
	const font = editorFont(id);
	const classes = document.documentElement.classList;
	for (const name of [...classes]) if (name.startsWith('font-') && !name.startsWith('font-size-')) classes.remove(name);
	classes.add(`font-${font.id}`);
	if (save) {
		try {
			localStorage.setItem(EDITOR_FONT_KEY, font.id);
		} catch {
			// Storage full or blocked: the choice lasts for this session.
		}
	}
	void keepEditorFont(font);
	return font;
}

/**
 * Have the face's files where the service worker finds them without a
 * connection: all of them, also the italic no note has needed yet. Does
 * nothing for bundled faces, without Cache Storage (the desktop app serves
 * its files itself), or offline.
 */
export async function keepEditorFont(font: EditorFont = savedEditorFont()): Promise<boolean> {
	if (font.files.length === 0 || typeof caches === 'undefined') return false;
	try {
		const cache = await caches.open(FONT_CACHE);
		const missing: string[] = [];
		for (const file of font.files) if (!(await cache.match(file))) missing.push(file);
		if (missing.length > 0) await cache.addAll(missing);
		return true;
	} catch {
		return false; // offline, or the files aren't reachable: the next start tries again
	}
}
