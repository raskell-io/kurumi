<script lang="ts">
	import { Mic, Square, Pause, Play, AlertCircle } from 'lucide-svelte';
	import { onDestroy } from 'svelte';

	interface Props {
		onComplete: (result: { blob: Blob; mimeType: string; durationMs: number }) => void;
		onCancel?: () => void;
		onStart?: () => void;
	}

	let { onComplete, onCancel, onStart }: Props = $props();

	type RecorderState = 'idle' | 'requesting' | 'recording' | 'paused' | 'stopped' | 'error';

	let recorderState = $state<RecorderState>('idle');
	let errorMessage = $state<string | null>(null);
	let elapsedMs = $state(0);

	let mediaStream: MediaStream | null = null;
	let mediaRecorder: MediaRecorder | null = null;
	let chunks: Blob[] = [];

	// Elapsed-time tracking that survives pauses
	let segmentStartedAt = 0;
	let accumulatedMs = 0;
	let timerInterval: ReturnType<typeof setInterval> | null = null;

	// Web Audio waveform
	let audioContext: AudioContext | null = null;
	let analyser: AnalyserNode | null = null;
	let waveformCanvas: HTMLCanvasElement | undefined = $state();
	let waveformAnimationFrame: number | null = null;

	function formatElapsed(ms: number): string {
		const totalSeconds = Math.floor(ms / 1000);
		const minutes = Math.floor(totalSeconds / 60);
		const seconds = totalSeconds % 60;
		return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
	}

	function currentElapsed(): number {
		if (recorderState === 'recording') {
			return accumulatedMs + (Date.now() - segmentStartedAt);
		}
		return accumulatedMs;
	}

	async function startRecording() {
		recorderState = 'requesting';
		errorMessage = null;
		chunks = [];
		accumulatedMs = 0;
		elapsedMs = 0;

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
			cleanupAll();
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
			const durationMs = currentElapsed();
			cleanupAll();
			recorderState = 'stopped';
			onComplete({ blob, mimeType, durationMs });
		};

		// Set up Web Audio analyser for waveform
		try {
			const Ctx = window.AudioContext || (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
			if (Ctx && mediaStream) {
				audioContext = new Ctx();
				const source = audioContext.createMediaStreamSource(mediaStream);
				analyser = audioContext.createAnalyser();
				analyser.fftSize = 256;
				source.connect(analyser);
			}
		} catch {
			// Waveform is optional; carry on without it
			analyser = null;
		}

		segmentStartedAt = Date.now();
		mediaRecorder.start();
		recorderState = 'recording';
		onStart?.();

		timerInterval = setInterval(() => {
			elapsedMs = currentElapsed();
		}, 250);

		drawWaveform();
	}

	function pauseRecording() {
		if (!mediaRecorder || mediaRecorder.state !== 'recording') return;
		mediaRecorder.pause();
		accumulatedMs += Date.now() - segmentStartedAt;
		elapsedMs = accumulatedMs;
		recorderState = 'paused';
	}

	function resumeRecording() {
		if (!mediaRecorder || mediaRecorder.state !== 'paused') return;
		mediaRecorder.resume();
		segmentStartedAt = Date.now();
		recorderState = 'recording';
	}

	function stopRecording() {
		if (timerInterval) {
			clearInterval(timerInterval);
			timerInterval = null;
		}
		if (waveformAnimationFrame !== null) {
			cancelAnimationFrame(waveformAnimationFrame);
			waveformAnimationFrame = null;
		}
		// Capture remaining segment time before flushing
		if (recorderState === 'recording') {
			accumulatedMs += Date.now() - segmentStartedAt;
		}
		if (mediaRecorder && mediaRecorder.state !== 'inactive') {
			mediaRecorder.stop();
		}
	}

	function drawWaveform() {
		if (!waveformCanvas || !analyser) return;
		const canvas = waveformCanvas;
		const ctx = canvas.getContext('2d');
		if (!ctx) return;

		const bufferLength = analyser.frequencyBinCount;
		const dataArray = new Uint8Array(bufferLength);

		const render = () => {
			if (recorderState !== 'recording' && recorderState !== 'paused') {
				return;
			}
			waveformAnimationFrame = requestAnimationFrame(render);

			analyser?.getByteFrequencyData(dataArray);

			const dpr = window.devicePixelRatio || 1;
			const cssWidth = canvas.clientWidth;
			const cssHeight = canvas.clientHeight;
			if (canvas.width !== cssWidth * dpr || canvas.height !== cssHeight * dpr) {
				canvas.width = cssWidth * dpr;
				canvas.height = cssHeight * dpr;
			}

			ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
			ctx.clearRect(0, 0, cssWidth, cssHeight);

			const barCount = 32;
			const step = Math.floor(bufferLength / barCount);
			const gap = 3;
			const barWidth = (cssWidth - gap * (barCount - 1)) / barCount;
			const isPaused = recorderState === 'paused';

			for (let i = 0; i < barCount; i++) {
				let sum = 0;
				for (let j = 0; j < step; j++) {
					sum += dataArray[i * step + j] || 0;
				}
				const avg = sum / step / 255;
				const barHeight = Math.max(2, avg * cssHeight);
				const y = (cssHeight - barHeight) / 2;
				ctx.fillStyle = isPaused ? 'rgba(239, 68, 68, 0.4)' : 'rgb(239, 68, 68)';
				ctx.fillRect(i * (barWidth + gap), y, barWidth, barHeight);
			}
		};

		render();
	}

	function cleanupAll() {
		if (timerInterval) {
			clearInterval(timerInterval);
			timerInterval = null;
		}
		if (waveformAnimationFrame !== null) {
			cancelAnimationFrame(waveformAnimationFrame);
			waveformAnimationFrame = null;
		}
		if (mediaStream) {
			mediaStream.getTracks().forEach((track) => track.stop());
			mediaStream = null;
		}
		if (audioContext) {
			audioContext.close().catch(() => {});
			audioContext = null;
		}
		analyser = null;
		mediaRecorder = null;
	}

	onDestroy(() => {
		cleanupAll();
	});
