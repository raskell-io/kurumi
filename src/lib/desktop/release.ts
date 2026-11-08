/**
 * The desktop app's downloads: the latest GitHub release (desktop.yml
 * attaches the installers to it), which file fits this computer, and
 * whether the running desktop app is older.
 */

export const RELEASES_URL = 'https://github.com/raskell-io/kurumi/releases';
export const LATEST_RELEASE_URL = `${RELEASES_URL}/latest`;
const API_URL = 'https://api.github.com/repos/raskell-io/kurumi/releases/latest';

export type DesktopOS = 'mac' | 'windows' | 'linux';

export interface DesktopDownload {
	os: DesktopOS;
	label: string;
	note: string;
	/** The installer itself, or the release page when it isn't known. */
	url: string;
	size?: number;
}

export interface DesktopRelease {
	version: string;
	url: string;
	downloads: DesktopDownload[];
}

const PLATFORMS: { os: DesktopOS; label: string; note: string; match: RegExp }[] = [
	{ os: 'mac', label: 'macOS', note: 'Apple Silicon and Intel · .dmg', match: /universal\.dmg$/ },
	{ os: 'windows', label: 'Windows', note: '64-bit installer · .exe', match: /x64-setup\.exe$/ },
	{ os: 'linux', label: 'Linux', note: 'AppImage, runs on most distributions', match: /\.AppImage$/ }
];

/** Links to the release page, for before (or without) the lookup. */
export const FALLBACK_DOWNLOADS: DesktopDownload[] = PLATFORMS.map(({ os, label, note }) => ({
	os,
	label,
	note,
	url: LATEST_RELEASE_URL
}));

let cached: Promise<DesktopRelease | null> | null = null;

/** The latest release, or null when GitHub can't be reached. Asked once per session. */
export function latestDesktopRelease(): Promise<DesktopRelease | null> {
	cached ??= (async () => {
		try {
			const res = await fetch(API_URL, { headers: { Accept: 'application/vnd.github+json' } });
			if (!res.ok) return null;
			const data = (await res.json()) as {
				tag_name: string;
				html_url: string;
				assets: { name: string; browser_download_url: string; size: number }[];
			};
			return {
				version: data.tag_name.replace(/^v/, ''),
				url: data.html_url,
				downloads: PLATFORMS.map(({ os, label, note, match }) => {
					const asset = data.assets.find((a) => match.test(a.name));
					return { os, label, note, url: asset?.browser_download_url ?? data.html_url, size: asset?.size };
				})
			};
		} catch {
			return null;
		}
	})().then((release) => {
		if (!release) cached = null; // try again next time
		return release;
	});
	return cached;
}

/** The computer this page runs on, if it's one the desktop app is built for. */
export function detectDesktopOS(): DesktopOS | null {
	if (typeof navigator === 'undefined') return null;
	const ua = navigator.userAgent;
	if (/iPhone|iPad|iPod|Android/.test(ua)) return null;
	if (/Macintosh/.test(ua)) return navigator.maxTouchPoints > 1 ? null : 'mac';
	if (/Windows/.test(ua)) return 'windows';
	if (/Linux|X11/.test(ua)) return 'linux';
	return null;
}

/** a > b for x.y.z versions. */
export function isNewerVersion(a: string, b: string): boolean {
	const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
	const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
	for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
		const d = (pa[i] ?? 0) - (pb[i] ?? 0);
		if (d) return d > 0;
	}
	return false;
}

export function formatSize(bytes: number): string {
	return `${Math.round(bytes / 1e6)} MB`;
}
