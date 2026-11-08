import { afterEach, describe, expect, it, vi } from 'vitest';
import { isNewerVersion, latestDesktopRelease } from '$lib/desktop/release';

describe('desktop release', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('compares versions by number', () => {
		expect(isNewerVersion('0.4.11', '0.4.9')).toBe(true);
		expect(isNewerVersion('0.5.0', '0.4.11')).toBe(true);
		expect(isNewerVersion('0.4.11', '0.4.11')).toBe(false);
		expect(isNewerVersion('0.4.9', '0.4.11')).toBe(false);
	});

	it('picks each platform installer from the latest release', async () => {
		const asset = (name: string) => ({ name, browser_download_url: `https://dl/${name}`, size: 24_300_000 });
		vi.stubGlobal(
			'fetch',
			vi.fn(async () =>
				Response.json({
					tag_name: 'v0.4.11',
					html_url: 'https://github.com/raskell-io/kurumi/releases/tag/v0.4.11',
					assets: [
						asset('Kurumi_0.4.11_universal.dmg'),
						asset('Kurumi_0.4.11_x64-setup.exe'),
						asset('Kurumi_0.4.11_amd64.AppImage')
					]
				})
			)
		);
		const release = await latestDesktopRelease();
		expect(release?.version).toBe('0.4.11');
		expect(release?.downloads.map((d) => d.url)).toEqual([
			'https://dl/Kurumi_0.4.11_universal.dmg',
			'https://dl/Kurumi_0.4.11_x64-setup.exe',
			'https://dl/Kurumi_0.4.11_amd64.AppImage'
		]);
	});
});
