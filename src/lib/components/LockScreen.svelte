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

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			handleSubmit();
		}
	}
</script>

{#if $isLocked}
	<div class="lock-overlay">
		<div class="lock-card">
			<Lock class="h-8 w-8 text-[var(--color-accent)]" />
			<h2>Kurumi is locked</h2>
			<p>Enter your PIN to unlock</p>
			<input
				bind:this={inputEl}
				bind:value={pin}
				onkeydown={handleKeydown}
				type="password"
				inputmode="numeric"
				pattern="[0-9]*"
				maxlength="8"
				placeholder="PIN"
				class="lock-input"
				autocomplete="off"
			/>
			{#if error}
				<p class="lock-error">{error}</p>
			{/if}
			<button class="lock-btn" onclick={handleSubmit}>
				<ShieldCheck class="h-4 w-4" />
				Unlock
			</button>
		</div>
	</div>
{/if}

<style>
	.lock-overlay {
		position: fixed;
		inset: 0;
		z-index: 9999;
		background: var(--color-bg);
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.lock-card {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.75rem;
		padding: 2rem;
		max-width: 320px;
		width: 100%;
	}

	.lock-card h2 {
		font-size: 1.125rem;
		font-weight: 700;
		color: var(--color-text);
		margin: 0;
	}

	.lock-card p {
		font-size: 0.8125rem;
		color: var(--color-text-muted);
		margin: 0;
	}

	.lock-input {
		width: 100%;
		padding: 0.75rem 1rem;
		border: 1px solid var(--color-border);
		border-radius: 0.5rem;
		background: var(--color-bg-secondary);
		color: var(--color-text);
		font-size: 1.5rem;
		text-align: center;
		letter-spacing: 0.5em;
		outline: none;
	}

	.lock-input:focus {
		border-color: var(--color-accent);
	}

	.lock-error {
		color: #ef4444 !important;
		font-size: 0.75rem !important;
	}

	.lock-btn {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.625rem 1.5rem;
		border: none;
		border-radius: 0.5rem;
		background: var(--color-accent);
		color: white;
		font-size: 0.875rem;
		font-weight: 500;
		cursor: pointer;
	}

	.lock-btn:hover {
		opacity: 0.9;
	}
</style>
