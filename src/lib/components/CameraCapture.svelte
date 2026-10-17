<script lang="ts">
	import { processAndStoreImage } from '$lib/utils/image';
	import { X, SwitchCamera, Loader2 } from 'lucide-svelte';
	import { onDestroy } from 'svelte';

	interface Props {
		/** Called with the markdown image string after capture + conversion. */
		onCapture: (markdown: string) => void;
		onClose: () => void;
	}

	let { onCapture, onClose }: Props = $props();

	let videoRef: HTMLVideoElement | undefined = $state();
	let stream: MediaStream | null = null;
	let capturing = $state(false);
	let processing = $state(false);
	let error = $state<string | null>(null);
	let facingMode = $state<'user' | 'environment'>('environment');

	// On mobile, we use a hidden <input capture> for the most native
	// experience. On desktop, we show a live webcam preview.
	let isMobile = $state(false);
	let mobileInputRef: HTMLInputElement | undefined = $state();

	$effect(() => {
		isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
		if (isMobile) {
			// On mobile, just trigger the file input immediately
			requestAnimationFrame(() => mobileInputRef?.click());
		} else {
			startWebcam();
		}
	});

	async function startWebcam() {
		error = null;
		try {
			// Stop any existing stream first
			stopStream();
			stream = await navigator.mediaDevices.getUserMedia({
				video: { facingMode, width: { ideal: 1920 }, height: { ideal: 1080 } }
			});
			if (videoRef) {
				videoRef.srcObject = stream;
				await videoRef.play();
			}
			capturing = true;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Camera access denied';
			capturing = false;
		}
	}

	function stopStream() {
		if (stream) {
			for (const track of stream.getTracks()) track.stop();
			stream = null;
		}
		capturing = false;
	}

	function switchCamera() {
		facingMode = facingMode === 'user' ? 'environment' : 'user';
		startWebcam();
	}

	async function takeSnapshot() {
		if (!videoRef || !stream) return;
		processing = true;

		try {
			const canvas = document.createElement('canvas');
			canvas.width = videoRef.videoWidth;
			canvas.height = videoRef.videoHeight;
			const ctx = canvas.getContext('2d');
			if (!ctx) throw new Error('Canvas context unavailable');
			ctx.drawImage(videoRef, 0, 0);

			const blob = await new Promise<Blob | null>((resolve) =>
				canvas.toBlob(resolve, 'image/jpeg', 0.95)
			);
			if (!blob) throw new Error('Snapshot failed');

			const now = new Date();
			const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
			const result = await processAndStoreImage(blob, `photo-${timestamp}`);
			stopStream();
			onCapture(result.markdown);
		} catch (err) {
			error = err instanceof Error ? err.message : 'Capture failed';
		} finally {
			processing = false;
		}
	}

	async function handleMobileCapture(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) {
			onClose();
			return;
		}
		processing = true;
		try {
			const result = await processAndStoreImage(file, 'photo');
			onCapture(result.markdown);
		} catch (err) {
			error = err instanceof Error ? err.message : 'Processing failed';
			processing = false;
		}
	}

	function close() {
		stopStream();
		onClose();
	}

	// Focus the shutter once the stream is live so Space/Enter shoots
	let shutterRef: HTMLButtonElement | undefined = $state();
	$effect(() => {
		if (capturing) shutterRef?.focus();
	});

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape' && !processing) {
			e.preventDefault();
			close();
		}
	}

	onDestroy(() => stopStream());
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- Hidden mobile camera input -->
<input
	bind:this={mobileInputRef}
	type="file"
	accept="image/*"
	capture="environment"
	onchange={handleMobileCapture}
	class="hidden"
/>

