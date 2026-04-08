/**
 * Voice assistant helpers: push-to-talk recording, TTS playback, and
 * a convenience speak(text) that routes to the first provider with
 * TTS capability.
 *
 * Kept in $lib (not in `inference/`) because it wires the browser-side
 * MediaRecorder + HTMLAudioElement layer to the inference layer, and
 * consumers generally want the whole dance, not the building blocks.
 */

import { inferenceRouter } from '$lib/inference';
import type { TtsInput } from '$lib/inference/types';

const AUDIO_MIME_CANDIDATES = [
	'audio/webm;codecs=opus',
	'audio/webm',
	'audio/mp4',
	'audio/ogg;codecs=opus',
	'audio/ogg'
];

export function pickRecorderMime(): string {
	if (typeof MediaRecorder === 'undefined') return '';
	for (const candidate of AUDIO_MIME_CANDIDATES) {
		if (MediaRecorder.isTypeSupported(candidate)) return candidate;
	}
	return '';
}

/**
 * Start recording from the default mic. Returns a handle that the
 * caller holds while the user is pressing the button; call stop() to
 * get the final Blob.
 *
 * Intentionally simpler than VoiceRecorder.svelte — no pause/resume,
 * no waveform, no tab audio — because push-to-talk is always a quick
 * mic-only burst.
 */
export interface RecorderHandle {
	stream: MediaStream;
	recorder: MediaRecorder;
	chunks: Blob[];
	stop(): Promise<Blob>;
}

export async function startPushToTalk(): Promise<RecorderHandle> {
	const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
	const mimeType = pickRecorderMime();
	const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
	const chunks: Blob[] = [];
	recorder.ondataavailable = (e) => {
		if (e.data.size > 0) chunks.push(e.data);
	};
	recorder.start();

	return {
		stream,
		recorder,
		chunks,
		async stop(): Promise<Blob> {
			return new Promise((resolve) => {
				recorder.onstop = () => {
					for (const track of stream.getTracks()) track.stop();
					const type = chunks[0]?.type || mimeType || 'audio/webm';
					resolve(new Blob(chunks, { type }));
				};
				if (recorder.state !== 'inactive') recorder.stop();
				else resolve(new Blob(chunks, { type: mimeType || 'audio/webm' }));
			});
		}
	};
}

/**
 * Speak text using the first registered provider that supports TTS.
 * Resolves when playback finishes (or rejects on failure). Cancels any
 * previous playback that's still running so a new turn doesn't clash
 * with the previous one.
 */
let currentAudio: HTMLAudioElement | null = null;
let currentUrl: string | null = null;

export function stopSpeaking(): void {
	if (currentAudio) {
		currentAudio.pause();
		currentAudio.currentTime = 0;
		currentAudio = null;
	}
	if (currentUrl) {
		URL.revokeObjectURL(currentUrl);
		currentUrl = null;
	}
}

export async function speak(text: string, voice?: string): Promise<void> {
	if (!text.trim()) return;
	stopSpeaking();

	// Iterate providers in registration order and try each until one
	// returns ok. This gives us a graceful fallback: if OpenAI TTS fails
	// (no API key, network down, etc.), the local MMS provider is
	// tried next.
	const candidates = inferenceRouter
		.allProviders()
		.filter((p) => p.capabilities.supportsTts);
	if (candidates.length === 0) {
		throw new Error('No inference provider supports TTS yet');
	}

	const input: TtsInput = { text, voice };
	let lastError = 'TTS failed';
	let result: Awaited<ReturnType<(typeof candidates)[number]['tts']>> | null = null;
	for (const provider of candidates) {
		result = await provider.tts(input);
		if (result.ok && result.value) break;
		lastError = result.error || lastError;
		result = null;
	}
	if (!result || !result.ok || !result.value) {
		throw new Error(lastError);
	}

	const blob = new Blob([result.value.audio], { type: result.value.mimeType });
	const url = URL.createObjectURL(blob);
	currentUrl = url;

	const audio = new Audio(url);
	currentAudio = audio;

	return new Promise((resolve, reject) => {
		audio.onended = () => {
			stopSpeaking();
			resolve();
		};
		audio.onerror = () => {
			stopSpeaking();
			reject(new Error('Audio playback failed'));
		};
		audio.play().catch((err) => {
			stopSpeaking();
			reject(err);
		});
	});
}
