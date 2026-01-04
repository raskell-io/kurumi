import { goto } from '$app/navigation';
import { browser } from '$app/environment';

/**
 * Hash-based routing for GitHub Pages compatibility.
 *
 * URLs like /#/note/xyz allow the app to work on static hosts
 * without returning 404 errors on refresh.
 */

/**
 * Initialize hash routing. Call this once on app mount.
 * - If there's a hash path, navigate to it
 * - Listen for hash changes and navigate accordingly
 * - Sync current path to hash on navigation
 */
export function initHashRouter(): () => void {
	if (!browser) return () => {};

	// On initial load, check for hash path and navigate
	const hashPath = getPathFromHash();
	if (hashPath && hashPath !== '/') {
		// Use replaceState to avoid adding to history
		goto(hashPath, { replaceState: true });
	} else {
		// Sync current path to hash
		updateHashFromPath(window.location.pathname);
	}

	// Listen for hash changes (e.g., back/forward buttons)
	const handleHashChange = () => {
		const hashPath = getPathFromHash();
		const currentPath = window.location.pathname;

		if (hashPath && hashPath !== currentPath) {
			goto(hashPath, { replaceState: true });
		}
	};

	window.addEventListener('hashchange', handleHashChange);

	return () => {
		window.removeEventListener('hashchange', handleHashChange);
	};
}

/**
 * Update the hash to reflect the current path.
 * Call this after navigation completes.
 */
export function updateHashFromPath(path: string): void {
	if (!browser) return;

	// Don't update if hash already matches
	const currentHashPath = getPathFromHash();
	if (currentHashPath === path) return;

	// Update hash without triggering hashchange navigation
	const newUrl = window.location.origin + '/#' + path;
	window.history.replaceState(null, '', newUrl);
}

/**
 * Extract the path from the hash.
 * e.g., "/#/note/xyz" -> "/note/xyz"
 */
function getPathFromHash(): string | null {
	if (!browser) return null;

	const hash = window.location.hash;
	if (!hash || !hash.startsWith('#/')) return null;

	return hash.slice(1); // Remove the #
}

/**
 * Create a hash-based href from a path.
 * e.g., "/note/xyz" -> "/#/note/xyz"
 */
export function hashHref(path: string): string {
	if (path.startsWith('#')) return path;
	if (path.startsWith('/#')) return path;
	if (path.startsWith('/')) return '/#' + path;
	return '/#/' + path;
}
