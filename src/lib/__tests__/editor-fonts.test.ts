// The editor's typefaces: the list, and what an unknown stored value becomes.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_EDITOR_FONT, EDITOR_FONTS, editorFont } from '$lib/editor-fonts';

const css = readFileSync('src/app.css', 'utf8');

describe('editor fonts', () => {
	it('offers four faces, the default first and unchanged', () => {
		expect(EDITOR_FONTS.map((f) => f.id)).toEqual(['quattro', 'geist', 'newsreader', 'atkinson']);
		expect(DEFAULT_EDITOR_FONT).toBe('quattro');
		expect(editorFont('quattro').family).toBe('iA Writer Quattro S');
	});

	it('an unknown, empty or malformed stored value is the default, without an error', () => {
		for (const value of [null, undefined, '', 'literata', 'Newsreader', 'font-geist', 42, {}, 'a b']) {
			expect(editorFont(value).id).toBe(DEFAULT_EDITOR_FONT);
		}
		expect(editorFont('newsreader').id).toBe('newsreader');
	});

	it('every face has a name, a one-line description and a class in app.css', () => {
		for (const font of EDITOR_FONTS) {
			expect(font.name.length).toBeGreaterThan(2);
			expect(font.blurb).toMatch(/^[A-Z].{20,110}\.$/);
			expect(font.blurb).not.toContain('\n');
			expect(css).toContain(`:root.font-${font.id} {`);
			expect(css).toContain(`'${font.family}'`);
		}
	});

	it('faces outside the app shell are woff2 files that exist, declared in app.css, with a licence beside them', () => {
		const optional = EDITOR_FONTS.filter((f) => f.files.length > 0);
		expect(optional.map((f) => f.id)).toEqual(['newsreader', 'atkinson']);
		for (const font of optional) {
			expect(font.files).toHaveLength(2); // upright and italic, every weight in each
			for (const file of font.files) {
				expect(file).toMatch(/^\/fonts\/optional\/[\w-]+\.woff2$/);
				expect(existsSync(`static${file}`)).toBe(true);
				expect(css).toContain(`url('${file}')`);
			}
		}
		for (const licence of ['Newsreader-OFL.txt', 'AtkinsonHyperlegibleNext-OFL.txt', 'Geist-OFL.txt', 'iA-Writer-Quattro-LICENSE.md']) {
			expect(readFileSync(`static/fonts/licenses/${licence}`, 'utf8')).toContain('SIL Open Font License');
		}
	});

	it('the bundled faces need no download; the optional ones are kept out of the precache', () => {
		expect(editorFont('quattro').files).toEqual([]);
		expect(editorFont('geist').files).toEqual([]);
		const config = readFileSync('vite.config.ts', 'utf8');
		expect(config).toContain("'**/fonts/optional/**'");
		expect(config).toContain("cacheName: 'kurumi-fonts'");
	});

	it('no font is loaded from another host', () => {
		for (const [, url] of css.matchAll(/url\(['"]?([^'")]+)['"]?\)/g)) {
			if (/\.(woff2?|ttf|otf)/.test(url)) expect(url.startsWith('/fonts/')).toBe(true);
		}
		expect(readFileSync('src/app.html', 'utf8')).not.toMatch(/fonts\.(googleapis|gstatic)\.com|use\.typekit|fonts\.bunny/);
	});
});
