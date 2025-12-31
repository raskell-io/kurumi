<script lang="ts">
	import { Sparkles, FileText, Minimize2, Languages, Loader2, X } from 'lucide-svelte';
	import { runAction, isAIConfigured, type AIAction } from '$lib/ai';

	interface Props {
		position: { x: number; y: number };
		selectedText: string;
		onResult: (text: string) => void;
		onClose: () => void;
	}

	let { position, selectedText, onResult, onClose }: Props = $props();

	let isLoading = $state(false);
	let currentAction = $state<AIAction | null>(null);
	let error = $state<string | null>(null);
	let showLanguageSelect = $state(false);

	const languages = [
		'English',
		'Spanish',
		'French',
		'German',
		'Italian',
		'Portuguese',
		'Japanese',
		'Chinese',
		'Korean'
	];

	async function handleAction(action: AIAction, language?: string) {
		if (!isAIConfigured()) {
			error = 'AI not configured. Go to Settings to add your API key.';
			return;
		}

		isLoading = true;
		currentAction = action;
		error = null;

		const result = await runAction(action, selectedText, language);

		isLoading = false;
		currentAction = null;

		if (result.success && result.text) {
			onResult(result.text);
		} else {
			error = result.error || 'Failed to process text';
		}
	}

	function handleTranslateClick() {
		showLanguageSelect = !showLanguageSelect;
	}

	function handleLanguageSelect(language: string) {
		showLanguageSelect = false;
		handleAction('translate', language);
	}

	// Close on escape
	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			onClose();
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<div
	class="ai-action-menu"
	style="left: {position.x}px; top: {position.y}px;"
>
	{#if error}
		<div class="error-message">
			<span>{error}</span>
			<button onclick={() => (error = null)} class="error-close">
				<X class="h-3 w-3" />
			</button>
		</div>
	{:else if isLoading}
		<div class="loading-state">
			<Loader2 class="h-4 w-4 animate-spin" />
			<span>
				{#if currentAction === 'improve'}Improving...
				{:else if currentAction === 'expand'}Expanding...
				{:else if currentAction === 'summarize'}Summarizing...
				{:else if currentAction === 'simplify'}Simplifying...
				{:else if currentAction === 'translate'}Translating...
				{:else}Processing...
				{/if}
			</span>
		</div>
	{:else}
		<div class="action-buttons">
			<button
				onclick={() => handleAction('improve')}
				class="action-btn"
				title="Improve clarity and grammar"
			>
				<Sparkles class="h-4 w-4" />
				<span>Improve</span>
			</button>

			<button
				onclick={() => handleAction('expand')}
				class="action-btn"
				title="Add more detail"
			>
				<FileText class="h-4 w-4" />
				<span>Expand</span>
			</button>

			<button
				onclick={() => handleAction('summarize')}
				class="action-btn"
				title="Condense to key points"
			>
				<Minimize2 class="h-4 w-4" />
				<span>Summarize</span>
			</button>

			<button
				onclick={() => handleAction('simplify')}
				class="action-btn"
				title="Make easier to understand"
			>
				<FileText class="h-4 w-4" />
				<span>Simplify</span>
			</button>

			<div class="translate-wrapper">
				<button
					onclick={handleTranslateClick}
					class="action-btn"
					title="Translate to another language"
				>
					<Languages class="h-4 w-4" />
					<span>Translate</span>
				</button>

				{#if showLanguageSelect}
					<div class="language-dropdown">
						{#each languages as language}
							<button
								onclick={() => handleLanguageSelect(language)}
								class="language-option"
							>
								{language}
							</button>
						{/each}
					</div>
				{/if}
			</div>
		</div>
	{/if}
</div>

<style>
	.ai-action-menu {
		position: fixed;
		z-index: 100;
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 0.75rem;
		box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.2), 0 8px 10px -6px rgba(0, 0, 0, 0.1);
		padding: 0.5rem;
		transform: translateX(-50%);
	}

	.action-buttons {
		display: flex;
		gap: 0.25rem;
		flex-wrap: wrap;
	}

	.action-btn {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.5rem 0.75rem;
		border-radius: 0.5rem;
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--color-text);
		background: transparent;
		border: none;
		cursor: pointer;
		transition: all 0.15s;
		white-space: nowrap;
	}

	.action-btn:hover {
		background: var(--color-bg-secondary);
		color: var(--color-accent);
	}

	.action-btn :global(svg) {
		flex-shrink: 0;
	}

	.translate-wrapper {
		position: relative;
	}

	.language-dropdown {
		position: absolute;
		top: 100%;
		left: 50%;
		transform: translateX(-50%);
		margin-top: 0.25rem;
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 0.5rem;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
		padding: 0.25rem;
		min-width: 120px;
		z-index: 10;
	}

	.language-option {
		display: block;
		width: 100%;
		padding: 0.5rem 0.75rem;
		text-align: left;
		font-size: 0.8125rem;
		color: var(--color-text);
		background: transparent;
		border: none;
		border-radius: 0.375rem;
		cursor: pointer;
		transition: background 0.15s;
	}

	.language-option:hover {
		background: var(--color-bg-secondary);
	}

	.loading-state {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 1rem;
		color: var(--color-accent);
		font-size: 0.875rem;
	}

	.error-message {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.75rem;
		color: #ef4444;
		font-size: 0.8125rem;
		max-width: 250px;
	}

	.error-close {
		padding: 0.25rem;
		background: transparent;
		border: none;
		color: #ef4444;
		cursor: pointer;
		border-radius: 0.25rem;
		flex-shrink: 0;
	}

	.error-close:hover {
		background: rgba(239, 68, 68, 0.1);
	}
</style>
