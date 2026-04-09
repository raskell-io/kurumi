/**
 * Azure Blob Storage sync client.
 *
 * Uses SAS (Shared Access Signature) token auth — the simplest
 * approach for browser-side access. The user generates a SAS token
 * with Read + Write + Create permissions on the container from the
 * Azure Portal, and pastes it here.
 *
 * Object path: kurumi-sync/<vault-id>.bin
 *
 * CORS must be configured on the storage account.
 */

export interface AzureBlobConfig {
	accountUrl: string; // e.g. "https://myaccount.blob.core.windows.net"
	container: string; // e.g. "kurumi"
	sasToken: string; // starts with ? — e.g. "?sv=2023-11-03&ss=b&srt=sco&..."
}

const STORAGE_KEYS = {
	accountUrl: 'kurumi-azure-blob-url',
	container: 'kurumi-azure-blob-container',
	sasToken: 'kurumi-azure-blob-sas'
};

export function getAzureBlobConfig(): AzureBlobConfig | null {
	if (typeof localStorage === 'undefined') return null;
	const accountUrl = localStorage.getItem(STORAGE_KEYS.accountUrl);
	const container = localStorage.getItem(STORAGE_KEYS.container);
	const sasToken = localStorage.getItem(STORAGE_KEYS.sasToken);
	if (!accountUrl || !container || !sasToken) return null;
	return { accountUrl, container, sasToken };
}

export function saveAzureBlobConfig(config: AzureBlobConfig): void {
	if (typeof localStorage === 'undefined') return;
	localStorage.setItem(STORAGE_KEYS.accountUrl, config.accountUrl);
	localStorage.setItem(STORAGE_KEYS.container, config.container);
	localStorage.setItem(STORAGE_KEYS.sasToken, config.sasToken);
}

export function isAzureBlobConfigured(): boolean {
	return getAzureBlobConfig() !== null;
}

function blobUrl(config: AzureBlobConfig, vaultId: string): string {
	const base = config.accountUrl.replace(/\/+$/, '');
	const sas = config.sasToken.startsWith('?') ? config.sasToken : `?${config.sasToken}`;
	return `${base}/${config.container}/kurumi-sync/${vaultId}.bin${sas}`;
}

export async function azureBlobPull(
	config: AzureBlobConfig,
	vaultId: string
): Promise<Uint8Array | null> {
	const url = blobUrl(config, vaultId);
	const response = await fetch(url, {
		headers: { 'x-ms-blob-type': 'BlockBlob' }
	});
	if (response.status === 404) return null;
	if (!response.ok) {
		throw new Error(`Azure Blob GET failed (${response.status})`);
	}
	return new Uint8Array(await response.arrayBuffer());
}

export async function azureBlobPush(
	config: AzureBlobConfig,
	vaultId: string,
	data: Uint8Array
): Promise<void> {
	const url = blobUrl(config, vaultId);
	const response = await fetch(url, {
		method: 'PUT',
		headers: {
			'x-ms-blob-type': 'BlockBlob',
			'Content-Type': 'application/octet-stream'
		},
		body: data.buffer as ArrayBuffer
	});
	if (!response.ok) {
		throw new Error(`Azure Blob PUT failed (${response.status})`);
	}
}

export async function azureBlobTest(
	config: AzureBlobConfig
): Promise<{ success: boolean; error?: string }> {
	try {
		const base = config.accountUrl.replace(/\/+$/, '');
		const sas = config.sasToken.startsWith('?') ? config.sasToken : `?${config.sasToken}`;
		const url = `${base}/${config.container}${sas}&restype=container&comp=list&maxresults=1`;
		const response = await fetch(url);
		if (response.status === 403 || response.status === 401) {
			return { success: false, error: 'SAS token invalid or expired' };
		}
		if (response.ok || response.status === 200) {
			return { success: true };
		}
		return { success: false, error: `Azure returned ${response.status}` };
	} catch (err) {
		return {
			success: false,
			error: err instanceof Error ? err.message : 'Connection failed'
		};
	}
}
