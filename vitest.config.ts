import { defineConfig } from 'vitest/config';
import { sveltekit } from '@sveltejs/kit/vite';

export default defineConfig({
	plugins: [sveltekit()],
	test: {
		// The sync worker (worker/) is tested here too; it has no deps of its own.
		include: ['src/**/*.test.ts', 'worker/src/**/*.test.ts'],
		environment: 'node',
		// Most store tests need mocking; keep it simple with no DOM.
		globals: true
	}
});