</script>

<div class="flex flex-col items-center gap-4 p-6">
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
	{:else if recorderState === 'recording' || recorderState === 'paused'}
		<canvas
			bind:this={waveformCanvas}
			class="h-16 w-full max-w-sm rounded-lg bg-[var(--color-bg-secondary)]"
		></canvas>

		<div class="flex items-center gap-2 text-2xl font-mono text-[var(--color-text)]">
			{#if recorderState === 'recording'}
				<span class="h-3 w-3 animate-pulse rounded-full bg-red-500"></span>
			{:else}
				<span class="h-3 w-3 rounded-full bg-yellow-500"></span>
			{/if}
			{formatElapsed(elapsedMs)}
		</div>

		<div class="flex items-center gap-3">
			{#if recorderState === 'recording'}
				<button
					type="button"
					onclick={pauseRecording}
					class="flex h-12 w-12 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] transition-transform hover:scale-105 active:scale-95"
					title="Pause"
					aria-label="Pause recording"
				>
					<Pause class="h-5 w-5" />
				</button>
			{:else}
				<button
					type="button"
					onclick={resumeRecording}
					class="flex h-12 w-12 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] transition-transform hover:scale-105 active:scale-95"
					title="Resume"
					aria-label="Resume recording"
				>
					<Play class="h-5 w-5" />
				</button>
			{/if}

			<button
				type="button"
				onclick={stopRecording}
				class="flex h-16 w-16 items-center justify-center rounded-full bg-red-500 text-white shadow-lg ring-4 ring-red-500/30 transition-transform hover:scale-105 active:scale-95"
				title="Stop"
				aria-label="Stop recording"
			>
				<Square class="h-6 w-6 fill-current" />
			</button>
		</div>

		<p class="text-xs text-[var(--color-text-muted)]">
			{recorderState === 'paused' ? 'Paused' : 'Recording…'}
		</p>
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
