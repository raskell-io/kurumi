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
	import { Timer, Pause, Play, X } from 'lucide-svelte';

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

	let timeDisplay = $derived(() => {
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
	<div class="focus-bar" class:complete={isComplete}>
		<div class="focus-progress" style="width: {progress}%"></div>
		<div class="focus-content">
			<Timer class="h-3.5 w-3.5 shrink-0" />
			<span class="focus-label">{$focusSession.actionItemText}</span>
			<span class="focus-time">{timeDisplay()}</span>
			<div class="focus-actions">
				{#if isComplete}
					<button class="focus-btn" onclick={stopFocus} title="Done">
						<X class="h-3.5 w-3.5" />
					</button>
				{:else if $focusSession.paused}
					<button class="focus-btn" onclick={resumeFocus} title="Resume">
						<Play class="h-3.5 w-3.5" />
					</button>
				{:else}
					<button class="focus-btn" onclick={pauseFocus} title="Pause">
						<Pause class="h-3.5 w-3.5" />
					</button>
				{/if}
				<button class="focus-btn" onclick={stopFocus} title="Stop">
					<X class="h-3.5 w-3.5" />
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.focus-bar {
		position: relative;
		border-bottom: 1px solid var(--color-border);
		background: var(--color-bg-secondary);
		overflow: hidden;
	}

	.focus-bar.complete {
		background: color-mix(in srgb, #22c55e 10%, var(--color-bg-secondary));
		border-color: color-mix(in srgb, #22c55e 30%, var(--color-border));
	}

	.focus-progress {
		position: absolute;
		inset: 0;
		background: color-mix(in srgb, var(--color-accent) 8%, transparent);
		transition: width 1s linear;
	}

	.focus-content {
		position: relative;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.375rem 0.75rem;
		font-size: 0.75rem;
		color: var(--color-text);
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

	.complete .focus-time {
		color: #22c55e;
	}

	.focus-actions {
		display: flex;
		gap: 0.125rem;
	}

	.focus-btn {
		padding: 0.25rem;
		border: none;
		border-radius: 0.25rem;
		background: none;
		color: var(--color-text-muted);
		cursor: pointer;
	}

	.focus-btn:hover {
		color: var(--color-text);
		background: var(--color-border);
	}
</style>
