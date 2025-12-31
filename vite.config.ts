import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { SvelteKitPWA } from '@vite-pwa/sveltekit';
import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';

export default defineConfig({
	plugins: [
		wasm(),
		topLevelAwait(),
		tailwindcss(),
		sveltekit(),
		SvelteKitPWA({
			registerType: 'autoUpdate',
			manifest: {
				name: 'Kurumi - Second Brain',
				short_name: 'Kurumi',
				description: 'A local-first personal knowledge management system',
				theme_color: '#1a1a2e',
				background_color: '#1a1a2e',
				display: 'standalone',
				scope: '/',
				start_url: '/',
				icons: [
					{
						src: '/icon-192.png',
						sizes: '192x192',
						type: 'image/png'
					},
					{
						src: '/icon-512.png',
						sizes: '512x512',
						type: 'image/png'
					},
					{
						src: '/icon-192.avif',
						sizes: '192x192',
						type: 'image/avif'
					},
					{
						src: '/icon-512.avif',
						sizes: '512x512',
						type: 'image/avif'
					}
				]
			},
			workbox: {
				globPatterns: ['**/*.{js,css,html,ico,png,svg,avif,woff,woff2,wasm}'],
				maximumFileSizeToCacheInBytes: 5 * 1024 * 1024, // 5 MiB for Automerge WASM
				runtimeCaching: [
					{
						urlPattern: /^https:\/\/api\.(openai|anthropic)\.com\/.*/i,
						handler: 'NetworkOnly'
					}
				]
			},
			devOptions: {
				enabled: true
			}
		})
	],
	optimizeDeps: {
		exclude: ['@automerge/automerge']
	}
});
