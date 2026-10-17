<script lang="ts">
	import { autofocus } from '$lib/actions/autofocus';
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
		type EmbedModelChoice,
		type ModelStatus
	} from '$lib/inference';
	import { onMount } from 'svelte';
	import { Monitor, Sun, Moon, Upload, Download, AlertTriangle, Check, X, Trash2, RefreshCw, Wifi, Sparkles, ChevronDown, Cloud, Shield, BookOpen, HardDrive } from 'lucide-svelte';
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
		showSaved = true;
		setTimeout(() => (showSaved = false), 2000);
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
		showSaved = true;
		setTimeout(() => (showSaved = false), 2000);
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

	// Derived for the local-AI status panels
	let currentWhisperModelId = $derived(whisperModelId($localInferenceSettings.whisperModel));
	let whisperStatus = $derived<ModelStatus>(
		$localModelStatus[`transcribe:${currentWhisperModelId}`] ?? { state: 'idle' }
	);
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

	// In-page section nav (sticky on wide screens); highlights the section in view
	const navSections = [
		{ id: 'appearance', label: 'Appearance' },
		{ id: 'sync', label: 'Sync' },
		{ id: 'local-ai', label: 'Local AI' },
		{ id: 'ai', label: 'AI assistant' },
		{ id: 'notifications', label: 'Notifications' },
		{ id: 'data', label: 'Data' },
		{ id: 'about', label: 'About' },
		{ id: 'danger', label: 'Danger zone' }
	];
	let activeSection = $state('appearance');
	let scrollEl: HTMLDivElement | undefined = $state();

	function jumpToSection(id: string) {
		activeSection = id;
		document.getElementById(id)?.scrollIntoView({ block: 'start' });
	}

	$effect(() => {
		if (!scrollEl || typeof IntersectionObserver === 'undefined') return;
		const observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (entry.isIntersecting) activeSection = entry.target.id;
				}
			},
			{ root: scrollEl, rootMargin: '0px 0px -75% 0px' }
		);
		for (const s of navSections) {
			const el = document.getElementById(s.id);
			if (el) observer.observe(el);
		}
		return () => observer.disconnect();
	});

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

