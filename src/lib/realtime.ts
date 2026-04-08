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
 * - Auth: uses the same OpenAI API key the rest of Kurumi uses
 *   (localStorage key set in Settings → AI Assistant). The key is
 *   sent directly in the SDP exchange — there's no server-side token
 *   exchange because Kurumi is a static PWA. This matches how the
 *   existing REST provider handles auth, with the same trust model.
 *
 * - Transport: one RTCPeerConnection carrying a mic audio track
 *   outbound, an assistant audio track inbound (routed to an
 *   <audio> element), and a single data channel for JSON events
 *   (transcripts, tool calls, status updates).
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

const REALTIME_MODEL = 'gpt-4o-realtime-preview-2024-12-17';
const REALTIME_URL = `https://api.openai.com/v1/realtime?model=${REALTIME_MODEL}`;
const OPENAI_KEY_STORAGE = 'kurumi-openai-key';

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
			this.dc.addEventListener('open', () => this.handleDataChannelOpen());
			this.dc.addEventListener('message', (e) => this.handleDataChannelMessage(e));
			this.dc.addEventListener('close', () => {
				if (this.getStatus() === 'connected') {
					realtimeStatus.set('stopped');
				}
			});

			// 4. Create SDP offer and exchange with OpenAI
			const offer = await this.pc.createOffer();
			await this.pc.setLocalDescription(offer);

			const response = await fetch(REALTIME_URL, {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${apiKey}`,
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

	/**
	 * Send a session.update event on data channel open to configure
	 * tools, instructions, and voice. Without this the model answers
	 * as a generic assistant with no access to Kurumi's memory.
	 */
	private handleDataChannelOpen(): void {
		this.sendEvent({
			type: 'session.update',
			session: {
				voice: 'alloy',
				modalities: ['text', 'audio'],
				input_audio_transcription: { model: 'whisper-1' },
				instructions: [
					'You are Kurumi, a second-brain voice assistant.',
					'When the user asks a question about their notes, memories, meetings,',
					'or anything that could live in their knowledge base, ALWAYS call the',
					'search_memory function first before answering. Pass the user\'s',
					"original phrasing as the query. Use the returned snippets to ground",
					'your reply, and cite specific memories by title when relevant.',
					'Keep spoken answers concise and conversational.'
				].join(' '),
				tools: [
					{
						type: 'function',
						name: 'search_memory',
						description:
							"Search the user's Kurumi vault for memories relevant to a question. Returns a JSON list of memory snippets with their ids and titles.",
						parameters: {
							type: 'object',
							properties: {
								query: {
									type: 'string',
									description: 'The natural-language question to search for.'
								}
							},
							required: ['query']
						}
					}
				],
				tool_choice: 'auto'
			}
		});
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

		const type = event.type as string | undefined;
		if (!type) return;

		switch (type) {
			case 'conversation.item.input_audio_transcription.completed': {
				// Final user transcript for a committed audio segment.
				const itemId = event.item_id as string | undefined;
				const transcript = event.transcript as string | undefined;
				if (itemId && transcript) {
					upsertTurn(`user-${itemId}`, 'user', transcript, true);
				}
				break;
			}
			case 'response.audio_transcript.delta': {
				// Streaming assistant text (aligned with outgoing audio)
				const itemId = event.item_id as string | undefined;
				const delta = event.delta as string | undefined;
				if (itemId && typeof delta === 'string') {
					upsertTurn(`assistant-${itemId}`, 'assistant', delta, false);
				}
				break;
			}
			case 'response.audio_transcript.done': {
				const itemId = event.item_id as string | undefined;
				if (itemId) finalizeTurn(`assistant-${itemId}`);
				break;
			}
			case 'response.function_call_arguments.delta': {
				const callId = event.call_id as string | undefined;
				const name = event.name as string | undefined;
				const delta = event.delta as string | undefined;
				if (!callId) break;
				const existing = this.pendingCalls.get(callId) ?? { name: name ?? '', args: '' };
				if (name && !existing.name) existing.name = name;
				if (typeof delta === 'string') existing.args += delta;
				this.pendingCalls.set(callId, existing);
				break;
			}
			case 'response.function_call_arguments.done': {
				const callId = event.call_id as string | undefined;
				const name = event.name as string | undefined;
				const finalArgs = event.arguments as string | undefined;
				if (!callId) break;
				const pending = this.pendingCalls.get(callId) ?? {
					name: name ?? '',
					args: finalArgs ?? ''
				};
				if (finalArgs !== undefined) pending.args = finalArgs;
				if (name && !pending.name) pending.name = name;
				this.pendingCalls.delete(callId);
				void this.executeToolCall(callId, pending.name, pending.args);
				break;
			}
			case 'error': {
				const payload = event.error as { message?: string } | undefined;
				realtimeError.set(payload?.message ?? 'Realtime error');
				break;
			}
			default:
				// Ignore the dozens of other informational events
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
