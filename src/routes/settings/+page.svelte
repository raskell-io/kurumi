<script lang="ts">
	import { exportNotesJSON, exportFullJSON, analyzeImport, importJSON, notes, folders, vaults, type ImportAnalysis, type ConflictResolution } from '$lib/db';
	import { syncState, initSyncState, sync, testConnection, isSyncConfigured } from '$lib/sync';
	import {
		type AIProvider,
		AVAILABLE_MODELS,
		DEFAULT_MODELS,
		getStoredProvider,
		getStoredModel,
		getStoredApiKey,
		saveAISettings,
		isAIConfigured,
		testConnection as testAIConnection
	} from '$lib/ai';
	import { onMount } from 'svelte';
	import { Monitor, Sun, Moon, Upload, Download, AlertTriangle, Check, X, Trash2, RefreshCw, CheckCircle, XCircle, Wifi, Sparkles, Bot, ChevronDown, Database, Cloud, Lock, Shield, BookOpen, Palette, HardDrive, Info } from 'lucide-svelte';

	let syncToken = $state(typeof localStorage !== 'undefined' ? localStorage.getItem('kurumi-sync-token') || '' : '');
	let syncUrl = $state(typeof localStorage !== 'undefined' ? localStorage.getItem('kurumi-sync-url') || '' : '');
	let showSaved = $state(false);
	let theme = $state<'system' | 'light' | 'dark'>('system');

	// Import state
	let showImportModal = $state(false);
	let importFileContent = $state<string | null>(null);
	let importAnalysis = $state<ImportAnalysis | null>(null);
	let importError = $state<string | null>(null);
	let isImporting = $state(false);
	let importSuccess = $state<{ vaults: number; folders: number; notes: number } | null>(null);
	let fileInputRef: HTMLInputElement;

	// Clear data state
	let showClearConfirm1 = $state(false);
	let showClearConfirm2 = $state(false);
	let clearConfirmText = $state('');
	let isClearing = $state(false);

	// Sync test state
	let isTesting = $state(false);
	let testResult = $state<{ success: boolean; error?: string } | null>(null);

	// AI settings state
	let aiProvider = $state<AIProvider>('openai');
	let openaiKey = $state('');
	let anthropicKey = $state('');
	let aiModel = $state('');
	let showAISaved = $state(false);
	let isTestingAI = $state(false);
	let aiTestResult = $state<{ success: boolean; error?: string } | null>(null);

	// Documentation sections state
	let showSyncDocs = $state(false);
	let showArchDocs = $state(false);

	// Collapsible sections state
	let sections = $state({
		appearance: true,
		sync: false,
		ai: false,
		data: false,
		danger: false,
		about: false
	});

	function toggleSection(section: keyof typeof sections) {
		sections[section] = !sections[section];
	}

	onMount(() => {
		const savedTheme = localStorage.getItem('kurumi-theme') as 'system' | 'light' | 'dark' | null;
		if (savedTheme) {
			theme = savedTheme;
		}
		initSyncState();

		// Load AI settings
		aiProvider = getStoredProvider();
		openaiKey = getStoredApiKey('openai');
		anthropicKey = getStoredApiKey('anthropic');
		aiModel = getStoredModel();
	});

	function setTheme(t: 'system' | 'light' | 'dark') {
		theme = t;
		localStorage.setItem('kurumi-theme', t);
		if (t === 'system') {
			document.documentElement.classList.remove('light', 'dark');
		} else {
			document.documentElement.classList.remove('light', 'dark');
			document.documentElement.classList.add(t);
		}
	}

	function saveSyncSettings() {
		localStorage.setItem('kurumi-sync-token', syncToken);
		localStorage.setItem('kurumi-sync-url', syncUrl);
		showSaved = true;
		setTimeout(() => (showSaved = false), 2000);
	}

	async function handleTestConnection() {
		isTesting = true;
		testResult = null;
		saveSyncSettings();
		testResult = await testConnection();
		isTesting = false;
	}

	async function handleSync() {
		await sync();
	}

	function handleProviderChange(provider: AIProvider) {
		aiProvider = provider;
		// Update model to default for the new provider
		aiModel = DEFAULT_MODELS[provider];
	}

	function handleSaveAISettings() {
		saveAISettings(aiProvider, openaiKey, anthropicKey, aiModel);
		showAISaved = true;
		setTimeout(() => (showAISaved = false), 2000);
	}

	async function handleTestAI() {
		isTestingAI = true;
		aiTestResult = null;
		handleSaveAISettings();
		aiTestResult = await testAIConnection();
		isTestingAI = false;
	}

	// Derived: current API key based on provider
	let currentApiKey = $derived(aiProvider === 'openai' ? openaiKey : anthropicKey);
	let availableModels = $derived(AVAILABLE_MODELS[aiProvider]);

	function formatTimestamp(timestamp: number): string {
		const date = new Date(timestamp);
		const now = new Date();
		const diffMs = now.getTime() - date.getTime();
		const diffMins = Math.floor(diffMs / 60000);
		const diffHours = Math.floor(diffMs / 3600000);
		const diffDays = Math.floor(diffMs / 86400000);

		if (diffMins < 1) return 'Just now';
		if (diffMins < 60) return `${diffMins} minute${diffMins === 1 ? '' : 's'} ago`;
		if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
		if (diffDays < 7) return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;

		return date.toLocaleDateString();
	}

	function handleExport() {
		const json = exportFullJSON();
		const blob = new Blob([json], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `kurumi-export-${new Date().toISOString().split('T')[0]}.json`;
		a.click();
		URL.revokeObjectURL(url);
	}

	function handleFileSelect(event: Event) {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;

		const reader = new FileReader();
		reader.onload = (e) => {
			const content = e.target?.result as string;
			importFileContent = content;
			importError = null;
			importSuccess = null;

			const analysis = analyzeImport(content);
			if ('error' in analysis) {
				importError = analysis.error;
				importAnalysis = null;
			} else {
				importAnalysis = analysis;
				showImportModal = true;
			}
		};
		reader.readAsText(file);

		// Reset input so same file can be selected again
		input.value = '';
	}

	async function handleImport(resolution: ConflictResolution) {
		if (!importFileContent) return;

		isImporting = true;
		importError = null;

		const result = await importJSON(importFileContent, { conflictResolution: resolution });

		isImporting = false;

		if (result.success && result.imported) {
			importSuccess = result.imported;
			showImportModal = false;
			importFileContent = null;
			importAnalysis = null;
		} else {
			importError = result.error || 'Import failed';
		}
	}

	function closeImportModal() {
		showImportModal = false;
		importFileContent = null;
		importAnalysis = null;
		importError = null;
	}

	function triggerFileInput() {
		fileInputRef?.click();
	}

	function startClearData() {
		showClearConfirm1 = true;
		showClearConfirm2 = false;
		clearConfirmText = '';
	}

	function proceedToClearStep2() {
		showClearConfirm1 = false;
		showClearConfirm2 = true;
		clearConfirmText = '';
	}

	function cancelClear() {
		showClearConfirm1 = false;
		showClearConfirm2 = false;
		clearConfirmText = '';
	}

	async function confirmClearData() {
		if (clearConfirmText !== 'DELETE ALL') return;

		isClearing = true;
		try {
			// Delete the IndexedDB database (idb-keyval uses 'keyval-store' by default)
			await new Promise<void>((resolve, reject) => {
				const request = indexedDB.deleteDatabase('keyval-store');
				request.onsuccess = () => resolve();
				request.onerror = () => reject(request.error);
				request.onblocked = () => resolve(); // Proceed even if blocked
			});

			// Also clear localStorage preferences
			localStorage.removeItem('kurumi-theme');
			localStorage.removeItem('kurumi-sync-token');
			localStorage.removeItem('kurumi-sync-url');
			localStorage.removeItem('kurumi-sidebar-width');

			// Reload the page to reinitialize
			location.reload();
		} catch (e) {
			console.error('Failed to clear data:', e);
			isClearing = false;
		}
	}
</script>

<div class="h-full overflow-y-auto overscroll-contain p-4 md:p-6">
	<div class="mx-auto max-w-2xl">
		<h1 class="mb-6 text-xl font-bold text-[var(--color-text)] md:mb-8 md:text-2xl">Settings</h1>

		<!-- Appearance -->
		<section class="mb-4 rounded-lg border border-[var(--color-border)] overflow-hidden">
			<button
				onclick={() => toggleSection('appearance')}
				class="flex w-full items-center justify-between bg-[var(--color-bg-secondary)] px-4 py-3 text-left transition-colors hover:bg-[var(--color-border)]"
			>
				<div class="flex items-center gap-3">
					<Palette class="h-5 w-5 text-[var(--color-accent)]" />
					<div>
						<h2 class="font-semibold text-[var(--color-text)]">Appearance</h2>
						<p class="text-sm text-[var(--color-text-muted)]">Theme and display settings</p>
					</div>
				</div>
				<ChevronDown class="h-5 w-5 text-[var(--color-text-muted)] transition-transform {sections.appearance ? 'rotate-180' : ''}" />
			</button>
			{#if sections.appearance}
				<div class="border-t border-[var(--color-border)] p-4">
					<p class="mb-4 text-sm text-[var(--color-text-muted)]">
						Choose your preferred color scheme.
					</p>

					<div class="flex flex-wrap gap-2">
						<button
							onclick={() => setTheme('system')}
							class="flex items-center gap-2 rounded-lg border px-4 py-3 transition-colors {theme === 'system' ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent)]' : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-[var(--color-text-muted)]'}"
						>
							<Monitor class="h-5 w-5" />
							System
						</button>
						<button
							onclick={() => setTheme('light')}
							class="flex items-center gap-2 rounded-lg border px-4 py-3 transition-colors {theme === 'light' ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent)]' : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-[var(--color-text-muted)]'}"
						>
							<Sun class="h-5 w-5" />
							Light
						</button>
						<button
							onclick={() => setTheme('dark')}
							class="flex items-center gap-2 rounded-lg border px-4 py-3 transition-colors {theme === 'dark' ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent)]' : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-[var(--color-text-muted)]'}"
						>
							<Moon class="h-5 w-5" />
							Dark
						</button>
					</div>
				</div>
			{/if}
		</section>

		<!-- Sync -->
		<section class="mb-4 rounded-lg border border-[var(--color-border)] overflow-hidden">
			<button
				onclick={() => toggleSection('sync')}
				class="flex w-full items-center justify-between bg-[var(--color-bg-secondary)] px-4 py-3 text-left transition-colors hover:bg-[var(--color-border)]"
			>
				<div class="flex items-center gap-3">
					<Cloud class="h-5 w-5 text-[var(--color-accent)]" />
					<div>
						<h2 class="font-semibold text-[var(--color-text)]">Cloudflare Sync</h2>
						<p class="text-sm text-[var(--color-text-muted)]">Cross-device sync with R2</p>
					</div>
				</div>
				<div class="flex items-center gap-2">
					{#if isSyncConfigured()}
						<span class="flex h-2 w-2 rounded-full bg-green-500"></span>
					{/if}
					<ChevronDown class="h-5 w-5 text-[var(--color-text-muted)] transition-transform {sections.sync ? 'rotate-180' : ''}" />
				</div>
			</button>
			{#if sections.sync}
				<div class="border-t border-[var(--color-border)] p-4">
					<p class="mb-4 text-sm text-[var(--color-text-muted)]">
						Configure sync with your Cloudflare R2 Worker to access notes across devices.
					</p>

					<div class="space-y-4">
						<div>
							<label for="syncUrl" class="mb-1 block text-sm font-medium text-[var(--color-text)]">
								Sync Worker URL
							</label>
							<input
								id="syncUrl"
								type="url"
								bind:value={syncUrl}
								placeholder="https://kurumi-sync.your-domain.workers.dev/sync"
								class="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-4 py-3 text-[var(--color-text)] placeholder-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus:outline-none"
							/>
						</div>

						<div>
							<label for="syncToken" class="mb-1 block text-sm font-medium text-[var(--color-text)]">
								Sync Token
							</label>
							<input
								id="syncToken"
								type="password"
								bind:value={syncToken}
								placeholder="Your sync authentication token"
								class="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-4 py-3 text-[var(--color-text)] placeholder-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus:outline-none"
							/>
						</div>

						<div class="flex flex-col gap-3 md:flex-row">
							<button
								onclick={saveSyncSettings}
								class="rounded-lg bg-[var(--color-accent)] px-4 py-3 text-white transition-colors hover:bg-[var(--color-accent-hover)] active:scale-[0.98]"
							>
								{showSaved ? 'Saved!' : 'Save Settings'}
							</button>

							<button
								onclick={handleTestConnection}
								disabled={isTesting || !syncUrl || !syncToken}
								class="flex items-center justify-center gap-2 rounded-lg border border-[var(--color-border)] px-4 py-3 text-[var(--color-text)] transition-colors hover:bg-[var(--color-border)] disabled:opacity-50"
							>
								{#if isTesting}
									<div class="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"></div>
								{:else}
									<Wifi class="h-4 w-4" />
								{/if}
								Test Connection
							</button>
						</div>

						{#if testResult}
							<div class="flex items-center gap-2 rounded-lg px-3 py-2 text-sm {testResult.success ? 'bg-green-500/10 text-green-600 dark:text-green-400' : 'bg-red-500/10 text-red-500'}">
								{#if testResult.success}
									<CheckCircle class="h-4 w-4" />
									Connection successful
								{:else}
									<XCircle class="h-4 w-4" />
									{testResult.error || 'Connection failed'}
								{/if}
							</div>
						{/if}

						<!-- Sync Status -->
						{#if isSyncConfigured()}
							<div class="mt-4 pt-4 border-t border-[var(--color-border)]">
								<h3 class="mb-3 text-sm font-semibold text-[var(--color-text)]">Sync Status</h3>
								<div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-4">
									<div class="flex items-center justify-between">
										<div class="flex items-center gap-3">
											{#if $syncState.status === 'syncing'}
												<div class="h-3 w-3 animate-pulse rounded-full bg-amber-500"></div>
												<span class="text-[var(--color-text)]">Syncing...</span>
											{:else if $syncState.status === 'success'}
												<div class="h-3 w-3 rounded-full bg-green-500"></div>
												<span class="text-[var(--color-text)]">Synced</span>
											{:else if $syncState.status === 'error'}
												<div class="h-3 w-3 rounded-full bg-red-500"></div>
												<span class="text-red-500">{$syncState.error || 'Sync failed'}</span>
											{:else}
												<div class="h-3 w-3 rounded-full bg-[var(--color-text-muted)]"></div>
												<span class="text-[var(--color-text-muted)]">Ready to sync</span>
											{/if}
										</div>

										<button
											onclick={handleSync}
											disabled={$syncState.status === 'syncing'}
											class="flex items-center gap-2 rounded-lg bg-[var(--color-accent)] px-4 py-2 text-white transition-colors hover:bg-[var(--color-accent-hover)] disabled:opacity-50"
										>
											<RefreshCw class="h-4 w-4 {$syncState.status === 'syncing' ? 'animate-spin' : ''}" />
											Sync Now
										</button>
									</div>

									{#if $syncState.lastSyncedAt}
										<div class="mt-3 text-sm text-[var(--color-text-muted)]">
											Last synced: {formatTimestamp($syncState.lastSyncedAt)}
										</div>
									{/if}
								</div>
							</div>
						{/if}
					</div>
				</div>
			{/if}
		</section>

		<!-- AI Assistant -->
		<section class="mb-4 rounded-lg border border-[var(--color-border)] overflow-hidden">
			<button
				onclick={() => toggleSection('ai')}
				class="flex w-full items-center justify-between bg-[var(--color-bg-secondary)] px-4 py-3 text-left transition-colors hover:bg-[var(--color-border)]"
			>
				<div class="flex items-center gap-3">
					<Sparkles class="h-5 w-5 text-[var(--color-accent)]" />
					<div>
						<h2 class="font-semibold text-[var(--color-text)]">AI Assistant</h2>
						<p class="text-sm text-[var(--color-text-muted)]">OpenAI and Anthropic integration</p>
					</div>
				</div>
				<div class="flex items-center gap-2">
					{#if isAIConfigured()}
						<span class="flex h-2 w-2 rounded-full bg-green-500"></span>
					{/if}
					<ChevronDown class="h-5 w-5 text-[var(--color-text-muted)] transition-transform {sections.ai ? 'rotate-180' : ''}" />
				</div>
			</button>
			{#if sections.ai}
				<div class="border-t border-[var(--color-border)] p-4">
					<p class="mb-4 text-sm text-[var(--color-text-muted)]">
						Enable AI-powered text assistance. Select text in the editor to improve, expand, summarize, or translate.
					</p>

					<div class="space-y-4">
						<!-- Provider Selection -->
						<div>
							<label class="mb-2 block text-sm font-medium text-[var(--color-text)]">
								AI Provider
							</label>
							<div class="flex gap-2">
								<button
									onclick={() => handleProviderChange('openai')}
									class="flex flex-1 items-center justify-center gap-2 rounded-lg border px-4 py-3 transition-colors {aiProvider === 'openai' ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent)]' : 'border-[var(--color-border)] text-[var(--color-text)] hover:bg-[var(--color-border)]'}"
								>
									<Bot class="h-4 w-4" />
									OpenAI
								</button>
								<button
									onclick={() => handleProviderChange('anthropic')}
									class="flex flex-1 items-center justify-center gap-2 rounded-lg border px-4 py-3 transition-colors {aiProvider === 'anthropic' ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent)]' : 'border-[var(--color-border)] text-[var(--color-text)] hover:bg-[var(--color-border)]'}"
								>
									<Sparkles class="h-4 w-4" />
									Anthropic
								</button>
							</div>
						</div>

						<!-- API Key Input -->
						<div>
							<label for="aiApiKey" class="mb-1 block text-sm font-medium text-[var(--color-text)]">
								{aiProvider === 'openai' ? 'OpenAI' : 'Anthropic'} API Key
							</label>
							{#if aiProvider === 'openai'}
								<input
									id="aiApiKey"
									type="password"
									bind:value={openaiKey}
									placeholder="sk-..."
									class="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-4 py-3 text-[var(--color-text)] placeholder-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus:outline-none"
								/>
							{:else}
								<input
									id="aiApiKey"
									type="password"
									bind:value={anthropicKey}
									placeholder="sk-ant-..."
									class="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-4 py-3 text-[var(--color-text)] placeholder-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus:outline-none"
								/>
							{/if}
							<p class="mt-1 text-xs text-[var(--color-text-muted)]">
								{#if aiProvider === 'openai'}
									Get your API key from <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener" class="text-[var(--color-accent)] hover:underline">OpenAI Dashboard</a>
								{:else}
									Get your API key from <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener" class="text-[var(--color-accent)] hover:underline">Anthropic Console</a>
								{/if}
							</p>
						</div>

						<!-- Model Selection -->
						<div>
							<label for="aiModel" class="mb-1 block text-sm font-medium text-[var(--color-text)]">
								Model
							</label>
							<select
								id="aiModel"
								bind:value={aiModel}
								class="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-4 py-3 text-[var(--color-text)] focus:border-[var(--color-accent)] focus:outline-none"
							>
								{#each availableModels as model}
									<option value={model.id}>{model.name}</option>
								{/each}
							</select>
						</div>

						<!-- Action Buttons -->
						<div class="flex flex-col gap-3 md:flex-row">
							<button
								onclick={handleSaveAISettings}
								class="rounded-lg bg-[var(--color-accent)] px-4 py-3 text-white transition-colors hover:bg-[var(--color-accent-hover)] active:scale-[0.98]"
							>
								{showAISaved ? 'Saved!' : 'Save Settings'}
							</button>

							<button
								onclick={handleTestAI}
								disabled={isTestingAI || !currentApiKey}
								class="flex items-center justify-center gap-2 rounded-lg border border-[var(--color-border)] px-4 py-3 text-[var(--color-text)] transition-colors hover:bg-[var(--color-border)] disabled:opacity-50"
							>
								{#if isTestingAI}
									<div class="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"></div>
								{:else}
									<Sparkles class="h-4 w-4" />
								{/if}
								Test Connection
							</button>
						</div>

						{#if aiTestResult}
							<div class="flex items-center gap-2 rounded-lg px-3 py-2 text-sm {aiTestResult.success ? 'bg-green-500/10 text-green-600 dark:text-green-400' : 'bg-red-500/10 text-red-500'}">
								{#if aiTestResult.success}
									<CheckCircle class="h-4 w-4" />
									Connection successful
								{:else}
									<XCircle class="h-4 w-4" />
									{aiTestResult.error || 'Connection failed'}
								{/if}
							</div>
						{/if}
					</div>
				</div>
			{/if}
		</section>

		<!-- Data Management -->
		<section class="mb-4 rounded-lg border border-[var(--color-border)] overflow-hidden">
			<button
				onclick={() => toggleSection('data')}
				class="flex w-full items-center justify-between bg-[var(--color-bg-secondary)] px-4 py-3 text-left transition-colors hover:bg-[var(--color-border)]"
			>
				<div class="flex items-center gap-3">
					<HardDrive class="h-5 w-5 text-[var(--color-accent)]" />
					<div>
						<h2 class="font-semibold text-[var(--color-text)]">Data Management</h2>
						<p class="text-sm text-[var(--color-text-muted)]">Import, export, and backup</p>
					</div>
				</div>
				<ChevronDown class="h-5 w-5 text-[var(--color-text-muted)] transition-transform {sections.data ? 'rotate-180' : ''}" />
			</button>
			{#if sections.data}
				<div class="border-t border-[var(--color-border)] p-4">
					<p class="mb-4 text-sm text-[var(--color-text-muted)]">
						Import or export your data as JSON for backup or migration.
					</p>

					<div class="flex flex-col gap-3 md:flex-row md:items-center md:gap-4">
						<input
							type="file"
							accept=".json,application/json"
							class="hidden"
							bind:this={fileInputRef}
							onchange={handleFileSelect}
						/>
						<button
							onclick={triggerFileInput}
							class="flex w-full items-center justify-center gap-2 rounded-lg border border-[var(--color-border)] px-4 py-3 text-[var(--color-text)] transition-colors hover:bg-[var(--color-border)] active:scale-[0.98] md:w-auto"
						>
							<Upload class="h-4 w-4" />
							Import JSON
						</button>
						<button
							onclick={handleExport}
							class="flex w-full items-center justify-center gap-2 rounded-lg border border-[var(--color-border)] px-4 py-3 text-[var(--color-text)] transition-colors hover:bg-[var(--color-border)] active:scale-[0.98] md:w-auto"
						>
							<Download class="h-4 w-4" />
							Export JSON
						</button>
					</div>

					<div class="mt-3 text-sm text-[var(--color-text-muted)]">
						{$vaults.length} {$vaults.length === 1 ? 'vault' : 'vaults'} · {$folders.length} {$folders.length === 1 ? 'folder' : 'folders'} · {$notes.length} {$notes.length === 1 ? 'note' : 'notes'}
					</div>

					{#if importError && !showImportModal}
						<div class="mt-3 flex items-center gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-500">
							<AlertTriangle class="h-4 w-4 shrink-0" />
							{importError}
						</div>
					{/if}

					{#if importSuccess}
						<div class="mt-3 flex items-center gap-2 rounded-lg bg-green-500/10 px-3 py-2 text-sm text-green-600 dark:text-green-400">
							<Check class="h-4 w-4 shrink-0" />
							Imported {importSuccess.vaults} {importSuccess.vaults === 1 ? 'vault' : 'vaults'}, {importSuccess.folders} {importSuccess.folders === 1 ? 'folder' : 'folders'}, {importSuccess.notes} {importSuccess.notes === 1 ? 'note' : 'notes'}
						</div>
					{/if}
				</div>
			{/if}
		</section>

		<!-- Danger Zone -->
		<section class="mb-4 rounded-lg border border-red-500/30 overflow-hidden">
			<button
				onclick={() => toggleSection('danger')}
				class="flex w-full items-center justify-between bg-red-500/5 px-4 py-3 text-left transition-colors hover:bg-red-500/10"
			>
				<div class="flex items-center gap-3">
					<Trash2 class="h-5 w-5 text-red-500" />
					<div>
						<h2 class="font-semibold text-red-500">Danger Zone</h2>
						<p class="text-sm text-[var(--color-text-muted)]">Destructive actions</p>
					</div>
				</div>
				<ChevronDown class="h-5 w-5 text-red-500 transition-transform {sections.danger ? 'rotate-180' : ''}" />
			</button>
			{#if sections.danger}
				<div class="border-t border-red-500/30 p-4 bg-red-500/5">
					<div class="flex items-start justify-between gap-4">
						<div>
							<h3 class="font-medium text-[var(--color-text)]">Clear All Data</h3>
							<p class="mt-1 text-sm text-[var(--color-text-muted)]">
								Permanently delete all vaults, folders, and notes. This cannot be undone.
							</p>
						</div>
						<button
							onclick={startClearData}
							class="shrink-0 rounded-lg border border-red-500/50 px-4 py-2 text-sm text-red-500 transition-colors hover:bg-red-500/10"
						>
							Clear Data
						</button>
					</div>
				</div>
			{/if}
		</section>

		<!-- About & Documentation -->
		<section class="mb-4 rounded-lg border border-[var(--color-border)] overflow-hidden">
			<button
				onclick={() => toggleSection('about')}
				class="flex w-full items-center justify-between bg-[var(--color-bg-secondary)] px-4 py-3 text-left transition-colors hover:bg-[var(--color-border)]"
			>
				<div class="flex items-center gap-3">
					<Info class="h-5 w-5 text-[var(--color-accent)]" />
					<div>
						<h2 class="font-semibold text-[var(--color-text)]">About & Documentation</h2>
						<p class="text-sm text-[var(--color-text-muted)]">Version info and guides</p>
					</div>
				</div>
				<ChevronDown class="h-5 w-5 text-[var(--color-text-muted)] transition-transform {sections.about ? 'rotate-180' : ''}" />
			</button>
			{#if sections.about}
				<div class="border-t border-[var(--color-border)] p-4">
					<!-- About -->
					<div class="flex items-center gap-3 mb-4">
						<img src="/icon-192.avif" alt="Kurumi" class="h-12 w-12 rounded-lg" />
						<div>
							<h3 class="font-semibold text-[var(--color-text)]">Kurumi</h3>
							<p class="text-sm text-[var(--color-text-muted)]">
								Your local-first second brain · v0.1.0
							</p>
						</div>
					</div>
					<p class="mb-4 text-sm text-[var(--color-text-muted)]">
						Built with SvelteKit, Automerge, and Tailwind CSS. Data stored locally using IndexedDB.
					</p>

					<!-- Docs -->
					<div class="space-y-3 mt-4 pt-4 border-t border-[var(--color-border)]">
						<h3 class="text-sm font-semibold text-[var(--color-text)]">Documentation</h3>

						<!-- Sync Setup -->
						<div class="rounded-lg border border-[var(--color-border)] overflow-hidden">
							<button
								onclick={() => (showSyncDocs = !showSyncDocs)}
								class="flex w-full items-center justify-between bg-[var(--color-bg)] px-4 py-3 text-left transition-colors hover:bg-[var(--color-bg-secondary)]"
							>
								<div class="flex items-center gap-3">
									<Cloud class="h-4 w-4 text-[var(--color-accent)]" />
									<span class="text-sm font-medium text-[var(--color-text)]">Sync Setup</span>
								</div>
								<ChevronDown class="h-4 w-4 text-[var(--color-text-muted)] transition-transform {showSyncDocs ? 'rotate-180' : ''}" />
							</button>
							{#if showSyncDocs}
								<div class="border-t border-[var(--color-border)] p-4 text-sm docs-content">
									<h4>Prerequisites</h4>
									<ul>
										<li>A <a href="https://dash.cloudflare.com/sign-up" target="_blank" rel="noopener">Cloudflare account</a> (free)</li>
										<li><a href="https://mise.jdx.dev/" target="_blank" rel="noopener">mise</a> installed (<code>brew install mise</code>)</li>
									</ul>

									<h4>Step 1: Enable R2</h4>
									<ol>
										<li>Go to <a href="https://dash.cloudflare.com" target="_blank" rel="noopener">Cloudflare Dashboard</a></li>
										<li>Click <strong>R2 Object Storage</strong> in the sidebar</li>
										<li>Click <strong>Get Started</strong> or <strong>Activate R2</strong></li>
										<li>Accept the terms (no credit card required for free tier)</li>
									</ol>

									<h4>Step 2: Deploy the Worker</h4>
									<p>Clone the repo and run the setup command:</p>
									<pre><code>git clone https://github.com/raskell-io/kurumi.git
cd kurumi/worker
mise run setup</code></pre>
									<p>This will install dependencies, log you into Cloudflare, create the R2 bucket, generate a sync token, and deploy the worker.</p>

									<h4>Step 3: Configure Kurumi</h4>
									<ol>
										<li>In the <strong>Cloudflare Sync</strong> section above, enter your Worker URL</li>
										<li>Enter the sync token from Step 2</li>
										<li>Click <strong>Save Settings</strong> then <strong>Test Connection</strong></li>
									</ol>

									<h4>Cost</h4>
									<p>Cloudflare's free tier includes:</p>
									<ul>
										<li><strong>Workers:</strong> 100,000 requests/day</li>
										<li><strong>R2:</strong> 10 GB storage, 10M reads/month, 1M writes/month</li>
									</ul>
									<p>For personal use, you'll likely never exceed these limits.</p>
								</div>
							{/if}
						</div>

						<!-- Architecture -->
						<div class="rounded-lg border border-[var(--color-border)] overflow-hidden">
							<button
								onclick={() => (showArchDocs = !showArchDocs)}
								class="flex w-full items-center justify-between bg-[var(--color-bg)] px-4 py-3 text-left transition-colors hover:bg-[var(--color-bg-secondary)]"
							>
								<div class="flex items-center gap-3">
									<Shield class="h-4 w-4 text-[var(--color-accent)]" />
									<span class="text-sm font-medium text-[var(--color-text)]">Architecture & Privacy</span>
								</div>
								<ChevronDown class="h-4 w-4 text-[var(--color-text-muted)] transition-transform {showArchDocs ? 'rotate-180' : ''}" />
							</button>
							{#if showArchDocs}
								<div class="border-t border-[var(--color-border)] p-4 text-sm docs-content">
									<h4>Local-First Architecture</h4>
									<p>Your data lives on your device first, with optional sync to other devices you control.</p>

									<div class="my-4 grid grid-cols-2 gap-3">
										<div class="rounded-lg bg-[var(--color-bg-secondary)] p-3">
											<div class="flex items-center gap-2 mb-2 text-[var(--color-text)]">
												<Database class="h-4 w-4 text-[var(--color-accent)]" />
												<strong>IndexedDB</strong>
											</div>
											<p class="text-[var(--color-text-muted)]">All notes stored locally in your browser</p>
										</div>
										<div class="rounded-lg bg-[var(--color-bg-secondary)] p-3">
											<div class="flex items-center gap-2 mb-2 text-[var(--color-text)]">
												<Cloud class="h-4 w-4 text-[var(--color-accent)]" />
												<strong>Automerge CRDT</strong>
											</div>
											<p class="text-[var(--color-text-muted)]">Conflict-free sync between devices</p>
										</div>
									</div>

									<h4>Security</h4>
									<ul>
										<li><strong>HTTPS/TLS encrypted</strong> - All sync traffic is encrypted</li>
										<li><strong>Bearer token auth</strong> - Only requests with your token can access your data</li>
										<li><strong>Encrypted storage</strong> - R2 data is encrypted by Cloudflare</li>
									</ul>

									<h4>Privacy</h4>
									<div class="my-4 rounded-lg border border-green-500/30 bg-green-500/10 p-3">
										<p class="text-green-600 dark:text-green-400"><strong>What we see: Nothing.</strong></p>
										<p class="text-[var(--color-text-muted)] mt-1">No servers, no analytics, no telemetry. Kurumi is a static web app.</p>
									</div>

									<h4>Recommendations</h4>
									<ul>
										<li>Use a strong sync token: <code>openssl rand -base64 32</code></li>
										<li>Enable 2FA on your Cloudflare account</li>
										<li>Regularly export backups to JSON</li>
									</ul>
								</div>
							{/if}
						</div>
					</div>
				</div>
			{/if}
		</section>

		<!-- Bottom safe area spacer -->
		<div class="h-8 safe-bottom md:h-0"></div>
	</div>
</div>

<!-- Import Modal -->
{#if showImportModal && importAnalysis}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
		onclick={closeImportModal}
		onkeydown={(e) => e.key === 'Escape' && closeImportModal()}
		role="dialog"
		aria-modal="true"
		tabindex="-1"
	>
		<div
			class="w-full max-w-md rounded-xl bg-[var(--color-bg)] p-6 shadow-2xl"
			onclick={(e) => e.stopPropagation()}
			role="document"
		>
			<div class="mb-4 flex items-center justify-between">
				<h2 class="text-xl font-semibold text-[var(--color-text)]">Import Data</h2>
				<button
					onclick={closeImportModal}
					class="rounded-lg p-1 text-[var(--color-text-muted)] hover:bg-[var(--color-bg-secondary)]"
				>
					<X class="h-5 w-5" />
				</button>
			</div>

			<!-- Import summary -->
			<div class="mb-4 rounded-lg bg-[var(--color-bg-secondary)] p-4">
				<div class="text-sm text-[var(--color-text-muted)]">
					<p><strong class="text-[var(--color-text)]">{importAnalysis.newVaults.length + importAnalysis.vaultConflicts.length}</strong> vaults</p>
					<p><strong class="text-[var(--color-text)]">{importAnalysis.totalFolders}</strong> folders</p>
					<p><strong class="text-[var(--color-text)]">{importAnalysis.totalNotes}</strong> notes</p>
				</div>
			</div>

			{#if importAnalysis.hasConflicts}
				<!-- Conflict warning -->
				<div class="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
					<div class="flex items-start gap-2">
						<AlertTriangle class="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
						<div>
							<p class="font-medium text-amber-600 dark:text-amber-400">Vault Conflicts Detected</p>
							<p class="mt-1 text-sm text-[var(--color-text-muted)]">
								{importAnalysis.vaultConflicts.length} {importAnalysis.vaultConflicts.length === 1 ? 'vault already exists' : 'vaults already exist'}:
							</p>
							<ul class="mt-2 space-y-1 text-sm">
								{#each importAnalysis.vaultConflicts as conflict}
									<li class="text-[var(--color-text)]">• {conflict.existingVault.name}</li>
								{/each}
							</ul>
						</div>
					</div>
				</div>

				<p class="mb-4 text-sm text-[var(--color-text-muted)]">
					How would you like to handle the conflicting vaults?
				</p>

				<div class="space-y-2">
					<button
						onclick={() => handleImport('overwrite')}
						disabled={isImporting}
						class="flex w-full items-center justify-center gap-2 rounded-lg border border-[var(--color-border)] px-4 py-3 text-[var(--color-text)] transition-colors hover:bg-[var(--color-bg-secondary)] disabled:opacity-50"
					>
						{#if isImporting}
							<div class="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"></div>
						{/if}
						Overwrite existing vaults
					</button>
					<button
						onclick={() => handleImport('duplicate')}
						disabled={isImporting}
						class="flex w-full items-center justify-center gap-2 rounded-lg border border-[var(--color-border)] px-4 py-3 text-[var(--color-text)] transition-colors hover:bg-[var(--color-bg-secondary)] disabled:opacity-50"
					>
						{#if isImporting}
							<div class="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"></div>
						{/if}
						Create duplicates with new IDs
					</button>
					<button
						onclick={() => handleImport('skip')}
						disabled={isImporting}
						class="flex w-full items-center justify-center gap-2 rounded-lg border border-[var(--color-border)] px-4 py-3 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-bg-secondary)] disabled:opacity-50"
					>
						{#if isImporting}
							<div class="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"></div>
						{/if}
						Skip conflicting vaults
					</button>
				</div>
			{:else}
				<!-- No conflicts -->
				<p class="mb-4 text-sm text-[var(--color-text-muted)]">
					No conflicts detected. Ready to import.
				</p>

				<button
					onclick={() => handleImport('skip')}
					disabled={isImporting}
					class="flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--color-accent)] px-4 py-3 text-white transition-colors hover:bg-[var(--color-accent-hover)] disabled:opacity-50"
				>
					{#if isImporting}
						<div class="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"></div>
					{/if}
					Import Data
				</button>
			{/if}

			{#if importError}
				<div class="mt-4 flex items-center gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-500">
					<AlertTriangle class="h-4 w-4 shrink-0" />
					{importError}
				</div>
			{/if}
		</div>
	</div>
{/if}

<!-- Clear Data Confirmation Step 1 -->
{#if showClearConfirm1}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
		onclick={cancelClear}
		onkeydown={(e) => e.key === 'Escape' && cancelClear()}
		role="dialog"
		aria-modal="true"
		tabindex="-1"
	>
		<div
			class="w-full max-w-md rounded-xl bg-[var(--color-bg)] p-6 shadow-2xl"
			onclick={(e) => e.stopPropagation()}
			role="document"
		>
			<div class="mb-4 flex items-center gap-3">
				<div class="flex h-12 w-12 items-center justify-center rounded-full bg-red-500/10">
					<AlertTriangle class="h-6 w-6 text-red-500" />
				</div>
				<div>
					<h2 class="text-xl font-semibold text-[var(--color-text)]">Clear All Data?</h2>
					<p class="text-sm text-[var(--color-text-muted)]">First confirmation</p>
				</div>
			</div>

			<p class="mb-4 text-[var(--color-text-muted)]">
				You are about to permanently delete all your data, including:
			</p>

			<ul class="mb-6 space-y-2 text-sm">
				<li class="flex items-center gap-2 text-[var(--color-text)]">
					<Trash2 class="h-4 w-4 text-red-500" />
					All vaults ({$vaults.length})
				</li>
				<li class="flex items-center gap-2 text-[var(--color-text)]">
					<Trash2 class="h-4 w-4 text-red-500" />
					All folders ({$folders.length})
				</li>
				<li class="flex items-center gap-2 text-[var(--color-text)]">
					<Trash2 class="h-4 w-4 text-red-500" />
					All notes ({$notes.length})
				</li>
			</ul>

			<div class="flex gap-3">
				<button
					onclick={cancelClear}
					class="flex-1 rounded-lg border border-[var(--color-border)] px-4 py-3 text-[var(--color-text)] transition-colors hover:bg-[var(--color-bg-secondary)]"
				>
					Cancel
				</button>
				<button
					onclick={proceedToClearStep2}
					class="flex-1 rounded-lg bg-red-500 px-4 py-3 text-white transition-colors hover:bg-red-600"
				>
					Continue
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- Clear Data Confirmation Step 2 -->
{#if showClearConfirm2}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
		onclick={cancelClear}
		onkeydown={(e) => e.key === 'Escape' && cancelClear()}
		role="dialog"
		aria-modal="true"
		tabindex="-1"
	>
		<div
			class="w-full max-w-md rounded-xl bg-[var(--color-bg)] p-6 shadow-2xl"
			onclick={(e) => e.stopPropagation()}
			role="document"
		>
			<div class="mb-4 flex items-center gap-3">
				<div class="flex h-12 w-12 items-center justify-center rounded-full bg-red-500/10">
					<AlertTriangle class="h-6 w-6 text-red-500" />
				</div>
				<div>
					<h2 class="text-xl font-semibold text-[var(--color-text)]">Final Confirmation</h2>
					<p class="text-sm text-[var(--color-text-muted)]">This action cannot be undone</p>
				</div>
			</div>

			<p class="mb-4 text-[var(--color-text-muted)]">
				Type <strong class="text-red-500">DELETE ALL</strong> to confirm:
			</p>

			<input
				type="text"
				bind:value={clearConfirmText}
				placeholder="DELETE ALL"
				class="mb-4 w-full rounded-lg border border-red-500/30 bg-[var(--color-bg-secondary)] px-4 py-3 text-[var(--color-text)] placeholder-[var(--color-text-muted)] focus:border-red-500 focus:outline-none"
				onkeydown={(e) => e.key === 'Enter' && clearConfirmText === 'DELETE ALL' && confirmClearData()}
			/>

			<div class="flex gap-3">
				<button
					onclick={cancelClear}
					class="flex-1 rounded-lg border border-[var(--color-border)] px-4 py-3 text-[var(--color-text)] transition-colors hover:bg-[var(--color-bg-secondary)]"
				>
					Cancel
				</button>
				<button
					onclick={confirmClearData}
					disabled={clearConfirmText !== 'DELETE ALL' || isClearing}
					class="flex flex-1 items-center justify-center gap-2 rounded-lg bg-red-500 px-4 py-3 text-white transition-colors hover:bg-red-600 disabled:opacity-50"
				>
					{#if isClearing}
						<div class="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"></div>
					{/if}
					Delete Everything
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.docs-content {
		color: var(--color-text);
		line-height: 1.6;
	}

	.docs-content h4 {
		font-weight: 600;
		margin-top: 1.25rem;
		margin-bottom: 0.5rem;
		color: var(--color-text);
	}

	.docs-content h4:first-child {
		margin-top: 0;
	}

	.docs-content p {
		margin-bottom: 0.75rem;
		color: var(--color-text-muted);
	}

	.docs-content ul,
	.docs-content ol {
		margin-bottom: 0.75rem;
		padding-left: 1.25rem;
		color: var(--color-text-muted);
	}

	.docs-content ul {
		list-style: disc;
	}

	.docs-content ol {
		list-style: decimal;
	}

	.docs-content li {
		margin-bottom: 0.375rem;
	}

	.docs-content a {
		color: var(--color-accent);
	}

	.docs-content a:hover {
		text-decoration: underline;
	}

	.docs-content code {
		background: var(--color-bg);
		padding: 0.125rem 0.375rem;
		border-radius: 0.25rem;
		font-size: 0.85em;
		font-family: var(--font-mono);
	}

	.docs-content pre {
		background: var(--color-bg);
		padding: 0.75rem 1rem;
		border-radius: 0.5rem;
		overflow-x: auto;
		margin: 0.75rem 0;
	}

	.docs-content pre code {
		background: none;
		padding: 0;
	}
</style>
