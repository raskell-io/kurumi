/**
 * Motion: the app's transitions as one small system.
 *
 * The values are CSS tokens in app.css (`--motion-fast`, `--motion-base`,
 * `--ease-enter`, `--ease-exit`, and `--motion-scale`, where 0 turns all of
 * it off). CSS uses them directly; the Svelte transitions here read them, so
 * a theme or CSS snippet that changes a token changes both.
 *
 * Rules these keep: opacity and transform where possible; nothing waits for
 * an animation (Svelte makes a leaving element inert, so it takes no clicks);
 * nothing plays until `armMotion()`, i.e. not on first paint or while the
 * app restores its state after a reload.
 */
import type { TransitionConfig } from 'svelte/transition';

export type MotionSpeed = 'fast' | 'base';
type Easing = (t: number) => number;

let armed = false;
let probe: HTMLElement | null = null;

/** Called by the layout once the restored app has been painted. */
export function armMotion() {
	if (armed || typeof document === 'undefined') return;
	armed = true;
	document.documentElement.classList.add('motion-ready');
}

/**
 * Change the look at once, with no transition: a theme, palette or accent
 * switch. Without this the backgrounds (no transition) changed in one
 * frame and buttons, tabs and text faded from the old colours for 100 ms.
 */
export function switchInstantly(change: () => void) {
	if (typeof document === 'undefined') return change();
	const root = document.documentElement;
	root.classList.add('motion-instant');
	change();
	void root.offsetWidth; // the new colours are computed here, with no transition to run
	requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('motion-instant')));
}

/** For tests. */
export function disarmMotion() {
	armed = false;
	if (typeof document !== 'undefined') document.documentElement.classList.remove('motion-ready');
}

function probeStyle(speed: MotionSpeed, ease: 'enter' | 'exit'): CSSStyleDeclaration | null {
	if (typeof document === 'undefined' || !document.body) return null;
	if (!probe || !probe.isConnected) {
		probe = document.createElement('div');
		probe.setAttribute('aria-hidden', 'true');
		probe.style.cssText = 'position:fixed;width:0;height:0;visibility:hidden;pointer-events:none';
		document.body.appendChild(probe);
	}
	probe.style.transition = `opacity var(--motion-${speed}, 0s) var(--ease-${ease}, ease)`;
	return getComputedStyle(probe);
}

function seconds(value: string): number {
	const first = value.split(',')[0].trim();
	const n = parseFloat(first);
	if (!Number.isFinite(n)) return 0;
	return first.endsWith('ms') ? n : n * 1000;
}

/** A token's duration in milliseconds; 0 before the app is ready, with motion turned off, or when the user asks for less motion. */
export function motionMs(speed: MotionSpeed = 'base'): number {
	if (!armed) return 0;
	const style = probeStyle(speed, 'enter');
	if (!style) return 0;
	const ms = seconds(style.transitionDuration);
	return ms < 1 ? 0 : ms;
}

const KEYWORDS: Record<string, [number, number, number, number]> = {
	ease: [0.25, 0.1, 0.25, 1],
	'ease-in': [0.42, 0, 1, 1],
	'ease-out': [0, 0, 0.58, 1],
	'ease-in-out': [0.42, 0, 0.58, 1]
};

/** A CSS timing function as a JS easing (cubic-bezier and the keywords; anything else is linear). */
export function cssEasing(value: string): Easing {
	const text = value.split(/,(?![^(]*\))/)[0].trim();
	const match = /^cubic-bezier\(([^)]+)\)$/.exec(text);
	const points = match ? match[1].split(',').map((p) => parseFloat(p)) : KEYWORDS[text];
	if (!points || points.length !== 4 || points.some((p) => !Number.isFinite(p))) return (t) => t;
	const [x1, y1, x2, y2] = points;
	const curve = (a: number, b: number, s: number) => 3 * a * s * (1 - s) * (1 - s) + 3 * b * s * s * (1 - s) + s * s * s;
	return (t) => {
		if (t <= 0) return 0;
		if (t >= 1) return 1;
		// Bisect x(s) = t; 20 steps is far below a pixel.
		let lo = 0;
		let hi = 1;
		for (let i = 0; i < 20; i++) {
			const mid = (lo + hi) / 2;
			if (curve(x1, x2, mid) < t) lo = mid;
			else hi = mid;
		}
		return curve(y1, y2, (lo + hi) / 2);
	};
}

function easing(ease: 'enter' | 'exit'): Easing {
	const style = probeStyle('base', ease);
	return style ? cssEasing(style.transitionTimingFunction) : (t) => t;
}

const NONE: TransitionConfig = { duration: 0 };

