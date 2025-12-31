interface Env {
	KURUMI_BUCKET: R2Bucket;
	SYNC_TOKEN: string;
}

const OBJECT_KEY = 'kurumi-doc.automerge';

const CORS_HEADERS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
	'Access-Control-Allow-Headers': 'Authorization, Content-Type',
};

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		// Handle CORS preflight
		if (request.method === 'OPTIONS') {
			return new Response(null, { headers: CORS_HEADERS });
		}

		// Verify path
		const url = new URL(request.url);
		if (url.pathname !== '/sync') {
			return new Response('Not Found', { status: 404, headers: CORS_HEADERS });
		}

		// Authenticate
		const authHeader = request.headers.get('Authorization');
		if (!authHeader || !authHeader.startsWith('Bearer ')) {
			return new Response('Unauthorized', { status: 401, headers: CORS_HEADERS });
		}

		const token = authHeader.slice(7);
		if (token !== env.SYNC_TOKEN) {
			return new Response('Forbidden', { status: 403, headers: CORS_HEADERS });
		}

		// Handle GET - Download document
		if (request.method === 'GET') {
			const object = await env.KURUMI_BUCKET.get(OBJECT_KEY);
			if (!object) {
				return new Response('Not Found', { status: 404, headers: CORS_HEADERS });
			}

			return new Response(object.body, {
				headers: {
					...CORS_HEADERS,
					'Content-Type': 'application/octet-stream',
					'ETag': object.httpEtag,
				},
			});
		}

		// Handle PUT - Upload document
		if (request.method === 'PUT') {
			const body = await request.arrayBuffer();
			await env.KURUMI_BUCKET.put(OBJECT_KEY, body, {
				httpMetadata: {
					contentType: 'application/octet-stream',
				},
			});

			return new Response('OK', { status: 200, headers: CORS_HEADERS });
		}

		return new Response('Method Not Allowed', { status: 405, headers: CORS_HEADERS });
	},
};