{#snippet spinner()}
	<span class="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true"></span>
{/snippet}

{#snippet testResultLine(result: { success: boolean; error?: string } | null, okLabel: string)}
	{#if result}
		{#if result.success}
			<span class="k-badge k-badge-success" role="status"><Check class="h-3 w-3" />{okLabel}</span>
		{:else}
			<p class="flex items-start gap-1.5 text-xs text-[var(--color-danger)]" role="alert">
				<AlertTriangle class="mt-px h-3.5 w-3.5 shrink-0" />
				<span>{result.error || 'Connection failed'}</span>
			</p>
		{/if}
	{/if}
{/snippet}

{#snippet modelStatusLine(status: ModelStatus, onDownload: () => void)}
	<div class="mt-2 flex flex-wrap items-center gap-2">
		{#if status.state === 'ready'}
			<span class="k-badge k-badge-success">Ready</span>
		{:else if status.state === 'loading'}
			<span class="k-badge k-badge-accent">
				{@render spinner()}
				Downloading {Math.round(status.progress)}%
			</span>
			<span class="text-xs text-[var(--color-text-faint)]">{status.phase}</span>
		{:else if status.state === 'error'}
			<span class="k-badge k-badge-danger">Error</span>
			<span class="min-w-0 text-xs text-[var(--color-danger)]">{status.error}</span>
		{:else}
			<span class="k-badge">Not downloaded</span>
		{/if}
		{#if status.state !== 'loading' && status.state !== 'ready'}
			<button type="button" onclick={onDownload} class="k-btn k-btn-sm">
				<Download class="h-3.5 w-3.5" />
				Download now
			</button>
		{/if}
	</div>
{/snippet}

{#snippet importResultLine(result: { success: boolean; error?: string } | null, okText: string, detail?: string)}
	{#if result}
		{#if result.success}
			<p class="mt-2 flex items-start gap-1.5 text-xs text-[var(--color-text-muted)]" role="status">
				<span class="k-badge k-badge-success shrink-0"><Check class="h-3 w-3" />Done</span>
				<span class="pt-0.5">{okText}{#if detail} · {detail}{/if}</span>
			</p>
		{:else if result.error}
			<p class="mt-2 flex items-start gap-1.5 text-xs text-[var(--color-danger)]" role="alert">
				<AlertTriangle class="mt-px h-3.5 w-3.5 shrink-0" />
				{result.error}
			</p>
		{/if}
	{/if}
{/snippet}

<svelte:head>
	<title>Settings - Kurumi</title>
</svelte:head>

<div class="h-full overflow-y-auto overscroll-contain" bind:this={scrollEl}>
	<div class="k-page settings-page">
		<div class="settings-layout">
			<!-- In-page section nav (wide screens only) -->
			<nav class="settings-nav" aria-label="Settings sections">
				{#each navSections as s (s.id)}
					<a
						href="#{s.id}"
						class="settings-nav-link"
						class:danger={s.id === 'danger'}
						aria-current={activeSection === s.id ? 'true' : undefined}
						onclick={(e) => {
							e.preventDefault();
							jumpToSection(s.id);
						}}
					>
						{s.label}
					</a>
				{/each}
			</nav>

			<div class="min-w-0 flex-1">
				<header class="k-page-header">
					<div class="min-w-0">
						<h1 class="k-page-title">Settings</h1>
						<p class="k-page-subtitle">Preferences for Kurumi on this device.</p>
					</div>
				</header>

				<!-- Appearance -->
				<section id="appearance" class="set-section" aria-labelledby="appearance-title">
					<h2 id="appearance-title" class="set-section-title">Appearance</h2>
					<p class="set-section-desc">Theme and editor typography. Changes apply instantly.</p>
					<div class="set-rows">
						<div class="set-row">
							<div class="set-row-text">
								<div class="set-row-label" id="theme-label">Theme</div>
								<p class="set-row-help">Follow the system or pick a fixed color scheme.</p>
							</div>
							<div class="k-segmented" role="group" aria-labelledby="theme-label">
								<button aria-pressed={theme === 'system'} onclick={() => setTheme('system')} class="inline-flex items-center gap-1.5">
									<Monitor class="h-3.5 w-3.5" />
									System
								</button>
								<button aria-pressed={theme === 'light'} onclick={() => setTheme('light')} class="inline-flex items-center gap-1.5">
									<Sun class="h-3.5 w-3.5" />
									Light
								</button>
								<button aria-pressed={theme === 'dark'} onclick={() => setTheme('dark')} class="inline-flex items-center gap-1.5">
									<Moon class="h-3.5 w-3.5" />
									Dark
								</button>
							</div>
						</div>

						<div class="set-row">
							<div class="set-row-text">
								<div class="set-row-label" id="font-label">Editor font</div>
								<p class="set-row-help">Typeface used in the note editor.</p>
							</div>
							<div class="k-segmented" role="group" aria-labelledby="font-label">
								<button aria-pressed={editorFont === 'quattro'} onclick={() => setEditorFont('quattro')}>
									<span style="font-family: 'iA Writer Quattro S', serif">iA Quattro</span>
								</button>
								<button aria-pressed={editorFont === 'geist'} onclick={() => setEditorFont('geist')}>
									<span style="font-family: 'Geist', sans-serif">Geist</span>
								</button>
							</div>
						</div>

						<div class="set-row">
							<div class="set-row-text">
								<div class="set-row-label" id="size-label">Editor font size</div>
								<p class="set-row-help">Text size in the editor.</p>
							</div>
							<div class="k-segmented" role="group" aria-labelledby="size-label">
								<button aria-pressed={editorFontSize === 'small'} onclick={() => setEditorFontSize('small')}>Small</button>
								<button aria-pressed={editorFontSize === 'medium'} onclick={() => setEditorFontSize('medium')}>Medium</button>
								<button aria-pressed={editorFontSize === 'large'} onclick={() => setEditorFontSize('large')}>Large</button>
							</div>
						</div>
					</div>
				</section>

				<!-- Sync -->
				<section id="sync" class="set-section" aria-labelledby="sync-title">
					<h2 id="sync-title" class="set-section-title">
						Sync
						{#if isSyncConfigured()}
							<span class="k-badge k-badge-success">Configured</span>
						{/if}
					</h2>
					<p class="set-section-desc">
						Keep your memories in sync across devices with storage you own.
					</p>
					<div class="set-rows">
						<div class="set-row">
							<div class="set-row-text">
								<div class="set-row-label" id="sync-method-label">Primary method</div>
								<p class="set-row-help">The source of truth Kurumi pulls from and pushes to.</p>
							</div>
							<div class="k-segmented flex-wrap" role="group" aria-labelledby="sync-method-label">
								{#each [
									{ id: 'r2', label: 'R2' },
									{ id: 'git', label: 'Git' },
									{ id: 's3', label: 'S3' },
									{ id: 'webdav', label: 'WebDAV' },
									{ id: 'local-fs', label: 'Local' },
									{ id: 'azure-blob', label: 'Azure' }
								] as item (item.id)}
									<button aria-pressed={syncMethod === item.id} onclick={() => handleSyncMethodChange(item.id as SyncMethod)}>
										{item.label}
									</button>
								{/each}
							</div>
						</div>

						<div class="set-row">
							<div class="set-row-text">
								<div class="set-row-label" id="mirror-label">Mirrors</div>
								<p class="set-row-help">
									After syncing with the primary, push the same state here too. Mirrors are
									one-way; the primary is always the source of truth.
								</p>
							</div>
							<div class="flex flex-wrap gap-1" role="group" aria-labelledby="mirror-label">
								{#each ['r2', 's3', 'webdav', 'local-fs', 'azure-blob'] as method (method)}
									{#if method !== syncMethod}
										<button
											onclick={() => toggleMirror(method as SyncMethod)}
											aria-pressed={mirrorMethods.includes(method as SyncMethod)}
											class="k-btn k-btn-sm chip"
										>
											{method === 'r2' ? 'R2' : method === 's3' ? 'S3' : method === 'webdav' ? 'WebDAV' : method === 'local-fs' ? 'Local FS' : 'Azure'}
										</button>
									{/if}
								{/each}
							</div>
						</div>

						{#if syncMethod === 'webdav'}
							<!-- WebDAV Configuration -->
							<div class="set-block">
								<div>
									<div class="set-row-label">WebDAV server</div>
									<p class="set-row-help">
										Works with Nextcloud, ownCloud, Synology, and any WebDAV server. CORS must be
										configured on the server.
									</p>
								</div>
								<div>
									<label for="webdavUrl" class="k-label">URL</label>
									<input id="webdavUrl" type="text" bind:value={webdavUrl} placeholder="https://cloud.example.com/remote.php/dav/files/user" class="k-input" />
								</div>
								<div class="grid gap-3 sm:grid-cols-2">
									<div>
										<label for="webdavUser" class="k-label">Username</label>
										<input id="webdavUser" type="text" bind:value={webdavUsername} placeholder="user" class="k-input" autocomplete="username" />
									</div>
									<div>
										<label for="webdavPass" class="k-label">Password</label>
										<input id="webdavPass" type="password" bind:value={webdavPassword} placeholder="••••••" class="k-input" autocomplete="current-password" />
									</div>
								</div>
								<div class="set-actions">
									<button onclick={saveWebDAVSettings} class="k-btn k-btn-primary">
										{#if showSaved}<Check class="h-4 w-4" />Saved{:else}Save{/if}
									</button>
									<button onclick={handleWebDAVTest} disabled={webdavTesting} class="k-btn">
										{#if webdavTesting}{@render spinner()}{:else}<Wifi class="h-4 w-4" />{/if}
										Test connection
									</button>
									{@render testResultLine(webdavTestResult, 'Connected')}
								</div>
							</div>
						{:else if syncMethod === 'local-fs'}
							<!-- Local Filesystem Configuration -->
							<div class="set-block">
								<div>
									<div class="set-row-label">Local folder</div>
									<p class="set-row-help">
										Sync to a folder on this computer. Put it inside Dropbox, iCloud, OneDrive, or
										Syncthing: Kurumi writes the files, your cloud client handles the rest.
										Chrome and Edge only.
									</p>
								</div>
								{#if !localFSAvailable}
									<p class="flex items-start gap-1.5 text-sm text-[var(--color-danger)]">
										<AlertTriangle class="mt-0.5 h-4 w-4 shrink-0" />
										The File System Access API isn't available in this browser. Use Chrome or Edge.
									</p>
								{:else if localFSConfigured}
									<div class="set-actions">
										<span class="k-badge k-badge-success">Folder selected</span>
										<button onclick={handleLocalFSTest} disabled={localFSTesting} class="k-btn k-btn-sm">
											{#if localFSTesting}{@render spinner()}{/if}
											Test
										</button>
										<button onclick={handleClearFolder} class="k-btn k-btn-sm k-btn-ghost">Change folder</button>
									</div>
									{#if localFSTestResult}
										<div>
											{@render testResultLine(
												localFSTestResult,
												`Writable${localFSTestResult.folder ? ` · ${localFSTestResult.folder}` : ''}`
											)}
										</div>
									{/if}
									<div class="set-actions">
										<button onclick={handleSync} disabled={$syncState.status === 'syncing'} class="k-btn k-btn-primary">
											<RefreshCw class="h-4 w-4 {$syncState.status === 'syncing' ? 'animate-spin' : ''}" />
											Sync now
										</button>
										{#if $syncState.status === 'error'}
											<span class="text-xs text-[var(--color-danger)]">{$syncState.error || 'Sync failed'}</span>
										{:else if $syncState.lastSyncedAt}
											<span class="text-xs text-[var(--color-text-faint)]">Last synced {formatTimestamp($syncState.lastSyncedAt).toLowerCase()}</span>
										{/if}
									</div>
									<p class="k-help">
										Notes are written as readable <code>.md</code> files (mirroring your folders),
										plus a <code>kurumi-sync.bin</code> used to merge across devices. Edits you make to
										a note's text in those files are read back on the next sync. Creating, renaming,
										or deleting notes still happens in Kurumi.
									</p>
								{:else}
									<div>
										<button onclick={handlePickFolder} class="k-btn k-btn-primary">
											<HardDrive class="h-4 w-4" />
											Pick folder
										</button>
									</div>
								{/if}
							</div>
						{:else if syncMethod === 'azure-blob'}
							<!-- Azure Blob Configuration -->
							<div class="set-block">
								<div>
									<div class="set-row-label">Azure Blob Storage</div>
									<p class="set-row-help">
										Uses a SAS token. Generate one in the Azure Portal with Read, Write and Create
										permissions.
									</p>
								</div>
								<div>
									<label for="azureUrl" class="k-label">Account URL</label>
									<input id="azureUrl" type="text" bind:value={azureAccountUrl} placeholder="https://myaccount.blob.core.windows.net" class="k-input" />
								</div>
								<div>
									<label for="azureContainer" class="k-label">Container</label>
									<input id="azureContainer" type="text" bind:value={azureContainer} placeholder="kurumi" class="k-input" />
								</div>
								<div>
									<label for="azureSas" class="k-label">SAS token</label>
									<input id="azureSas" type="password" bind:value={azureSasToken} placeholder="?sv=2023-11-03&ss=b&srt=sco&..." class="k-input font-mono !text-xs" />
								</div>
								<div class="set-actions">
									<button onclick={saveAzureBlobSettings} class="k-btn k-btn-primary">
										{#if showSaved}<Check class="h-4 w-4" />Saved{:else}Save{/if}
									</button>
									<button onclick={handleAzureTest} disabled={azureTesting} class="k-btn">
										{#if azureTesting}{@render spinner()}{:else}<Wifi class="h-4 w-4" />{/if}
										Test connection
									</button>
									{@render testResultLine(azureTestResult, 'Connected')}
								</div>
							</div>
						{:else if syncMethod === 's3'}
							<!-- S3 Sync Configuration -->
							<div class="set-block">
								<div>
									<div class="set-row-label">S3-compatible storage</div>
									<p class="set-row-help">
										AWS S3, MinIO, Backblaze B2, DigitalOcean Spaces, Wasabi, or Cloudflare R2 (S3
										API). CORS must be configured on the bucket.
									</p>
								</div>
								<div>
									<label for="s3Endpoint" class="k-label">Endpoint URL</label>
									<input id="s3Endpoint" type="text" bind:value={s3Endpoint} placeholder="https://s3.us-east-1.amazonaws.com" class="k-input" />
								</div>
								<div class="grid gap-3 sm:grid-cols-2">
									<div>
										<label for="s3Bucket" class="k-label">Bucket</label>
										<input id="s3Bucket" type="text" bind:value={s3Bucket} placeholder="my-kurumi-bucket" class="k-input" />
									</div>
									<div>
										<label for="s3Region" class="k-label">Region</label>
										<input id="s3Region" type="text" bind:value={s3Region} placeholder="us-east-1" class="k-input" />
									</div>
								</div>
								<div>
									<label for="s3Access" class="k-label">Access key ID</label>
									<input id="s3Access" type="text" bind:value={s3AccessKey} placeholder="AKIAIOSFODNN7EXAMPLE" class="k-input font-mono" />
								</div>
								<div>
									<label for="s3Secret" class="k-label">Secret access key</label>
									<input id="s3Secret" type="password" bind:value={s3SecretKey} placeholder="wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY" class="k-input font-mono" />
								</div>
								<div class="set-actions">
									<button onclick={saveS3Settings} class="k-btn k-btn-primary">
										{#if showSaved}<Check class="h-4 w-4" />Saved{:else}Save{/if}
									</button>
									<button onclick={handleS3Test} disabled={s3Testing} class="k-btn">
										{#if s3Testing}{@render spinner()}{:else}<Wifi class="h-4 w-4" />{/if}
										Test connection
									</button>
									{@render testResultLine(s3TestResult, 'Connected')}
								</div>
							</div>
						{:else if syncMethod === 'git'}
							<!-- Git Sync Configuration -->
							<div class="set-block">
								<div>
									<div class="set-row-label">Git repository</div>
									<p class="set-row-help">
										Memories are stored as markdown files. Works with GitHub, GitLab, and Codeberg.
									</p>
								</div>
								<div>
									<span class="k-label" id="git-provider-label">Provider</span>
									<div class="k-segmented" role="group" aria-labelledby="git-provider-label">
										{#each Object.values(GIT_PROVIDERS) as provider}
											<button aria-pressed={gitProvider === provider.id} onclick={() => (gitProvider = provider.id)}>
												{provider.name}
											</button>
										{/each}
									</div>
								</div>
								<div class="grid gap-3 sm:grid-cols-[1fr_10rem]">
									<div>
										<label for="gitRepoUrl" class="k-label">Repository URL</label>
										<input id="gitRepoUrl" type="url" bind:value={gitRepoUrl} placeholder={currentGitProvider.exampleUrl} class="k-input" />
									</div>
									<div>
										<label for="gitBranch" class="k-label">Branch</label>
										<input id="gitBranch" type="text" bind:value={gitBranch} placeholder="main" class="k-input" />
									</div>
								</div>
								<div>
									<label for="gitToken" class="k-label">Personal access token</label>
									<input id="gitToken" type="password" bind:value={gitToken} placeholder="ghp_xxxx..." class="k-input" />
									<p class="k-help">
										<a href={currentGitProvider.tokenUrl} target="_blank" rel="noopener" class="text-[var(--color-accent)] hover:underline">Create a token</a>
										· {currentGitProvider.tokenHelp}
									</p>
								</div>
								<div class="set-actions">
									<button onclick={saveGitSettings} class="k-btn k-btn-primary">
										{#if showGitSaved}<Check class="h-4 w-4" />Saved{:else}Save{/if}
									</button>
									<button onclick={handleTestGitConnection} disabled={isTestingGit || !gitRepoUrl || !gitToken} class="k-btn">
										{#if isTestingGit}{@render spinner()}{:else}<Wifi class="h-4 w-4" />{/if}
										Test connection
									</button>
									{@render testResultLine(gitTestResult, 'Connected')}
								</div>
							</div>

							{#if isGitSyncConfigured()}
								{@const gitBusy = ['cloning', 'pulling', 'pushing', 'syncing'].includes($gitSyncState.status)}
								<div class="set-row">
									<div class="set-row-text">
										<div class="set-row-label flex flex-wrap items-center gap-2">
											Status
											{#if gitBusy}
												<span class="k-badge k-badge-accent">
													{@render spinner()}
													{$gitSyncState.status === 'cloning' ? 'Cloning' : $gitSyncState.status === 'pulling' ? 'Pulling' : $gitSyncState.status === 'pushing' ? 'Pushing' : 'Syncing'}…
												</span>
											{:else if $gitSyncState.status === 'conflict'}
												<span class="k-badge k-badge-warn">
													{$gitSyncState.conflicts.length} conflict{$gitSyncState.conflicts.length === 1 ? '' : 's'}
												</span>
											{:else if $gitSyncState.status === 'success'}
												<span class="k-badge k-badge-success">Synced</span>
											{:else if $gitSyncState.status === 'error'}
												<span class="k-badge k-badge-danger">Error</span>
											{:else}
												<span class="k-badge">Ready</span>
											{/if}
										</div>
										{#if $gitSyncState.status === 'error'}
											<p class="set-row-help !text-[var(--color-danger)]">{$gitSyncState.error || 'Sync failed'}</p>
										{:else if $gitSyncState.lastSyncedAt}
											<p class="set-row-help">Last synced {formatTimestamp($gitSyncState.lastSyncedAt).toLowerCase()}</p>
										{/if}
									</div>
									{#if $gitSyncState.status === 'conflict'}
										<button onclick={() => (showConflictModal = true)} class="k-btn k-btn-primary">Resolve conflicts</button>
									{:else}
										<button onclick={handleSync} disabled={gitBusy} class="k-btn">
											<RefreshCw class="h-4 w-4 {gitBusy ? 'animate-spin' : ''}" />
											Sync now
										</button>
									{/if}
								</div>
							{/if}
						{:else}
							<!-- R2 Sync Configuration -->
							<div class="set-block">
								<div>
									<div class="set-row-label">Cloudflare R2</div>
									<p class="set-row-help">
										Sync through your own Cloudflare Worker. See <em>Sync setup</em> under About for a
										walkthrough.
									</p>
								</div>
								<div>
									<label for="syncUrl" class="k-label">Worker URL</label>
									<input id="syncUrl" type="url" bind:value={syncUrl} placeholder="https://kurumi-sync.your-domain.workers.dev/sync" class="k-input" />
								</div>
								<div>
									<label for="syncToken" class="k-label">Sync token</label>
									<input id="syncToken" type="password" bind:value={syncToken} placeholder="Your sync authentication token" class="k-input" />
								</div>
								<div class="set-actions">
									<button onclick={saveSyncSettings} class="k-btn k-btn-primary">
										{#if showSaved}<Check class="h-4 w-4" />Saved{:else}Save{/if}
									</button>
									<button onclick={handleTestConnection} disabled={isTesting || !syncUrl || !syncToken} class="k-btn">
										{#if isTesting}{@render spinner()}{:else}<Wifi class="h-4 w-4" />{/if}
										Test connection
									</button>
									{@render testResultLine(testResult, 'Connected')}
								</div>
							</div>

							{#if isR2SyncConfigured()}
								<div class="set-row">
									<div class="set-row-text">
										<div class="set-row-label flex flex-wrap items-center gap-2">
											Status
											{#if $syncState.status === 'syncing'}
												<span class="k-badge k-badge-accent">{@render spinner()}Syncing…</span>
											{:else if $syncState.status === 'success'}
												<span class="k-badge k-badge-success">Synced</span>
											{:else if $syncState.status === 'error'}
												<span class="k-badge k-badge-danger">Error</span>
											{:else}
												<span class="k-badge">Ready</span>
											{/if}
										</div>
										{#if $syncState.status === 'error'}
											<p class="set-row-help !text-[var(--color-danger)]">{$syncState.error || 'Sync failed'}</p>
										{:else if $syncState.lastSyncedAt}
											<p class="set-row-help">Last synced {formatTimestamp($syncState.lastSyncedAt).toLowerCase()}</p>
										{/if}
									</div>
									<button onclick={handleSync} disabled={$syncState.status === 'syncing'} class="k-btn">
										<RefreshCw class="h-4 w-4 {$syncState.status === 'syncing' ? 'animate-spin' : ''}" />
										Sync now
									</button>
								</div>
							{/if}
						{/if}
					</div>
				</section>

				<!-- Local AI -->
				<section id="local-ai" class="set-section" aria-labelledby="local-ai-title">
					<h2 id="local-ai-title" class="set-section-title">
						Local AI
						{#if $localInferenceSettings.enabled}
							<span class="k-badge k-badge-success">On</span>
						{/if}
					</h2>
					<p class="set-section-desc">
						Models run entirely in your browser (WebGPU/WASM) and are cached after the first
						download. Nothing is sent to a server.
					</p>
					<div class="set-rows">
						<label class="set-row">
							<div class="set-row-text">
								<div class="set-row-label">Enable local inference</div>
								<p class="set-row-help">When off, transcription falls back to a remote provider if one is configured.</p>
							</div>
							<input
								type="checkbox"
								class="switch"
								checked={$localInferenceSettings.enabled}
								onchange={(e) => updateLocalInferenceSettings({ enabled: (e.target as HTMLInputElement).checked })}
							/>
						</label>

						<label class="set-row">
							<div class="set-row-text">
								<div class="set-row-label">Preload on startup</div>
								<p class="set-row-help">Download models in the background when the app loads, so capture is instant.</p>
							</div>
							<input
								type="checkbox"
								class="switch"
								checked={$localInferenceSettings.preloadOnStartup}
								onchange={(e) => updateLocalInferenceSettings({ preloadOnStartup: (e.target as HTMLInputElement).checked })}
							/>
						</label>

						<div class="set-row">
							<div class="set-row-text">
								<label for="whisper-model" class="set-row-label">Transcription model</label>
								<p class="set-row-help">Whisper, for voice memos and meetings.</p>
								{@render modelStatusLine(whisperStatus, () => preloadPipeline('transcribe', currentWhisperModelId, { dtype: 'fp32' }))}
							</div>
							<select
								id="whisper-model"
								value={$localInferenceSettings.whisperModel}
								onchange={(e) => updateLocalInferenceSettings({ whisperModel: (e.target as HTMLSelectElement).value as WhisperModelSize })}
								class="k-input set-select"
							>
								<option value="tiny">{whisperModelLabel('tiny')}</option>
								<option value="base">{whisperModelLabel('base')}</option>
								<option value="small">{whisperModelLabel('small')}</option>
							</select>
						</div>

						<label class="set-row">
							<div class="set-row-text">
								<div class="set-row-label">Local text generation</div>
								<p class="set-row-help">Run summaries and title generation on-device. Larger download (~360 MB+).</p>
							</div>
							<input
								type="checkbox"
								class="switch"
								checked={$localInferenceSettings.textModelEnabled}
								onchange={(e) => updateLocalInferenceSettings({ textModelEnabled: (e.target as HTMLInputElement).checked })}
							/>
						</label>

						{#if $localInferenceSettings.textModelEnabled}
							<div class="set-row set-row-nested">
								<div class="set-row-text">
									<label for="text-model" class="set-row-label">Text model</label>
									{@render modelStatusLine(textStatus, () => preloadPipeline('text-generation', currentTextModelId))}
								</div>
								<select
									id="text-model"
									value={$localInferenceSettings.textModel}
									onchange={(e) => updateLocalInferenceSettings({ textModel: (e.target as HTMLSelectElement).value as TextModelChoice })}
									class="k-input set-select"
								>
									<option value="smollm2-360m">{textModelLabel('smollm2-360m')}</option>
									<option value="qwen2-0_5b">{textModelLabel('qwen2-0_5b')}</option>
									<option value="llama-3_2-1b">{textModelLabel('llama-3_2-1b')}</option>
									<option value="llama-3_2-3b">{textModelLabel('llama-3_2-3b')}</option>
									<option value="qwen2_5-3b">{textModelLabel('qwen2_5-3b')}</option>
								</select>
							</div>
						{/if}

						<label class="set-row">
							<div class="set-row-text">
								<div class="set-row-label">Semantic search embeddings</div>
								<p class="set-row-help">
									Lets Ask Kurumi find memories by meaning, not just keywords. Small download
									(~25 MB), runs on-device.
								</p>
							</div>
							<input
								type="checkbox"
								class="switch"
								checked={$localInferenceSettings.embedModelEnabled}
								onchange={(e) =>
									updateLocalInferenceSettings({
										embedModelEnabled: (e.target as HTMLInputElement).checked
									})}
							/>
						</label>

						{#if $localInferenceSettings.embedModelEnabled}
							<div class="set-row set-row-nested">
								<div class="set-row-text">
									<label for="embed-model" class="set-row-label">Embedding model</label>
									{@render modelStatusLine(embedStatus, () => preloadPipeline('embed', currentEmbedModelId))}
								</div>
								<select
									id="embed-model"
									value={$localInferenceSettings.embedModel}
									onchange={(e) =>
										updateLocalInferenceSettings({
											embedModel: (e.target as HTMLSelectElement).value as EmbedModelChoice
										})}
									class="k-input set-select"
								>
									<option value="mini-lm-l6">{embedModelLabel('mini-lm-l6')}</option>
									<option value="multilingual-e5-small">
										{embedModelLabel('multilingual-e5-small')}
									</option>
								</select>
							</div>
						{/if}

						<div class="set-row">
							<div class="set-row-text">
								<div class="set-row-label">Model cache</div>
								<p class="set-row-help">Stuck on a broken download? Clear the cache and re-download the transcription model.</p>
							</div>
							<button
								type="button"
								onclick={async () => {
									await clearLocalModelCache();
									// Re-trigger preload with the current settings
									preloadPipeline('transcribe', currentWhisperModelId, { dtype: 'fp32' });
								}}
								class="k-btn"
							>
								Clear cache
							</button>
						</div>
					</div>
				</section>

				<!-- AI Assistant -->
				<section id="ai" class="set-section" aria-labelledby="ai-title">
					<h2 id="ai-title" class="set-section-title">
						AI assistant
						{#if isAIConfigured()}
							<span class="k-badge k-badge-success">Configured</span>
						{/if}
					</h2>
					<p class="set-section-desc">
						Remote models for Ask Kurumi and editor actions (improve, expand, summarize, translate).
					</p>
					<div class="set-rows">
						<div class="set-row">
							<div class="set-row-text">
								<div class="set-row-label" id="ai-provider-label">Provider</div>
								<p class="set-row-help">Primary provider for remote inference.</p>
							</div>
							<div class="k-segmented" role="group" aria-labelledby="ai-provider-label">
								<button aria-pressed={aiProvider === 'openai'} onclick={() => handleProviderChange('openai')} class="inline-flex items-center gap-1.5">
									<!-- OpenAI Logo -->
									<svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
										<path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z"/>
									</svg>
									OpenAI
								</button>
								<button aria-pressed={aiProvider === 'anthropic'} onclick={() => handleProviderChange('anthropic')} class="inline-flex items-center gap-1.5">
									<!-- Anthropic Logo -->
									<svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
										<path d="M13.827 3.52h3.603L24 20.48h-3.603l-6.57-16.96zm-7.258 0h3.767L16.906 20.48h-3.674l-1.343-3.461H5.017l-1.344 3.46H0L6.57 3.522zm1.04 3.781L5.246 14.14h4.726L7.609 7.301z"/>
									</svg>
									Anthropic
								</button>
							</div>
						</div>

						<div class="set-block">
							<div class="grid gap-3 sm:grid-cols-2">
								<div>
									<label for="aiApiKey" class="k-label">{aiProvider === 'openai' ? 'OpenAI' : 'Anthropic'} API key</label>
									{#if aiProvider === 'openai'}
										<input id="aiApiKey" type="password" bind:value={openaiKey} placeholder="sk-..." class="k-input font-mono" />
									{:else}
										<input id="aiApiKey" type="password" bind:value={anthropicKey} placeholder="sk-ant-..." class="k-input font-mono" />
									{/if}
									<p class="k-help">
										{#if aiProvider === 'openai'}
											Get a key from the <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener" class="text-[var(--color-accent)] hover:underline">OpenAI dashboard</a>
										{:else}
											Get a key from the <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener" class="text-[var(--color-accent)] hover:underline">Anthropic console</a>
										{/if}
									</p>
								</div>
								<div>
									<label for="aiModel" class="k-label">Model</label>
									<select id="aiModel" bind:value={aiModel} class="k-input">
										{#each availableModels as model}
											<option value={model.id}>{model.name}</option>
										{/each}
									</select>
								</div>
							</div>
							<div class="set-actions">
								<button onclick={handleSaveAISettings} class="k-btn k-btn-primary">
									{#if showAISaved}<Check class="h-4 w-4" />Saved{:else}Save{/if}
								</button>
								<button onclick={handleTestAI} disabled={isTestingAI || !currentApiKey} class="k-btn">
									{#if isTestingAI}{@render spinner()}{:else}<Sparkles class="h-4 w-4" />{/if}
									Test connection
								</button>
								{@render testResultLine(aiTestResult, 'Connected')}
							</div>
						</div>

						<div class="set-block">
							<div>
								<div class="set-row-label">Additional providers</div>
								<p class="set-row-help">
									Fallbacks when the primary provider fails or isn't configured. All use
									OpenAI-compatible APIs and are tried in order. Keys save when you leave the field.
								</p>
							</div>
							<div class="space-y-2">
								{#each PROVIDER_CONFIGS as config (config.id)}
									<div class="flex items-center gap-3">
										<label for="provider-key-{config.id}" class="w-28 shrink-0 truncate text-sm text-[var(--color-text)]">{config.name}</label>
										<input
											id="provider-key-{config.id}"
											type="password"
											value={extraProviderKeys[config.apiKeyStorageKey] || ''}
											oninput={(e) => {
												extraProviderKeys[config.apiKeyStorageKey] = (e.target as HTMLInputElement).value;
											}}
											onblur={() => saveExtraProviderKey(config.apiKeyStorageKey, extraProviderKeys[config.apiKeyStorageKey] || '')}
											placeholder={config.id === 'azure-openai' ? 'API key (set endpoint below)' : 'API key'}
											class="k-input !h-8 min-w-0 flex-1 font-mono !text-xs"
										/>
										<span class="w-10 shrink-0">
											{#if extraProviderKeys[config.apiKeyStorageKey]}
												<span class="k-badge k-badge-success" title="Key set">Set</span>
											{/if}
										</span>
									</div>
								{/each}
							</div>
						</div>
					</div>
				</section>

				<!-- Notifications -->
				<section id="notifications" class="set-section" aria-labelledby="notifications-title">
					<h2 id="notifications-title" class="set-section-title">
						Notifications
						{#if notifEnabled}
							<span class="k-badge k-badge-success">On</span>
						{/if}
					</h2>
					<p class="set-section-desc">Browser alerts when action items come due.</p>
					<div class="set-rows">
						{#if !notifSupported}
							<p class="set-row text-sm text-[var(--color-text-muted)]">Your browser doesn't support notifications.</p>
						{:else if notifPermission === 'denied'}
							<p class="set-row text-sm text-[var(--color-text-muted)]">
								Notifications are blocked by the browser. Re-enable them in your browser's site
								settings and reload the page.
							</p>
						{:else}
							<div class="set-row">
								<div class="set-row-text">
									<div class="set-row-label" id="notif-label">While the app is open</div>
									<p class="set-row-help">
										Checks every minute while a tab is open and notifies you of each due action item.
										Clicking a notification opens Actions.
									</p>
								</div>
								<button
									role="switch"
									aria-checked={notifEnabled}
									aria-labelledby="notif-label"
									onclick={handleNotifToggle}
									class="switch"
								></button>
							</div>

							<div class="set-row">
								<div class="set-row-text">
									<div class="set-row-label flex items-center gap-2" id="bg-notif-label">
										When the app is closed
										<span class="k-badge">Experimental</span>
									</div>
									<p class="set-row-help">
										{#if bgNotifSupported}
											Uses Periodic Background Sync so notifications can fire with no Kurumi tab open.
											The browser decides the real interval, typically every few hours.
										{:else}
											Needs Kurumi installed as a PWA in a browser with Periodic Background Sync
											(currently Chrome or Edge).
										{/if}
									</p>
									{#if bgNotifError}
										<p class="mt-1 text-xs text-[var(--color-danger)]" role="alert">{bgNotifError}</p>
									{/if}
								</div>
								<button
									role="switch"
									aria-checked={bgNotifEnabled}
									aria-labelledby="bg-notif-label"
									onclick={handleBackgroundNotifToggle}
									disabled={!bgNotifSupported}
									class="switch"
								></button>
							</div>
						{/if}
					</div>
				</section>

				<!-- Data -->
				<section id="data" class="set-section" aria-labelledby="data-title">
					<h2 id="data-title" class="set-section-title">Data</h2>
					<p class="set-section-desc">
						Back up, export, or bring in notes from other apps.
						{$vaults.length} {$vaults.length === 1 ? 'vault' : 'vaults'} · {$folders.length} {$folders.length === 1 ? 'folder' : 'folders'} · {$memoryObjects.length} {$memoryObjects.length === 1 ? 'note' : 'notes'}.
					</p>
					<div class="set-rows">
						<div class="set-row">
							<div class="set-row-text">
								<div class="set-row-label">JSON backup</div>
								<p class="set-row-help">A full backup of all vaults, for restoring or moving to another device.</p>
								{#if importError && !showImportModal}
									<p class="mt-2 flex items-start gap-1.5 text-xs text-[var(--color-danger)]" role="alert">
										<AlertTriangle class="mt-px h-3.5 w-3.5 shrink-0" />
										{importError}
									</p>
								{/if}
								{#if importSuccess}
									{@render importResultLine(
										{ success: true },
										`Imported ${importSuccess.vaults} ${importSuccess.vaults === 1 ? 'vault' : 'vaults'}, ${importSuccess.folders} ${importSuccess.folders === 1 ? 'folder' : 'folders'}, ${importSuccess.memoryObjects} ${importSuccess.memoryObjects === 1 ? 'note' : 'notes'}`
									)}
								{/if}
							</div>
							<div class="set-actions">
								<input type="file" accept=".json,application/json" class="hidden" bind:this={fileInputRef} onchange={handleFileSelect} />
								<button onclick={triggerFileInput} class="k-btn">
									<Upload class="h-4 w-4" />
									Import
								</button>
								<button onclick={handleExport} class="k-btn">
									<Download class="h-4 w-4" />
									Export
								</button>
							</div>
						</div>

						<div class="set-row">
							<div class="set-row-text">
								<div class="set-row-label" id="md-export-label">Export as Markdown</div>
								<p class="set-row-help">The current vault as markdown files with its folder structure.</p>
							</div>
							<div class="set-actions" role="group" aria-labelledby="md-export-label">
								{#each [
									{ id: 'vanilla', label: 'Markdown' },
									{ id: 'hugo', label: 'Hugo' },
									{ id: 'zola', label: 'Zola' }
								] as fmt (fmt.id)}
									<button
										onclick={() => handleMarkdownExport(fmt.id as MarkdownExportFormat)}
										disabled={isExportingMarkdown}
										class="k-btn"
									>
										{#if isExportingMarkdown && markdownExportFormat === fmt.id}{@render spinner()}{:else}<Download class="h-4 w-4" />{/if}
										{fmt.label}
									</button>
								{/each}
							</div>
						</div>

						<div class="set-row">
							<div class="set-row-text">
								<div class="set-row-label">Import a markdown folder</div>
								<p class="set-row-help">
									Any folder of <code>.md</code> files: Obsidian, Logseq, Bear, Notion export, or Foam.
									Subfolders become nested folders.
								</p>
								{#if obsidianImportResult}
									{@render importResultLine(
										obsidianImportResult,
										`Imported ${obsidianImportResult.foldersCreated} ${obsidianImportResult.foldersCreated === 1 ? 'folder' : 'folders'} and ${obsidianImportResult.notesCreated} ${obsidianImportResult.notesCreated === 1 ? 'note' : 'notes'}`,
										obsidianImportResult.skipped.length > 0 ? `skipped ${obsidianImportResult.skipped.length} items (hidden files, non-markdown, etc.)` : undefined
									)}
								{/if}
							</div>
							<button onclick={handleObsidianImport} disabled={isImportingObsidian} class="k-btn">
								{#if isImportingObsidian}{@render spinner()}Importing…{:else}<Upload class="h-4 w-4" />Select folder{/if}
							</button>
						</div>

						<div class="set-row">
							<div class="set-row-text">
								<div class="set-row-label">Import from Roam Research</div>
								<p class="set-row-help">
									A Roam JSON export. Each page becomes a memory with its outline as nested bullets;
									<code>{'{{TODO}}'}</code>/<code>{'{{DONE}}'}</code> become checklist items.
								</p>
								{#if roamImportResult}
									{@render importResultLine(
										roamImportResult,
										`Imported ${roamImportResult.pagesCreated} ${roamImportResult.pagesCreated === 1 ? 'page' : 'pages'} (${roamImportResult.blockCount} blocks)`,
										roamImportResult.skipped.length > 0 ? `skipped ${roamImportResult.skipped.length} items` : undefined
									)}
								{/if}
							</div>
							<input bind:this={roamFileInputRef} type="file" accept=".json,application/json" onchange={handleRoamFileSelect} class="hidden" />
							<button onclick={triggerRoamImport} disabled={isImportingRoam} class="k-btn">
								{#if isImportingRoam}{@render spinner()}Importing…{:else}<Upload class="h-4 w-4" />Select file{/if}
							</button>
						</div>

						<div class="set-row">
							<div class="set-row-text">
								<div class="set-row-label">Import from Evernote</div>
								<p class="set-row-help">An <code>.enex</code> export. Notes become markdown with tags kept as #hashtags.</p>
								{#if evernoteImportResult}
									{@render importResultLine(
										evernoteImportResult,
										`Imported ${evernoteImportResult.notesCreated} note${evernoteImportResult.notesCreated === 1 ? '' : 's'}`
									)}
								{/if}
							</div>
							<input bind:this={evernoteFileInputRef} type="file" accept=".enex,application/xml,text/xml" onchange={handleEvernoteFileSelect} class="hidden" />
							<button onclick={triggerEvernoteImport} disabled={isImportingEvernote} class="k-btn">
								{#if isImportingEvernote}{@render spinner()}Importing…{:else}<Upload class="h-4 w-4" />Select file{/if}
							</button>
						</div>

						<div class="set-row">
							<div class="set-row-text">
								<div class="set-row-label">Web clipper</div>
								<p class="set-row-help">
									Drag the button to your bookmarks bar. Click it on any page to save its title, URL
									and selected text as a new memory.
								</p>
							</div>
							{#if bookmarkletUrl}
								<a
									href={bookmarkletUrl}
									class="k-btn cursor-grab no-underline"
									title="Drag to your bookmarks bar"
									onclick={(e) => { e.preventDefault(); alert('Drag this link to your bookmarks bar — don\'t click it here!'); }}
								>
									<BookOpen class="h-4 w-4" />
									Clip to Kurumi
								</a>
							{/if}
						</div>
					</div>
				</section>

				<!-- About & Documentation -->
				<section id="about" class="set-section" aria-labelledby="about-title">
					<h2 id="about-title" class="set-section-title">About</h2>
					<p class="set-section-desc">Version info and guides.</p>
					<div class="set-rows">
						<div class="set-row">
							<div class="flex min-w-0 items-center gap-3">
								<img src="/icon-192.avif" alt="" class="h-9 w-9 shrink-0 rounded-lg" />
								<div class="min-w-0">
									<div class="set-row-label">Kurumi <span class="font-normal text-[var(--color-text-faint)]">v0.1.0</span></div>
									<p class="set-row-help">
										Your local-first second brain. Built with SvelteKit, Automerge and Tailwind CSS;
										data is stored locally in IndexedDB.
									</p>
								</div>
							</div>
							<a href="https://ko-fi.com/raskell" target="_blank" rel="noopener" class="k-btn no-underline">
								<svg class="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
									<path d="M23.881 8.948c-.773-4.085-4.859-4.593-4.859-4.593H.723c-.604 0-.679.798-.679.798s-.082 7.324-.022 11.822c.164 2.424 2.586 2.672 2.586 2.672s8.267-.023 11.966-.049c2.438-.426 2.683-2.566 2.658-3.734 4.352.24 7.422-2.831 6.649-6.916zm-11.062 3.511c-1.246 1.453-4.011 3.976-4.011 3.976s-.121.119-.31.023c-.076-.057-.108-.09-.108-.09-.443-.441-3.368-3.049-4.034-3.954-.709-.965-1.041-2.7-.091-3.71.951-1.01 3.005-1.086 4.363.407 0 0 1.565-1.782 3.468-.963 1.904.82 1.832 3.011.723 4.311z"/>
								</svg>
								Support on Ko-fi
							</a>
						</div>

						<!-- Sync Setup -->
						<details class="set-disclosure" bind:open={showSyncDocs}>
							<summary>
								<Cloud class="h-4 w-4 text-[var(--color-text-faint)]" />
								<span class="flex-1">Sync setup (Cloudflare R2)</span>
								<ChevronDown class="disclosure-chevron h-4 w-4 text-[var(--color-text-faint)]" />
							</summary>
							<div class="docs-content pb-4 pl-6 text-sm">
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
									<li>In the <strong>Sync</strong> section above, choose <strong>R2</strong> and enter your Worker URL</li>
									<li>Enter the sync token from Step 2</li>
									<li>Click <strong>Save</strong> then <strong>Test connection</strong></li>
								</ol>

								<h4>Cost</h4>
								<p>Cloudflare's free tier includes:</p>
								<ul>
									<li><strong>Workers:</strong> 100,000 requests/day</li>
									<li><strong>R2:</strong> 10 GB storage, 10M reads/month, 1M writes/month</li>
								</ul>
								<p>For personal use, you'll likely never exceed these limits.</p>
							</div>
						</details>

						<!-- Architecture -->
						<details class="set-disclosure" bind:open={showArchDocs}>
							<summary>
								<Shield class="h-4 w-4 text-[var(--color-text-faint)]" />
								<span class="flex-1">Architecture & privacy</span>
								<ChevronDown class="disclosure-chevron h-4 w-4 text-[var(--color-text-faint)]" />
							</summary>
							<div class="docs-content pb-4 pl-6 text-sm">
								<h4>Local-first architecture</h4>
								<p>Your data lives on your device first, with optional sync to other devices you control.</p>
								<ul>
									<li><strong>IndexedDB</strong> - all notes stored locally in your browser</li>
									<li><strong>Automerge CRDT</strong> - conflict-free sync between devices</li>
								</ul>

								<h4>Security</h4>
								<ul>
									<li><strong>HTTPS/TLS encrypted</strong> - All sync traffic is encrypted</li>
									<li><strong>Bearer token auth</strong> - Only requests with your token can access your data</li>
									<li><strong>Encrypted storage</strong> - R2 data is encrypted by Cloudflare</li>
								</ul>

								<h4>Privacy</h4>
								<p><strong>What we see: nothing.</strong> No servers, no analytics, no telemetry. Kurumi is a static web app.</p>

								<h4>Recommendations</h4>
								<ul>
									<li>Use a strong sync token: <code>openssl rand -base64 32</code></li>
									<li>Enable 2FA on your Cloudflare account</li>
									<li>Regularly export backups to JSON</li>
								</ul>
							</div>
						</details>
					</div>
				</section>

				<!-- Danger Zone -->
				<section id="danger" class="set-section" aria-labelledby="danger-title">
					<h2 id="danger-title" class="set-section-title !text-[var(--color-danger)]">Danger zone</h2>
					<p class="set-section-desc">Irreversible actions. Export a backup first.</p>
					<div class="set-rows">
						<div class="set-row">
							<div class="set-row-text">
								<div class="set-row-label">Clear all data</div>
								<p class="set-row-help">Permanently delete every vault, folder and note on this device, and reset preferences.</p>
							</div>
							<button onclick={startClearData} class="k-btn k-btn-danger">
								<Trash2 class="h-4 w-4" />
								Clear data…
							</button>
						</div>
					</div>
				</section>

				<!-- Bottom safe area spacer -->
				<div class="h-8 safe-bottom md:h-0"></div>
			</div>
		</div>
	</div>
</div>

<!-- Import Modal -->
{#if showImportModal && importAnalysis}
	<div
		class="k-dialog-backdrop"
		onclick={closeImportModal}
		onkeydown={(e) => e.key === 'Escape' && closeImportModal()}
		role="dialog"
		aria-modal="true"
		aria-labelledby="import-title"
		tabindex="-1"
	>
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<div class="k-dialog p-5" onclick={(e) => e.stopPropagation()} role="document">
			<div class="mb-3 flex items-center justify-between">
				<h2 id="import-title" class="text-base font-semibold text-[var(--color-text)]">Import backup</h2>
				<button onclick={closeImportModal} class="k-icon-btn" aria-label="Close">
					<X class="h-4 w-4" />
				</button>
			</div>

			<!-- Import summary -->
			<p class="text-sm text-[var(--color-text-muted)]">
				<strong class="font-medium text-[var(--color-text)]">{importAnalysis.newVaults.length + importAnalysis.vaultConflicts.length}</strong> vaults ·
				<strong class="font-medium text-[var(--color-text)]">{importAnalysis.totalFolders}</strong> folders ·
				<strong class="font-medium text-[var(--color-text)]">{importAnalysis.totalMemoryObjects}</strong> notes
			</p>

			{#if importAnalysis.hasConflicts}
				<!-- Conflict warning -->
				<div class="mt-4 text-sm">
					<p class="flex items-center gap-2 font-medium text-[var(--color-text)]">
						<span class="k-badge k-badge-warn">Conflict</span>
						{importAnalysis.vaultConflicts.length} {importAnalysis.vaultConflicts.length === 1 ? 'vault already exists' : 'vaults already exist'}
					</p>
					<ul class="mt-2 space-y-0.5 pl-1 text-[var(--color-text-muted)]">
						{#each importAnalysis.vaultConflicts as conflict}
							<li>• {conflict.existingVault.name}</li>
						{/each}
					</ul>
				</div>

				<p class="mb-2 mt-4 text-sm text-[var(--color-text-muted)]">How should conflicting vaults be handled?</p>

				<div class="space-y-1.5">
					<button onclick={() => handleImport('overwrite')} disabled={isImporting} class="k-btn w-full !justify-start">
						{#if isImporting}{@render spinner()}{/if}
						Overwrite existing vaults
					</button>
					<button onclick={() => handleImport('duplicate')} disabled={isImporting} class="k-btn w-full !justify-start">
						{#if isImporting}{@render spinner()}{/if}
						Create duplicates with new IDs
					</button>
					<button onclick={() => handleImport('skip')} disabled={isImporting} class="k-btn k-btn-ghost w-full !justify-start">
						{#if isImporting}{@render spinner()}{/if}
						Skip conflicting vaults
					</button>
				</div>
			{:else}
				<!-- No conflicts -->
				<p class="mt-2 text-sm text-[var(--color-text-muted)]">No conflicts detected. Ready to import.</p>

				<div class="mt-5 flex justify-end gap-2">
					<button onclick={closeImportModal} class="k-btn k-btn-ghost">Cancel</button>
					<button onclick={() => handleImport('skip')} disabled={isImporting} class="k-btn k-btn-primary">
						{#if isImporting}{@render spinner()}{/if}
						Import
					</button>
				</div>
			{/if}

			{#if importError}
				<p class="mt-4 flex items-start gap-1.5 text-xs text-[var(--color-danger)]" role="alert">
					<AlertTriangle class="mt-px h-3.5 w-3.5 shrink-0" />
					{importError}
				</p>
			{/if}
		</div>
	</div>
{/if}

<!-- Clear Data Confirmation Step 1 -->
{#if showClearConfirm1}
	<div
		class="k-dialog-backdrop"
		onclick={cancelClear}
		onkeydown={(e) => e.key === 'Escape' && cancelClear()}
		role="dialog"
		aria-modal="true"
		aria-labelledby="clear1-title"
		tabindex="-1"
	>
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<div class="k-dialog p-5" onclick={(e) => e.stopPropagation()} role="document">
			<h2 id="clear1-title" class="text-base font-semibold text-[var(--color-text)]">Clear all data?</h2>
			<p class="mt-2 text-sm text-[var(--color-text-muted)]">This permanently deletes everything on this device:</p>
			<ul class="mt-3 space-y-1 text-sm text-[var(--color-text)]">
				<li class="flex items-center gap-2"><Trash2 class="h-3.5 w-3.5 text-[var(--color-danger)]" />All vaults ({$vaults.length})</li>
				<li class="flex items-center gap-2"><Trash2 class="h-3.5 w-3.5 text-[var(--color-danger)]" />All folders ({$folders.length})</li>
				<li class="flex items-center gap-2"><Trash2 class="h-3.5 w-3.5 text-[var(--color-danger)]" />All notes ({$memoryObjects.length})</li>
			</ul>
			<div class="mt-5 flex justify-end gap-2">
				<button onclick={cancelClear} class="k-btn k-btn-ghost" use:autofocus>Cancel</button>
				<button onclick={proceedToClearStep2} class="k-btn k-btn-danger">Continue</button>
			</div>
		</div>
	</div>
{/if}

<!-- Clear Data Confirmation Step 2 -->
{#if showClearConfirm2}
	<div
		class="k-dialog-backdrop"
		onclick={cancelClear}
		onkeydown={(e) => e.key === 'Escape' && cancelClear()}
		role="dialog"
		aria-modal="true"
		aria-labelledby="clear2-title"
		tabindex="-1"
	>
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<div class="k-dialog p-5" onclick={(e) => e.stopPropagation()} role="document">
			<h2 id="clear2-title" class="text-base font-semibold text-[var(--color-text)]">Final confirmation</h2>
			<p class="mt-2 text-sm text-[var(--color-text-muted)]">
				This can't be undone. Type <strong class="font-medium text-[var(--color-danger)]">DELETE ALL</strong> to confirm.
			</p>
			<input
				type="text"
				bind:value={clearConfirmText}
				placeholder="DELETE ALL"
				aria-label="Type DELETE ALL to confirm"
				class="k-input mt-3"
				use:autofocus
				autocomplete="off"
				onkeydown={(e) => e.key === 'Enter' && clearConfirmText === 'DELETE ALL' && confirmClearData()}
			/>
			<div class="mt-5 flex justify-end gap-2">
				<button onclick={cancelClear} class="k-btn k-btn-ghost">Cancel</button>
				<button onclick={confirmClearData} disabled={clearConfirmText !== 'DELETE ALL' || isClearing} class="k-btn k-btn-danger">
					{#if isClearing}{@render spinner()}{/if}
					Delete everything
				</button>
			</div>
		</div>
	</div>
{/if}

{#if showConflictModal}
	<GitConflictModal onClose={() => (showConflictModal = false)} />
{/if}

<style>
	/* ---- Settings page layout ---- */
	.settings-layout {
		display: flex;
		gap: 3rem;
	}

	.settings-nav {
		display: none;
	}

	/* Sticky section nav only when there's room beside the 46rem column */
	@media (min-width: 1280px) {
		.settings-page {
			max-width: 62rem;
		}

		.settings-nav {
			position: sticky;
			top: 3rem;
			display: flex;
			flex-direction: column;
			gap: 0.0625rem;
			width: 9rem;
			flex-shrink: 0;
			align-self: flex-start;
			padding-top: 0.25rem;
		}
	}

	.settings-nav-link {
		padding: 0.3125rem 0.625rem;
		border-radius: var(--radius-sm);
		font-size: 0.8125rem;
		color: var(--color-text-muted);
		text-decoration: none;
	}

	.settings-nav-link:hover {
		background: var(--color-hover);
		color: var(--color-text);
	}

	.settings-nav-link[aria-current='true'] {
		background: var(--color-active);
		color: var(--color-text);
		font-weight: 500;
	}

	.settings-nav-link.danger {
		margin-top: 0.75rem;
	}

	/* ---- Sections + rows ---- */
	.set-section {
		scroll-margin-top: 1.5rem;
		padding-top: 2.75rem;
	}

	.set-section:first-of-type {
		padding-top: 0;
	}

	.set-section-title {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.9375rem;
		font-weight: 600;
		color: var(--color-text);
	}

	.set-section-desc {
		margin-top: 0.125rem;
		font-size: 0.8125rem;
		color: var(--color-text-muted);
	}

	.set-rows {
		margin-top: 0.75rem;
		border-top: 1px solid var(--color-border);
	}

	.set-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.625rem 1.5rem;
		padding: 0.875rem 0;
		border-bottom: 1px solid var(--color-border);
	}

	/* Follow-up rows that belong to the toggle above them */
	.set-row-nested {
		padding-left: 1rem;
	}

	label.set-row {
		cursor: pointer;
	}

	.set-row-text {
		flex: 1 1 16rem;
		min-width: 0;
	}

	.set-row-label {
		display: block;
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--color-text);
	}

	.set-row-help {
		margin-top: 0.125rem;
		font-size: 0.75rem;
		line-height: 1.45;
		color: var(--color-text-muted);
	}

	/* Full-width stacked form inside the row list (sync/AI credentials) */
	.set-block {
		display: flex;
		flex-direction: column;
		gap: 0.875rem;
		padding: 1rem 0;
		border-bottom: 1px solid var(--color-border);
	}

	.set-actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
	}

	.set-select {
		width: auto;
		max-width: 100%;
		min-width: 12rem;
		height: 2rem;
		font-size: 0.8125rem;
	}

	.set-section code,
	.set-section :global(code) {
		font-family: var(--font-mono);
		font-size: 0.9em;
	}

	/* Toggle chip (mirrors) */
	.chip[aria-pressed='true'] {
		border-color: transparent;
		background: var(--color-accent-soft);
		color: var(--color-accent);
	}

	/* Switch: <input type="checkbox" class="switch"> or <button role="switch" aria-checked> */
	.switch {
		position: relative;
		flex-shrink: 0;
		width: 2rem;
		height: 1.125rem;
		border-radius: 999px;
		background: var(--color-active);
		appearance: none;
		cursor: pointer;
		transition: background 120ms var(--ease-out);
	}

	.switch::before {
		content: '';
		position: absolute;
		top: 0.125rem;
		left: 0.125rem;
		width: 0.875rem;
		height: 0.875rem;
		border-radius: 999px;
		background: var(--color-bg);
		box-shadow: var(--shadow-sm);
		transition: transform 120ms var(--ease-out);
	}

	.switch:checked,
	.switch[aria-checked='true'] {
		background: var(--color-accent);
	}

	.switch:checked::before,
	.switch[aria-checked='true']::before {
		transform: translateX(0.875rem);
	}

	.switch:focus-visible {
		outline: 2px solid var(--color-accent);
		outline-offset: 2px;
	}

	.switch:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	/* ---- Docs disclosures ---- */
	.set-disclosure {
		border-bottom: 1px solid var(--color-border);
	}

	.set-disclosure > summary {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.75rem 0;
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--color-text);
		cursor: pointer;
		list-style: none;
	}

	.set-disclosure > summary::-webkit-details-marker {
		display: none;
	}

	.set-disclosure > summary:hover {
		color: var(--color-accent);
	}

	.set-disclosure :global(.disclosure-chevron) {
		transition: transform 120ms var(--ease-out);
	}

	.set-disclosure[open] :global(.disclosure-chevron) {
		transform: rotate(180deg);
	}

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
		background: var(--color-hover);
		padding: 0.125rem 0.375rem;
		border-radius: 0.25rem;
		font-size: 0.85em;
	}

	.docs-content pre {
		background: var(--color-bg-secondary);
		padding: 0.75rem 1rem;
		border-radius: var(--radius-md);
		overflow-x: auto;
		margin: 0.75rem 0;
	}

	.docs-content pre code {
		background: none;
		padding: 0;
	}
</style>
