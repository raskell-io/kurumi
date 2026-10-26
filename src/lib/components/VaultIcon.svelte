<script lang="ts">
	import { getIconById } from '$lib/icons/vault-icons';
	import type { Vault } from '$lib/db/types';
	import { Archive } from 'lucide-svelte';

	// Renders a vault's uploaded logo, else its library icon, else a generic
	// archive glyph. `class` sizes and colours it like any other icon.
	let {
		vault,
		class: className = 'h-4 w-4'
	}: { vault: Pick<Vault, 'icon' | 'iconImage'> | null | undefined; class?: string } = $props();

	let libraryIcon = $derived(vault?.icon ? getIconById(vault.icon) : null);
</script>

{#if vault?.iconImage}
	<img src={vault.iconImage} alt="" class="{className} shrink-0 rounded-[3px] object-cover" />
{:else if libraryIcon}
	<svg
		xmlns="http://www.w3.org/2000/svg"
		class="{className} shrink-0"
		viewBox="0 0 20 20"
		fill="currentColor"
		aria-hidden="true"
	>
		<path fill-rule="evenodd" d={libraryIcon.path} clip-rule="evenodd" />
	</svg>
{:else}
	<Archive class="{className} shrink-0" />
{/if}