{#if !isMobile}
	<!-- Desktop webcam modal -->
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div
		class="k-dialog-backdrop camera-backdrop"
		onclick={close}
		role="dialog"
		aria-modal="true"
		aria-labelledby="camera-title"
		tabindex="-1"
	>
		<div class="k-dialog camera-modal" onclick={(e) => e.stopPropagation()} role="document">
			<div class="camera-header">
				<h2 id="camera-title">Take a photo</h2>
				<button type="button" class="k-icon-btn" onclick={close} aria-label="Close">
					<X class="h-4 w-4" />
				</button>
			</div>

			{#if error}
				<div class="error" role="alert">{error}</div>
			{/if}

			<div class="video-container">
				<!-- svelte-ignore a11y_media_has_caption -->
				<video
					bind:this={videoRef}
					autoplay
					playsinline
					muted
					class="video-feed"
					class:mirror={facingMode === 'user'}
				></video>

				{#if processing}
					<div class="processing-overlay">
						<Loader2 class="h-5 w-5 animate-spin" />
						<span>Converting to AVIF…</span>
					</div>
				{/if}
			</div>

			<div class="controls">
				<button type="button" class="k-icon-btn" onclick={switchCamera} title="Switch camera" aria-label="Switch camera">
					<SwitchCamera class="h-4 w-4" />
				</button>
				<button
					type="button"
					bind:this={shutterRef}
					class="shutter-btn"
					onclick={takeSnapshot}
					disabled={!capturing || processing}
					aria-label="Take photo"
				>
					<span class="shutter-inner"></span>
				</button>
				<button type="button" class="k-btn k-btn-ghost k-btn-sm" onclick={close}>Cancel</button>
			</div>
		</div>
	</div>
{:else if processing || error}
	<!-- Mobile: processing / error card after the native camera returns -->
	<div class="k-dialog-backdrop camera-backdrop" role={error ? 'alertdialog' : 'status'} aria-modal={error ? 'true' : undefined}>
		<div class="k-dialog processing-card">
			{#if error}
				<span class="text-[var(--color-danger)]">{error}</span>
				<button type="button" class="k-btn" onclick={close}>Close</button>
			{:else}
				<Loader2 class="h-5 w-5 animate-spin text-[var(--color-accent)]" />
				<span>Converting to AVIF…</span>
			{/if}
		</div>
	</div>
{/if}

<style>
	.camera-backdrop {
		z-index: 200;
	}

	@media (min-width: 768px) {
		.camera-backdrop {
			align-items: center;
			padding-top: 1rem;
		}
	}

	.camera-modal {
		max-width: 40rem;
		max-height: 90vh;
		overflow: hidden;
	}

	.camera-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.625rem 0.625rem 0.625rem 1rem;
	}

	.camera-header h2 {
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--color-text);
	}

	.error {
		padding: 0.5rem 1rem;
		background: color-mix(in srgb, var(--color-danger) 10%, transparent);
		color: var(--color-danger);
		font-size: 0.8125rem;
	}

	.video-container {
		position: relative;
		background: #000;
		aspect-ratio: 4 / 3;
	}

	.video-feed {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.video-feed.mirror {
		transform: scaleX(-1);
	}

	.processing-overlay {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.75rem;
		background: rgb(0 0 0 / 0.6);
		color: white;
		font-size: 0.8125rem;
	}

	.controls {
		display: grid;
		grid-template-columns: 1fr auto 1fr;
		align-items: center;
		padding: 0.75rem 1rem;
	}

	.controls > :last-child {
		justify-self: end;
	}

	/* Classic camera shutter: ring + solid disc */
	.shutter-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 3.25rem;
		height: 3.25rem;
		border: 2px solid var(--color-text-muted);
		border-radius: 50%;
		cursor: pointer;
	}

	.shutter-inner {
		width: 2.5rem;
		height: 2.5rem;
		border-radius: 50%;
		background: var(--color-text);
		transition: transform 100ms var(--ease-out);
	}

	.shutter-btn:hover:not(:disabled) .shutter-inner {
		background: var(--color-accent);
	}

	.shutter-btn:active:not(:disabled) .shutter-inner {
		transform: scale(0.92);
	}

	.shutter-btn:focus-visible {
		outline: none;
		box-shadow: 0 0 0 3px var(--color-accent-soft);
	}

	.shutter-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.processing-card {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.75rem;
		max-width: 20rem;
		padding: 1.5rem;
		text-align: center;
		color: var(--color-text);
		font-size: 0.875rem;
	}
</style>
