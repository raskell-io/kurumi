<script lang="ts">
	import { Plus, Check, AlertCircle, Info, X, FileText, Folder, Archive } from 'lucide-svelte';
	import { resourceColors, type ResourceType } from '$lib/types/resources';

	interface Props {
		message: string;
		resourceType?: ResourceType | null;
		duration?: number;
		onClose: () => void;
	}

	let { message, resourceType = null, duration = 2000, onClose }: Props = $props();

	// Auto close after duration
	$effect(() => {
		const timer = setTimeout(() => {
			onClose();
		}, duration);
		return () => clearTimeout(timer);
	});

	// Get icon based on resource type
	function getIconComponent() {
		switch (resourceType) {
			case 'note': return FileText;
			case 'folder': return Folder;
			case 'vault': return Archive;
			case 'action': return Check;
			default: return Info;
		}
	}

	const IconComponent = $derived(getIconComponent());
	const colors = $derived(resourceType ? resourceColors[resourceType] : null);
</script>

<div
	class="snackbar fixed bottom-4 right-4 z-[100] overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] shadow-xl safe-bottom"
	role="alert"
>
	<div class="flex items-center gap-3 px-4 py-3">
		{#if IconComponent && colors}
			<div
				class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
				style="background: {colors.bgAlpha}; color: {colors.color};"
			>
				<svelte:component this={IconComponent} class="h-4 w-4" />
			</div>
		{/if}
		<span class="text-sm font-medium text-[var(--color-text)]">{message}</span>
		<button
			onclick={onClose}
			class="ml-2 shrink-0 rounded-lg p-1 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-border)] hover:text-[var(--color-text)]"
			aria-label="Dismiss"
		>
			<X class="h-4 w-4" />
		</button>
	</div>
	<div
		class="progress-bar h-1"
		style="--duration: {duration}ms; background: {colors?.color ?? 'var(--color-accent)'};"
	></div>
</div>

<style>
	.snackbar {
		animation: slideUp 0.3s ease-out forwards;
	}

	@keyframes slideUp {
		from {
			opacity: 0;
			transform: translateY(20px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	.progress-bar {
		animation: shrink var(--duration) linear forwards;
	}

	@keyframes shrink {
		from {
			width: 100%;
		}
		to {
			width: 0%;
		}
	}
</style>
