/**
 * Git sync state management
 * Tracks sync status, last commit, and configuration
 */

import { writable } from 'svelte/store';
import type { GitProviderId } from './providers';

export type GitSyncStatus = 'idle' | 'cloning' | 'pulling' | 'pushing' | 'syncing' | 'success' | 'error';

export interface GitSyncState {
	status: GitSyncStatus;
	error: string | null;
	lastSyncedAt: number | null;
	lastCommitHash: string | null;
	progress?: {
		phase: string;
		loaded: number;
		total: number;
	};
}

export interface GitSyncConfig {
	provider: GitProviderId;
	repoUrl: string;
	branch: string;
	token: string;
	authorName: string;
	authorEmail: string;
}

const STORAGE_KEYS = {
	lastSync: 'kurumi-git-last-sync',
	lastCommit: 'kurumi-git-last-commit',
	provider: 'kurumi-git-provider',
	repoUrl: 'kurumi-git-repo-url',
	branch: 'kurumi-git-branch',
	token: 'kurumi-git-token',
	authorName: 'kurumi-git-author-name',
	authorEmail: 'kurumi-git-author-email'
};

// Initial state
const initialState: GitSyncState = {
	status: 'idle',
	error: null,
	lastSyncedAt: null,
	lastCommitHash: null
};

// Create the store
export const gitSyncState = writable<GitSyncState>(initialState);

/**
 * Initialize git sync state from localStorage
 */
export function initGitSyncState(): void {
	if (typeof localStorage === 'undefined') return;

	const lastSync = localStorage.getItem(STORAGE_KEYS.lastSync);
	const lastCommit = localStorage.getItem(STORAGE_KEYS.lastCommit);

	gitSyncState.update((state) => ({
		...state,
		lastSyncedAt: lastSync ? parseInt(lastSync, 10) : null,
		lastCommitHash: lastCommit
	}));
}

/**
 * Set syncing status with optional phase info
 */
export function setGitSyncing(phase?: string): void {
	gitSyncState.update((state) => ({
		...state,
		status: 'syncing',
		error: null,
		progress: phase ? { phase, loaded: 0, total: 0 } : undefined
	}));
}

/**
 * Set cloning status
 */
export function setGitCloning(): void {
	gitSyncState.update((state) => ({
		...state,
		status: 'cloning',
		error: null
	}));
}

/**
 * Set pulling status
 */
export function setGitPulling(): void {
	gitSyncState.update((state) => ({
		...state,
		status: 'pulling',
		error: null
	}));
}

/**
 * Set pushing status
 */
export function setGitPushing(): void {
	gitSyncState.update((state) => ({
		...state,
		status: 'pushing',
		error: null
	}));
}

/**
 * Update progress
 */
export function setGitProgress(phase: string, loaded: number, total: number): void {
	gitSyncState.update((state) => ({
		...state,
		progress: { phase, loaded, total }
	}));
}

/**
 * Set sync success
 */
export function setGitSyncSuccess(commitHash?: string): void {
	const now = Date.now();

	if (typeof localStorage !== 'undefined') {
		localStorage.setItem(STORAGE_KEYS.lastSync, now.toString());
		if (commitHash) {
			localStorage.setItem(STORAGE_KEYS.lastCommit, commitHash);
		}
	}

	gitSyncState.update((state) => ({
		...state,
		status: 'success',
		error: null,
		lastSyncedAt: now,
		lastCommitHash: commitHash ?? state.lastCommitHash,
		progress: undefined
	}));
}

/**
 * Set sync error
 */
export function setGitSyncError(error: string): void {
	gitSyncState.update((state) => ({
		...state,
		status: 'error',
		error,
		progress: undefined
	}));
}

/**
 * Reset to idle
 */
export function setGitIdle(): void {
	gitSyncState.update((state) => ({
		...state,
		status: 'idle',
		error: null,
		progress: undefined
	}));
}

// Configuration management

/**
 * Get stored git sync configuration
 */
export function getGitSyncConfig(): GitSyncConfig | null {
	if (typeof localStorage === 'undefined') return null;

	const provider = localStorage.getItem(STORAGE_KEYS.provider) as GitProviderId | null;
	const repoUrl = localStorage.getItem(STORAGE_KEYS.repoUrl);
	const token = localStorage.getItem(STORAGE_KEYS.token);

	if (!provider || !repoUrl || !token) return null;

	return {
		provider,
		repoUrl,
		branch: localStorage.getItem(STORAGE_KEYS.branch) || 'main',
		token,
		authorName: localStorage.getItem(STORAGE_KEYS.authorName) || 'Kurumi',
		authorEmail: localStorage.getItem(STORAGE_KEYS.authorEmail) || 'kurumi@localhost'
	};
}

/**
 * Save git sync configuration
 */
export function saveGitSyncConfig(config: GitSyncConfig): void {
	if (typeof localStorage === 'undefined') return;

	localStorage.setItem(STORAGE_KEYS.provider, config.provider);
	localStorage.setItem(STORAGE_KEYS.repoUrl, config.repoUrl);
	localStorage.setItem(STORAGE_KEYS.branch, config.branch);
	localStorage.setItem(STORAGE_KEYS.token, config.token);
	localStorage.setItem(STORAGE_KEYS.authorName, config.authorName);
	localStorage.setItem(STORAGE_KEYS.authorEmail, config.authorEmail);
}

/**
 * Clear git sync configuration
 */
export function clearGitSyncConfig(): void {
	if (typeof localStorage === 'undefined') return;

	for (const key of Object.values(STORAGE_KEYS)) {
		localStorage.removeItem(key);
	}

	gitSyncState.set(initialState);
}

/**
 * Check if git sync is configured
 */
export function isGitSyncConfigured(): boolean {
	return getGitSyncConfig() !== null;
}
