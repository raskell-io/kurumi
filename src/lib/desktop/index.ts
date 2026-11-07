/**
 * The desktop app (desktop/, Tauri): detection and the browser APIs it
 * stands in for. See desktop/README.md.
 */

import { showDesktopDirectoryPicker } from './folder-handle';

/** Running inside the desktop app. Tauri sets this before any page script. */
export function isTauri(): boolean {
	return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/**
 * Called once at startup (hooks.client.ts). In the desktop app, gives the
 * page a showDirectoryPicker backed by the app (WebKit has none, and on
 * Windows this keeps folder access the same everywhere).
 */
export function installDesktopShims(): void {
	if (!isTauri()) return;
	Object.defineProperty(window, 'showDirectoryPicker', {
		configurable: true,
		writable: true,
		value: showDesktopDirectoryPicker
	});
}
