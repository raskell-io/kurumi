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

	const loadingLabels: Record<string, string> = {
		improve: 'Improving…',
		expand: 'Expanding…',
		summarize: 'Summarizing…',
		simplify: 'Simplifying…',
		translate: 'Translating…'
	};

	// The editor passes the top of the selection. Sit the toolbar just
	// above it (centered, clamped to the viewport); flip below when there
	// is no room at the top.
	let style = $derived.by(() => {
		const half = 170;
		const x = Math.max(half / 2, Math.min(position.x, window.innerWidth - half / 2));
		if (position.y < 56) {
			return `left: ${x}px; top: ${position.y + 34}px; transform: translateX(-50%);`;
		}
		return `left: ${x}px; top: ${position.y}px; transform: translate(-50%, -100%);`;
	});

	// Close on escape
	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			onClose();
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- mousedown is swallowed so clicking an action keeps the editor
     selection intact -->
<div
	class="ai-action-menu"
	{style}
	role="toolbar"
	aria-label="AI actions"
	tabindex="-1"
	onmousedown={(e) => e.preventDefault()}
>
	{#if error}
		<div class="status error" role="alert">
			<span>{error}</span>
			<button type="button" onclick={() => (error = null)} class="k-icon-btn !h-6 !w-6" aria-label="Dismiss">
				<X class="h-3.5 w-3.5" />
			</button>
		</div>
	{:else if isLoading}
		<div class="status">
			<Loader2 class="h-3.5 w-3.5 animate-spin text-[var(--color-accent)]" />
			<span>{(currentAction && loadingLabels[currentAction]) || 'Processing…'}</span>
		</div>
	{:else}
		<div class="action-buttons">
			<span class="lead" aria-hidden="true"><Sparkles class="h-3.5 w-3.5" /></span>
			<button type="button" onclick={() => handleAction('improve')} class="action-btn" title="Improve clarity and grammar">
				Improve
			</button>
			<button type="button" onclick={() => handleAction('expand')} class="action-btn" title="Add more detail">
				<FileText class="h-3.5 w-3.5" />
				Expand
			</button>
			<button type="button" onclick={() => handleAction('summarize')} class="action-btn" title="Condense to key points">
				<Minimize2 class="h-3.5 w-3.5" />
				Summarize
			</button>
			<button type="button" onclick={() => handleAction('simplify')} class="action-btn" title="Make easier to understand">
				<FileText class="h-3.5 w-3.5" />
				Simplify
			</button>
			<div class="translate-wrapper">
				<button
					type="button"
					onclick={handleTranslateClick}
					class="action-btn"
					class:active={showLanguageSelect}
					title="Translate to another language"
					aria-expanded={showLanguageSelect}
				>
					<Languages class="h-3.5 w-3.5" />
					Translate
				</button>

				{#if showLanguageSelect}
					<div class="language-dropdown k-menu" role="menu">
						<div class="k-menu-label">Translate to</div>
						{#each languages as language}
							<button
								type="button"
								role="menuitem"
								onclick={() => handleLanguageSelect(language)}
								class="k-menu-item"
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
		padding: 0.1875rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-bg);
		box-shadow: var(--shadow-lg);
		max-width: calc(100vw - 1rem);
	}

	.action-buttons {
		display: flex;
		align-items: center;
		gap: 0.125rem;
		flex-wrap: wrap;
	}

	.lead {
		display: flex;
		padding: 0 0.25rem 0 0.375rem;
		color: var(--color-accent);
	}

	.action-btn {
		display: flex;
		align-items: center;
		gap: 0.3125rem;
		height: 1.75rem;
		padding: 0 0.5rem;
		border-radius: var(--radius-sm);
		font-size: 0.8125rem;
		color: var(--color-text);
		white-space: nowrap;
	}

	.action-btn :global(svg) {
		flex-shrink: 0;
		color: var(--color-text-faint);
	}

	.action-btn:hover,
	.action-btn:focus-visible,
	.action-btn.active {
		background: var(--color-hover);
		outline: none;
	}

	.translate-wrapper {
		position: relative;
	}

	.language-dropdown {
		position: absolute;
		top: 100%;
		right: 0;
		margin-top: 0.375rem;
		min-width: 9rem;
		z-index: 10;
	}

	.status {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-height: 1.75rem;
		padding: 0 0.5rem;
		font-size: 0.8125rem;
		color: var(--color-text-muted);
	}

	.status.error {
		max-width: 260px;
		padding-right: 0.125rem;
		color: var(--color-danger);
	}
</style>
