<script lang="ts">
	import { onMount } from 'svelte';
	import {
		focusSession,
		isFocusing,
		pauseFocus,
		resumeFocus,
		stopFocus,
		tickFocus
	} from '$lib/stores/focus';
	import { Timer, Pause, Play, X, Check } from 'lucide-svelte';

	let interval: ReturnType<typeof setInterval> | null = null;

	onMount(() => {
		interval = setInterval(() => {
			if ($isFocusing) tickFocus();
		}, 1000);
		return () => {
			if (interval) clearInterval(interval);
		};
	});

	let remaining = $derived(
		$focusSession ? Math.max(0, $focusSession.duration - $focusSession.elapsed) : 0
	);

	let progress = $derived(
		$focusSession ? Math.min(100, ($focusSession.elapsed / $focusSession.duration) * 100) : 0
	);

	let isComplete = $derived(remaining === 0 && $focusSession !== null);

	let timeDisplay = $derived.by(() => {
		const mins = Math.floor(remaining / 60);
		const secs = remaining % 60;
		return `${mins}:${String(secs).padStart(2, '0')}`;
	});

	// Play a completion chime
	$effect(() => {
		if (isComplete) {
			try {
				const ctx = new AudioContext();
				const osc = ctx.createOscillator();
				const gain = ctx.createGain();
				osc.connect(gain);
				gain.connect(ctx.destination);
				osc.frequency.value = 880;
				osc.type = 'sine';
				gain.gain.setValueAtTime(0.1, ctx.currentTime);
				gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
				osc.start(ctx.currentTime);
				osc.stop(ctx.currentTime + 0.5);
			} catch { /* audio not available */ }
		}
	});
</script>

{#if $focusSession}
	<!-- Rendered above every page; takes no space unless a session is running -->
	<div class="focus-wrap">
		<div class="focus-pill" class:complete={isComplete} class:paused={$focusSession.paused} role="timer" aria-label="Focus timer">
			<div class="focus-progress" style="width: {progress}%"></div>
			{#if isComplete}
				<Check class="focus-icon h-3.5 w-3.5 shrink-0" />
			{:else}
				<Timer class="focus-icon h-3.5 w-3.5 shrink-0" />
			{/if}
			<span class="focus-label">{$focusSession.actionItemText}</span>
			<span class="focus-time">{isComplete ? 'Done' : timeDisplay}</span>
			<div class="focus-actions">
				{#if isComplete}
					<button class="focus-btn" onclick={stopFocus} aria-label="Dismiss" title="Dismiss">
						<X class="h-3.5 w-3.5" />
					</button>
				{:else}
					{#if $focusSession.paused}
						<button class="focus-btn" onclick={resumeFocus} aria-label="Resume" title="Resume">
							<Play class="h-3.5 w-3.5" />
						</button>
					{:else}
						<button class="focus-btn" onclick={pauseFocus} aria-label="Pause" title="Pause">
							<Pause class="h-3.5 w-3.5" />
						</button>
					{/if}
					<button class="focus-btn" onclick={stopFocus} aria-label="Stop" title="Stop">
						<X class="h-3.5 w-3.5" />
					</button>
				{/if}
			</div>
		</div>
	</div>
{/if}

<style>
	.focus-wrap {
		display: flex;
		justify-content: center;
		padding: 0.5rem 1rem 0;
	}

	.focus-pill {
		position: relative;
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		min-width: 0;
		max-width: min(26rem, 100%);
		height: 1.875rem;
		padding: 0 0.1875rem 0 0.75rem;
		overflow: hidden;
		isolation: isolate;
		border: 1px solid var(--color-border);
		border-radius: 999px;
		background: var(--color-bg);
		box-shadow: var(--shadow-sm);
		font-size: 0.75rem;
		color: var(--color-text);
		animation: fadeIn 150ms var(--ease-out);
	}

	.focus-pill.complete {
		--focus-done: var(--color-ref-person);
		border-color: color-mix(in srgb, var(--focus-done) 40%, var(--color-border));
	}

	/* Elapsed fill behind the content (isolation keeps it above the pill bg) */
	.focus-progress {
		position: absolute;
		inset: 0 auto 0 0;
		z-index: -1;
		background: var(--color-accent-soft);
		transition: width 1s linear;
		pointer-events: none;
	}

	.complete .focus-progress {
		background: color-mix(in srgb, var(--focus-done) 14%, transparent);
	}

	.focus-pill :global(.focus-icon) {
		color: var(--color-text-faint);
	}

	.complete :global(.focus-icon) {
		color: var(--focus-done);
	}

	.focus-label {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--color-text-muted);
	}

	.focus-time {
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		color: var(--color-accent);
	}

	.paused .focus-time {
		color: var(--color-text-faint);
	}

	.complete .focus-time {
		color: var(--focus-done);
	}

	.focus-actions {
		display: flex;
		gap: 0.0625rem;
	}

	.focus-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.5rem;
		height: 1.5rem;
		border-radius: 999px;
		color: var(--color-text-muted);
		cursor: pointer;
	}

	.focus-btn:hover {
		background: var(--color-hover);
		color: var(--color-text);
	}

	/* Keep the pill slim on touch devices despite the global 44px floor */
	@media (hover: none) and (pointer: coarse) {
		.focus-btn {
			min-width: 2rem;
			min-height: 1.75rem;
		}
	}
</style>
