<script module lang="ts">
	export type RecorderState = 'idle' | 'requesting' | 'recording' | 'paused' | 'stopped' | 'error';
</script>

<script lang="ts">
	import { Mic, Square, Pause, Play, AlertCircle } from 'lucide-svelte';
	import { onDestroy, tick } from 'svelte';

	export type AudioSources = 'mic' | 'mic+tab';

	interface Props {
		onComplete: (result: { blob: Blob; mimeType: string; durationMs: number }) => void;
		onCancel?: () => void;
		onStart?: () => void;
		/** Notified whenever the recorder moves between states, so a host
		 *  modal can avoid dismissing mid-recording. */
		onStateChange?: (state: RecorderState) => void;
		audioSources?: AudioSources;
	}

	let { onComplete, onCancel, onStart, onStateChange, audioSources = 'mic' }: Props = $props();

	let recorderState = $state<RecorderState>('idle');

	$effect(() => {
		onStateChange?.(recorderState);
	});

	// Focus the start button on open so Enter/Space begins recording
	let startButton: HTMLButtonElement | undefined = $state();
	$effect(() => {
		startButton?.focus();
	});
	let errorMessage = $state<string | null>(null);
	let elapsedMs = $state(0);

	// The stream MediaRecorder records from. May be the raw mic stream, or a
	// merged stream produced by the Web Audio graph below.
	let recordStream: MediaStream | null = null;
	// Original source streams we need to clean up explicitly. The merged
	// stream lives inside audioContext and is released when the context closes.
	let micStream: MediaStream | null = null;
	let displayStream: MediaStream | null = null;
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

		// 1. Always grab the mic.
		try {
			micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
		} catch (err) {
			recorderState = 'error';
			errorMessage =
				err instanceof Error && err.name === 'NotAllowedError'
					? 'Microphone permission denied. Allow access in your browser settings and try again.'
					: 'Could not access microphone.';
			return;
		}

		// 2. If tab-audio mode, also grab a display stream and merge them.
		if (audioSources === 'mic+tab') {
			try {
				displayStream = await navigator.mediaDevices.getDisplayMedia({
					// Some browsers require video to be requested even if we
					// only need audio. We stop the video tracks immediately.
					video: true,
					audio: true
				});
			} catch (err) {
				cleanupAll();
				recorderState = 'error';
				errorMessage =
					err instanceof Error && err.name === 'NotAllowedError'
						? 'Tab/window audio permission denied or cancelled.'
						: 'Could not capture tab/window audio.';
				return;
			}

			const tabAudioTracks = displayStream.getAudioTracks();
			if (tabAudioTracks.length === 0) {
				cleanupAll();
				recorderState = 'error';
				errorMessage =
					'No audio shared. When picking the tab/window, make sure to check "Share tab audio" (or the equivalent option in your browser).';
				return;
			}

			// We don't need video, just audio.
			displayStream.getVideoTracks().forEach((t) => t.stop());

			// If a tab audio track stops on its own (e.g. user closes the tab),
			// stop the recording cleanly.
			tabAudioTracks[0].onended = () => {
				if (recorderState === 'recording' || recorderState === 'paused') {
					stopRecording();
				}
			};

			// Build a Web Audio graph that mixes mic + tab audio into a single
			// MediaStream that MediaRecorder can record.
			try {
				const Ctx =
					window.AudioContext ||
					(window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
				if (!Ctx) throw new Error('Web Audio API not available');

				audioContext = new Ctx();
				const micSource = audioContext.createMediaStreamSource(micStream);
				const tabSource = audioContext.createMediaStreamSource(new MediaStream(tabAudioTracks));
				const destination = audioContext.createMediaStreamDestination();
				micSource.connect(destination);
				tabSource.connect(destination);

				// Tap an analyser off the merged signal for the waveform.
				analyser = audioContext.createAnalyser();
				analyser.fftSize = 256;
				micSource.connect(analyser);
				tabSource.connect(analyser);

				recordStream = destination.stream;
			} catch (err) {
				cleanupAll();
				recorderState = 'error';
				errorMessage =
					err instanceof Error
						? `Failed to mix audio sources: ${err.message}`
						: 'Failed to mix audio sources.';
				return;
			}
		} else {
			// Mic-only path
			recordStream = micStream;

			// Set up the analyser for the waveform
			try {
				const Ctx =
					window.AudioContext ||
					(window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
				if (Ctx) {
					audioContext = new Ctx();
					const source = audioContext.createMediaStreamSource(micStream);
					analyser = audioContext.createAnalyser();
					analyser.fftSize = 256;
					source.connect(analyser);
				}
			} catch {
				// Waveform is optional; carry on without it
				analyser = null;
			}
		}

		try {
			mediaRecorder = new MediaRecorder(recordStream!);
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

		segmentStartedAt = Date.now();
		mediaRecorder.start();
		recorderState = 'recording';
		onStart?.();

		timerInterval = setInterval(() => {
			elapsedMs = currentElapsed();
		}, 250);

		// The canvas only mounts once the recording branch renders
		await tick();
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

		// Bars take the canvas's CSS text color (theme-aware danger red)
		const barColor = getComputedStyle(canvas).color || 'rgb(239, 68, 68)';
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
				ctx.globalAlpha = isPaused ? 0.35 : 1;
				ctx.fillStyle = barColor;
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
		if (micStream) {
			micStream.getTracks().forEach((track) => track.stop());
			micStream = null;
		}
		if (displayStream) {
			displayStream.getTracks().forEach((track) => track.stop());
			displayStream = null;
		}
		recordStream = null;
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

<div class="flex flex-col items-center gap-3 px-6 pt-6 pb-5">
	{#if recorderState === 'idle'}
		<button
			type="button"
			bind:this={startButton}
			onclick={startRecording}
			class="record-btn flex h-16 w-16 items-center justify-center rounded-full text-white"
			title="Start recording"
			aria-label="Start recording"
		>
			<Mic class="h-7 w-7" />
		</button>
		<p class="text-xs text-[var(--color-text-faint)]">Click or press Enter to start recording</p>
	{:else if recorderState === 'requesting'}
		<div class="flex h-16 w-16 items-center justify-center rounded-full bg-[var(--color-hover)]">
			<div class="h-6 w-6 animate-spin rounded-full border-2 border-[var(--color-accent)] border-t-transparent"></div>
		</div>
		<p class="text-xs text-[var(--color-text-muted)]">
			{audioSources === 'mic+tab'
				? 'Requesting microphone + tab/window audio…'
				: 'Requesting microphone…'}
		</p>
	{:else if recorderState === 'recording' || recorderState === 'paused'}
		<canvas
			bind:this={waveformCanvas}
			class="h-12 w-full max-w-sm text-[var(--color-danger)]"
		></canvas>

		<div class="flex items-center gap-2 font-mono text-xl tabular-nums text-[var(--color-text)]">
			<span
				class="h-2 w-2 rounded-full bg-[var(--color-danger)]"
				class:animate-pulse={recorderState === 'recording'}
				class:opacity-40={recorderState === 'paused'}
			></span>
			{formatElapsed(elapsedMs)}
		</div>
		<p class="-mt-2 text-xs text-[var(--color-text-faint)]">
			{recorderState === 'paused' ? 'Paused' : 'Recording…'}
		</p>

		<div class="mt-1 flex items-center gap-2">
			{#if recorderState === 'recording'}
				<button type="button" onclick={pauseRecording} class="k-btn" title="Pause" aria-label="Pause recording">
					<Pause class="h-3.5 w-3.5" />
					Pause
				</button>
			{:else}
				<button type="button" onclick={resumeRecording} class="k-btn" title="Resume" aria-label="Resume recording">
					<Play class="h-3.5 w-3.5" />
					Resume
				</button>
			{/if}
			<button type="button" onclick={stopRecording} class="k-btn k-btn-primary" title="Stop and save" aria-label="Stop recording">
				<Square class="h-3 w-3 fill-current" />
				Stop &amp; save
			</button>
		</div>
	{:else if recorderState === 'stopped'}
		<p class="text-sm text-[var(--color-text-muted)]">Saving…</p>
	{:else if recorderState === 'error'}
		<div class="flex flex-col items-center gap-3 text-center">
			<AlertCircle class="h-6 w-6 text-[var(--color-danger)]" />
			<p class="max-w-xs text-sm text-[var(--color-text)]">{errorMessage}</p>
			<div class="flex gap-2">
				{#if onCancel}
					<button type="button" onclick={onCancel} class="k-btn k-btn-ghost">Cancel</button>
				{/if}
				<button
					type="button"
					onclick={() => {
						recorderState = 'idle';
						errorMessage = null;
					}}
					class="k-btn"
				>
					Try again
				</button>
			</div>
		</div>
	{/if}
</div>

<style>
	/* Recording is the one place red is the primary affordance */
	.record-btn {
		background: var(--color-danger);
		box-shadow: var(--shadow-md);
		transition: filter 120ms var(--ease-out);
	}

	.record-btn:hover {
		filter: brightness(1.08);
	}

	.record-btn:focus-visible {
		outline: none;
		box-shadow:
			var(--shadow-md),
			0 0 0 4px color-mix(in srgb, var(--color-danger) 25%, transparent);
	}
</style>
