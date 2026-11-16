<script lang="ts">
	/**
	 * A long note's headings at the right edge of the panel: a quiet rail of
	 * marks (one per heading, indented by level) that opens into the list on
	 * hover or keyboard focus. A click goes to the heading. It reads the
	 * editor's own headings, so it follows typing, folds and every kind of
	 * note, and stores nothing. Wide windows only; the note's menu hides it.
	 */
	import { onDestroy } from 'svelte';
	import { motionMs } from '$lib/motion';

	let { scrollArea, minimum = 3 }: { scrollArea: HTMLElement | undefined; minimum?: number } = $props();

	interface Entry {
		level: number;
		text: string;
		el: HTMLElement;
	}

	let headings = $state.raw<Entry[]>([]);
	let active = $state(-1);

	function collect() {
		const editor = scrollArea?.querySelector<HTMLElement>('.ProseMirror');
		if (!editor) {
			headings = [];
			return;
		}
		const found: Entry[] = [];
		for (const el of editor.querySelectorAll<HTMLElement>(':scope > :is(h1, h2, h3, h4, h5, h6)')) {
			const text = el.textContent?.trim() ?? '';
			if (!text || el.offsetParent === null) continue; // empty, or inside a fold
			found.push({ level: Number(el.tagName[1]), text, el });
		}
		headings = found;
		track();
	}

	function track() {
		if (!scrollArea || headings.length === 0) return;
		const top = scrollArea.getBoundingClientRect().top + 96;
		let current = -1;
		for (let i = 0; i < headings.length; i++) {
			if (headings[i].el.getBoundingClientRect().top <= top) current = i;
			else break;
		}
		active = current;
	}

	function go(entry: Entry) {
		entry.el.scrollIntoView({ block: 'start', behavior: motionMs('base') > 0 ? 'smooth' : 'auto' });
	}

	let timer: ReturnType<typeof setTimeout> | undefined;
	let observer: MutationObserver | undefined;
	let observed: HTMLElement | undefined;
	const schedule = () => {
		clearTimeout(timer);
		timer = setTimeout(collect, 250);
	};

	$effect(() => {
		const area = scrollArea;
		if (!area) return;
		observer = new MutationObserver(schedule);
		observer.observe(area, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class'] });
		observed = area;
		area.addEventListener('scroll', track, { passive: true });
		schedule();
		return () => {
			observer?.disconnect();
			area.removeEventListener('scroll', track);
			observed = undefined;
		};
	});

	onDestroy(() => {
		clearTimeout(timer);
		observer?.disconnect();
		observed?.removeEventListener('scroll', track);
	});

	const minLevel = $derived(headings.length ? Math.min(...headings.map((h) => h.level)) : 1);
</script>

{#if headings.length >= minimum}
	<nav class="note-outline" aria-label="Outline">
		<ol>
			{#each headings as entry, i (i)}
				<li style="--depth: {Math.min(entry.level - minLevel, 3)}">
					<button type="button" class:is-active={i === active} aria-current={i === active ? 'location' : undefined} onclick={() => go(entry)}>
						<span class="mark" aria-hidden="true"></span>
						<span class="label">{entry.text}</span>
					</button>
				</li>
			{/each}
		</ol>
	</nav>
{/if}

<style>
	.note-outline {
		position: absolute;
		top: 50%;
		right: 0.75rem;
		z-index: 20;
		max-height: min(70%, 32rem);
		transform: translateY(-50%);
		display: flex;
	}

	/* Only where it fits beside the note */
	@media (max-width: 1279px) {
		.note-outline {
			display: none;
		}
	}

	ol {
		margin: 0;
		padding: 0.375rem;
		list-style: none;
		overflow-y: auto;
		overscroll-behavior: contain;
		scrollbar-width: none;
		border: 1px solid transparent;
		border-radius: var(--radius-md);
		transition:
			background-color var(--motion-fast) var(--ease-enter),
			border-color var(--motion-fast) var(--ease-enter),
			box-shadow var(--motion-fast) var(--ease-enter);
	}

	button {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 0.5rem;
		width: 100%;
		min-height: 1rem;
		padding: 0.125rem 0.25rem;
		border-radius: var(--radius-sm);
		color: var(--color-text-faint);
		font-size: 0.75rem;
		line-height: 1.35;
		text-align: left;
	}

	.mark {
		flex-shrink: 0;
		order: 2;
		width: calc(1rem - var(--depth) * 0.25rem);
		height: 2px;
		border-radius: 1px;
		background: currentColor;
		opacity: 0.55;
	}

	.label {
		display: none;
		flex: 1;
		max-width: 14rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		padding-left: calc(var(--depth) * 0.75rem);
	}

	.is-active {
		color: var(--color-accent);
	}

	.is-active .mark {
		opacity: 1;
	}

	/* Open: the list itself, on hover or keyboard focus */
	.note-outline:is(:hover, :focus-within) ol {
		border-color: var(--color-border);
		background: var(--color-bg);
		box-shadow: var(--shadow-md);
	}

	.note-outline:is(:hover, :focus-within) .label {
		display: block;
	}

	.note-outline:is(:hover, :focus-within) button {
		color: var(--color-text-muted);
	}

	.note-outline:is(:hover, :focus-within) .is-active {
		color: var(--color-accent);
	}

	button:hover {
		background: var(--color-hover);
		color: var(--color-text);
	}

	button:focus-visible {
		outline: 2px solid var(--color-accent);
		outline-offset: -2px;
	}
</style>
