/**
 * One behaviour for every menu and dialog: `<div use:menu={{ onClose }}>`,
 * `<div use:dialog={{ onClose }}>`.
 *
 * Both:
 * - Escape closes the one on top (only that one), wherever the focus is,
 *   before anything inside can swallow the key; a field that uses Escape
 *   itself (an open autocomplete) keeps it.
 * - Going to another page closes them.
 * - Closing gives the focus back to what had it before (the button that
 *   opened a menu), unless the user has put it somewhere else meanwhile.
 *
 * Menus also: open with the focus on their first item (keyboard users see
 * it; after a click nothing shows), ↑ ↓ Home End move between items, Tab
 * leaves and closes, and a press anywhere outside closes them (the press
 * still does what it does: no invisible layer eats it).
 *
 * Dialogs also: the focus starts inside (unless something inside already
 * took it) and Tab stays inside.
 */
import { page } from '$app/stores';
import { get } from 'svelte/store';

type CloseReason = 'escape' | 'outside' | 'navigation' | 'tab';

export interface OverlayOptions {
	/** Close it. The component's own close function. */
	onClose: (reason: CloseReason) => void;
	/** Where the focus goes back to. Default: what had it when this opened. */
	returnFocus?: HTMLElement | null;
	/** Elements that count as inside (the button that opens a menu: pressing it toggles). */
	inside?: Array<HTMLElement | null | undefined>;
	/**
	 * false: the component handles Escape itself (a recording to confirm, a
	 * prompt inside to close first). Everything else still applies.
	 */
	escape?: boolean;
}

interface Entry {
	node: HTMLElement;
	kind: 'menu' | 'dialog';
	options: OverlayOptions;
	/** What had the focus when it opened (for a menu: usually its button, which toggles it). */
	opener: HTMLElement | null;
}

const stack: Entry[] = [];

const FOCUSABLE =
	'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';
const ITEMS = '[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], [role="option"], .k-menu-item';

const visible = (el: HTMLElement) => el.getClientRects().length > 0 && !el.closest('[inert]');

export function focusables(root: HTMLElement): HTMLElement[] {
	return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(visible);
}

function menuItems(root: HTMLElement): HTMLElement[] {
	const items = [...root.querySelectorAll<HTMLElement>(ITEMS)].filter(
		(el) =>
			visible(el) &&
			el.matches('a[href], button, [tabindex]') &&
			!(el as HTMLButtonElement).disabled &&
			el.getAttribute('aria-disabled') !== 'true'
	);
	return items.length > 0 ? items : focusables(root);
}

/** A field handling Escape itself: an open autocomplete or combobox. */
function keepsEscape(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	return target.getAttribute('aria-expanded') === 'true' && /^(INPUT|TEXTAREA)$/.test(target.tagName);
}

/** The one on top that is not already on its way out (fading, `inert`). */
function topEntry(): Entry | undefined {
	for (let i = stack.length - 1; i >= 0; i--) if (!stack[i].node.hasAttribute('inert')) return stack[i];
	return undefined;
}

function isTop(entry: Entry) {
	return topEntry() === entry;
}

function onKeydown(e: KeyboardEvent) {
	const top = topEntry();
	if (!top || e.key !== 'Escape' || e.isComposing || keepsEscape(e.target)) return;
	if (top.options.escape === false) return;
	e.preventDefault();
	e.stopImmediatePropagation();
	top.options.onClose('escape');
}

function onPointerdown(e: PointerEvent) {
	const top = topEntry();
	if (!top || top.kind !== 'menu') return;
	const target = e.target as Node;
	if (top.node.contains(target)) return;
	if (top.options.inside?.some((el) => el?.contains(target))) return;
	if (top.opener?.contains(target)) return;
	// Something portaled on top of the menu (a nested popup it opened) counts as inside.
	if (stack.some((entry) => entry !== top && entry.node.contains(target))) return;
	top.options.onClose('outside');
}

let listening = false;
let unsubscribePage: (() => void) | null = null;
let lastPath: string | null = null;

function listen() {
	if (listening) return;
	listening = true;
	window.addEventListener('keydown', onKeydown, true);
	document.addEventListener('pointerdown', onPointerdown, true);
	lastPath = get(page).url.pathname;
	unsubscribePage = page.subscribe(($page) => {
		const path = $page.url.pathname;
		if (path === lastPath) return;
		lastPath = path;
		// Another page: everything open closes, top first.
		for (const entry of [...stack].reverse()) entry.options.onClose('navigation');
	});
}

function unlisten() {
	if (!listening || stack.length > 0) return;
	listening = false;
	window.removeEventListener('keydown', onKeydown, true);
	document.removeEventListener('pointerdown', onPointerdown, true);
	unsubscribePage?.();
	unsubscribePage = null;
}

