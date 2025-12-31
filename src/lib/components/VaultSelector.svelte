<script lang="ts">
	import { vaults, currentVault, currentVaultId, setCurrentVault, addVault, updateVault } from '$lib/db';
	import { goto } from '$app/navigation';
	import { vaultIcons, searchIcons, getIconById, type VaultIcon } from '$lib/icons/vault-icons';
	import type { Vault } from '$lib/db/types';

	let showDropdown = $state(false);
	let showCreateModal = $state(false);
	let showEditModal = $state(false);
	let editingVault = $state<Vault | null>(null);

	// Form state (shared between create and edit)
	let formName = $state('');
	let formIconId = $state<string | null>(null);
	let iconSearchQuery = $state('');
	let showIconPicker = $state(false);

	let dropdownRef: HTMLDivElement;
	let iconPickerRef: HTMLDivElement;

	let filteredIcons = $derived(searchIcons(iconSearchQuery));
	let selectedIcon = $derived(formIconId ? getIconById(formIconId) : null);

	function selectVault(vaultId: string) {
		setCurrentVault(vaultId);
		showDropdown = false;
		goto('/');
	}

	function openCreateModal() {
		formName = '';
		formIconId = null;
		iconSearchQuery = '';
		showDropdown = false;
		showCreateModal = true;
	}

	function openEditModal(vault: Vault, event: MouseEvent) {
		event.stopPropagation();
		formName = vault.name;
		formIconId = vault.icon || null;
		iconSearchQuery = '';
		editingVault = vault;
		showDropdown = false;
		showEditModal = true;
	}

	function handleCreateVault() {
		if (formName.trim()) {
			const vault = addVault(formName.trim(), formIconId || undefined);
			setCurrentVault(vault.id);
			resetForm();
			showCreateModal = false;
			goto('/');
		}
	}

	function handleUpdateVault() {
		if (editingVault && formName.trim()) {
			updateVault(editingVault.id, {
				name: formName.trim(),
				icon: formIconId || undefined
			});
			resetForm();
			showEditModal = false;
			editingVault = null;
		}
	}

	function resetForm() {
		formName = '';
		formIconId = null;
		iconSearchQuery = '';
		showIconPicker = false;
	}

	function closeModals() {
		showCreateModal = false;
		showEditModal = false;
		editingVault = null;
		resetForm();
	}

	function selectIcon(iconId: string) {
		formIconId = iconId;
		showIconPicker = false;
		iconSearchQuery = '';
	}

	function clearIcon() {
		formIconId = null;
		iconSearchQuery = '';
	}

	function handleClickOutside(event: MouseEvent) {
		if (dropdownRef && !dropdownRef.contains(event.target as Node)) {
			showDropdown = false;
		}
	}

	function handleIconPickerClickOutside(event: MouseEvent) {
		if (iconPickerRef && !iconPickerRef.contains(event.target as Node)) {
			showIconPicker = false;
		}
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			if (showIconPicker) {
				showIconPicker = false;
			} else if (showCreateModal || showEditModal) {
				closeModals();
			} else {
				showDropdown = false;
			}
		}
	}

	$effect(() => {
		if (showDropdown) {
			document.addEventListener('click', handleClickOutside);
			return () => document.removeEventListener('click', handleClickOutside);
		}
	});

	$effect(() => {
		if (showIconPicker) {
			document.addEventListener('click', handleIconPickerClickOutside);
			return () => document.removeEventListener('click', handleIconPickerClickOutside);
		}
	});

	// Portal action to render modal at document.body level
	function portal(node: HTMLElement) {
		document.body.appendChild(node);
		return {
			destroy() {
				node.remove();
			}
		};
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="relative" bind:this={dropdownRef}>
	<!-- Trigger Button -->
	<button
		onclick={() => (showDropdown = !showDropdown)}
		class="flex items-center gap-2 rounded-lg px-2 py-1 text-left transition-colors hover:bg-[var(--color-border)]"
	>
		{#if $currentVault?.icon}
			{@const vaultIcon = getIconById($currentVault.icon)}
			{#if vaultIcon}
				<svg
					xmlns="http://www.w3.org/2000/svg"
					class="h-5 w-5 text-[var(--color-accent)]"
					viewBox="0 0 20 20"
					fill="currentColor"
				>
					<path fill-rule="evenodd" d={vaultIcon.path} clip-rule="evenodd" />
				</svg>
			{/if}
		{/if}
		<span class="font-semibold text-[var(--color-text)]">
			{$currentVault?.name || 'Select Vault'}
		</span>
		<svg
			xmlns="http://www.w3.org/2000/svg"
			class="h-4 w-4 text-[var(--color-text-muted)] transition-transform"
			class:rotate-180={showDropdown}
			viewBox="0 0 20 20"
			fill="currentColor"
		>
			<path
				fill-rule="evenodd"
				d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
				clip-rule="evenodd"
			/>
		</svg>
	</button>

	<!-- Dropdown Menu -->
	{#if showDropdown}
		<div
			class="absolute left-0 top-full z-50 mt-1 min-w-[220px] overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] shadow-lg"
		>
			<div class="max-h-[300px] overflow-y-auto py-1">
				{#each $vaults as vault (vault.id)}
					{@const vaultIcon = vault.icon ? getIconById(vault.icon) : null}
					<div
						class="group flex w-full items-center gap-2 px-3 py-2 transition-colors hover:bg-[var(--color-bg-secondary)]"
						class:bg-[var(--color-accent)]={vault.id === $currentVaultId}
						class:text-white={vault.id === $currentVaultId}
					>
						<button
							onclick={() => selectVault(vault.id)}
							class="flex flex-1 items-center gap-2 text-left"
						>
							{#if vaultIcon}
								<svg
									xmlns="http://www.w3.org/2000/svg"
									class="h-5 w-5 shrink-0"
									class:text-[var(--color-accent)]={vault.id !== $currentVaultId}
									viewBox="0 0 20 20"
									fill="currentColor"
								>
									<path fill-rule="evenodd" d={vaultIcon.path} clip-rule="evenodd" />
								</svg>
							{:else}
								<svg
									xmlns="http://www.w3.org/2000/svg"
									class="h-5 w-5 shrink-0"
									class:text-[var(--color-text-muted)]={vault.id !== $currentVaultId}
									viewBox="0 0 20 20"
									fill="currentColor"
								>
									<path d="M4 3a2 2 0 100 4h12a2 2 0 100-4H4zM3 8h14v7a2 2 0 01-2 2H5a2 2 0 01-2-2V8zm5 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z" />
								</svg>
							{/if}
							<span class="flex-1 truncate">{vault.name}</span>
						</button>
						<button
							onclick={(e) => openEditModal(vault, e)}
							class="rounded p-1 transition-opacity {vault.id === $currentVaultId ? 'hover:bg-white/20' : 'opacity-0 group-hover:opacity-100 hover:bg-[var(--color-border)]'}"
							title="Edit vault"
						>
							<svg
								xmlns="http://www.w3.org/2000/svg"
								class="h-3.5 w-3.5"
								class:text-[var(--color-text-muted)]={vault.id !== $currentVaultId}
								viewBox="0 0 20 20"
								fill="currentColor"
							>
								<path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
							</svg>
						</button>
						{#if vault.id === $currentVaultId}
							<svg
								xmlns="http://www.w3.org/2000/svg"
								class="h-4 w-4 shrink-0"
								viewBox="0 0 20 20"
								fill="currentColor"
							>
								<path
									fill-rule="evenodd"
									d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
									clip-rule="evenodd"
								/>
							</svg>
						{/if}
					</div>
				{/each}
			</div>

			<div class="border-t border-[var(--color-border)] py-1">
				<button
					onclick={openCreateModal}
					class="flex w-full items-center gap-2 px-3 py-2 text-left text-[var(--color-accent)] transition-colors hover:bg-[var(--color-bg-secondary)]"
				>
					<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
						<path
							fill-rule="evenodd"
							d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z"
							clip-rule="evenodd"
						/>
					</svg>
					<span>Create Vault</span>
				</button>
			</div>
		</div>
	{/if}
</div>

<!-- Create/Edit Vault Modal -->
{#if showCreateModal || showEditModal}
	<div
		use:portal
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
		onclick={closeModals}
		onkeydown={(e) => e.key === 'Escape' && closeModals()}
		role="dialog"
		aria-modal="true"
		tabindex="-1"
	>
		<div
			class="w-full max-w-md rounded-xl bg-[var(--color-bg)] p-6 shadow-2xl"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.stopPropagation()}
			role="document"
		>
			<h2 class="mb-4 text-xl font-semibold text-[var(--color-text)]">
				{showEditModal ? 'Edit Vault' : 'Create New Vault'}
			</h2>

			<div class="space-y-4">
				<div>
					<label for="vault-name" class="mb-1 block text-sm font-medium text-[var(--color-text)]">
						Vault Name
					</label>
					<input
						id="vault-name"
						type="text"
						bind:value={formName}
						placeholder="My Vault"
						class="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-[var(--color-text)] placeholder-[var(--color-text-muted)] outline-none focus:border-[var(--color-accent)]"
						onkeydown={(e) => e.key === 'Enter' && !showIconPicker && (showEditModal ? handleUpdateVault() : handleCreateVault())}
					/>
				</div>

				<div>
					<label class="mb-1 block text-sm font-medium text-[var(--color-text)]">
						Icon (optional)
					</label>
					<div class="relative" bind:this={iconPickerRef}>
						<button
							type="button"
							onclick={() => (showIconPicker = !showIconPicker)}
							class="flex w-full items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-left transition-colors hover:border-[var(--color-accent)]"
						>
							{#if selectedIcon}
								<svg
									xmlns="http://www.w3.org/2000/svg"
									class="h-5 w-5 text-[var(--color-accent)]"
									viewBox="0 0 20 20"
									fill="currentColor"
								>
									<path fill-rule="evenodd" d={selectedIcon.path} clip-rule="evenodd" />
								</svg>
								<span class="flex-1 text-[var(--color-text)]">{selectedIcon.name}</span>
								<button
									type="button"
									onclick={(e) => {
										e.stopPropagation();
										clearIcon();
									}}
									class="rounded p-0.5 text-[var(--color-text-muted)] hover:bg-[var(--color-border)] hover:text-[var(--color-text)]"
								>
									<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
										<path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
									</svg>
								</button>
							{:else}
								<svg
									xmlns="http://www.w3.org/2000/svg"
									class="h-5 w-5 text-[var(--color-text-muted)]"
									viewBox="0 0 20 20"
									fill="currentColor"
								>
									<path d="M4 3a2 2 0 100 4h12a2 2 0 100-4H4zM3 8h14v7a2 2 0 01-2 2H5a2 2 0 01-2-2V8zm5 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z" />
								</svg>
								<span class="flex-1 text-[var(--color-text-muted)]">Choose an icon...</span>
							{/if}
							<svg
								xmlns="http://www.w3.org/2000/svg"
								class="h-4 w-4 text-[var(--color-text-muted)] transition-transform"
								class:rotate-180={showIconPicker}
								viewBox="0 0 20 20"
								fill="currentColor"
							>
								<path
									fill-rule="evenodd"
									d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
									clip-rule="evenodd"
								/>
							</svg>
						</button>

						{#if showIconPicker}
							<div
								class="absolute left-0 right-0 top-full z-10 mt-1 overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] shadow-lg"
							>
								<!-- Search Input -->
								<div class="border-b border-[var(--color-border)] p-2">
									<div class="flex items-center gap-2 rounded-md bg-[var(--color-bg-secondary)] px-2 py-1.5">
										<svg
											xmlns="http://www.w3.org/2000/svg"
											class="h-4 w-4 text-[var(--color-text-muted)]"
											viewBox="0 0 20 20"
											fill="currentColor"
										>
											<path
												fill-rule="evenodd"
												d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z"
												clip-rule="evenodd"
											/>
										</svg>
										<input
											type="text"
											bind:value={iconSearchQuery}
											placeholder="Search icons..."
											class="flex-1 bg-transparent text-sm text-[var(--color-text)] placeholder-[var(--color-text-muted)] outline-none"
										/>
									</div>
								</div>

								<!-- Icon Grid -->
								<div class="max-h-[200px] overflow-y-auto p-2">
									{#if filteredIcons.length === 0}
										<div class="py-4 text-center text-sm text-[var(--color-text-muted)]">
											No icons found
										</div>
									{:else}
										<div class="grid grid-cols-6 gap-1">
											{#each filteredIcons as icon (icon.id)}
												<button
													type="button"
													onclick={() => selectIcon(icon.id)}
													class="flex flex-col items-center gap-1 rounded-lg p-2 transition-colors hover:bg-[var(--color-bg-secondary)]"
													class:bg-[var(--color-accent)]={formIconId === icon.id}
													class:text-white={formIconId === icon.id}
													title={icon.name}
												>
													<svg
														xmlns="http://www.w3.org/2000/svg"
														class="h-5 w-5"
														class:text-[var(--color-text)]={formIconId !== icon.id}
														viewBox="0 0 20 20"
														fill="currentColor"
													>
														<path fill-rule="evenodd" d={icon.path} clip-rule="evenodd" />
													</svg>
												</button>
											{/each}
										</div>
									{/if}
								</div>
							</div>
						{/if}
					</div>
				</div>
			</div>

			<div class="mt-6 flex justify-end gap-3">
				<button
					onclick={closeModals}
					class="rounded-lg px-4 py-2 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-bg-secondary)]"
				>
					Cancel
				</button>
				<button
					onclick={showEditModal ? handleUpdateVault : handleCreateVault}
					disabled={!formName.trim()}
					class="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-white transition-colors hover:bg-[var(--color-accent-hover)] disabled:opacity-50"
				>
					{showEditModal ? 'Save Changes' : 'Create Vault'}
				</button>
			</div>
		</div>
	</div>
{/if}
