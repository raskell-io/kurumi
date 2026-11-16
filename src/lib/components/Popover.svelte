<script lang="ts">
	/**
	 * A popup under `anchor`, kept on screen. Portaled to <body> so tables and
	 * scroll areas don't clip it. Closing, keys and focus: the shared menu
	 * behaviour ($lib/actions/overlay).
	 */
	import { portal } from '$lib/actions/portal';
	import { popOut } from '$lib/motion';
	import { menu } from '$lib/actions/overlay';
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
	let above = $state(false);

	function place() {
		if (!el) return;
		const a = anchor.getBoundingClientRect();
		const margin = 8;
		const h = el.offsetHeight;
		const w = el.offsetWidth;
		above = a.bottom + 4 + h > window.innerHeight - margin;
		top = above ? Math.max(margin, a.top - h - 4) : a.bottom + 4;
		left = Math.min(Math.max(margin, a.left), window.innerWidth - w - margin);
	}

	onMount(() => {
		place();
		const reflow = () => place();
		window.addEventListener('resize', reflow);
		window.addEventListener('scroll', reflow, true);
		const observer = new ResizeObserver(reflow);
		if (el) observer.observe(el);
		return () => {
			window.removeEventListener('resize', reflow);
			window.removeEventListener('scroll', reflow, true);
			observer.disconnect();
		};
	});
</script>

<div
	use:portal
	use:menu={{ onClose, inside: [anchor], returnFocus: anchor }}
	bind:this={el}
	class="k-menu fixed z-[120]"
	style="top: {top}px; left: {left}px; width: {width}; max-width: calc(100vw - 16px); --pop-origin: {above ? 'bottom' : 'top'} left;"
	out:popOut|global
	role="dialog"
	aria-label={label}
>
	{@render children()}
</div>
