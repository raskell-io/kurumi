import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { SvelteKitPWA } from '@vite-pwa/sveltekit';
import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// Shown in Settings → Offline & storage: package version, commit, build date.
const version = (() => {
	const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;
	let commit = '';
	try {
		commit = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
	} catch {
		// Not a git checkout (e.g. a source tarball).
	}
	return [pkg, commit, new Date().toISOString().slice(0, 10)].filter(Boolean).join(' · ');
})();

export default defineConfig({
	define: {
		__KURUMI_VERSION__: JSON.stringify(version)
	},
	plugins: [
		wasm(),
		topLevelAwait(),
		tailwindcss(),
		sveltekit(),
		SvelteKitPWA({
			// Registered by UpdateToast.svelte; new versions wait for a reload.
			registerType: 'prompt',
			manifest: {
				name: 'Kurumi - Second Brain',
				short_name: 'Kurumi',
				description: 'A local-first personal knowledge management system',
				theme_color: '#1e1e2e',
				background_color: '#1e1e2e',
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
				],
				// Web Share Target: text, links, images, recordings, markdown and other files
				// shared from other apps. static/sw-notify.js receives the POST,
				// stashes it, and opens /?share=incoming (src/lib/incoming.ts).
				share_target: {
					action: '/share-target',
					method: 'POST',
					enctype: 'multipart/form-data',
					params: {
						title: 'share_title',
						text: 'share_text',
						url: 'share_url',
						files: [
							{
								name: 'share_files',
								// Images, recordings and markdown get special handling;
								// anything else (PDFs, documents) becomes an attachment.
								accept: ['image/*', 'audio/*', 'video/*', 'text/*', 'application/*', '.md', '.markdown', '.txt']
							}
						]
					}
				},
				// Long-press / right-click on the app icon.
				shortcuts: [
					{ name: 'New note', short_name: 'Note', url: '/?new=note' },
					{ name: "Today's daily note", short_name: 'Today', url: '/#/daily' },
					{ name: 'Voice memo', short_name: 'Voice', url: '/?new=voice' },
					{ name: 'To-dos', short_name: 'To-dos', url: '/#/actions' }
				],
				// Launches (opened files, shares, shortcuts) reuse the open Kurumi
				// window. navigate-existing, not focus-existing: the window really
				// navigates to the launch URL, so a share's POST still reaches the
				// service worker. Editors save on pagehide before that reload.
				launch_handler: { client_mode: ['navigate-existing', 'auto'] },
				// "Open with Kurumi" for markdown files (installed desktop app);
				// handled through window.launchQueue in src/lib/pwa-boot.ts.
				file_handlers: [
					{
						action: '/',
						accept: { 'text/markdown': ['.md', '.markdown'], 'text/plain': ['.txt'] }
					}
				]
			},
			workbox: {
				globPatterns: ['**/*.{js,css,html,ico,png,svg,avif,woff,woff2,wasm}'],
				// Exclude the ONNX runtime WASM (~22 MB) and Hugging Face model
				// weights from precache. They're loaded on demand the first time
				// local inference is used; the browser cache + transformers.js's
				// own IndexedDB cache make subsequent loads instant.
				globIgnores: ['**/ort-*.wasm', '**/onnxruntime-*.wasm'],
				maximumFileSizeToCacheInBytes: 5 * 1024 * 1024, // 5 MiB for Automerge WASM
				// Inject our custom notification handlers into the generated
				// Workbox service worker. sw-notify.js adds the periodicsync
				// + notificationclick listeners without disturbing the
				// auto-generated precache + runtime routes below.
				importScripts: ['sw-notify.js'],
				// Discovery files must reach the network as real text files, never
				// the app shell the navigation fallback would answer with.
				navigateFallbackDenylist: [/^\/(robots\.txt|sitemap\.xml|llms\.txt)$/],
				runtimeCaching: [
					{
						urlPattern: /^https:\/\/api\.(openai|anthropic)\.com\/.*/i,
						handler: 'NetworkOnly'
					},
					{
						// Hugging Face model downloads — let them through to the
						// network so transformers.js's own cache handles them.
						// Includes the LFS CDN where the actual model weights live.
						urlPattern: /^https:\/\/(?:[a-z0-9-]+\.)?(?:huggingface\.co|hf\.co)\/.*/i,
						handler: 'NetworkOnly'
					},
					{
						// The ONNX runtime transformers.js loads from jsdelivr. Its
						// URLs are versioned, so cache it for good: local inference
						// then works offline once it has run online.
						urlPattern: /^https:\/\/cdn\.jsdelivr\.net\/npm\/onnxruntime-web@.*/i,
						handler: 'CacheFirst',
						options: {
							cacheName: 'onnxruntime',
							expiration: { maxEntries: 20 },
							cacheableResponse: { statuses: [0, 200] }
						}
					}
				]
			},
			devOptions: {
				enabled: false
			}
		})
	],
	optimizeDeps: {
		exclude: ['@automerge/automerge', '@huggingface/transformers']
	},
	// ES module workers: the embedding worker (src/lib/inference/
	// embed.worker.ts) loads transformers.js, which uses dynamic imports.
	worker: {
		format: 'es'
	}
});
