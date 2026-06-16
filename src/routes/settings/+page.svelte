<script lang="ts">
	import {
		exportMemoryObjectsJSON,
		exportFullJSON,
		analyzeImport,
		importJSON,
		memoryObjects,
		folders,
		vaults,
		currentVaultId,
		type ImportAnalysis,
		type ConflictResolution
	} from '$lib/db';
	import { exportVaultAsMarkdown, type MarkdownExportFormat } from '$lib/utils/markdown-export';
	import { importObsidianVault, type ObsidianImportResult } from '$lib/utils/obsidian-import';
	import { importRoamJSON, type RoamImportResult } from '$lib/utils/roam-import';
	import { importEvernoteEnex, type EvernoteImportResult } from '$lib/utils/evernote-import';
	import { generateBookmarklet } from '$lib/utils/web-clipper';
	import {
		syncState, initSyncState, sync, testConnection,
		testS3Connection, testWebDAVConnection, testLocalFSConnection, testAzureBlobConnection,
		isSyncConfigured, getSyncMethod, setSyncMethod,
		getMirrorMethods, setMirrorMethods, isMethodConfigured,
		isR2SyncConfigured, type SyncMethod
	} from '$lib/sync';
	import { getS3Config, saveS3Config, isS3Configured, type S3Config } from '$lib/sync/s3';
	import { getWebDAVConfig, saveWebDAVConfig, isWebDAVConfigured } from '$lib/sync/webdav';
	import { isLocalFSSupported, hasLocalFSHandle, pickLocalFSDirectory, clearLocalFSHandle } from '$lib/sync/local-fs';
	import { getAzureBlobConfig, saveAzureBlobConfig, isAzureBlobConfigured } from '$lib/sync/azure-blob';
	import {
		gitSyncState,
		initGitSyncState,
		getGitSyncConfig,
		saveGitSyncConfig,
		isGitSyncConfigured,
		testGitConnection,
		GIT_PROVIDERS,
		type GitProviderId,
		type GitSyncConfig
	} from '$lib/git';
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
	import {
		localInferenceSettings,
		updateLocalInferenceSettings,
		whisperModelId,
		whisperModelLabel,
		textModelId,
		textModelLabel,
		embedModelId,
		embedModelLabel,
		localModelStatus,
		preloadPipeline,
		clearLocalModelCache,
		type WhisperModelSize,
		type TextModelChoice,
		type EmbedModelChoice
	} from '$lib/inference';
	import { onMount } from 'svelte';
	import { Monitor, Sun, Moon, Upload, Download, AlertTriangle, Check, X, Trash2, RefreshCw, CheckCircle, XCircle, Wifi, Sparkles, ChevronDown, Database, Cloud, Lock, Shield, BookOpen, Palette, HardDrive, Info, Type, GitBranch, Cpu, Bell } from 'lucide-svelte';
	import GitConflictModal from '$lib/components/GitConflictModal.svelte';
	import {
		notificationsSupported,
		notificationPermission,
		notificationsEnabled,
		setNotificationsEnabled,
		requestNotificationPermission,
		backgroundNotificationsEnabled,
		setBackgroundNotificationsEnabled,
		periodicSyncSupported,
		ensurePeriodicSyncRegistered,
		unregisterPeriodicSync
	} from '$lib/notifications';

	let syncToken = $state(typeof localStorage !== 'undefined' ? localStorage.getItem('kurumi-sync-token') || '' : '');
	let syncUrl = $state(typeof localStorage !== 'undefined' ? localStorage.getItem('kurumi-sync-url') || '' : '');

	// Mirror sync methods
	let mirrorMethods = $state<SyncMethod[]>([]);

	function loadMirrors() {
		mirrorMethods = getMirrorMethods();
	}

	function toggleMirror(method: SyncMethod) {
		if (!method) return;
		if (mirrorMethods.includes(method)) {
			mirrorMethods = mirrorMethods.filter((m) => m !== method);
		} else {
			mirrorMethods = [...mirrorMethods, method];
		}
		setMirrorMethods(mirrorMethods);
	}

	// WebDAV state
	let webdavUrl = $state('');
	let webdavUsername = $state('');
	let webdavPassword = $state('');
	let webdavTesting = $state(false);
	let webdavTestResult = $state<{ success: boolean; error?: string } | null>(null);

	function loadWebDAVConfig() {
		const config = getWebDAVConfig();
		if (config) {
			webdavUrl = config.url;
			webdavUsername = config.username;
			webdavPassword = config.password;
		}
	}

	function saveWebDAVSettings() {
		saveWebDAVConfig({ url: webdavUrl.trim(), username: webdavUsername.trim(), password: webdavPassword });
	}

	async function handleWebDAVTest() {
		webdavTesting = true;
		webdavTestResult = null;
		saveWebDAVSettings();
		webdavTestResult = await testWebDAVConnection();
		webdavTesting = false;
	}

	// Local FS state
	let localFSAvailable = $state(false);
	let localFSConfigured = $state(false);
	let localFSTesting = $state(false);
	let localFSTestResult = $state<{ success: boolean; error?: string; folder?: string } | null>(null);

	async function loadLocalFSState() {
		localFSAvailable = isLocalFSSupported();
		localFSConfigured = await hasLocalFSHandle();
	}

	async function handlePickFolder() {
		const ok = await pickLocalFSDirectory();
		localFSConfigured = ok;
		localFSTestResult = null;
	}

	async function handleClearFolder() {
		await clearLocalFSHandle();
		localFSConfigured = false;
		localFSTestResult = null;
	}

	async function handleLocalFSTest() {
		localFSTesting = true;
		localFSTestResult = null;
		localFSTestResult = await testLocalFSConnection();
		localFSTesting = false;
	}

	// Azure Blob state
	let azureAccountUrl = $state('');
	let azureContainer = $state('');
	let azureSasToken = $state('');
	let azureTesting = $state(false);
	let azureTestResult = $state<{ success: boolean; error?: string } | null>(null);

	function loadAzureBlobConfig() {
		const config = getAzureBlobConfig();
		if (config) {
			azureAccountUrl = config.accountUrl;
			azureContainer = config.container;
			azureSasToken = config.sasToken;
		}
	}

	function saveAzureBlobSettings() {
		saveAzureBlobConfig({ accountUrl: azureAccountUrl.trim(), container: azureContainer.trim(), sasToken: azureSasToken.trim() });
	}

	async function handleAzureTest() {
		azureTesting = true;
		azureTestResult = null;
		saveAzureBlobSettings();
		azureTestResult = await testAzureBlobConnection();
		azureTesting = false;
	}

	// S3 sync state
	let s3Endpoint = $state('');
	let s3Bucket = $state('');
	let s3Region = $state('us-east-1');
	let s3AccessKey = $state('');
	let s3SecretKey = $state('');
	let s3TestResult = $state<{ success: boolean; error?: string } | null>(null);
	let s3Testing = $state(false);

	function loadS3Config() {
		const config = getS3Config();
		if (config) {
			s3Endpoint = config.endpoint;
			s3Bucket = config.bucket;
			s3Region = config.region;
			s3AccessKey = config.accessKeyId;
			s3SecretKey = config.secretAccessKey;
		}
	}

	function saveS3Settings() {
		saveS3Config({
			endpoint: s3Endpoint.trim(),
			bucket: s3Bucket.trim(),
			region: s3Region.trim(),
			accessKeyId: s3AccessKey.trim(),
			secretAccessKey: s3SecretKey.trim()
		});
		showSaved = true;
		setTimeout(() => (showSaved = false), 2000);
	}

	async function handleS3Test() {
		s3Testing = true;
		s3TestResult = null;
		saveS3Settings();
		s3TestResult = await testS3Connection();
		s3Testing = false;
	}
	let showSaved = $state(false);
	let theme = $state<'system' | 'light' | 'dark'>('system');
	let editorFont = $state<'quattro' | 'geist'>('quattro');
	let editorFontSize = $state<'small' | 'medium' | 'large'>('medium');

	// Derived for the local-AI status panel
	let currentTextModelId = $derived(textModelId($localInferenceSettings.textModel));
	let textStatus = $derived(
		$localModelStatus[`text-generation:${currentTextModelId}`] ?? { state: 'idle' as const }
	);
	let currentEmbedModelId = $derived(embedModelId($localInferenceSettings.embedModel));
	let embedStatus = $derived(
		$localModelStatus[`embed:${currentEmbedModelId}`] ?? { state: 'idle' as const }
	);

	// Import state
	let showImportModal = $state(false);
	let importFileContent = $state<string | null>(null);
	let importAnalysis = $state<ImportAnalysis | null>(null);
	let importError = $state<string | null>(null);
	let isImporting = $state(false);
	let importSuccess = $state<{ vaults: number; folders: number; memoryObjects: number } | null>(
		null
	);
	let fileInputRef: HTMLInputElement | undefined = $state();

	// Clear data state
	let showClearConfirm1 = $state(false);
	let showClearConfirm2 = $state(false);
	let clearConfirmText = $state('');
	let isClearing = $state(false);

	// Git conflict modal
	let showConflictModal = $state(false);
	// Auto-open when conflicts arrive from a sync attempt.
	$effect(() => {
		if ($gitSyncState.status === 'conflict' && $gitSyncState.conflicts.length > 0) {
			showConflictModal = true;
		}
	});

	// Notifications state — refreshed on mount and when the user toggles.
	let notifEnabled = $state(false);
	let notifPermission = $state<NotificationPermission>('default');
	let notifSupported = $state(false);
	let bgNotifEnabled = $state(false);
	let bgNotifSupported = $state(false);
	let bgNotifError = $state<string | null>(null);

	async function handleNotifToggle() {
		if (!notifSupported) return;
		if (!notifEnabled) {
			// Turning on: request permission first
			const perm = await requestNotificationPermission();
			notifPermission = perm;
			if (perm === 'granted') {
				setNotificationsEnabled(true);
				notifEnabled = true;
			}
		} else {
			setNotificationsEnabled(false);
			notifEnabled = false;
		}
	}

	async function handleBackgroundNotifToggle() {
		bgNotifError = null;
		if (!bgNotifEnabled) {
			// Registering periodicsync requires the foreground notification
			// permission and the service worker to be ready. Both should
			// already be true if the user is here, but we bail cleanly on
			// any failure.
			if (Notification.permission !== 'granted') {
				const perm = await requestNotificationPermission();
				if (perm !== 'granted') {
					bgNotifError = 'Notification permission required';
					return;
				}
				notifPermission = perm;
			}
			const ok = await ensurePeriodicSyncRegistered();
			if (!ok) {
				bgNotifError =
					'Background notifications need an installed PWA and browser support (currently Chromium-only).';
				return;
			}
			setBackgroundNotificationsEnabled(true);
			bgNotifEnabled = true;
		} else {
			await unregisterPeriodicSync();
			setBackgroundNotificationsEnabled(false);
			bgNotifEnabled = false;
		}
	}

	// Sync test state
	let isTesting = $state(false);
	let testResult = $state<{ success: boolean; error?: string } | null>(null);

	// Sync method state
	let syncMethod = $state<SyncMethod>(getSyncMethod());

	// Git sync state
	let gitProvider = $state<GitProviderId>('github');
	let gitRepoUrl = $state('');
	let gitBranch = $state('main');
	let gitToken = $state('');
	let gitAuthorName = $state('Kurumi');
	let gitAuthorEmail = $state('kurumi@localhost');
	let showGitSaved = $state(false);
	let isTestingGit = $state(false);
	let gitTestResult = $state<{ success: boolean; error?: string } | null>(null);

	// AI settings state
	let aiProvider = $state<AIProvider>('openai');
	let openaiKey = $state('');
	let anthropicKey = $state('');
	let aiModel = $state('');
	let showAISaved = $state(false);
	let isTestingAI = $state(false);
	let aiTestResult = $state<{ success: boolean; error?: string } | null>(null);

	// Additional provider API keys (keyed by PROVIDER_CONFIGS[].apiKeyStorageKey)
	import { PROVIDER_CONFIGS } from '$lib/inference';
	let extraProviderKeys = $state<Record<string, string>>({});

	function loadExtraProviderKeys() {
		if (typeof localStorage === 'undefined') return;
		const keys: Record<string, string> = {};
		for (const config of PROVIDER_CONFIGS) {
			keys[config.apiKeyStorageKey] = localStorage.getItem(config.apiKeyStorageKey) || '';
		}
		extraProviderKeys = keys;
	}

	function saveExtraProviderKey(storageKey: string, value: string) {
		if (typeof localStorage === 'undefined') return;
		if (value.trim()) {
			localStorage.setItem(storageKey, value.trim());
		} else {
			localStorage.removeItem(storageKey);
		}
	}

	function saveAllExtraProviderKeys() {
		for (const config of PROVIDER_CONFIGS) {
			saveExtraProviderKey(config.apiKeyStorageKey, extraProviderKeys[config.apiKeyStorageKey] || '');
		}
	}

	// Documentation sections state
	let showSyncDocs = $state(false);
	let showArchDocs = $state(false);

	// Markdown export state
	let isExportingMarkdown = $state(false);
	let markdownExportFormat = $state<MarkdownExportFormat | null>(null);

	// Obsidian import state
	let isImportingObsidian = $state(false);
	let obsidianImportResult = $state<ObsidianImportResult | null>(null);
	let isImportingRoam = $state(false);
	let roamImportResult = $state<RoamImportResult | null>(null);
	let roamFileInputRef: HTMLInputElement | undefined = $state();
	let isImportingEvernote = $state(false);
	let evernoteImportResult = $state<EvernoteImportResult | null>(null);
	let evernoteFileInputRef: HTMLInputElement | undefined = $state();

	// Collapsible sections state
	let sections = $state({
		appearance: true,
		sync: false,
		localAi: false,
		ai: false,
		notifications: false,
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

		// Load editor font
		const savedFont = localStorage.getItem('kurumi-editor-font') as 'quattro' | 'geist' | null;
		if (savedFont) {
			editorFont = savedFont;
		}

		// Load editor font size
		const savedFontSize = localStorage.getItem('kurumi-editor-font-size') as 'small' | 'medium' | 'large' | null;
		if (savedFontSize) {
			editorFontSize = savedFontSize;
		}

		initSyncState();
		initGitSyncState();
		loadS3Config();
		loadWebDAVConfig();
		loadAzureBlobConfig();
		void loadLocalFSState();
		loadMirrors();
		loadExtraProviderKeys();

		notifSupported = notificationsSupported();
		if (notifSupported) {
			notifPermission = notificationPermission();
			notifEnabled = notificationsEnabled() && notifPermission === 'granted';
		}

		// Feature-detect periodicsync asynchronously. If it's not there
		// or the SW registration fails we just hide the background toggle.
		void (async () => {
			bgNotifSupported = await periodicSyncSupported();
			bgNotifEnabled = bgNotifSupported && backgroundNotificationsEnabled();
		})();

		// Load sync method
		syncMethod = getSyncMethod();

		// Load git sync settings
		const gitConfig = getGitSyncConfig();
		if (gitConfig) {
			gitProvider = gitConfig.provider;
			gitRepoUrl = gitConfig.repoUrl;
			gitBranch = gitConfig.branch;
			gitToken = gitConfig.token;
			gitAuthorName = gitConfig.authorName;
			gitAuthorEmail = gitConfig.authorEmail;
		}

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

	function setEditorFont(f: 'quattro' | 'geist') {
		editorFont = f;
		localStorage.setItem('kurumi-editor-font', f);
		document.documentElement.classList.remove('font-quattro', 'font-geist');
		document.documentElement.classList.add(`font-${f}`);
	}

	function setEditorFontSize(s: 'small' | 'medium' | 'large') {
		editorFontSize = s;
		localStorage.setItem('kurumi-editor-font-size', s);
		document.documentElement.classList.remove('font-size-small', 'font-size-medium', 'font-size-large');
		document.documentElement.classList.add(`font-size-${s}`);
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

	// Sync method handlers
	function handleSyncMethodChange(method: SyncMethod) {
		syncMethod = method;
		setSyncMethod(method);
	}

	// Git sync handlers
	function saveGitSettings() {
		const config: GitSyncConfig = {
			provider: gitProvider,
			repoUrl: gitRepoUrl,
			branch: gitBranch,
			token: gitToken,
			authorName: gitAuthorName,
			authorEmail: gitAuthorEmail
		};
		saveGitSyncConfig(config);
		showGitSaved = true;
		setTimeout(() => (showGitSaved = false), 2000);
	}

	async function handleTestGitConnection() {
		isTestingGit = true;
		gitTestResult = null;
		saveGitSettings();
		gitTestResult = await testGitConnection(gitProvider, gitRepoUrl, gitToken);
		isTestingGit = false;
	}

	let currentGitProvider = $derived(GIT_PROVIDERS[gitProvider]);

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

	async function handleMarkdownExport(format: MarkdownExportFormat) {
		isExportingMarkdown = true;
		markdownExportFormat = format;
		try {
			const vault = $vaults.find((v) => v.id === $currentVaultId);
			if (!vault) return;

			const vaultMemories = $memoryObjects.filter((m) => m.vaultId === vault.id);
			const vaultFolders = $folders.filter((f) => f.vaultId === vault.id);

			await exportVaultAsMarkdown(vaultMemories, vaultFolders, vault, { format });
		} finally {
			isExportingMarkdown = false;
			markdownExportFormat = null;
		}
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

	async function handleObsidianImport() {
		isImportingObsidian = true;
		obsidianImportResult = null;
		try {
			obsidianImportResult = await importObsidianVault();
		} finally {
			isImportingObsidian = false;
		}
	}

	function triggerRoamImport() {
		roamFileInputRef?.click();
	}

	async function handleRoamFileSelect(event: Event) {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		isImportingRoam = true;
		roamImportResult = null;
		try {
			roamImportResult = await importRoamJSON(file);
		} finally {
			isImportingRoam = false;
			if (roamFileInputRef) roamFileInputRef.value = '';
		}
	}

	function triggerEvernoteImport() {
		evernoteFileInputRef?.click();
	}

	async function handleEvernoteFileSelect(event: Event) {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		isImportingEvernote = true;
		evernoteImportResult = null;
		try {
			evernoteImportResult = await importEvernoteEnex(file);
		} finally {
			isImportingEvernote = false;
			if (evernoteFileInputRef) evernoteFileInputRef.value = '';
		}
	}

	let bookmarkletUrl = $state('');
	$effect(() => {
		if (typeof window !== 'undefined') {
			bookmarkletUrl = generateBookmarklet(window.location.origin);
		}
	});

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

					<!-- Editor Font -->
					<div class="mt-6 pt-4 border-t border-[var(--color-border)]">
						<h3 class="mb-2 text-sm font-medium text-[var(--color-text)]">Editor Font</h3>
						<p class="mb-4 text-sm text-[var(--color-text-muted)]">
							Choose the font for the note editor.
						</p>
						<div class="flex flex-wrap gap-2">
							<button
								onclick={() => setEditorFont('quattro')}
								class="flex items-center gap-2 rounded-lg border px-4 py-3 transition-colors {editorFont === 'quattro' ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent)]' : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-[var(--color-text-muted)]'}"
							>
								<Type class="h-5 w-5" />
								<span style="font-family: 'iA Writer Quattro S', serif">iA Quattro</span>
							</button>
							<button
								onclick={() => setEditorFont('geist')}
								class="flex items-center gap-2 rounded-lg border px-4 py-3 transition-colors {editorFont === 'geist' ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent)]' : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-[var(--color-text-muted)]'}"
							>
								<Type class="h-5 w-5" />
								<span style="font-family: 'Geist', sans-serif">Geist</span>
							</button>
						</div>
					</div>

					<!-- Editor Font Size -->
					<div class="mt-6 pt-4 border-t border-[var(--color-border)]">
						<h3 class="mb-2 text-sm font-medium text-[var(--color-text)]">Editor Font Size</h3>
						<p class="mb-4 text-sm text-[var(--color-text-muted)]">
							Adjust the text size in the editor.
						</p>
						<div class="flex flex-wrap gap-2">
							<button
								onclick={() => setEditorFontSize('small')}
								class="flex items-center gap-2 rounded-lg border px-4 py-3 transition-colors {editorFontSize === 'small' ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent)]' : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-[var(--color-text-muted)]'}"
							>
								<span class="text-sm">Small</span>
							</button>
							<button
								onclick={() => setEditorFontSize('medium')}
								class="flex items-center gap-2 rounded-lg border px-4 py-3 transition-colors {editorFontSize === 'medium' ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent)]' : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-[var(--color-text-muted)]'}"
							>
								<span>Medium</span>
							</button>
							<button
								onclick={() => setEditorFontSize('large')}
								class="flex items-center gap-2 rounded-lg border px-4 py-3 transition-colors {editorFontSize === 'large' ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent)]' : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-[var(--color-text-muted)]'}"
							>
								<span class="text-lg">Large</span>
							</button>
						</div>
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
					{#if syncMethod === 'git'}
						<GitBranch class="h-5 w-5 text-[var(--color-accent)]" />
					{:else}
						<Cloud class="h-5 w-5 text-[var(--color-accent)]" />
					{/if}
					<div>
						<h2 class="font-semibold text-[var(--color-text)]">Sync</h2>
						<p class="text-sm text-[var(--color-text-muted)]">
							{#if syncMethod === 'git'}Git repository
							{:else if syncMethod === 's3'}S3-compatible storage
							{:else if syncMethod === 'webdav'}WebDAV server
							{:else if syncMethod === 'local-fs'}Local filesystem
							{:else if syncMethod === 'azure-blob'}Azure Blob Storage
							{:else}Cloudflare R2{/if}
							{#if mirrorMethods.length > 0}
								+ {mirrorMethods.length} mirror{mirrorMethods.length === 1 ? '' : 's'}
							{/if}
						</p>
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
					<!-- Primary Sync Method -->
					<div class="mb-4">
						<span class="mb-2 block text-sm font-medium text-[var(--color-text)]">Primary sync method</span>
						<div class="grid grid-cols-3 gap-1.5">
							{#each [
								{ id: 'r2', label: 'R2', icon: 'cloud' },
								{ id: 'git', label: 'Git', icon: 'git' },
								{ id: 's3', label: 'S3', icon: 'db' },
								{ id: 'webdav', label: 'WebDAV', icon: 'cloud' },
								{ id: 'local-fs', label: 'Local', icon: 'db' },
								{ id: 'azure-blob', label: 'Azure', icon: 'cloud' }
							] as item (item.id)}
								<button
									onclick={() => handleSyncMethodChange(item.id as SyncMethod)}
									class="flex items-center justify-center gap-1.5 rounded-lg border px-2 py-2.5 text-xs font-medium transition-colors {syncMethod === item.id ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent)]' : 'border-[var(--color-border)] text-[var(--color-text)] hover:bg-[var(--color-border)]'}"
								>
									{item.label}
								</button>
							{/each}
						</div>
					</div>

					<!-- Mirror methods -->
					<div class="mb-4">
						<span class="mb-1 block text-sm font-medium text-[var(--color-text)]">Mirror targets</span>
						<p class="mb-2 text-xs text-[var(--color-text-muted)]">
							After syncing with the primary, push the same state to these mirrors.
							Mirrors are one-way — the primary is always the source of truth.
						</p>
						<div class="flex flex-wrap gap-1.5">
							{#each ['r2', 's3', 'webdav', 'local-fs', 'azure-blob'] as method (method)}
								{#if method !== syncMethod}
									<button
										onclick={() => toggleMirror(method as SyncMethod)}
										class="rounded-lg border px-2.5 py-1.5 text-xs transition-colors {mirrorMethods.includes(method as SyncMethod) ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent)]' : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}"
									>
										{method === 'r2' ? 'R2' : method === 's3' ? 'S3' : method === 'webdav' ? 'WebDAV' : method === 'local-fs' ? 'Local FS' : 'Azure'}
									</button>
								{/if}
							{/each}
						</div>
					</div>

					{#if syncMethod === 'webdav'}
						<!-- WebDAV Configuration -->
						<div class="space-y-4">
							<p class="text-sm text-[var(--color-text-muted)]">
								Sync via WebDAV — works with Nextcloud, ownCloud, Synology, and any
								WebDAV server. CORS must be configured on the server.
							</p>
							<div>
								<span class="mb-1 block text-sm text-[var(--color-text)]">WebDAV URL</span>
								<input type="text" bind:value={webdavUrl} placeholder="https://cloud.example.com/remote.php/dav/files/user"
									class="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)] focus:border-[var(--color-accent)] focus:outline-none" />
							</div>
							<div class="grid grid-cols-2 gap-3">
								<div>
									<span class="mb-1 block text-sm text-[var(--color-text)]">Username</span>
									<input type="text" bind:value={webdavUsername} placeholder="user"
										class="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)] focus:border-[var(--color-accent)] focus:outline-none" />
								</div>
								<div>
									<span class="mb-1 block text-sm text-[var(--color-text)]">Password</span>
									<input type="password" bind:value={webdavPassword} placeholder="••••••"
										class="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)] focus:border-[var(--color-accent)] focus:outline-none" />
								</div>
							</div>
							<div class="flex gap-2">
								<button onclick={saveWebDAVSettings} class="flex items-center gap-2 rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm text-white">Save</button>
								<button onclick={handleWebDAVTest} disabled={webdavTesting}
									class="flex items-center gap-2 rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text)] disabled:opacity-50">
									{#if webdavTesting}<div class="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"></div>{/if}
									Test
								</button>
							</div>
							{#if webdavTestResult}
								<div class="flex items-center gap-2 rounded-lg px-3 py-2 text-sm {webdavTestResult.success ? 'bg-green-500/10 text-green-600 dark:text-green-400' : 'bg-red-500/10 text-red-500'}">
									{webdavTestResult.success ? '✓ Connected' : webdavTestResult.error}
								</div>
							{/if}
						</div>
					{:else if syncMethod === 'local-fs'}
						<!-- Local Filesystem Configuration -->
						<div class="space-y-4">
							<p class="text-sm text-[var(--color-text-muted)]">
								Sync to a local folder. Put it inside Dropbox, iCloud, OneDrive, or
								Syncthing — Kurumi writes a file, your cloud sync handles the rest.
								Chrome/Edge only.
							</p>
							{#if !localFSAvailable}
								<p class="text-sm text-red-500">
									File System Access API not available in this browser. Use Chrome or Edge.
								</p>
							{:else if localFSConfigured}
								<div class="flex flex-wrap items-center gap-3">
									<span class="flex h-2 w-2 rounded-full bg-green-500"></span>
									<span class="text-sm text-[var(--color-text)]">Folder selected</span>
									<button onclick={handleLocalFSTest} disabled={localFSTesting}
										class="flex items-center gap-2 rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-text)] hover:bg-[var(--color-border)] disabled:opacity-50">
										{#if localFSTesting}<div class="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent"></div>{/if}
										Test
									</button>
									<button onclick={handleClearFolder}
										class="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-text-muted)] hover:bg-[var(--color-border)]">
										Change folder
									</button>
								</div>
								{#if localFSTestResult}
									<div class="flex items-center gap-2 rounded-lg px-3 py-2 text-sm {localFSTestResult.success ? 'bg-green-500/10 text-green-600 dark:text-green-400' : 'bg-red-500/10 text-red-500'}">
										{localFSTestResult.success
											? `✓ Writable${localFSTestResult.folder ? ` — ${localFSTestResult.folder}` : ''}`
											: localFSTestResult.error}
									</div>
								{/if}
								<div class="mt-2 flex items-center gap-3">
									<button onclick={handleSync} disabled={$syncState.status === 'syncing'}
										class="flex items-center gap-2 rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm text-white transition-colors hover:bg-[var(--color-accent-hover)] disabled:opacity-50">
										<RefreshCw class="h-4 w-4 {$syncState.status === 'syncing' ? 'animate-spin' : ''}" />
										Sync now
									</button>
									{#if $syncState.status === 'error'}
										<span class="text-sm text-red-500">{$syncState.error || 'Sync failed'}</span>
									{:else if $syncState.lastSyncedAt}
										<span class="text-sm text-[var(--color-text-muted)]">Last synced: {formatTimestamp($syncState.lastSyncedAt)}</span>
									{/if}
								</div>
								<p class="text-xs text-[var(--color-text-muted)]">
									Kurumi writes a single file (<code>kurumi-sync.bin</code>) holding your
									whole library — let a cloud client (Dropbox, iCloud, Syncthing…) sync the folder.
								</p>
							{:else}
								<button onclick={handlePickFolder}
									class="flex items-center gap-2 rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm text-white">
									<HardDrive class="h-4 w-4" />
									Pick folder
								</button>
							{/if}
						</div>
					{:else if syncMethod === 'azure-blob'}
						<!-- Azure Blob Configuration -->
						<div class="space-y-4">
							<p class="text-sm text-[var(--color-text-muted)]">
								Sync via Azure Blob Storage with a SAS token. Generate one in
								the Azure Portal with Read + Write + Create permissions.
							</p>
							<div>
								<span class="mb-1 block text-sm text-[var(--color-text)]">Account URL</span>
								<input type="text" bind:value={azureAccountUrl} placeholder="https://myaccount.blob.core.windows.net"
									class="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)] focus:border-[var(--color-accent)] focus:outline-none" />
							</div>
							<div>
								<span class="mb-1 block text-sm text-[var(--color-text)]">Container</span>
								<input type="text" bind:value={azureContainer} placeholder="kurumi"
									class="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)] focus:border-[var(--color-accent)] focus:outline-none" />
							</div>
							<div>
								<span class="mb-1 block text-sm text-[var(--color-text)]">SAS Token</span>
								<input type="password" bind:value={azureSasToken} placeholder="?sv=2023-11-03&ss=b&srt=sco&..."
									class="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 font-mono text-xs text-[var(--color-text)] focus:border-[var(--color-accent)] focus:outline-none" />
							</div>
							<div class="flex gap-2">
								<button onclick={saveAzureBlobSettings} class="flex items-center gap-2 rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm text-white">Save</button>
								<button onclick={handleAzureTest} disabled={azureTesting}
									class="flex items-center gap-2 rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text)] disabled:opacity-50">
									{#if azureTesting}<div class="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"></div>{/if}
									Test
								</button>
							</div>
							{#if azureTestResult}
								<div class="flex items-center gap-2 rounded-lg px-3 py-2 text-sm {azureTestResult.success ? 'bg-green-500/10 text-green-600 dark:text-green-400' : 'bg-red-500/10 text-red-500'}">
									{azureTestResult.success ? '✓ Connected' : azureTestResult.error}
								</div>
							{/if}
						</div>
					{:else if syncMethod === 's3'}
						<!-- S3 Sync Configuration -->
						<div class="space-y-4">
							<p class="text-sm text-[var(--color-text-muted)]">
								Sync via any S3-compatible storage: AWS S3, MinIO, Backblaze B2,
								DigitalOcean Spaces, Wasabi, Cloudflare R2 (S3 API). CORS must be
								configured on the bucket.
							</p>

							<div>
								<span class="mb-1 block text-sm text-[var(--color-text)]">Endpoint URL</span>
								<input
									type="text"
									bind:value={s3Endpoint}
									placeholder="https://s3.us-east-1.amazonaws.com"
									class="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)] focus:border-[var(--color-accent)] focus:outline-none"
								/>
							</div>

							<div class="grid grid-cols-2 gap-3">
								<div>
									<span class="mb-1 block text-sm text-[var(--color-text)]">Bucket</span>
									<input
										type="text"
										bind:value={s3Bucket}
										placeholder="my-kurumi-bucket"
										class="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)] focus:border-[var(--color-accent)] focus:outline-none"
									/>
								</div>
								<div>
									<span class="mb-1 block text-sm text-[var(--color-text)]">Region</span>
									<input
										type="text"
										bind:value={s3Region}
										placeholder="us-east-1"
										class="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)] focus:border-[var(--color-accent)] focus:outline-none"
									/>
								</div>
							</div>

							<div>
								<span class="mb-1 block text-sm text-[var(--color-text)]">Access Key ID</span>
								<input
									type="text"
									bind:value={s3AccessKey}
									placeholder="AKIAIOSFODNN7EXAMPLE"
									class="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)] font-mono focus:border-[var(--color-accent)] focus:outline-none"
								/>
							</div>

							<div>
								<span class="mb-1 block text-sm text-[var(--color-text)]">Secret Access Key</span>
								<input
									type="password"
									bind:value={s3SecretKey}
									placeholder="wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
									class="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)] font-mono focus:border-[var(--color-accent)] focus:outline-none"
								/>
							</div>

							<div class="flex gap-2">
								<button
									onclick={saveS3Settings}
									class="flex items-center gap-2 rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm text-white transition-colors hover:bg-[var(--color-accent-hover)]"
								>
									Save
								</button>
								<button
									onclick={handleS3Test}
									disabled={s3Testing}
									class="flex items-center gap-2 rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text)] transition-colors hover:bg-[var(--color-border)] disabled:opacity-50"
								>
									{#if s3Testing}
										<div class="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"></div>
									{/if}
									Test Connection
								</button>
							</div>

							{#if s3TestResult}
								<div class="flex items-center gap-2 rounded-lg px-3 py-2 text-sm {s3TestResult.success ? 'bg-green-500/10 text-green-600 dark:text-green-400' : 'bg-red-500/10 text-red-500'}">
									{#if s3TestResult.success}
										<Check class="h-4 w-4" />
										Connection successful
									{:else}
										<AlertTriangle class="h-4 w-4" />
										{s3TestResult.error}
									{/if}
								</div>
							{/if}
						</div>
					{:else if syncMethod === 'git'}
						<!-- Git Sync Configuration -->
						<div class="space-y-4">
							<p class="text-sm text-[var(--color-text-muted)]">
								Sync notes as markdown files to a Git repository. Works with GitHub, GitLab, and Codeberg.
							</p>

							<!-- Provider Selection -->
							<div>
								<span class="mb-2 block text-sm font-medium text-[var(--color-text)]">Provider</span>
								<div class="flex gap-2">
									{#each Object.values(GIT_PROVIDERS) as provider}
										<button
											onclick={() => (gitProvider = provider.id)}
											class="flex flex-1 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors {gitProvider === provider.id ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent)]' : 'border-[var(--color-border)] text-[var(--color-text)] hover:bg-[var(--color-border)]'}"
										>
											{provider.name}
										</button>
									{/each}
								</div>
							</div>

							<!-- Repository URL -->
							<div>
								<label for="gitRepoUrl" class="mb-1 block text-sm font-medium text-[var(--color-text)]">
									Repository URL
								</label>
								<input
									id="gitRepoUrl"
									type="url"
									bind:value={gitRepoUrl}
									placeholder={currentGitProvider.exampleUrl}
									class="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-4 py-3 text-[var(--color-text)] placeholder-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus:outline-none"
								/>
							</div>

							<!-- Branch -->
							<div>
								<label for="gitBranch" class="mb-1 block text-sm font-medium text-[var(--color-text)]">
									Branch
								</label>
								<input
									id="gitBranch"
									type="text"
									bind:value={gitBranch}
									placeholder="main"
									class="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-4 py-3 text-[var(--color-text)] placeholder-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus:outline-none"
								/>
							</div>

							<!-- Personal Access Token -->
							<div>
								<label for="gitToken" class="mb-1 block text-sm font-medium text-[var(--color-text)]">
									Personal Access Token
								</label>
								<input
									id="gitToken"
									type="password"
									bind:value={gitToken}
									placeholder="ghp_xxxx..."
									class="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-4 py-3 text-[var(--color-text)] placeholder-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus:outline-none"
								/>
								<p class="mt-1 text-xs text-[var(--color-text-muted)]">
									<a href={currentGitProvider.tokenUrl} target="_blank" rel="noopener" class="text-[var(--color-accent)] hover:underline">
										Create a token
									</a> · {currentGitProvider.tokenHelp}
								</p>
							</div>

							<!-- Action Buttons -->
							<div class="flex flex-col gap-3 md:flex-row">
								<button
									onclick={saveGitSettings}
									class="rounded-lg bg-[var(--color-accent)] px-4 py-3 text-white transition-colors hover:bg-[var(--color-accent-hover)] active:scale-[0.98]"
								>
									{showGitSaved ? 'Saved!' : 'Save Settings'}
								</button>

								<button
									onclick={handleTestGitConnection}
									disabled={isTestingGit || !gitRepoUrl || !gitToken}
									class="flex items-center justify-center gap-2 rounded-lg border border-[var(--color-border)] px-4 py-3 text-[var(--color-text)] transition-colors hover:bg-[var(--color-border)] disabled:opacity-50"
								>
									{#if isTestingGit}
										<div class="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"></div>
									{:else}
										<Wifi class="h-4 w-4" />
									{/if}
									Test Connection
								</button>
							</div>

							{#if gitTestResult}
								<div class="flex items-center gap-2 rounded-lg px-3 py-2 text-sm {gitTestResult.success ? 'bg-green-500/10 text-green-600 dark:text-green-400' : 'bg-red-500/10 text-red-500'}">
									{#if gitTestResult.success}
										<CheckCircle class="h-4 w-4" />
										Connection successful
									{:else}
										<XCircle class="h-4 w-4" />
										{gitTestResult.error || 'Connection failed'}
									{/if}
								</div>
							{/if}

							<!-- Git Sync Status -->
							{#if isGitSyncConfigured()}
								<div class="mt-4 pt-4 border-t border-[var(--color-border)]">
									<h3 class="mb-3 text-sm font-semibold text-[var(--color-text)]">Sync Status</h3>
									<div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-4">
										<div class="flex items-center justify-between">
											<div class="flex items-center gap-3">
												{#if ['cloning', 'pulling', 'pushing', 'syncing'].includes($gitSyncState.status)}
													<div class="h-3 w-3 animate-pulse rounded-full bg-amber-500"></div>
													<span class="text-[var(--color-text)]">
														{$gitSyncState.status === 'cloning' ? 'Cloning...' : $gitSyncState.status === 'pulling' ? 'Pulling...' : $gitSyncState.status === 'pushing' ? 'Pushing...' : 'Syncing...'}
													</span>
												{:else if $gitSyncState.status === 'conflict'}
													<div class="h-3 w-3 rounded-full bg-yellow-500"></div>
													<span class="text-yellow-500">
														{$gitSyncState.conflicts.length} conflict{$gitSyncState.conflicts.length === 1 ? '' : 's'} need resolution
													</span>
												{:else if $gitSyncState.status === 'success'}
													<div class="h-3 w-3 rounded-full bg-green-500"></div>
													<span class="text-[var(--color-text)]">Synced</span>
												{:else if $gitSyncState.status === 'error'}
													<div class="h-3 w-3 rounded-full bg-red-500"></div>
													<span class="text-red-500">{$gitSyncState.error || 'Sync failed'}</span>
												{:else}
													<div class="h-3 w-3 rounded-full bg-[var(--color-text-muted)]"></div>
													<span class="text-[var(--color-text-muted)]">Ready to sync</span>
												{/if}
											</div>

											{#if $gitSyncState.status === 'conflict'}
												<button
													onclick={() => (showConflictModal = true)}
													class="flex items-center gap-2 rounded-lg bg-yellow-500 px-4 py-2 text-white transition-colors hover:bg-yellow-600"
												>
													Resolve
												</button>
											{:else}
												<button
													onclick={handleSync}
													disabled={['cloning', 'pulling', 'pushing', 'syncing'].includes($gitSyncState.status)}
													class="flex items-center gap-2 rounded-lg bg-[var(--color-accent)] px-4 py-2 text-white transition-colors hover:bg-[var(--color-accent-hover)] disabled:opacity-50"
												>
													<RefreshCw class="h-4 w-4 {['cloning', 'pulling', 'pushing', 'syncing'].includes($gitSyncState.status) ? 'animate-spin' : ''}" />
													Sync Now
												</button>
											{/if}
										</div>

										{#if $gitSyncState.lastSyncedAt}
											<div class="mt-3 text-sm text-[var(--color-text-muted)]">
												Last synced: {formatTimestamp($gitSyncState.lastSyncedAt)}
											</div>
										{/if}
									</div>
								</div>
							{/if}
						</div>
					{:else}
						<!-- R2 Sync Configuration -->
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

							<!-- R2 Sync Status -->
							{#if isR2SyncConfigured()}
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
				{/if}
			</div>
		{/if}
	</section>

		<!-- Local AI -->
		<section class="mb-4 rounded-lg border border-[var(--color-border)] overflow-hidden">
			<button
				onclick={() => toggleSection('localAi')}
				class="flex w-full items-center justify-between bg-[var(--color-bg-secondary)] px-4 py-3 text-left transition-colors hover:bg-[var(--color-border)]"
			>
				<div class="flex items-center gap-3">
					<Cpu class="h-5 w-5 text-[var(--color-accent)]" />
					<div>
						<h2 class="font-semibold text-[var(--color-text)]">Local AI</h2>
						<p class="text-sm text-[var(--color-text-muted)]">
							On-device transcription via Whisper. Default — works offline, no API keys.
						</p>
					</div>
				</div>
				<div class="flex items-center gap-2">
					{#if $localInferenceSettings.enabled}
						<span class="flex h-2 w-2 rounded-full bg-green-500"></span>
					{/if}
					<ChevronDown class="h-5 w-5 text-[var(--color-text-muted)] transition-transform {sections.localAi ? 'rotate-180' : ''}" />
				</div>
			</button>
			{#if sections.localAi}
				{@const currentModelId = whisperModelId($localInferenceSettings.whisperModel)}
				{@const currentStatus = $localModelStatus[`transcribe:${currentModelId}`] ?? { state: 'idle' }}
				<div class="space-y-4 border-t border-[var(--color-border)] p-4">
					<p class="text-sm text-[var(--color-text-muted)]">
						Models run entirely in your browser via WebGPU/WASM and are cached after the first download. Nothing is sent to any server.
					</p>

					<!-- Enable toggle -->
					<label class="flex items-center justify-between gap-3">
						<div>
							<div class="text-sm font-medium text-[var(--color-text)]">Enable local inference</div>
							<div class="text-xs text-[var(--color-text-muted)]">When off, transcription falls back to a remote provider if configured.</div>
						</div>
						<input
							type="checkbox"
							checked={$localInferenceSettings.enabled}
							onchange={(e) => updateLocalInferenceSettings({ enabled: (e.target as HTMLInputElement).checked })}
							class="h-5 w-5 accent-[var(--color-accent)]"
						/>
					</label>

					<!-- Preload toggle -->
					<label class="flex items-center justify-between gap-3">
						<div>
							<div class="text-sm font-medium text-[var(--color-text)]">Preload on startup</div>
							<div class="text-xs text-[var(--color-text-muted)]">Download the model in the background when the app loads, so capture is instant.</div>
						</div>
						<input
							type="checkbox"
							checked={$localInferenceSettings.preloadOnStartup}
							onchange={(e) => updateLocalInferenceSettings({ preloadOnStartup: (e.target as HTMLInputElement).checked })}
							class="h-5 w-5 accent-[var(--color-accent)]"
						/>
					</label>

					<!-- Model selection -->
					<div>
						<label for="whisper-model" class="mb-1 block text-sm font-medium text-[var(--color-text)]">
							Whisper model
						</label>
						<select
							id="whisper-model"
							value={$localInferenceSettings.whisperModel}
							onchange={(e) => updateLocalInferenceSettings({ whisperModel: (e.target as HTMLSelectElement).value as WhisperModelSize })}
							class="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-sm text-[var(--color-text)]"
						>
							<option value="tiny">{whisperModelLabel('tiny')}</option>
							<option value="base">{whisperModelLabel('base')}</option>
							<option value="small">{whisperModelLabel('small')}</option>
						</select>
					</div>

					<!-- Status + manual download -->
					<div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3">
						<div class="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
							Status
						</div>
						<div class="flex items-center justify-between gap-3">
							<div class="text-sm text-[var(--color-text)]">
								{#if currentStatus.state === 'ready'}
									<span class="inline-flex items-center gap-2">
										<span class="h-2 w-2 rounded-full bg-green-500"></span>
										Ready
									</span>
								{:else if currentStatus.state === 'loading'}
									<span class="inline-flex items-center gap-2">
										<div class="h-3 w-3 animate-spin rounded-full border-2 border-[var(--color-accent)] border-t-transparent"></div>
										Downloading… {Math.round(currentStatus.progress)}% ({currentStatus.phase})
									</span>
								{:else if currentStatus.state === 'error'}
									<span class="inline-flex items-center gap-2 text-red-500">
										<AlertTriangle class="h-3 w-3" />
										{currentStatus.error}
									</span>
								{:else}
									<span class="text-[var(--color-text-muted)]">Not downloaded</span>
								{/if}
							</div>
							{#if currentStatus.state !== 'loading' && currentStatus.state !== 'ready'}
								<button
									type="button"
									onclick={() => preloadPipeline('transcribe', currentModelId, { dtype: 'fp32' })}
									class="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-text)] hover:bg-[var(--color-border)]"
								>
									Download now
								</button>
							{/if}
						</div>
					</div>

					<!-- Cache management -->
					<div class="text-xs text-[var(--color-text-muted)]">
						Stuck on a broken model download?
						<button
							type="button"
							onclick={async () => {
								await clearLocalModelCache();
								// Re-trigger preload with the current settings
								preloadPipeline('transcribe', currentModelId, { dtype: 'fp32' });
							}}
							class="ml-1 underline hover:text-[var(--color-text)]"
						>
							Clear local model cache
						</button>
					</div>

					<!-- Text generation (opt-in) -->
					<div class="mt-4 border-t border-[var(--color-border)] pt-4">
						<label class="flex items-center justify-between gap-3">
							<div>
								<div class="text-sm font-medium text-[var(--color-text)]">Local text generation</div>
								<div class="text-xs text-[var(--color-text-muted)]">Run summarization and title generation on-device. Larger download (~360 MB+).</div>
							</div>
							<input
								type="checkbox"
								checked={$localInferenceSettings.textModelEnabled}
								onchange={(e) => updateLocalInferenceSettings({ textModelEnabled: (e.target as HTMLInputElement).checked })}
								class="h-5 w-5 accent-[var(--color-accent)]"
							/>
						</label>

						{#if $localInferenceSettings.textModelEnabled}
							<div class="mt-3">
								<label for="text-model" class="mb-1 block text-sm font-medium text-[var(--color-text)]">
									Text model
								</label>
								<select
									id="text-model"
									value={$localInferenceSettings.textModel}
									onchange={(e) => updateLocalInferenceSettings({ textModel: (e.target as HTMLSelectElement).value as TextModelChoice })}
									class="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-sm text-[var(--color-text)]"
								>
									<option value="smollm2-360m">{textModelLabel('smollm2-360m')}</option>
									<option value="qwen2-0_5b">{textModelLabel('qwen2-0_5b')}</option>
									<option value="llama-3_2-1b">{textModelLabel('llama-3_2-1b')}</option>
									<option value="llama-3_2-3b">{textModelLabel('llama-3_2-3b')}</option>
									<option value="qwen2_5-3b">{textModelLabel('qwen2_5-3b')}</option>
								</select>
							</div>

							<div class="mt-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3">
								<div class="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
									Status
								</div>
								<div class="flex items-center justify-between gap-3">
									<div class="text-sm text-[var(--color-text)]">
										{#if textStatus.state === 'ready'}
											<span class="inline-flex items-center gap-2">
												<span class="h-2 w-2 rounded-full bg-green-500"></span>
												Ready
											</span>
										{:else if textStatus.state === 'loading'}
											<span class="inline-flex items-center gap-2">
												<div class="h-3 w-3 animate-spin rounded-full border-2 border-[var(--color-accent)] border-t-transparent"></div>
												Downloading… {Math.round(textStatus.progress)}% ({textStatus.phase})
											</span>
										{:else if textStatus.state === 'error'}
											<span class="inline-flex items-center gap-2 text-red-500">
												<AlertTriangle class="h-3 w-3" />
												{textStatus.error}
											</span>
										{:else}
											<span class="text-[var(--color-text-muted)]">Not downloaded</span>
										{/if}
									</div>
									{#if textStatus.state !== 'loading' && textStatus.state !== 'ready'}
										<button
											type="button"
											onclick={() => preloadPipeline('text-generation', currentTextModelId)}
											class="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-text)] hover:bg-[var(--color-border)]"
										>
											Download now
										</button>
									{/if}
								</div>
							</div>
						{/if}
					</div>

					<!-- Semantic embeddings (default on, small model) -->
					<div class="mt-4 border-t border-[var(--color-border)] pt-4">
						<label class="flex items-center justify-between gap-3">
							<div>
								<div class="text-sm font-medium text-[var(--color-text)]">
									Semantic search embeddings
								</div>
								<div class="text-xs text-[var(--color-text-muted)]">
									Generate vectors for your memories so Ask Kurumi can find them by meaning, not
									just exact keywords. Small download (~25 MB), runs on-device.
								</div>
							</div>
							<input
								type="checkbox"
								checked={$localInferenceSettings.embedModelEnabled}
								onchange={(e) =>
									updateLocalInferenceSettings({
										embedModelEnabled: (e.target as HTMLInputElement).checked
									})}
								class="h-5 w-5 accent-[var(--color-accent)]"
							/>
						</label>

						{#if $localInferenceSettings.embedModelEnabled}
							<div class="mt-3">
								<label
									for="embed-model"
									class="mb-1 block text-sm font-medium text-[var(--color-text)]"
								>
									Embedding model
								</label>
								<select
									id="embed-model"
									value={$localInferenceSettings.embedModel}
									onchange={(e) =>
										updateLocalInferenceSettings({
											embedModel: (e.target as HTMLSelectElement).value as EmbedModelChoice
										})}
									class="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-sm text-[var(--color-text)]"
								>
									<option value="mini-lm-l6">{embedModelLabel('mini-lm-l6')}</option>
									<option value="multilingual-e5-small">
										{embedModelLabel('multilingual-e5-small')}
									</option>
								</select>
							</div>

							<div class="mt-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3">
								<div class="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
									Status
								</div>
								<div class="flex items-center justify-between gap-3">
									<div class="text-sm text-[var(--color-text)]">
										{#if embedStatus.state === 'ready'}
											<span class="inline-flex items-center gap-2">
												<span class="h-2 w-2 rounded-full bg-green-500"></span>
												Ready
											</span>
										{:else if embedStatus.state === 'loading'}
											<span class="inline-flex items-center gap-2">
												<div class="h-3 w-3 animate-spin rounded-full border-2 border-[var(--color-accent)] border-t-transparent"></div>
												Downloading… {Math.round(embedStatus.progress)}% ({embedStatus.phase})
											</span>
										{:else if embedStatus.state === 'error'}
											<span class="inline-flex items-center gap-2 text-red-500">
												<AlertTriangle class="h-3 w-3" />
												{embedStatus.error}
											</span>
										{:else}
											<span class="text-[var(--color-text-muted)]">Not downloaded</span>
										{/if}
									</div>
									{#if embedStatus.state !== 'loading' && embedStatus.state !== 'ready'}
										<button
											type="button"
											onclick={() => preloadPipeline('embed', currentEmbedModelId)}
											class="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-text)] hover:bg-[var(--color-border)]"
										>
											Download now
										</button>
									{/if}
								</div>
							</div>
						{/if}
					</div>
				</div>
			{/if}
		</section>

		<!-- Notifications -->
		<section class="mb-4 rounded-lg border border-[var(--color-border)] overflow-hidden">
			<button
				onclick={() => toggleSection('notifications')}
				class="flex w-full items-center justify-between bg-[var(--color-bg-secondary)] px-4 py-3 text-left transition-colors hover:bg-[var(--color-border)]"
			>
				<div class="flex items-center gap-3">
					<Bell class="h-5 w-5 text-[var(--color-accent)]" />
					<div>
						<h2 class="font-semibold text-[var(--color-text)]">Notifications</h2>
						<p class="text-sm text-[var(--color-text-muted)]">
							Browser alerts for overdue action items
						</p>
					</div>
				</div>
				<div class="flex items-center gap-2">
					{#if notifEnabled}
						<span class="flex h-2 w-2 rounded-full bg-green-500"></span>
					{/if}
					<ChevronDown class="h-5 w-5 text-[var(--color-text-muted)] transition-transform {sections.notifications ? 'rotate-180' : ''}" />
				</div>
			</button>
			{#if sections.notifications}
				<div class="border-t border-[var(--color-border)] p-4 space-y-4">
					{#if !notifSupported}
						<p class="text-sm text-[var(--color-text-muted)]">
							Your browser doesn't support notifications.
						</p>
					{:else if notifPermission === 'denied'}
						<p class="text-sm text-[var(--color-text-muted)]">
							Notifications are blocked by the browser. Re-enable them in your
							browser site settings and reload the page.
						</p>
					{:else}
						<div>
							<h3 class="mb-1 text-sm font-medium text-[var(--color-text)]">While the app is open</h3>
							<p class="mb-3 text-sm text-[var(--color-text-muted)]">
								Kurumi will show a browser notification for every action item
								whose due date has arrived. Checks run every minute while a
								tab is open. Clicking a notification jumps to /actions.
							</p>
							<button
								onclick={handleNotifToggle}
								class="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors"
								class:bg-[var(--color-accent)]={!notifEnabled}
								class:text-white={!notifEnabled}
								class:bg-[var(--color-bg-secondary)]={notifEnabled}
								class:text-[var(--color-text)]={notifEnabled}
								class:border={notifEnabled}
								class:border-[var(--color-border)]={notifEnabled}
							>
								<Bell class="h-4 w-4" />
								{notifEnabled ? 'Disable notifications' : 'Enable notifications'}
							</button>
						</div>

						<div class="pt-4 border-t border-[var(--color-border)]">
							<h3 class="mb-1 text-sm font-medium text-[var(--color-text)]">
								When the app is closed
								<span class="ml-1 text-xs font-normal text-[var(--color-text-muted)]">
									(experimental)
								</span>
							</h3>
							<p class="mb-3 text-sm text-[var(--color-text-muted)]">
								Register a background periodic sync with the service worker
								so notifications can fire even when no Kurumi tab is open.
								Requires the PWA to be installed and a browser that supports
								the Periodic Background Sync API — currently that means
								Chrome or Edge as an installed PWA. The browser decides the
								real check interval based on your usage; typically every few
								hours.
							</p>
							{#if !bgNotifSupported}
								<p class="text-sm text-[var(--color-text-muted)]">
									Periodic Background Sync isn't available in this browser /
									installation. Install Kurumi as a PWA on Chrome or Edge to
									enable it.
								</p>
							{:else}
								<button
									onclick={handleBackgroundNotifToggle}
									class="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors"
									class:bg-[var(--color-accent)]={!bgNotifEnabled}
									class:text-white={!bgNotifEnabled}
									class:bg-[var(--color-bg-secondary)]={bgNotifEnabled}
									class:text-[var(--color-text)]={bgNotifEnabled}
									class:border={bgNotifEnabled}
									class:border-[var(--color-border)]={bgNotifEnabled}
								>
									<Bell class="h-4 w-4" />
									{bgNotifEnabled
										? 'Disable background notifications'
										: 'Enable background notifications'}
								</button>
								{#if bgNotifError}
									<p class="mt-2 text-sm text-red-500">{bgNotifError}</p>
								{/if}
							{/if}
						</div>
					{/if}
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
							<span class="mb-2 block text-sm font-medium text-[var(--color-text)]">
								AI Provider
							</span>
							<div class="flex gap-2">
								<button
									onclick={() => handleProviderChange('openai')}
									class="flex flex-1 items-center justify-center gap-2 rounded-lg border px-4 py-3 transition-colors {aiProvider === 'openai' ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent)]' : 'border-[var(--color-border)] text-[var(--color-text)] hover:bg-[var(--color-border)]'}"
								>
									<!-- OpenAI Logo -->
									<svg class="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
										<path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z"/>
									</svg>
									OpenAI
								</button>
								<button
									onclick={() => handleProviderChange('anthropic')}
									class="flex flex-1 items-center justify-center gap-2 rounded-lg border px-4 py-3 transition-colors {aiProvider === 'anthropic' ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent)]' : 'border-[var(--color-border)] text-[var(--color-text)] hover:bg-[var(--color-border)]'}"
								>
									<!-- Anthropic Logo -->
									<svg class="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
										<path d="M13.827 3.52h3.603L24 20.48h-3.603l-6.57-16.96zm-7.258 0h3.767L16.906 20.48h-3.674l-1.343-3.461H5.017l-1.344 3.46H0L6.57 3.522zm1.04 3.781L5.246 14.14h4.726L7.609 7.301z"/>
									</svg>
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

						<!-- Additional AI providers -->
						<div class="mt-6 pt-4 border-t border-[var(--color-border)]">
							<h3 class="mb-1 text-sm font-medium text-[var(--color-text)]">Additional providers</h3>
							<p class="mb-3 text-sm text-[var(--color-text-muted)]">
								Configure API keys for other providers. They act as fallbacks when the
								primary provider fails or isn't configured. All use OpenAI-compatible APIs.
							</p>
							<div class="space-y-3">
								{#each PROVIDER_CONFIGS as config (config.id)}
									<div class="flex items-center gap-2">
										<span class="w-24 shrink-0 text-xs font-medium text-[var(--color-text)]">{config.name}</span>
										<input
											type="password"
											value={extraProviderKeys[config.apiKeyStorageKey] || ''}
											oninput={(e) => {
												extraProviderKeys[config.apiKeyStorageKey] = (e.target as HTMLInputElement).value;
											}}
											onblur={() => saveExtraProviderKey(config.apiKeyStorageKey, extraProviderKeys[config.apiKeyStorageKey] || '')}
											placeholder={config.id === 'azure-openai' ? 'API key (set endpoint below)' : 'API key'}
											class="flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-1.5 font-mono text-xs text-[var(--color-text)] focus:border-[var(--color-accent)] focus:outline-none"
										/>
										{#if extraProviderKeys[config.apiKeyStorageKey]}
											<span class="flex h-2 w-2 shrink-0 rounded-full bg-green-500" title="Key set"></span>
										{/if}
									</div>
								{/each}
							</div>
							<p class="mt-2 text-xs text-[var(--color-text-muted)]">
								Keys are saved to localStorage on blur. Providers with a key
								configured are tried as fallbacks in order: Mistral, Perplexity,
								Grok, Qwen, Azure OpenAI, Groq.
							</p>
						</div>
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
						{$vaults.length} {$vaults.length === 1 ? 'vault' : 'vaults'} · {$folders.length} {$folders.length === 1 ? 'folder' : 'folders'} · {$memoryObjects.length} {$memoryObjects.length === 1 ? 'note' : 'notes'}
					</div>

					<!-- Markdown folder import (Obsidian / Logseq / Bear / Notion md / Foam) -->
					<div class="mt-4 pt-4 border-t border-[var(--color-border)]">
						<h3 class="mb-2 text-sm font-medium text-[var(--color-text)]">Import from markdown folder</h3>
						<p class="mb-3 text-sm text-[var(--color-text-muted)]">
							Import any folder of <code>.md</code> files: Obsidian vault, Logseq graph,
							Bear export, Notion markdown export, or Foam workspace. Subfolders
							become nested folders in Kurumi.
						</p>
						<button
							onclick={handleObsidianImport}
							disabled={isImportingObsidian}
							class="flex items-center justify-center gap-2 rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text)] transition-colors hover:bg-[var(--color-border)] active:scale-[0.98] disabled:opacity-50"
						>
							{#if isImportingObsidian}
								<div class="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"></div>
								Importing...
							{:else}
								<Upload class="h-4 w-4" />
								Select folder
							{/if}
						</button>

						{#if obsidianImportResult}
							{#if obsidianImportResult.success}
								<div class="mt-3 flex items-start gap-2 rounded-lg bg-green-500/10 px-3 py-2 text-sm text-green-600 dark:text-green-400">
									<Check class="h-4 w-4 shrink-0 mt-0.5" />
									<div>
										<p>Imported {obsidianImportResult.foldersCreated} {obsidianImportResult.foldersCreated === 1 ? 'folder' : 'folders'} and {obsidianImportResult.notesCreated} {obsidianImportResult.notesCreated === 1 ? 'note' : 'notes'}</p>
										{#if obsidianImportResult.skipped.length > 0}
											<p class="mt-1 text-xs opacity-80">Skipped {obsidianImportResult.skipped.length} items (hidden files, non-markdown, etc.)</p>
										{/if}
									</div>
								</div>
							{:else if obsidianImportResult.error}
								<div class="mt-3 flex items-center gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-500">
									<AlertTriangle class="h-4 w-4 shrink-0" />
									{obsidianImportResult.error}
								</div>
							{/if}
						{/if}
					</div>

					<!-- Roam Research JSON import -->
					<div class="mt-4 pt-4 border-t border-[var(--color-border)]">
						<h3 class="mb-2 text-sm font-medium text-[var(--color-text)]">Import from Roam Research</h3>
						<p class="mb-3 text-sm text-[var(--color-text-muted)]">
							Upload a Roam JSON export file. Each page becomes a memory with
							its block outline flattened to nested markdown bullets.
							<code>{'{{TODO}}'}</code> / <code>{'{{DONE}}'}</code> become
							checklist items; wikilinks and tags are preserved as-is.
						</p>
						<input
							bind:this={roamFileInputRef}
							type="file"
							accept=".json,application/json"
							onchange={handleRoamFileSelect}
							class="hidden"
						/>
						<button
							onclick={triggerRoamImport}
							disabled={isImportingRoam}
							class="flex items-center justify-center gap-2 rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text)] transition-colors hover:bg-[var(--color-border)] active:scale-[0.98] disabled:opacity-50"
						>
							{#if isImportingRoam}
								<div class="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"></div>
								Importing...
							{:else}
								<Upload class="h-4 w-4" />
								Select Roam JSON
							{/if}
						</button>

						{#if roamImportResult}
							{#if roamImportResult.success}
								<div class="mt-3 flex items-start gap-2 rounded-lg bg-green-500/10 px-3 py-2 text-sm text-green-600 dark:text-green-400">
									<Check class="h-4 w-4 shrink-0 mt-0.5" />
									<div>
										<p>
											Imported {roamImportResult.pagesCreated}
											{roamImportResult.pagesCreated === 1 ? 'page' : 'pages'}
											({roamImportResult.blockCount} blocks)
										</p>
										{#if roamImportResult.skipped.length > 0}
											<p class="mt-1 text-xs opacity-80">
												Skipped {roamImportResult.skipped.length} items
											</p>
										{/if}
									</div>
								</div>
							{:else if roamImportResult.error}
								<div class="mt-3 flex items-center gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-500">
									<AlertTriangle class="h-4 w-4 shrink-0" />
									{roamImportResult.error}
								</div>
							{/if}
						{/if}
					</div>

					<!-- Evernote ENEX import -->
					<div class="mt-4 pt-4 border-t border-[var(--color-border)]">
						<h3 class="mb-2 text-sm font-medium text-[var(--color-text)]">Import from Evernote</h3>
						<p class="mb-3 text-sm text-[var(--color-text-muted)]">
							Upload an Evernote <code>.enex</code> export file. Notes are converted to
							markdown with tags preserved as #hashtags.
						</p>
						<input
							bind:this={evernoteFileInputRef}
							type="file"
							accept=".enex,application/xml,text/xml"
							onchange={handleEvernoteFileSelect}
							class="hidden"
						/>
						<button
							onclick={triggerEvernoteImport}
							disabled={isImportingEvernote}
							class="flex items-center justify-center gap-2 rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text)] transition-colors hover:bg-[var(--color-border)] active:scale-[0.98] disabled:opacity-50"
						>
							{#if isImportingEvernote}
								<div class="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"></div>
								Importing...
							{:else}
								<Upload class="h-4 w-4" />
								Select ENEX file
							{/if}
						</button>

						{#if evernoteImportResult}
							{#if evernoteImportResult.success}
								<div class="mt-3 flex items-start gap-2 rounded-lg bg-green-500/10 px-3 py-2 text-sm text-green-600 dark:text-green-400">
									<Check class="h-4 w-4 shrink-0 mt-0.5" />
									<p>Imported {evernoteImportResult.notesCreated} note{evernoteImportResult.notesCreated === 1 ? '' : 's'}</p>
								</div>
							{:else if evernoteImportResult.error}
								<div class="mt-3 flex items-center gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-500">
									<AlertTriangle class="h-4 w-4 shrink-0" />
									{evernoteImportResult.error}
								</div>
							{/if}
						{/if}
					</div>

					<!-- Web clipper bookmarklet -->
					<div class="mt-4 pt-4 border-t border-[var(--color-border)]">
						<h3 class="mb-2 text-sm font-medium text-[var(--color-text)]">Web Clipper</h3>
						<p class="mb-3 text-sm text-[var(--color-text-muted)]">
							Drag this link to your bookmarks bar. Click it on any webpage to
							save the page title, URL, and selected text as a new Kurumi memory.
						</p>
						{#if bookmarkletUrl}
							<a
								href={bookmarkletUrl}
								class="inline-flex items-center gap-2 rounded-lg border border-[var(--color-accent)] bg-[var(--color-accent)]/10 px-4 py-2 text-sm font-medium text-[var(--color-accent)] no-underline"
								onclick={(e) => { e.preventDefault(); alert('Drag this link to your bookmarks bar — don\'t click it here!'); }}
							>
								Clip to Kurumi
							</a>
							<p class="mt-2 text-xs text-[var(--color-text-muted)]">
								Drag ↑ to your bookmarks bar. Don't click — drag.
							</p>
						{/if}
					</div>

					<!-- Markdown Export -->
					<div class="mt-4 pt-4 border-t border-[var(--color-border)]">
						<h3 class="mb-2 text-sm font-medium text-[var(--color-text)]">Export as Markdown</h3>
						<p class="mb-3 text-sm text-[var(--color-text-muted)]">
							Export current vault as markdown files with folder structure. Choose a format:
						</p>
						<div class="flex flex-wrap gap-2">
							<button
								onclick={() => handleMarkdownExport('vanilla')}
								disabled={isExportingMarkdown}
								class="flex items-center justify-center gap-2 rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text)] transition-colors hover:bg-[var(--color-border)] active:scale-[0.98] disabled:opacity-50"
							>
								{#if isExportingMarkdown && markdownExportFormat === 'vanilla'}
									<div class="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"></div>
								{:else}
									<Download class="h-4 w-4" />
								{/if}
								Markdown
							</button>
							<button
								onclick={() => handleMarkdownExport('hugo')}
								disabled={isExportingMarkdown}
								class="flex items-center justify-center gap-2 rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text)] transition-colors hover:bg-[var(--color-border)] active:scale-[0.98] disabled:opacity-50"
							>
								{#if isExportingMarkdown && markdownExportFormat === 'hugo'}
									<div class="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"></div>
								{:else}
									<Download class="h-4 w-4" />
								{/if}
								Hugo-flavoured
							</button>
							<button
								onclick={() => handleMarkdownExport('zola')}
								disabled={isExportingMarkdown}
								class="flex items-center justify-center gap-2 rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text)] transition-colors hover:bg-[var(--color-border)] active:scale-[0.98] disabled:opacity-50"
							>
								{#if isExportingMarkdown && markdownExportFormat === 'zola'}
									<div class="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"></div>
								{:else}
									<Download class="h-4 w-4" />
								{/if}
								Zola-flavoured
							</button>
						</div>
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
							Imported {importSuccess.vaults} {importSuccess.vaults === 1 ? 'vault' : 'vaults'}, {importSuccess.folders} {importSuccess.folders === 1 ? 'folder' : 'folders'}, {importSuccess.memoryObjects} {importSuccess.memoryObjects === 1 ? 'note' : 'notes'}
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

					<!-- Support -->
					<div class="mt-4 pt-4 border-t border-[var(--color-border)]">
						<a
							href="https://ko-fi.com/raskell"
							target="_blank"
							rel="noopener"
							class="flex items-center justify-center gap-2 rounded-lg border border-[var(--color-border)] px-4 py-3 text-[var(--color-text)] transition-colors hover:bg-[var(--color-border)] hover:border-[var(--color-accent)]"
						>
							<svg class="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
								<path d="M23.881 8.948c-.773-4.085-4.859-4.593-4.859-4.593H.723c-.604 0-.679.798-.679.798s-.082 7.324-.022 11.822c.164 2.424 2.586 2.672 2.586 2.672s8.267-.023 11.966-.049c2.438-.426 2.683-2.566 2.658-3.734 4.352.24 7.422-2.831 6.649-6.916zm-11.062 3.511c-1.246 1.453-4.011 3.976-4.011 3.976s-.121.119-.31.023c-.076-.057-.108-.09-.108-.09-.443-.441-3.368-3.049-4.034-3.954-.709-.965-1.041-2.7-.091-3.71.951-1.01 3.005-1.086 4.363.407 0 0 1.565-1.782 3.468-.963 1.904.82 1.832 3.011.723 4.311z"/>
							</svg>
							Support on Ko-fi
						</a>
					</div>

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
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
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
					<p><strong class="text-[var(--color-text)]">{importAnalysis.totalMemoryObjects}</strong> notes</p>
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
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
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
					All notes ({$memoryObjects.length})
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
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
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

{#if showConflictModal}
	<GitConflictModal onClose={() => (showConflictModal = false)} />
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
