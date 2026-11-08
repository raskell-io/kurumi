/**
 * OpenAI Realtime API voice session.
 *
 * This wraps the browser WebRTC + data-channel flow for OpenAI's
 * Realtime endpoint. It produces a live two-way voice conversation
 * where the assistant can also call a `search_memory` function to
 * pull context from the user's Kurumi vault before replying.
 *
 * Design notes:
 *
 * - Auth (GA Realtime API): the browser mints a short-lived client
 *   secret with the user's OpenAI key (POST /v1/realtime/client_secrets,
 *   which also carries the session config) and does the SDP exchange
 *   with that secret (POST /v1/realtime/calls). Kurumi is a static PWA,
 *   so the key is already in the browser for the REST provider; the
 *   secret keeps it out of the WebRTC call itself.
 *
 * - Transport: one RTCPeerConnection carrying a mic audio track
 *   outbound, an assistant audio track inbound (routed to an
 *   <audio> element), and a single data channel for JSON events
 *   (transcripts, tool calls, status updates).
 *
 * - Events: `interpretRealtimeEvent` turns data-channel events into
 *   actions, and accepts both the GA names (response.output_audio_transcript.*)
 *   and the beta ones (response.audio_transcript.*).
 *
 * - Tool use: the session is configured with a single `search_memory`
 *   function. When the model emits a function_call, we run
 *   retrieveMemoryContext + buildContextBlocks, stringify the result,
 *   and send a function_call_output back through the data channel so
 *   the model can use it in its reply.
 *
 * - State: a set of writable stores expose current status, the
 *   accumulated transcript turns (user + assistant), and the last
 *   error so the UI can render a live panel and react.
 */

import { writable, type Writable } from 'svelte/store';
import { retrieveMemoryContext, buildContextBlocks } from './ask';

// The GA Realtime API (the beta interface and preview models are on their way out).
export const REALTIME_MODEL = 'gpt-realtime';
const CLIENT_SECRETS_URL = 'https://api.openai.com/v1/realtime/client_secrets';
const CALLS_URL = 'https://api.openai.com/v1/realtime/calls';
const OPENAI_KEY_STORAGE = 'kurumi-openai-key';

const INSTRUCTIONS = [
	'You are Kurumi, a second-brain voice assistant.',
	'When the user asks a question about their notes, memories, meetings,',
	'or anything that could live in their knowledge base, ALWAYS call the',
	"search_memory function first before answering. Pass the user's",
	'original phrasing as the query. Use the returned snippets to ground',
	'your reply, and cite specific memories by title when relevant.',
	'Keep spoken answers concise and conversational.'
].join(' ');

/** The session config (GA shape), sent when minting the client secret. */
export function realtimeSessionConfig(model = REALTIME_MODEL) {
	return {
		type: 'realtime',
		model,
		instructions: INSTRUCTIONS,
		output_modalities: ['audio'],
		audio: {
			input: { transcription: { model: 'gpt-4o-mini-transcribe' } },
			output: { voice: 'marin' }
		},
		tools: [
			{
				type: 'function',
				name: 'search_memory',
				description:
					"Search the user's Kurumi vault for memories relevant to a question. Returns a JSON list of memory snippets with their ids and titles.",
				parameters: {
					type: 'object',
					properties: {
						query: { type: 'string', description: 'The natural-language question to search for.' }
					},
					required: ['query']
				}
			}
		],
		tool_choice: 'auto'
	};
}

/** What a data-channel event means for the session (null: nothing to do). */
export type RealtimeAction =
	| { kind: 'user-transcript'; id: string; text: string }
	| { kind: 'assistant-delta'; id: string; delta: string }
	| { kind: 'assistant-done'; id: string }
	| { kind: 'call-delta'; callId: string; name?: string; delta: string }
	| { kind: 'call-done'; callId: string; name?: string; args?: string }
	| { kind: 'error'; message: string };

/** Interpret one Realtime server event; GA and beta event names both work. */
export function interpretRealtimeEvent(event: Record<string, unknown>): RealtimeAction | null {
	const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
	const itemId = str(event.item_id);
	switch (event.type) {
		case 'conversation.item.input_audio_transcription.completed': {
			const text = str(event.transcript);
			return itemId && text ? { kind: 'user-transcript', id: `user-${itemId}`, text } : null;
		}
		case 'response.output_audio_transcript.delta':
		case 'response.audio_transcript.delta':
		case 'response.output_text.delta':
		case 'response.text.delta': {
			const delta = str(event.delta);
			return itemId && delta !== undefined ? { kind: 'assistant-delta', id: `assistant-${itemId}`, delta } : null;
		}
		case 'response.output_audio_transcript.done':
		case 'response.audio_transcript.done':
		case 'response.output_text.done':
		case 'response.text.done':
			return itemId ? { kind: 'assistant-done', id: `assistant-${itemId}` } : null;
		case 'response.function_call_arguments.delta': {
			const callId = str(event.call_id);
			return callId ? { kind: 'call-delta', callId, name: str(event.name), delta: str(event.delta) ?? '' } : null;
		}
		case 'response.function_call_arguments.done': {
			const callId = str(event.call_id);
			return callId ? { kind: 'call-done', callId, name: str(event.name), args: str(event.arguments) } : null;
		}
		case 'error': {
			const error = event.error as { message?: string } | undefined;
			return { kind: 'error', message: error?.message ?? 'Realtime error' };
		}
		default:
			return null;
	}
}

