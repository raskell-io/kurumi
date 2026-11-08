/**
 * Colour themes for Settings → Appearance. The colours themselves are in
 * app.css (`palette-*` classes); these are for the previews.
 */

export interface Palette {
	id: string;
	label: string;
	/** bg, text and a reference colour, light then dark */
	light: [string, string, string];
	dark: [string, string, string];
}

export const PALETTES: Palette[] = [
	{ id: 'catppuccin', label: 'Catppuccin', light: ['#ffffff', '#4c4f69', '#fe640b'], dark: ['#1e1e2e', '#cdd6f4', '#fab387'] },
	{ id: 'nord', label: 'Nord', light: ['#eceff4', '#2e3440', '#c0704f'], dark: ['#2e3440', '#eceff4', '#d08770'] },
	{ id: 'gruvbox', label: 'Gruvbox', light: ['#fbf1c7', '#3c3836', '#af3a03'], dark: ['#282828', '#ebdbb2', '#fe8019'] },
	{ id: 'solarized', label: 'Solarized', light: ['#fdf6e3', '#475b62', '#cb4b16'], dark: ['#002b36', '#c4d0d0', '#cb4b16'] },
	{ id: 'rose-pine', label: 'Rosé Pine', light: ['#faf4ed', '#575279', '#d7827e'], dark: ['#191724', '#e0def4', '#ebbcba'] },
	{ id: 'plain', label: 'Plain', light: ['#ffffff', '#1f1f1f', '#d35400'], dark: ['#161616', '#e6e6e6', '#ffb74d'] }
];

export const PALETTE_KEY = 'kurumi-palette';
export const CUSTOM_CSS_KEY = 'kurumi-custom-css';

/** Apply a palette to the page (the default is no class). */
export function applyPalette(id: string): void {
	const classes = document.documentElement.classList;
	for (const p of PALETTES) classes.remove(`palette-${p.id}`);
	if (id !== 'catppuccin') classes.add(`palette-${id}`);
}

/** Apply custom CSS (a <style> at the end of <head>, also created by app.html). */
export function applyCustomCss(css: string): void {
	let el = document.getElementById('kurumi-custom-css');
	if (!el) {
		el = document.createElement('style');
		el.id = 'kurumi-custom-css';
		document.head.appendChild(el);
	}
	el.textContent = css;
}
