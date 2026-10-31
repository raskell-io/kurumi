import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';
import { sveltekit } from '@sveltejs/kit/vite';

export default defineConfig({
	plugins: [sveltekit()],
	define: {
		__KURUMI_VERSION__: JSON.stringify('test'),
		__KURUMI_SEMVER__: JSON.stringify(JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version)
	},
	test: {
		// The sync worker (worker/) is tested here too; it has no deps of its own.
		include: ['src/**/*.test.ts', 'worker/src/**/*.test.ts'],
		environment: 'node',
		// Most store tests need mocking; keep it simple with no DOM.
		globals: true
	}
});
