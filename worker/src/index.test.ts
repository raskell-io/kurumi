import { describe, it, expect } from 'vitest';
import worker, { type Env } from './index';

// Just enough of R2 for the worker: a Map of objects.
function fakeBucket() {
	const objects = new Map<string, { body: ArrayBuffer; contentType?: string }>();
	return {
		objects,
		async get(key: string) {
			const o = objects.get(key);
			if (!o) return null;
			return {
				body: o.body,
				httpEtag: '"x"',
				httpMetadata: { contentType: o.contentType },
				text: async () => new TextDecoder().decode(o.body)
			};
		},
		async put(key: string, value: ArrayBuffer | string, opts?: { httpMetadata?: { contentType?: string } }) {
			const body = typeof value === 'string' ? new TextEncoder().encode(value).buffer : value;
			objects.set(key, { body: body as ArrayBuffer, contentType: opts?.httpMetadata?.contentType });
		}
	};
}

const call = (env: Env, path: string, init?: RequestInit) => worker.fetch(new Request(`https://kurumi-sync.example.workers.dev${path}`, init), env);
const tokenFrom = (link: string) => JSON.parse(atob(link.split('pair=')[1].replace(/-/g, '+').replace(/_/g, '/'))).token as string;

describe('sync worker', () => {
	it('is claimed once, through its setup page, and then syncs with the token', async () => {
		const bucket = fakeBucket();
		const env = { KURUMI_BUCKET: bucket } as unknown as Env;
		expect(await (await call(env, '/')).text()).toContain('Connect Kurumi');

		const claimed = await call(env, '/claim', { method: 'POST' });
		const { link } = (await claimed.json()) as { link: string };
		expect(link).toMatch(/^https:\/\/kurumi\.raskell\.io\/#\/settings\/sync\?pair=/);
		const token = tokenFrom(link);
		expect(JSON.parse(atob(link.split('pair=')[1].replace(/-/g, '+').replace(/_/g, '/'))).url).toBe('https://kurumi-sync.example.workers.dev/sync');

		// Only the hash is stored, and only one claim
		expect(new TextDecoder().decode(bucket.objects.get('kurumi-config/tokens.json')!.body)).not.toContain(token);
		expect((await call(env, '/claim', { method: 'POST' })).status).toBe(409);
		expect(await (await call(env, '/')).text()).not.toContain('Connect Kurumi');

		const auth = { Authorization: `Bearer ${token}` };
		expect((await call(env, '/sync', { headers: auth })).status).toBe(404);
		expect((await call(env, '/sync', { method: 'PUT', headers: auth, body: new Uint8Array([1, 2, 3]) })).status).toBe(200);
		expect(new Uint8Array(await (await call(env, '/sync', { headers: auth })).arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
		expect((await call(env, '/sync', { headers: { Authorization: 'Bearer nope' } })).status).toBe(403);
	});

	it('keeps blob keys out of the config, and accepts the SYNC_TOKEN secret', async () => {
		const bucket = fakeBucket();
		const env = { KURUMI_BUCKET: bucket, SYNC_TOKEN: 'manual-secret' } as unknown as Env;
		expect((await call(env, '/claim', { method: 'POST' })).status).toBe(409);
		const auth = { Authorization: 'Bearer manual-secret' };
		await call(env, '/sync?key=../kurumi-config/tokens.json', { method: 'PUT', headers: auth, body: 'x' });
		expect(bucket.objects.has('kurumi-config/tokens.json')).toBe(false);
		expect([...bucket.objects.keys()][0]).toMatch(/^kurumi-blobs\//);
	});
});
