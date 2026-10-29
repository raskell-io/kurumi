<script lang="ts">
	import { imageViewer, closeImageViewer } from '$lib/stores/imageViewer';
	import { portal } from '$lib/actions/portal';
	import { ZoomIn, ZoomOut, Maximize, Download, X, ChevronLeft, ChevronRight } from 'lucide-svelte';

	// Full-screen image viewer: fit to screen, zoom (wheel, pinch, buttons,
	// + / - / 0), drag to pan, double-click to toggle, ← / → between the
	// note's images, Esc or a click on the backdrop to close.

	const MIN = 0.1;
	const MAX = 8;

	let viewport: HTMLDivElement | undefined = $state();
	let natural = $state({ w: 0, h: 0 });
	let scale = $state(1);
	let fitScale = $state(1);
	let x = $state(0); // translation of the image centre from the viewport centre
	let y = $state(0);
	let dragging = $state(false);

	let current = $derived($imageViewer ? $imageViewer.images[$imageViewer.index] : null);
	let count = $derived($imageViewer?.images.length ?? 0);
	let percent = $derived(Math.round(scale * 100));

	// Reset when the image changes.
	$effect(() => {
		void current?.src;
		natural = { w: 0, h: 0 };
		scale = 1;
		x = y = 0;
	});

	function computeFit() {
		if (!viewport || !natural.w) return 1;
		// Keep clear of the ← / → buttons and the top and bottom bars.
		const padX = count > 1 ? 72 : 24;
		const padY = 72;
		return Math.min(1, (viewport.clientWidth - padX * 2) / natural.w, (viewport.clientHeight - padY * 2) / natural.h);
	}

	function onLoad(e: Event) {
		const img = e.currentTarget as HTMLImageElement;
		natural = { w: img.naturalWidth, h: img.naturalHeight };
		fitScale = computeFit();
		scale = fitScale;
		x = y = 0;
	}

	// Zoom to `next`, keeping the point under (cx, cy) (viewport coords,
	// relative to its centre) where it is.
	function zoomTo(next: number, cx = 0, cy = 0) {
		const clamped = Math.min(MAX, Math.max(MIN, next));
		const k = clamped / scale;
		x = cx - (cx - x) * k;
		y = cy - (cy - y) * k;
		scale = clamped;
		if (scale <= fitScale) x = y = 0;
	}

	function pointFromEvent(e: { clientX: number; clientY: number }) {
		const r = viewport!.getBoundingClientRect();
		return { cx: e.clientX - r.left - r.width / 2, cy: e.clientY - r.top - r.height / 2 };
	}

	function fit() {
		scale = fitScale;
		x = y = 0;
	}

	function step(delta: number) {
		if (!$imageViewer || count < 2) return;
		imageViewer.set({ ...$imageViewer, index: ($imageViewer.index + delta + count) % count });
	}

	// Non-passive, so the page doesn't scroll while zooming.
	function wheel(node: HTMLElement) {
		node.addEventListener('wheel', onWheel, { passive: false });
		return { destroy: () => node.removeEventListener('wheel', onWheel) };
	}

	function onWheel(e: WheelEvent) {
		e.preventDefault();
		const { cx, cy } = pointFromEvent(e);
		// Trackpad pinch arrives as ctrl+wheel with small deltas.
		const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0025));
		zoomTo(scale * factor, cx, cy);
	}

	// Pointer handling: one pointer pans, two pinch-zoom.
	const pointers = new Map<number, { x: number; y: number }>();
	let pinchStart: { dist: number; scale: number } | null = null;
	let moved = false;

	function onPointerDown(e: PointerEvent) {
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
		moved = false;
		dragging = true;
		if (pointers.size === 2) {
			const [a, b] = [...pointers.values()];
			pinchStart = { dist: Math.hypot(a.x - b.x, a.y - b.y), scale };
		}
	}

	function onPointerMove(e: PointerEvent) {
		const prev = pointers.get(e.pointerId);
		if (!prev) return;
		pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
		if (pointers.size === 2 && pinchStart) {
			const [a, b] = [...pointers.values()];
			const { cx, cy } = pointFromEvent({ clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 });
			zoomTo((pinchStart.scale * Math.hypot(a.x - b.x, a.y - b.y)) / pinchStart.dist, cx, cy);
		} else if (scale > fitScale) {
			x += e.clientX - prev.x;
			y += e.clientY - prev.y;
		}
		if (Math.abs(e.clientX - prev.x) + Math.abs(e.clientY - prev.y) > 2) moved = true;
	}

	function onPointerUp(e: PointerEvent) {
		pointers.delete(e.pointerId);
		if (pointers.size < 2) pinchStart = null;
		if (pointers.size === 0) dragging = false;
	}

	function onDoubleClick(e: MouseEvent) {
		const { cx, cy } = pointFromEvent(e);
		if (scale > fitScale * 1.01) fit();
		else zoomTo(Math.max(fitScale * 2, 1), cx, cy);
	}

	// A click on the backdrop (not after a drag) closes.
	function onBackdropClick(e: MouseEvent) {
		if (e.target === e.currentTarget && !moved) closeImageViewer();
	}

	function onKeydown(e: KeyboardEvent) {
		if (!$imageViewer) return;
		const keys: Record<string, () => void> = {
			Escape: closeImageViewer,
			ArrowLeft: () => step(-1),
			ArrowRight: () => step(1),
			'+': () => zoomTo(scale * 1.25),
			'=': () => zoomTo(scale * 1.25),
			'-': () => zoomTo(scale / 1.25),
			'0': fit
		};
		const action = keys[e.key];
		if (action) {
			e.preventDefault();
			e.stopPropagation();
			action();
		}
	}

	function download() {
		if (!current) return;
		const a = document.createElement('a');
		a.href = current.src;
		a.download = (current.alt && current.alt !== 'image' ? current.alt : 'image').replace(/[\\/:*?"<>|]/g, '-');
		a.click();
	}
</script>

<svelte:window onkeydowncapture={onKeydown} onresize={() => { fitScale = computeFit(); if (scale < fitScale) fit(); }} />

{#if $imageViewer && current}
	<div use:portal class="viewer" role="dialog" aria-modal="true" aria-label={current.alt || 'Image'}>
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
		<div
			bind:this={viewport}
			class="viewer-stage"
			class:grab={scale > fitScale}
			class:grabbing={dragging && scale > fitScale}
			use:wheel
			onpointerdown={onPointerDown}
			onpointermove={onPointerMove}
			onpointerup={onPointerUp}
			onpointercancel={onPointerUp}
			onclick={onBackdropClick}
			ondblclick={onDoubleClick}
		>
			<img
				src={current.src}
				alt={current.alt}
				onload={onLoad}
				draggable="false"
				class="viewer-image"
				style="width: {natural.w || 'auto'}px; transform: translate(-50%, -50%) translate({x}px, {y}px) scale({scale});"
			/>
		</div>

		<div class="viewer-bar viewer-top">
			<span class="min-w-0 truncate">{current.alt && current.alt !== 'image' && current.alt !== 'pasted image' ? current.alt : ''}</span>
			<button class="viewer-btn" onclick={closeImageViewer} title="Close (Esc)" aria-label="Close viewer"><X class="h-5 w-5" /></button>
		</div>

		{#if count > 1}
			<button class="viewer-btn viewer-nav left-3" onclick={() => step(-1)} aria-label="Previous image"><ChevronLeft class="h-6 w-6" /></button>
			<button class="viewer-btn viewer-nav right-3" onclick={() => step(1)} aria-label="Next image"><ChevronRight class="h-6 w-6" /></button>
		{/if}

		<div class="viewer-bar viewer-bottom" role="toolbar" aria-label="Zoom">
			<button class="viewer-btn" onclick={() => zoomTo(scale / 1.25)} title="Zoom out (−)" aria-label="Zoom out"><ZoomOut class="h-4 w-4" /></button>
			<button class="viewer-btn viewer-percent" onclick={() => (Math.abs(scale - 1) < 0.01 ? fit() : zoomTo(1))} title="Toggle 100% / fit" aria-label="Zoom level {percent}%">{percent}%</button>
			<button class="viewer-btn" onclick={() => zoomTo(scale * 1.25)} title="Zoom in (+)" aria-label="Zoom in"><ZoomIn class="h-4 w-4" /></button>
			<button class="viewer-btn" onclick={fit} title="Fit to screen (0)" aria-label="Fit to screen"><Maximize class="h-4 w-4" /></button>
			<button class="viewer-btn" onclick={download} title="Download" aria-label="Download image"><Download class="h-4 w-4" /></button>
			{#if count > 1}
				<span class="px-2 text-xs tabular-nums opacity-70">{($imageViewer?.index ?? 0) + 1} / {count}</span>
			{/if}
		</div>
	</div>
{/if}

<style>
	.viewer {
		position: fixed;
		inset: 0;
		z-index: 300;
		background: rgb(10 10 14 / 0.92);
		color: #e6e6ef;
		animation: viewer-in 120ms ease-out;
	}

	@keyframes viewer-in {
		from {
			opacity: 0;
		}
	}

	.viewer-stage {
		position: absolute;
		inset: 0;
		overflow: hidden;
		touch-action: none;
		cursor: zoom-out;
	}

	.viewer-stage.grab {
		cursor: grab;
	}

	.viewer-stage.grabbing {
		cursor: grabbing;
	}

	.viewer-image {
		position: absolute;
		top: 50%;
		left: 50%;
		max-width: none;
		transform-origin: center;
		user-select: none;
		box-shadow: 0 10px 40px rgb(0 0 0 / 0.5);
		cursor: default;
	}

	.grab .viewer-image {
		cursor: inherit;
	}

	.viewer-bar {
		position: absolute;
		left: 50%;
		display: flex;
		align-items: center;
		gap: 0.25rem;
		transform: translateX(-50%);
		border-radius: 999px;
		background: rgb(30 30 40 / 0.85);
		padding: 0.25rem;
		backdrop-filter: blur(6px);
	}

	.viewer-top {
		top: max(0.75rem, env(safe-area-inset-top));
		left: 0.75rem;
		right: 0.75rem;
		justify-content: space-between;
		transform: none;
		background: none;
		backdrop-filter: none;
		font-size: 0.8125rem;
	}

	.viewer-bottom {
		bottom: max(1rem, env(safe-area-inset-bottom));
	}

	.viewer-btn {
		display: flex;
		min-width: 2.25rem;
		height: 2.25rem;
		align-items: center;
		justify-content: center;
		border-radius: 999px;
		color: inherit;
	}

	.viewer-top .viewer-btn {
		background: rgb(30 30 40 / 0.85);
	}

	.viewer-btn:hover {
		background: rgb(255 255 255 / 0.12);
	}

	.viewer-percent {
		min-width: 3.5rem;
		font-size: 0.75rem;
		font-variant-numeric: tabular-nums;
	}

	.viewer-nav {
		position: absolute;
		top: 50%;
		width: 2.75rem;
		height: 2.75rem;
		transform: translateY(-50%);
		background: rgb(30 30 40 / 0.7);
	}
</style>
