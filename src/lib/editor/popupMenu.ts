/**
 * A small menu under a button inside the editor (a callout's type), built
 * from the app's `k-menu` styles. Arrow keys move, Enter picks, Escape
 * closes and gives the focus back to the editor.
 */

export interface PopupItem {
	label: string;
	checked?: boolean;
	run: () => void;
}

let open: { menu: HTMLElement; close: (refocus?: boolean) => void } | null = null;

export function closePopupMenu() {
	open?.close(false);
}

export function openPopupMenu(anchor: HTMLElement, label: string, items: (PopupItem | 'sep')[], onClose: (refocus: boolean) => void) {
	open?.close(false);
	const menu = document.createElement('div');
	menu.className = 'k-menu kurumi-popup-menu';
	menu.setAttribute('role', 'menu');
	menu.setAttribute('aria-label', label);
	const buttons: HTMLButtonElement[] = [];
	for (const item of items) {
		if (item === 'sep') {
			const sep = document.createElement('div');
			sep.className = 'k-menu-sep';
			sep.setAttribute('role', 'separator');
			menu.appendChild(sep);
			continue;
		}
		const button = document.createElement('button');
		button.type = 'button';
		button.className = 'k-menu-item';
		button.setAttribute('role', item.checked === undefined ? 'menuitem' : 'menuitemradio');
		if (item.checked !== undefined) button.setAttribute('aria-checked', String(item.checked));
		button.textContent = item.label;
		button.addEventListener('click', () => {
			close(false);
			item.run();
		});
		buttons.push(button);
		menu.appendChild(button);
	}
	menu.addEventListener('keydown', (event) => {
		const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			const step = event.key === 'ArrowDown' ? 1 : -1;
			buttons[(at + step + buttons.length) % buttons.length]?.focus();
		} else if (event.key === 'Home' || event.key === 'End') {
			event.preventDefault();
			buttons[event.key === 'Home' ? 0 : buttons.length - 1]?.focus();
		} else if (event.key === 'Escape' || event.key === 'Tab') {
			event.preventDefault();
			event.stopPropagation();
			close(true);
		}
	});
	document.body.appendChild(menu);
	const rect = anchor.getBoundingClientRect();
	const below = rect.bottom + 4 + menu.offsetHeight < window.innerHeight;
	menu.style.top = `${below ? rect.bottom + 4 : Math.max(8, rect.top - 4 - menu.offsetHeight)}px`;
	menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - menu.offsetWidth - 8))}px`;
	anchor.setAttribute('aria-expanded', 'true');
	const choices = items.filter((x): x is PopupItem => x !== 'sep');
	(buttons.find((_, i) => choices[i].checked) ?? buttons[0])?.focus();

	const outside = (event: MouseEvent) => {
		if (!menu.contains(event.target as Node) && !anchor.contains(event.target as Node)) close(false);
	};
	const onScroll = (event: Event) => {
		if (!menu.contains(event.target as Node)) close(false);
	};
	function close(refocus = false) {
		if (open?.menu !== menu) return;
		open = null;
		menu.remove();
		anchor.setAttribute('aria-expanded', 'false');
		document.removeEventListener('mousedown', outside, true);
		window.removeEventListener('scroll', onScroll, true);
		window.removeEventListener('resize', onResize);
		onClose(refocus);
	}
	const onResize = () => close(false);
	setTimeout(() => {
		document.addEventListener('mousedown', outside, true);
		window.addEventListener('scroll', onScroll, true);
		window.addEventListener('resize', onResize);
	});
	open = { menu, close };
}