/** Mint a short-lived client secret for one session (its config travels with it). */
async function mintClientSecret(apiKey: string): Promise<string> {
	const response = await fetch(CLIENT_SECRETS_URL, {
		method: 'POST',
		headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({ session: realtimeSessionConfig() })
	});
	if (!response.ok) {
		const text = await response.text().catch(() => '');
		throw new Error(`Realtime session setup failed (${response.status}): ${text || 'no body'}`);
	}
	const data = (await response.json()) as { value?: string; client_secret?: { value?: string } };
	const secret = data.value ?? data.client_secret?.value;
	if (!secret) throw new Error('Realtime session setup returned no client secret');
	return secret;
}

export type RealtimeStatus =
	| 'idle'
	| 'connecting'
	| 'connected'
	| 'error'
	| 'stopped';

export interface RealtimeTurn {
	id: string;
	role: 'user' | 'assistant';
	text: string;
	partial: boolean; // true while streaming, false once finalized
	createdAt: number;
}

export const realtimeStatus: Writable<RealtimeStatus> = writable('idle');
export const realtimeTurns: Writable<RealtimeTurn[]> = writable([]);
export const realtimeError: Writable<string | null> = writable(null);

function getApiKey(): string | null {
	if (typeof localStorage === 'undefined') return null;
	return localStorage.getItem(OPENAI_KEY_STORAGE);
}

function generateId(): string {
	return Math.random().toString(36).slice(2, 10);
}

/**
 * Append or update a streaming turn. If a turn with the given id
 * already exists we treat this as a delta and append text;
 * otherwise we create a fresh entry.
 */
function upsertTurn(
	id: string,
	role: RealtimeTurn['role'],
	deltaText: string,
	finalized: boolean
): void {
	realtimeTurns.update((turns) => {
		const existing = turns.findIndex((t) => t.id === id);
		if (existing >= 0) {
			const next = [...turns];
			next[existing] = {
				...next[existing],
				text: next[existing].text + deltaText,
				partial: !finalized
			};
			return next;
		}
		return [
			...turns,
			{
				id,
				role,
				text: deltaText,
				partial: !finalized,
				createdAt: Date.now()
			}
		];
	});
}

function finalizeTurn(id: string): void {
	realtimeTurns.update((turns) =>
		turns.map((t) => (t.id === id ? { ...t, partial: false } : t))
	);
}

// --- Session class ----------------------------------------------------------

export class RealtimeSession {
	private pc: RTCPeerConnection | null = null;
	private dc: RTCDataChannel | null = null;
	private micStream: MediaStream | null = null;
	private audioElement: HTMLAudioElement | null = null;

	// Track pending function calls keyed by call_id so we can assemble
	// streaming argument deltas before executing the tool.
	private pendingCalls = new Map<string, { name: string; args: string }>();

