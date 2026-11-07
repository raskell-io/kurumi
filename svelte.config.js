import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),

	kit: {
		adapter: adapter({
			pages: 'build',
			assets: 'build',
			fallback: '404.html', // GitHub Pages serves 404.html for unknown routes
			precompress: false,
			strict: true
		}),
		paths: {
			base: '',
			// Absolute asset paths (/_app/…) in every page, like 404.html. The
			// desktop app answers unknown routes (/memory/<id>) with index.html,
			// whose relative ./_app/… paths would resolve under /memory/.
			relative: false
		},
		prerender: {
			handleUnseenRoutes: 'ignore' // Dynamic routes handled by SPA fallback
		}
	}
};

export default config;
