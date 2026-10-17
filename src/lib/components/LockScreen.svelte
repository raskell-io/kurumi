<script lang="ts">
	import { isLocked, unlock, lockEnabled, hasPinSet } from '$lib/stores/lock';
	import { Lock, ShieldCheck } from 'lucide-svelte';

	let pin = $state('');
	let error = $state('');
	let inputEl: HTMLInputElement | undefined = $state();

	$effect(() => {
		if ($isLocked) {
			pin = '';
			error = '';
			requestAnimationFrame(() => inputEl?.focus());
		}
	});

	async function handleSubmit() {
		if (pin.length < 4) {
			error = 'PIN must be at least 4 digits';
			return;
		}
		const ok = await unlock(pin);
		if (!ok) {
			error = 'Wrong PIN';
			pin = '';
			inputEl?.focus();
		}
	}

</script>

{#if $isLocked}
	<div class="lock-overlay" role="dialog" aria-modal="true" aria-labelledby="lock-title">
		<form
			class="lock-card"
			onsubmit={(e) => {
				e.preventDefault();
				handleSubmit();
			}}
		>
			<Lock class="mb-1 h-5 w-5 text-[var(--color-text-faint)]" />
			<h2 id="lock-title" class="text-base font-semibold text-[var(--color-text)]">Kurumi is locked</h2>
			<p class="text-sm text-[var(--color-text-muted)]">Enter your PIN to continue.</p>
			<input
				bind:this={inputEl}
				bind:value={pin}
				oninput={() => (error = '')}
				type="password"
				inputmode="numeric"
				pattern="[0-9]*"
				maxlength="8"
				placeholder="••••"
				aria-label="PIN"
				aria-invalid={!!error}
				class="k-input lock-input mt-3"
				autocomplete="off"
			/>
			<p class="lock-error text-xs" role="alert">{error}</p>
			<button type="submit" class="k-btn k-btn-primary w-full">
				<ShieldCheck class="h-4 w-4" />
				Unlock
			</button>
		</form>
	</div>
{/if}

<style>
	.lock-overlay {
		position: fixed;
		inset: 0;
		z-index: 9999;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem;
		background: var(--color-bg);
	}

	.lock-card {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.25rem;
		width: 100%;
		max-width: 18rem;
		text-align: center;
	}

	.lock-input {
		height: 2.75rem;
		font-size: 1.25rem;
		text-align: center;
		letter-spacing: 0.4em;
	}

	.lock-input[aria-invalid='true'] {
		border-color: var(--color-danger);
	}

	/* Reserve the line so the card doesn't jump when an error appears */
	.lock-error {
		min-height: 1.25rem;
		margin: 0.25rem 0;
		color: var(--color-danger);
	}
</style>
