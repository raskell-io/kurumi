/**
 * S3-compatible sync client.
 *
 * Implements AWS Signature Version 4 signing entirely in the browser
 * via the Web Crypto API. Works with any S3-compatible storage:
 * AWS S3, MinIO, Backblaze B2, DigitalOcean Spaces, Cloudflare R2
 * (S3 API), Wasabi, etc.
 *
 * The Automerge binary is stored as a single object at:
 *   s3://<bucket>/kurumi-sync/<vault-id>.bin
 *
 * CORS must be configured on the bucket to allow GET/PUT/HEAD from
 * the app's origin.
 */

export interface S3Config {
	endpoint: string; // e.g. "https://s3.us-east-1.amazonaws.com" or "https://minio.example.com"
	bucket: string;
	region: string; // e.g. "us-east-1"
	accessKeyId: string;
	secretAccessKey: string;
}

const STORAGE_KEYS = {
	endpoint: 'kurumi-s3-endpoint',
	bucket: 'kurumi-s3-bucket',
	region: 'kurumi-s3-region',
	accessKeyId: 'kurumi-s3-access-key',
	secretAccessKey: 'kurumi-s3-secret-key'
};

export function getS3Config(): S3Config | null {
	if (typeof localStorage === 'undefined') return null;
	const endpoint = localStorage.getItem(STORAGE_KEYS.endpoint);
	const bucket = localStorage.getItem(STORAGE_KEYS.bucket);
	const region = localStorage.getItem(STORAGE_KEYS.region);
	const accessKeyId = localStorage.getItem(STORAGE_KEYS.accessKeyId);
	const secretAccessKey = localStorage.getItem(STORAGE_KEYS.secretAccessKey);
	if (!endpoint || !bucket || !region || !accessKeyId || !secretAccessKey) return null;
	return { endpoint, bucket, region, accessKeyId, secretAccessKey };
}

export function saveS3Config(config: S3Config): void {
	if (typeof localStorage === 'undefined') return;
	localStorage.setItem(STORAGE_KEYS.endpoint, config.endpoint);
	localStorage.setItem(STORAGE_KEYS.bucket, config.bucket);
	localStorage.setItem(STORAGE_KEYS.region, config.region);
	localStorage.setItem(STORAGE_KEYS.accessKeyId, config.accessKeyId);
	localStorage.setItem(STORAGE_KEYS.secretAccessKey, config.secretAccessKey);
}

export function clearS3Config(): void {
	if (typeof localStorage === 'undefined') return;
	for (const key of Object.values(STORAGE_KEYS)) {
		localStorage.removeItem(key);
	}
}

export function isS3Configured(): boolean {
	return getS3Config() !== null;
}

function objectKey(vaultId: string): string {
	return `kurumi-sync/${vaultId}.bin`;
}

function objectUrl(config: S3Config, key: string): string {
	// Path-style URL: endpoint/bucket/key
	const base = config.endpoint.replace(/\/+$/, '');
	return `${base}/${config.bucket}/${key}`;
}

// ---------------------------------------------------------------------------
// AWS Signature V4 (browser-side via Web Crypto)
// ---------------------------------------------------------------------------

async function hmacSha256(key: ArrayBuffer, message: string): Promise<ArrayBuffer> {
	const cryptoKey = await crypto.subtle.importKey(
		'raw',
		key,
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);
	return crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(message));
}

async function sha256(data: ArrayBuffer | Uint8Array): Promise<string> {
	const buf = data instanceof Uint8Array ? data.buffer : data;
	const hash = await crypto.subtle.digest('SHA-256', buf as ArrayBuffer);
	return bufToHex(hash);
}

async function sha256String(s: string): Promise<string> {
	return sha256(new TextEncoder().encode(s));
}

