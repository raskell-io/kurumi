<script lang="ts">
	/**
	 * Shown in place of a page that a linked folder doesn't have: to-dos,
	 * projects and the other records live in the Automerge document, so in
	 * Kurumi vaults. Offers the way back to one.
	 */
	import { docVaults, setCurrentVault } from '$lib/db';
	import { NO_RECORDS } from '$lib/linked/capabilities';
	import VaultIcon from './VaultIcon.svelte';
	import { Link2 } from 'lucide-svelte';

	// Stays on the page: the layout shows it again once the vault has records.
	function switchTo(id: string) {
		setCurrentVault(id);
	}
</script>

<div class="k-empty h-full justify-center" data-testid="linked-vault-notice">
	<Link2 />
	<p class="k-empty-title">Not in a linked folder</p>
	<p>{NO_RECORDS}</p>
	<div class="mt-4 flex flex-wrap justify-center gap-2">
		{#each $docVaults as vault (vault.id)}
			<button type="button" class="k-btn k-btn-ghost" onclick={() => switchTo(vault.id)}>
				<VaultIcon {vault} class="h-4 w-4 text-[var(--color-text-muted)]" />
				Switch to {vault.name}
			</button>
		{/each}
	</div>
</div>
