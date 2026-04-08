<script lang="ts">
	import { Mic, Square, AlertCircle } from 'lucide-svelte';
	import { onDestroy } from 'svelte';

	interface Props {
		onComplete: (result: { blob: Blob; mimeType: string; durationMs: number }) => void;
		onCancel?: () => void;
	}

	let { onComplete, onCancel }: Props = $props();

	type RecorderState = 'idle' | 'requesting' | 'recording' | 'stopped' | 'error';

	let recorderState = $state<RecorderState>('idle');
	let errorMessage = $state<string | null>(null);
	let elapsedMs = $state(0);

	let mediaStream: MediaStream | null = null;
	let mediaRecorder: MediaRecorder | null = null;
	let chunks: Blob[] = [];
	let startedAt = 0;
	let timerInterval: ReturnType<typeof setInterval> | null = null;

	function formatElapsed(ms: number): string {
		const totalSeconds = Math.floor(ms / 1000);
		const minutes = Math.floor(totalSeconds / 60);
		const seconds = totalSeconds % 60;
		return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
	}

	async function startRecording() {
		recorderState = 'requesting';
		errorMessage = null;
		chunks = [];

		try {
			mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
		} catch (err) {
			recorderState = 'error';
			errorMessage =
				err instanceof Error && err.name === 'NotAllowedError'
					? 'Microphone permission denied. Allow access in your browser settings and try again.'
					: 'Could not access microphone.';
			return;
		}

		try {
			mediaRecorder = new MediaRecorder(mediaStream);
		} catch {
			recorderState = 'error';
			errorMessage = 'Recording is not supported in this browser.';
			cleanupStream();
			return;
		}

		mediaRecorder.ondataavailable = (event) => {
			if (event.data.size > 0) {
				chunks.push(event.data);
			}
		};

		mediaRecorder.onstop = () => {
			const mimeType = mediaRecorder?.mimeType || 'audio/webm';
			const blob = new Blob(chunks, { type: mimeType });
			const durationMs = Date.now() - startedAt;
			cleanupStream();
			recorderState = 'stopped';
			onComplete({ blob, mimeType, durationMs });
		};

		startedAt = Date.now();
		elapsedMs = 0;
		mediaRecorder.start();
		recorderState = 'recording';

		timerInterval = setInterval(() => {
			elapsedMs = Date.now() - startedAt;
		}, 250);
	}

	function stopRecording() {
		if (timerInterval) {
			clearInterval(timerInterval);
			timerInterval = null;
		}
		if (mediaRecorder && mediaRecorder.state !== 'inactive') {
			mediaRecorder.stop();
		}
	}

	function cleanupStream() {
		if (timerInterval) {
			clearInterval(timerInterval);
			timerInterval = null;
		}
		if (mediaStream) {
			mediaStream.getTracks().forEach((track) => track.stop());
			mediaStream = null;
		}
		mediaRecorder = null;
	}

	onDestroy(() => {
		cleanupStream();
	});
</script>

<div class="flex flex-col items-center gap-6 p-6">
	{#if recorderState === 'idle'}
		<button
			type="button"
			onclick={startRecording}
			class="flex h-24 w-24 items-center justify-center rounded-full bg-red-500 text-white shadow-lg transition-transform hover:scale-105 active:scale-95"
			title="Start recording"
		>
			<Mic class="h-10 w-10" />
		</button>
		<p class="text-sm text-[var(--color-text-muted)]">Tap to start recording</p>
	{:else if recorderState === 'requesting'}
		<div class="flex h-24 w-24 items-center justify-center rounded-full bg-[var(--color-bg-secondary)]">
			<div class="h-8 w-8 animate-spin rounded-full border-2 border-[var(--color-accent)] border-t-transparent"></div>
		</div>
		<p class="text-sm text-[var(--color-text-muted)]">Requesting microphone…</p>
	{:else if recorderState === 'recording'}
		<button
			type="button"
			onclick={stopRecording}
			class="flex h-24 w-24 items-center justify-center rounded-full bg-red-500 text-white shadow-lg ring-4 ring-red-500/30 transition-transform hover:scale-105 active:scale-95"
			title="Stop recording"
		>
			<Square class="h-10 w-10 fill-current" />
		</button>
		<div class="flex items-center gap-2 text-2xl font-mono text-[var(--color-text)]">
			<span class="h-3 w-3 animate-pulse rounded-full bg-red-500"></span>
			{formatElapsed(elapsedMs)}
		</div>
		<p class="text-sm text-[var(--color-text-muted)]">Tap to stop</p>
	{:else if recorderState === 'stopped'}
		<p class="text-sm text-[var(--color-text-muted)]">Saving…</p>
	{:else if recorderState === 'error'}
		<div class="flex flex-col items-center gap-3 text-center">
			<AlertCircle class="h-10 w-10 text-red-500" />
			<p class="max-w-xs text-sm text-[var(--color-text)]">{errorMessage}</p>
			<div class="flex gap-2">
				<button
					type="button"
					onclick={() => {
						recorderState = 'idle';
						errorMessage = null;
					}}
					class="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text)] hover:bg-[var(--color-bg-secondary)]"
				>
					Try again
				</button>
				{#if onCancel}
					<button
						type="button"
						onclick={onCancel}
						class="rounded-lg px-4 py-2 text-sm text-[var(--color-text-muted)] hover:bg-[var(--color-bg-secondary)]"
					>
						Cancel
					</button>
				{/if}
			</div>
		</div>
	{/if}
</div>