/**
 * Height open and shut without measuring: the node is a one-row grid
 * (`.k-collapse` in app.css) whose row goes 0fr ↔ 1fr. Reversible midway.
 * `skip` is for long lists, which open at once.
 */
export function collapse(node: HTMLElement, { skip = false }: { skip?: boolean } = {}): TransitionConfig {
	const duration = skip ? 0 : motionMs('base');
	if (!duration) return NONE;
	let moved = false;
	return {
		duration,
		easing: easing('enter'),
		css: (t) => `grid-template-rows:${t}fr;opacity:${Math.min(1, t * 1.5)}`,
		// Clipped only while it moves: menus and focus rings inside may
		// reach past the edge the rest of the time.
		tick: (t) => {
			if (t < 1) {
				moved = true;
				node.style.overflow = 'hidden';
			} else if (moved) node.style.overflow = '';
		}
	};
}

/** A menu, popover or dialog leaving: a quick fade, very slightly smaller. Entering is CSS (`popIn`). */
export function popOut(_node: Element): TransitionConfig {
	const duration = motionMs('fast');
	if (!duration) return NONE;
	return { duration, easing: easing('exit'), css: (t) => `opacity:${t};scale:${0.98 + 0.02 * t}` };
}

/** A plain fade out, for backdrops and toasts. */
export function fadeOut(_node: Element): TransitionConfig {
	const duration = motionMs('fast');
	if (!duration) return NONE;
	return { duration, easing: easing('exit'), css: (t) => `opacity:${t}` };
}

/**
 * Something appearing in a row (the sidebar's expand button in the top
 * bar): it grows from no width, so what follows slides instead of jumping.
 */
export function growX(node: HTMLElement): TransitionConfig {
	const duration = motionMs('base');
	if (!duration) return NONE;
	const style = getComputedStyle(node);
	const width = node.offsetWidth;
	const left = parseFloat(style.marginLeft) || 0;
	const right = parseFloat(style.marginRight) || 0;
	return {
		duration,
		easing: easing('enter'),
		css: (t) => `width:${t * width}px;min-width:0;margin-left:${t * left}px;margin-right:${t * right}px;opacity:${t};overflow:hidden`
	};
}

/** A tab appearing. */
export function tabIn(_node: Element): TransitionConfig {
	const duration = motionMs('base');
	if (!duration) return NONE;
	return { duration, easing: easing('enter'), css: (t) => `opacity:${t};scale:${0.96 + 0.04 * t}` };
}

/** For `animate:flip`: the neighbours of a tab that came, went or moved. */
export function flipParams(): { duration: number; easing: Easing } {
	return { duration: motionMs('base'), easing: easing('enter') };
}

/**
 * A panel beside the page (split note, assistant) coming in from the right
 * edge while the page makes room. The panel keeps its final width, so
 * nothing inside it reflows; only its right margin moves.
 */
export function panelSlide(node: HTMLElement): TransitionConfig {
	const duration = motionMs('base');
	const parent = node.parentElement;
	// Phones show these over the page, not beside it.
	if (!duration || !parent || !matchMedia('(min-width: 768px)').matches) return NONE;
	const width = node.offsetWidth;
	if (!width) return NONE;
	const gap = parseFloat(getComputedStyle(parent).columnGap) || 0;
	const travel = width + gap;
	const held = { flex: node.style.flex, width: node.style.width };
	node.style.flex = 'none';
	node.style.width = `${width}px`;
	let moved = false;
	return {
		duration,
		easing: easing('enter'),
		css: (t) => `margin-right:${-(1 - t) * travel}px;opacity:${Math.min(1, t * 2)}`,
		tick: (t) => {
			if (t < 1) moved = true;
			else if (moved) {
				node.style.flex = held.flex;
				node.style.width = held.width;
			}
		}
	};
}

let pageAnimation: Animation | null = null;

/** A page or note arriving: its inside fades in over a few pixels. The chrome and the panel stay put. */
export function pageEnter(el: HTMLElement | undefined | null) {
	pageAnimation?.cancel();
	pageAnimation = null;
	const duration = motionMs('base');
	if (!el || !duration || typeof el.animate !== 'function') return;
	const style = probeStyle('base', 'enter');
	pageAnimation = el.animate(
		[
			{ opacity: 0, translate: '0 4px' },
			{ opacity: 1, translate: '0 0' }
		],
		{ duration, easing: style?.transitionTimingFunction.split(/,(?![^(]*\))/)[0].trim() || 'ease-out' }
	);
	const mine = pageAnimation;
	const done = () => {
		if (pageAnimation === mine) pageAnimation = null;
	};
	mine.finished.then(done, done);
}
