import { goto } from '$app/navigation';
import { browser } from '$app/environment';
import { handleClip } from '$lib/utils/web-clipper';

/**
 * Hash-based routing for GitHub Pages compatibility.
 *
 * URLs like /#/memory/xyz allow the app to work on static hosts
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

	// Handle web clipper: #/clip/<encoded-json>
	if (hashPath && hashPath.startsWith('/clip/')) {
		const encoded = hashPath.slice(6);
		// Delay until the app is mounted so store mutations work.
		setTimeout(() => handleClip(encoded), 100);
		return () => {};
	}

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
 * e.g., "/#/memory/xyz" -> "/memory/xyz"
 */
function getPathFromHash(): string | null {
	if (!browser) return null;

	const hash = window.location.hash;
	if (!hash || !hash.startsWith('#/')) return null;

	return hash.slice(1); // Remove the #
}

/**
 * Create a hash-based href from a path.
 * e.g., "/memory/xyz" -> "/#/memory/xyz"
 */
export function hashHref(path: string): string {
	if (path.startsWith('#')) return path;
	if (path.startsWith('/#')) return path;
	if (path.startsWith('/')) return '/#' + path;
	return '/#/' + path;
}

/**
 * The path of the route that is actually rendered, rebuilt from the route
 * id and params (e.g. "/memory/[id]" + { id: "abc" } -> "/memory/abc").
 *
 * Prefer this over `page.url.pathname` for "is this link active?" checks:
 * because updateHashFromPath rewrites the address bar to "/#/…", the page
 * URL can read "/" after a direct load even though a deeper route renders.
 */
export function currentRoutePath(
	routeId: string | null,
	params: Record<string, string>,
	fallback: string
): string {
	if (!routeId) return fallback;
	const path = routeId
		.replace(/\/\([^)]+\)/g, '')
		.replace(/\[(?:\.\.\.)?([^\]=]+)(?:=[^\]]+)?\]/g, (_, key: string) => params[key] ?? '');
	return path || '/';
}