	async start(): Promise<void> {
		const apiKey = getApiKey();
		if (!apiKey) {
			realtimeError.set('OpenAI API key not configured');
			realtimeStatus.set('error');
			throw new Error('OpenAI API key not configured');
		}

		realtimeError.set(null);
		realtimeTurns.set([]);
		realtimeStatus.set('connecting');

		try {
			// 1. Get mic access
			this.micStream = await navigator.mediaDevices.getUserMedia({ audio: true });

			// 2. Set up peer connection
			this.pc = new RTCPeerConnection();

			// Remote audio → hidden <audio> element for playback
			this.audioElement = new Audio();
			this.audioElement.autoplay = true;
			this.pc.ontrack = (event) => {
				if (this.audioElement && event.streams[0]) {
					this.audioElement.srcObject = event.streams[0];
				}
			};

			// Outbound mic track
			for (const track of this.micStream.getTracks()) {
				this.pc.addTrack(track, this.micStream);
			}

			// 3. Data channel for events
			this.dc = this.pc.createDataChannel('oai-events');
			this.dc.addEventListener('message', (e) => this.handleDataChannelMessage(e));
			this.dc.addEventListener('close', () => {
				if (this.getStatus() === 'connected') {
					realtimeStatus.set('stopped');
				}
			});

			// 4. Create SDP offer and exchange it with OpenAI, using a
			//    short-lived secret minted with the user's key.
			const offer = await this.pc.createOffer();
			await this.pc.setLocalDescription(offer);
			const secret = await mintClientSecret(apiKey);

			const response = await fetch(CALLS_URL, {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${secret}`,
					'Content-Type': 'application/sdp'
				},
				body: offer.sdp
			});

			if (!response.ok) {
				const text = await response.text().catch(() => '');
				throw new Error(
					`Realtime SDP exchange failed (${response.status}): ${text || 'no body'}`
				);
			}

			const answerSdp = await response.text();
			await this.pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });

			realtimeStatus.set('connected');
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Realtime connection failed';
			realtimeError.set(message);
			realtimeStatus.set('error');
			this.cleanup();
			throw err;
		}
	}

	stop(): void {
		realtimeStatus.set('stopped');
		this.cleanup();
	}

	private cleanup(): void {
		if (this.dc) {
			try {
				this.dc.close();
			} catch {
				// Already closed
			}
			this.dc = null;
		}
		if (this.pc) {
			try {
				this.pc.close();
			} catch {
				// Already closed
			}
			this.pc = null;
		}
		if (this.micStream) {
			for (const track of this.micStream.getTracks()) {
				track.stop();
			}
			this.micStream = null;
		}
		if (this.audioElement) {
			this.audioElement.pause();
			this.audioElement.srcObject = null;
			this.audioElement = null;
		}
		this.pendingCalls.clear();
	}

	private getStatus(): RealtimeStatus {
		let status: RealtimeStatus = 'idle';
		realtimeStatus.subscribe((s) => {
			status = s;
		})();
		return status;
	}

	private sendEvent(event: unknown): void {
		if (!this.dc || this.dc.readyState !== 'open') return;
		this.dc.send(JSON.stringify(event));
	}

	private handleDataChannelMessage(e: MessageEvent): void {
		let event: Record<string, unknown>;
		try {
			event = JSON.parse(typeof e.data === 'string' ? e.data : '');
		} catch {
			return;
		}

		const action = interpretRealtimeEvent(event);
		if (!action) return; // the many informational events
		switch (action.kind) {
			case 'user-transcript':
				upsertTurn(action.id, 'user', action.text, true);
				break;
			case 'assistant-delta':
				upsertTurn(action.id, 'assistant', action.delta, false);
				break;
			case 'assistant-done':
				finalizeTurn(action.id);
				break;
			case 'call-delta': {
				const existing = this.pendingCalls.get(action.callId) ?? { name: action.name ?? '', args: '' };
				if (action.name && !existing.name) existing.name = action.name;
				existing.args += action.delta;
				this.pendingCalls.set(action.callId, existing);
				break;
			}
			case 'call-done': {
				const pending = this.pendingCalls.get(action.callId) ?? { name: action.name ?? '', args: action.args ?? '' };
				if (action.args !== undefined) pending.args = action.args;
				if (action.name && !pending.name) pending.name = action.name;
				this.pendingCalls.delete(action.callId);
				void this.executeToolCall(action.callId, pending.name, pending.args);
				break;
			}
			case 'error':
				realtimeError.set(action.message);
				break;
		}
	}

	/**
	 * Execute a tool call the model emitted, then send the result back
	 * into the session and ask for a new response so the model can
	 * fold the results into its reply.
	 */
	private async executeToolCall(callId: string, name: string, argsJson: string): Promise<void> {
		let result: unknown;
		try {
			if (name === 'search_memory') {
				const parsed = JSON.parse(argsJson || '{}') as { query?: string };
				const query = typeof parsed.query === 'string' ? parsed.query : '';
				const memories = await retrieveMemoryContext(query);
				const blocks = buildContextBlocks(memories);
				result = {
					ok: true,
					count: blocks.length,
					memories: blocks.map((b, i) => ({
						index: i + 1,
						memoryId: b.memoryId,
						title: memories[i]?.title ?? 'Untitled',
						text: b.text
					}))
				};
			} else {
				result = { ok: false, error: `Unknown tool: ${name}` };
			}
		} catch (err) {
			result = {
				ok: false,
				error: err instanceof Error ? err.message : 'Tool execution failed'
			};
		}

		this.sendEvent({
			type: 'conversation.item.create',
			item: {
				type: 'function_call_output',
				call_id: callId,
				output: JSON.stringify(result)
			}
		});
		// Prompt the model to continue now that it has the tool result
		this.sendEvent({ type: 'response.create' });
	}
}
