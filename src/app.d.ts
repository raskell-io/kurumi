// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
/// <reference types="vite-plugin-pwa/info" />
/// <reference types="vite-plugin-pwa/svelte" />
/// <reference types="vite-plugin-pwa/client" />
declare global {
	/** Package version · commit · build date (vite.config.ts). */
	const __KURUMI_VERSION__: string;
	/** package.json version alone, e.g. "0.4.0". */
	const __KURUMI_SEMVER__: string;

	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
