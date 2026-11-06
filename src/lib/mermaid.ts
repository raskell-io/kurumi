/**
 * Rendering Mermaid diagrams, shared by the editor and the reader.
 *
 * `strict` security: notes can come from sync and coding agents, and a
 * diagram mustn't be able to run script (click handlers, raw HTML).
 * Renders run one at a time; Mermaid's renderer isn't safe to run
 * concurrently.
 */

let queue: Promise<unknown> = Promise.resolve();
let configuredFor: string | null = null;
let counter = 0;

function isDark(): boolean {
	const root = document.documentElement;
	return (
		root.classList.contains('dark') ||
		(!root.classList.contains('light') && window.matchMedia('(prefers-color-scheme: dark)').matches)
	);
}

// Mermaid wants concrete colours: mix two #rrggbb values (weight of `a`).
function mix(a: string, b: string, weight: number): string {
	const parse = (hex: string) => {
		const h = hex.replace('#', '');
		const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h.slice(0, 6);
		return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
	};
	if (!/^#[0-9a-f]{3,8}$/i.test(a) || !/^#[0-9a-f]{3,8}$/i.test(b)) return a;
	const [x, y] = [parse(a), parse(b)];
	return `#${x.map((v, i) => Math.round(v * weight + y[i] * (1 - weight)).toString(16).padStart(2, '0')).join('')}`;
}

// Diagrams in the app's colours: the theme's surfaces and text, the accent for
// shapes and lines. Read when rendering, so a change of theme or accent shows
// on the next render.
function themeFromApp() {
	const style = getComputedStyle(document.documentElement);
	const read = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
	const dark = isDark();
	const bg = read('--color-bg', dark ? '#1e1e2e' : '#ffffff');
	const surface = read('--color-bg-secondary', dark ? '#181825' : '#f7f7f8');
	const text = read('--color-text', dark ? '#cdd6f4' : '#4c4f69');
	const muted = read('--color-text-muted', dark ? '#a6adc8' : '#6c6f85');
	const border = read('--color-border', dark ? '#313244' : '#e3e5ea');
	const accent = read('--color-accent', dark ? '#b4befe' : '#7287fd');
	// The font the app's interface uses: Mermaid measures labels with it, so
	// they fit their boxes.
	const font = getComputedStyle(document.body).fontFamily || 'sans-serif';
	return {
		key: [dark, bg, text, accent, font].join('|'),
		font,
		variables: {
			darkMode: dark,
			fontFamily: font,
			fontSize: '14px',
			background: surface,
			primaryColor: mix(accent, bg, dark ? 0.22 : 0.14),
			primaryTextColor: text,
			primaryBorderColor: accent,
			secondaryColor: mix(accent, bg, dark ? 0.12 : 0.08),
			secondaryTextColor: text,
			secondaryBorderColor: mix(accent, border, 0.5),
			tertiaryColor: surface,
			tertiaryTextColor: text,
			tertiaryBorderColor: border,
			lineColor: mix(accent, muted, 0.7),
			textColor: text,
			mainBkg: mix(accent, bg, dark ? 0.22 : 0.14),
			nodeBorder: accent,
			clusterBkg: mix(accent, bg, 0.06),
			clusterBorder: border,
			titleColor: text,
			edgeLabelBackground: surface,
			noteBkgColor: mix(accent, bg, 0.1),
			noteTextColor: text,
			noteBorderColor: border,
			actorBkg: mix(accent, bg, dark ? 0.22 : 0.14),
			actorBorder: accent,
			actorTextColor: text,
			signalColor: muted,
			signalTextColor: text,
			labelBoxBkgColor: surface,
			labelTextColor: text
		}
	};
}

export type MermaidResult = { svg: string } | { error: string };

export function renderMermaid(source: string): Promise<MermaidResult> {
	const run = queue.then(async (): Promise<MermaidResult> => {
		try {
			const { default: mermaid } = await import('mermaid');
			const theme = themeFromApp();
			if (configuredFor !== theme.key) {
				mermaid.initialize({
					startOnLoad: false,
					securityLevel: 'strict',
					theme: 'base',
					fontFamily: theme.font,
					themeVariables: theme.variables
				});
				configuredFor = theme.key;
			}
			const { svg } = await mermaid.render(`kurumi-mermaid-${++counter}`, source);
			return { svg };
		} catch (err) {
			// Mermaid leaves its error graphic in the page; take it out.
			document.getElementById(`dkurumi-mermaid-${counter}`)?.remove();
			return { error: err instanceof Error ? err.message : String(err) };
		}
	});
	queue = run;
	return run;
}
