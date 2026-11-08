<script lang="ts">
	/**
	 * A popup under `anchor`, kept on screen, closed by a click outside or
	 * Escape. Portaled to <body> so tables and scroll areas don't clip it.
	 */
	import { portal } from '$lib/actions/portal';
	import { onMount, type Snippet } from 'svelte';

	interface Props {
		anchor: HTMLElement;
		onClose: () => void;
		children: Snippet;
		width?: string;
		label?: string;
	}

	let { anchor, onClose, children, width = '15rem', label }: Props = $props();
	let el: HTMLDivElement | undefined = $state();
	let top = $state(0);
	let left = $state(0);

	function place() {
		if (!el) return;
		const a = anchor.getBoundingClientRect();
		const margin = 8;
		const h = el.offsetHeight;
		const w = el.offsetWidth;
		top = a.bottom + 4 + h > window.innerHeight - margin ? Math.max(margin, a.top - h - 4) : a.bottom + 4;
		left = Math.min(Math.max(margin, a.left), window.innerWidth - w - margin);
	}

	onMount(() => {
		place();
		const outside = (e: PointerEvent) => {
			const target = e.target as Node;
			if (!el?.contains(target) && !anchor.contains(target)) onClose();
		};
		const key = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				e.stopPropagation();
				onClose();
				anchor.focus?.();
			}
		};
		const reflow = () => place();
		document.addEventListener('pointerdown', outside, true);
		document.addEventListener('keydown', key, true);
		window.addEventListener('resize', reflow);
		window.addEventListener('scroll', reflow, true);
		const observer = new ResizeObserver(reflow);
		if (el) observer.observe(el);
		return () => {
			document.removeEventListener('pointerdown', outside, true);
			document.removeEventListener('keydown', key, true);
			window.removeEventListener('resize', reflow);
			window.removeEventListener('scroll', reflow, true);
			observer.disconnect();
		};
	});
</script>

<div
	use:portal
	bind:this={el}
	class="k-menu fixed z-[120]"
	style="top: {top}px; left: {left}px; width: {width}; max-width: calc(100vw - 16px);"
	role="dialog"
	aria-label={label}
>
	{@render children()}
</div>
