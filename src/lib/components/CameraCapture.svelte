<script lang="ts">
	import { processAndStoreImage } from '$lib/utils/image';
	import { Camera, X, SwitchCamera, CircleDot } from 'lucide-svelte';
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

	onDestroy(() => stopStream());
</script>

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
	<div class="backdrop" onclick={onClose} role="dialog" aria-modal="true" tabindex="-1">
		<div class="camera-modal" onclick={(e) => e.stopPropagation()} role="document">
			<div class="camera-header">
				<h3>Take a photo</h3>
				<button class="close-btn" onclick={() => { stopStream(); onClose(); }} aria-label="Close">
					<X class="h-4 w-4" />
				</button>
			</div>

			{#if error}
				<div class="error">
					{error}
				</div>
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
						<div class="spinner"></div>
						<span>Converting to AVIF...</span>
					</div>
				{/if}
			</div>

			<div class="controls">
				<button class="control-btn" onclick={switchCamera} title="Switch camera">
					<SwitchCamera class="h-5 w-5" />
				</button>
				<button
					class="shutter-btn"
					onclick={takeSnapshot}
					disabled={!capturing || processing}
					aria-label="Take photo"
				>
					<CircleDot class="h-8 w-8" />
				</button>
				<div class="control-spacer"></div>
			</div>
		</div>
	</div>
{:else if processing}
	<!-- Mobile processing overlay -->
	<div class="backdrop" role="status">
		<div class="processing-card">
			<div class="spinner"></div>
			<span>Converting to AVIF...</span>
		</div>
	</div>
{/if}

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.8);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 200;
		padding: 1rem;
	}

	.camera-modal {
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 0.75rem;
		max-width: 640px;
		width: 100%;
		overflow: hidden;
		box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
	}

	.camera-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.75rem 1rem;
		border-bottom: 1px solid var(--color-border);
	}

	.camera-header h3 {
		font-size: 1rem;
		font-weight: 600;
		color: var(--color-text);
	}

	.close-btn {
		background: none;
		border: none;
		padding: 0.375rem;
		border-radius: 0.375rem;
		cursor: pointer;
		color: var(--color-text-muted);
	}

	.close-btn:hover {
		background: var(--color-bg-secondary);
	}

	.error {
		padding: 0.75rem 1rem;
		background: rgba(239, 68, 68, 0.1);
		color: #ef4444;
		font-size: 0.875rem;
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
		background: rgba(0, 0, 0, 0.7);
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.75rem;
		color: white;
		font-size: 0.875rem;
	}

	.controls {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 1rem;
		background: var(--color-bg-secondary);
	}

	.control-btn {
		background: none;
		border: 1px solid var(--color-border);
		padding: 0.5rem;
		border-radius: 50%;
		cursor: pointer;
		color: var(--color-text-muted);
		transition: all 0.15s;
	}

	.control-btn:hover {
		background: var(--color-border);
		color: var(--color-text);
	}

	.control-spacer {
		width: 2.5rem;
	}

	.shutter-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 3.5rem;
		height: 3.5rem;
		border-radius: 50%;
		background: white;
		border: 3px solid var(--color-accent);
		cursor: pointer;
		color: var(--color-accent);
		transition: all 0.15s;
	}

	.shutter-btn:hover:not(:disabled) {
		background: var(--color-accent);
		color: white;
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
		padding: 2rem;
		background: var(--color-bg);
		border-radius: 0.75rem;
		color: var(--color-text);
		font-size: 0.875rem;
	}

	.spinner {
		width: 1.5rem;
		height: 1.5rem;
		border: 2px solid var(--color-accent);
		border-top-color: transparent;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}
</style>