function register(node: HTMLElement, kind: Entry['kind'], options: OverlayOptions) {
	let opener = options.returnFocus ?? (document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null);
	// Opened from an item of a menu that is closing now ("New vault…"): the
	// focus goes back to what opened that menu.
	const parent = opener ? stack.find((entry) => entry.node.contains(opener)) : undefined;
	if (parent && parent.kind === 'menu' && !options.returnFocus) opener = parent.opener;
	const entry: Entry = { node, kind, options, opener };
	listen();
	stack.push(entry);
	return {
		entry,
		opener,
		update(next: OverlayOptions) {
			entry.options = next;
		},
		destroy() {
			const at = stack.indexOf(entry);
			if (at >= 0) stack.splice(at, 1);
			// Focus back where it was, unless the user has put it somewhere else
			// (clicked into the page, or the menu item opened a dialog that took it).
			const active = document.activeElement;
			const lost = !active || active === document.body || node.contains(active) || !active.isConnected;
			if (lost && opener?.isConnected && !opener.closest('[inert]')) opener.focus({ preventScroll: true });
			unlisten();
		}
	};
}

export function menu(node: HTMLElement, options: OverlayOptions) {
	const reg = register(node, 'menu', options);
	if (!node.hasAttribute('tabindex')) node.tabIndex = -1;

	// Start on the first item, unless something inside (a search field) took the focus.
	const focusFirst = () => {
		if (node.contains(document.activeElement)) return;
		(menuItems(node)[0] ?? node).focus({ preventScroll: true });
	};
	queueMicrotask(focusFirst);
	// Opened again while it was still fading out: Svelte reverses the fade and
	// keeps the element (no new mount), only taking `inert` off again.
	const reopened = whenReopened(node, focusFirst);

	const keydown = (e: KeyboardEvent) => {
		if (!isTop(reg.entry)) return;
		const target = e.target as HTMLElement;
		const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable;
		if (e.key === 'Tab') {
			reg.entry.options.onClose('tab');
			return;
		}
		if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
		if (typing && (e.key === 'Home' || e.key === 'End')) return;
		const items = menuItems(node);
		if (items.length === 0) return;
		e.preventDefault();
		const at = items.indexOf(document.activeElement as HTMLElement);
		const next =
			e.key === 'Home' ? 0
			: e.key === 'End' ? items.length - 1
			: e.key === 'ArrowDown' ? (at + 1) % items.length
			: (at <= 0 ? items.length : at) - 1;
		items[next].focus();
	};
	node.addEventListener('keydown', keydown);

	return {
		update: reg.update,
		destroy() {
			reopened.disconnect();
			node.removeEventListener('keydown', keydown);
			reg.destroy();
		}
	};
}

function whenReopened(node: HTMLElement, then: () => void): MutationObserver {
	const observer = new MutationObserver(() => {
		if (!node.hasAttribute('inert')) then();
	});
	observer.observe(node, { attributes: true, attributeFilter: ['inert'] });
	return observer;
}

export function dialog(node: HTMLElement, options: OverlayOptions) {
	const reg = register(node, 'dialog', options);

	const focusFirst = () => {
		if (node.contains(document.activeElement)) return;
		const autofocus = node.querySelector<HTMLElement>('[autofocus], [data-autofocus]');
		const first = autofocus ?? focusables(node).find((el) => !el.matches('[aria-label="Close"], [aria-label="Close dialog"]')) ?? focusables(node)[0];
		if (first) first.focus({ preventScroll: true });
		else {
			if (!node.hasAttribute('tabindex')) node.tabIndex = -1;
			node.focus({ preventScroll: true });
		}
	};
	queueMicrotask(focusFirst);
	const reopened = whenReopened(node, focusFirst);

	// Tab and Shift+Tab go round inside.
	const keydown = (e: KeyboardEvent) => {
		if (e.key !== 'Tab' || !isTop(reg.entry)) return;
		const all = focusables(node);
		if (all.length === 0) {
			e.preventDefault();
			return;
		}
		const first = all[0];
		const last = all[all.length - 1];
		const active = document.activeElement as HTMLElement | null;
		if (e.shiftKey && (active === first || !node.contains(active))) {
			e.preventDefault();
			last.focus();
		} else if (!e.shiftKey && (active === last || !node.contains(active))) {
			e.preventDefault();
			first.focus();
		}
	};
	// The focus leaving by other means (a click on the dimmed page cannot reach it): pull it back.
	const focusin = (e: FocusEvent) => {
		if (!isTop(reg.entry)) return;
		const target = e.target as Node;
		if (node.contains(target) || stack.some((entry) => entry !== reg.entry && entry.node.contains(target))) return;
		(focusables(node)[0] ?? node).focus({ preventScroll: true });
	};
	window.addEventListener('keydown', keydown, true);
	document.addEventListener('focusin', focusin);

	return {
		update: reg.update,
		destroy() {
			reopened.disconnect();
			window.removeEventListener('keydown', keydown, true);
			document.removeEventListener('focusin', focusin);
			reg.destroy();
		}
	};
}

/** For tests: how many are open. */
export function openOverlays(): number {
	return stack.length;
}