function bufToHex(buf: ArrayBuffer): string {
	return Array.from(new Uint8Array(buf))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

function toAmzDate(date: Date): { amzDate: string; dateStamp: string } {
	const iso = date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
	return {
		amzDate: iso, // 20260409T120000Z
		dateStamp: iso.slice(0, 8) // 20260409
	};
}

async function getSigningKey(
	secretKey: string,
	dateStamp: string,
	region: string,
	service: string
): Promise<ArrayBuffer> {
	let key: ArrayBuffer = new TextEncoder().encode(`AWS4${secretKey}`).buffer;
	key = await hmacSha256(key, dateStamp);
	key = await hmacSha256(key, region);
	key = await hmacSha256(key, service);
	key = await hmacSha256(key, 'aws4_request');
	return key;
}

async function signRequest(
	config: S3Config,
	method: string,
	key: string,
	body: Uint8Array | null,
	contentType?: string
): Promise<{ url: string; headers: Record<string, string> }> {
	const url = new URL(objectUrl(config, key));
	const now = new Date();
	const { amzDate, dateStamp } = toAmzDate(now);
	const host = url.host;
	const path = url.pathname;

	const payloadHash = body
		? await sha256(body)
		: await sha256String('');

	// Canonical headers (must be sorted)
	const headers: Record<string, string> = {
		host,
		'x-amz-content-sha256': payloadHash,
		'x-amz-date': amzDate
	};
	if (contentType) headers['content-type'] = contentType;

	const sortedHeaderKeys = Object.keys(headers).sort();
	const canonicalHeaders = sortedHeaderKeys
		.map((k) => `${k}:${headers[k]}\n`)
		.join('');
	const signedHeaders = sortedHeaderKeys.join(';');

	const canonicalRequest = [
		method,
		path,
		'', // query string (empty)
		canonicalHeaders,
		signedHeaders,
		payloadHash
	].join('\n');

	const credentialScope = `${dateStamp}/${config.region}/s3/aws4_request`;
	const stringToSign = [
		'AWS4-HMAC-SHA256',
		amzDate,
		credentialScope,
		await sha256String(canonicalRequest)
	].join('\n');

	const signingKey = await getSigningKey(
		config.secretAccessKey,
		dateStamp,
		config.region,
		's3'
	);
	const signatureBuf = await hmacSha256(signingKey, stringToSign);
	const signature = bufToHex(signatureBuf);

	const authorization =
		`AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}, ` +
		`SignedHeaders=${signedHeaders}, Signature=${signature}`;

	return {
		url: url.toString(),
		headers: {
			...headers,
			authorization
		}
	};
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function s3Pull(
	config: S3Config,
	vaultId: string
): Promise<Uint8Array | null> {
	const key = objectKey(vaultId);
	const { url, headers } = await signRequest(config, 'GET', key, null);

	const response = await fetch(url, { headers });
	if (response.status === 404 || response.status === 403) {
		// No remote object yet — first sync.
		return null;
	}
	if (!response.ok) {
		throw new Error(`S3 GET failed (${response.status}): ${await response.text()}`);
	}
	const buf = await response.arrayBuffer();
	return new Uint8Array(buf);
}

export async function s3Push(
	config: S3Config,
	vaultId: string,
	data: Uint8Array
): Promise<void> {
	const key = objectKey(vaultId);
	const { url, headers } = await signRequest(
		config,
		'PUT',
		key,
		data,
		'application/octet-stream'
	);

	const response = await fetch(url, {
		method: 'PUT',
		headers: {
			...headers,
			'content-length': String(data.length)
		},
		body: data.buffer as ArrayBuffer
	});
	if (!response.ok) {
		throw new Error(`S3 PUT failed (${response.status}): ${await response.text()}`);
	}
}

/**
 * Generic object GET by key — used for blob sync. Returns null when the
 * object is absent (404/403 on a first sync).
 */
export async function s3GetObject(config: S3Config, key: string): Promise<Uint8Array | null> {
	const { url, headers } = await signRequest(config, 'GET', key, null);
	const response = await fetch(url, { headers });
	if (response.status === 404 || response.status === 403) return null;
	if (!response.ok) {
		throw new Error(`S3 GET failed (${response.status}): ${await response.text()}`);
	}
	return new Uint8Array(await response.arrayBuffer());
}

/**
 * Generic object PUT by key — used for blob sync.
 */
export async function s3PutObject(
	config: S3Config,
	key: string,
	data: Uint8Array,
	contentType = 'application/octet-stream'
): Promise<void> {
	const { url, headers } = await signRequest(config, 'PUT', key, data, contentType);
	const response = await fetch(url, {
		method: 'PUT',
		headers: { ...headers, 'content-length': String(data.length) },
		body: data.buffer as ArrayBuffer
	});
	if (!response.ok) {
		throw new Error(`S3 PUT failed (${response.status}): ${await response.text()}`);
	}
}

export async function s3Test(config: S3Config): Promise<{ success: boolean; error?: string }> {
	try {
		const key = objectKey('__test__');
		const { url, headers } = await signRequest(config, 'HEAD', key, null);
		const response = await fetch(url, { method: 'HEAD', headers });
		// 200 or 404 both mean the connection works; 403 means bad creds.
		if (response.status === 403 || response.status === 401) {
			return { success: false, error: 'Authentication failed — check access key and secret.' };
		}
		return { success: true };
	} catch (err) {
		return {
			success: false,
			error: err instanceof Error ? err.message : 'Connection failed'
		};
	}
}
