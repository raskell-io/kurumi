/**
 * Git provider configurations for GitHub, GitLab, and Codeberg
 */

export type GitProviderId = 'github' | 'gitlab' | 'codeberg';

export interface GitProvider {
	id: GitProviderId;
	name: string;
	host: string;
	tokenUrl: string;
	tokenHelp: string;
	repoUrlPattern: RegExp;
	exampleUrl: string;
}

export const GIT_PROVIDERS: Record<GitProviderId, GitProvider> = {
	github: {
		id: 'github',
		name: 'GitHub',
		host: 'github.com',
		tokenUrl: 'https://github.com/settings/tokens/new',
		tokenHelp: 'Create a fine-grained token with "Contents" read/write access',
		repoUrlPattern: /^https:\/\/github\.com\/[\w-]+\/[\w.-]+(?:\.git)?$/,
		exampleUrl: 'https://github.com/your-username/kurumi-notes'
	},
	gitlab: {
		id: 'gitlab',
		name: 'GitLab',
		host: 'gitlab.com',
		tokenUrl: 'https://gitlab.com/-/user_settings/personal_access_tokens',
		tokenHelp: 'Create a token with "api" or "write_repository" scope',
		repoUrlPattern: /^https:\/\/gitlab\.com\/[\w-]+\/[\w.-]+(?:\.git)?$/,
		exampleUrl: 'https://gitlab.com/your-username/kurumi-notes'
	},
	codeberg: {
		id: 'codeberg',
		name: 'Codeberg',
		host: 'codeberg.org',
		tokenUrl: 'https://codeberg.org/user/settings/applications',
		tokenHelp: 'Create an access token with "repository" scope',
		repoUrlPattern: /^https:\/\/codeberg\.org\/[\w-]+\/[\w.-]+(?:\.git)?$/,
		exampleUrl: 'https://codeberg.org/your-username/kurumi-notes'
	}
};

/**
 * CORS proxy for git operations
 * isomorphic-git needs this to bypass CORS restrictions
 */
export const CORS_PROXY = 'https://cors.isomorphic-git.org';

/**
 * Detect provider from repository URL
 */
export function detectProvider(url: string): GitProviderId | null {
	const lowerUrl = url.toLowerCase();
	if (lowerUrl.includes('github.com')) return 'github';
	if (lowerUrl.includes('gitlab.com')) return 'gitlab';
	if (lowerUrl.includes('codeberg.org')) return 'codeberg';
	return null;
}

/**
 * Validate repository URL format
 */
export function validateRepoUrl(url: string, providerId: GitProviderId): boolean {
	const provider = GIT_PROVIDERS[providerId];
	return provider.repoUrlPattern.test(url);
}

/**
 * Normalize repository URL (ensure no trailing .git, add https:// if missing)
 */
export function normalizeRepoUrl(url: string): string {
	let normalized = url.trim();

	// Add https:// if missing
	if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
		normalized = `https://${normalized}`;
	}

	// Remove trailing .git
	if (normalized.endsWith('.git')) {
		normalized = normalized.slice(0, -4);
	}

	// Remove trailing slash
	if (normalized.endsWith('/')) {
		normalized = normalized.slice(0, -1);
	}

	return normalized;
}

/**
 * Get the git URL for cloning (with .git suffix)
 */
export function getCloneUrl(url: string): string {
	const normalized = normalizeRepoUrl(url);
	return `${normalized}.git`;
}

/**
 * Extract owner and repo name from URL
 */
export function parseRepoUrl(url: string): { owner: string; repo: string } | null {
	const normalized = normalizeRepoUrl(url);
	const match = normalized.match(/https:\/\/[^/]+\/([^/]+)\/([^/]+)/);
	if (!match) return null;
	return { owner: match[1], repo: match[2] };
}
