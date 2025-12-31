import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),

	kit: {
		adapter: adapter({
			pages: 'build',
			assets: 'build',
			fallback: 'index.html', // SPA mode for client-side routing
			precompress: false,
			strict: true
		}),
		paths: {
			base: ''
		},
		prerender: {
			handleUnseenRoutes: 'ignore' // Dynamic routes handled by SPA fallback
		}
	}
};

export default config;
