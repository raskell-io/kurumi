/**
 * LaTeX math with KaTeX, shared by the editor (editor/math.ts) and the
 * reader (MarkdownRenderer). KaTeX and its stylesheet load on first use, so
 * notes without math don't pay for them.
 *
 * `trust: false` (KaTeX's default): notes can come from sync and coding
 * agents, so \href, \url and HTML-producing commands stay off.
 */

type Katex = typeof import('katex').default;

let loading: Promise<Katex> | null = null;
let loaded: Katex | null = null;

export function loadKatex(): Promise<Katex> {
	loading ??= Promise.all([import('katex'), import('katex/dist/katex.min.css')]).then(([mod]) => {
		loaded = (mod as unknown as { default?: Katex }).default ?? (mod as unknown as Katex);
		return loaded;
	});
	return loading;
}

function render(katex: Katex, source: string, display: boolean): string {
	return katex.renderToString(source, {
		displayMode: display,
		throwOnError: false,
		strict: 'ignore',
		trust: false,
		output: 'htmlAndMathml'
	});
}

/** HTML for `source`, once KaTeX is loaded. */
export async function renderMath(source: string, display: boolean): Promise<string> {
	return render(await loadKatex(), source, display);
}

/** HTML for `source` if KaTeX is already loaded, else null (then use renderMath). */
export function renderMathNow(source: string, display: boolean): string | null {
	return loaded ? render(loaded, source, display) : null;
}
