<script lang="ts">
	import { autofocus } from '$lib/actions/autofocus';
	import { vaults, currentVault, currentVaultId, setCurrentVault, addVault, updateVault, deleteVault } from '$lib/db';
	import { goto } from '$app/navigation';
	import { vaultIcons, searchIcons, getIconById, type VaultIcon } from '$lib/icons/vault-icons';
	import type { Vault } from '$lib/db/types';
	import { ChevronDown, Plus, Pencil, Check, X, Search, Archive, Trash2, AlertTriangle } from 'lucide-svelte';

	let showDropdown = $state(false);
	let showCreateModal = $state(false);
	let showEditModal = $state(false);
	let editingVault = $state<Vault | null>(null);
	let showDeleteConfirm = $state(false);
	let deleteConfirmName = $state('');
	let deleteError = $state<string | null>(null);

	// Form state (shared between create and edit)
	let formName = $state('');
	let formIconId = $state<string | null>(null);
	let iconSearchQuery = $state('');
	let showIconPicker = $state(false);

	let dropdownRef: HTMLDivElement;
	let iconPickerRef: HTMLDivElement | undefined = $state();

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

	function handleDeleteVault() {
		if (!editingVault) return;

		// Verify name matches
		if (deleteConfirmName.trim() !== editingVault.name) {
			deleteError = 'Vault name does not match';
			return;
		}

		const result = deleteVault(editingVault.id);
		if (result.success) {
			resetForm();
			showEditModal = false;
			editingVault = null;
			goto('/');
		} else {
			deleteError = result.error || 'Failed to delete vault';
		}
	}

	function resetForm() {
		formName = '';
		formIconId = null;
		iconSearchQuery = '';
		showIconPicker = false;
		showDeleteConfirm = false;
		deleteConfirmName = '';
		deleteError = null;
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
		class="flex max-w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left hover:bg-[var(--color-hover)]"
	>
		{#if $currentVault?.icon}
			{@const vaultIcon = getIconById($currentVault.icon)}
			{#if vaultIcon}
				<svg
					xmlns="http://www.w3.org/2000/svg"
					class="h-4 w-4 shrink-0 text-[var(--color-accent)]"
					viewBox="0 0 20 20"
					fill="currentColor"
				>
					<path fill-rule="evenodd" d={vaultIcon.path} clip-rule="evenodd" />
				</svg>
			{/if}
		{/if}
		<span class="truncate text-sm font-semibold text-[var(--color-text)]">
			{$currentVault?.name || 'Select Vault'}
		</span>
		<ChevronDown
			class="h-3.5 w-3.5 shrink-0 text-[var(--color-text-muted)] transition-transform {showDropdown ? 'rotate-180' : ''}"
		/>
	</button>

	<!-- Dropdown Menu -->
	{#if showDropdown}
		<div class="k-menu absolute left-0 top-full z-50 mt-1 w-60" role="menu">
			<div class="k-menu-label">Vaults</div>
			<div class="max-h-[300px] overflow-y-auto">
				{#each $vaults as vault (vault.id)}
					{@const vaultIcon = vault.icon ? getIconById(vault.icon) : null}
					{@const isCurrent = vault.id === $currentVaultId}
					<div class="group k-menu-item !p-0" class:vault-current={isCurrent}>
						<button
							onclick={() => selectVault(vault.id)}
							class="flex min-w-0 flex-1 items-center gap-2 py-1.5 pl-2 text-left"
							role="menuitemradio"
							aria-checked={isCurrent}
						>
							{#if vaultIcon}
								<svg
									xmlns="http://www.w3.org/2000/svg"
									class="h-4 w-4 shrink-0 {isCurrent ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-muted)]'}"
									viewBox="0 0 20 20"
									fill="currentColor"
								>
									<path fill-rule="evenodd" d={vaultIcon.path} clip-rule="evenodd" />
								</svg>
							{:else}
								<Archive class="h-4 w-4 shrink-0 text-[var(--color-text-muted)]" />
							{/if}
							<span class="flex-1 truncate">{vault.name}</span>
						</button>
						<button
							onclick={(e) => openEditModal(vault, e)}
							class="k-icon-btn !h-6 !w-6 opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
							title="Edit vault"
							aria-label="Edit vault {vault.name}"
						>
							<Pencil class="h-3.5 w-3.5" />
						</button>
						<span class="flex w-6 shrink-0 justify-center pr-1">
							{#if isCurrent}
								<Check class="h-4 w-4 text-[var(--color-accent)]" />
							{/if}
						</span>
					</div>
				{/each}
			</div>

			<div class="k-menu-sep"></div>
			<button onclick={openCreateModal} class="k-menu-item text-[var(--color-text-muted)]" role="menuitem">
				<Plus class="h-4 w-4" />
				<span>New vault</span>
			</button>
		</div>
	{/if}
</div>

<!-- Create/Edit Vault Modal -->
{#if showCreateModal || showEditModal}
	<div
		use:portal
		class="k-dialog-backdrop"
		onclick={closeModals}
		onkeydown={(e) => e.key === 'Escape' && closeModals()}
		role="dialog"
		aria-modal="true"
		aria-labelledby="vault-dialog-title"
		tabindex="-1"
	>
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<div
			class="k-dialog !overflow-visible p-5"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.stopPropagation()}
			role="document"
		>
			<h2 id="vault-dialog-title" class="mb-4 text-base font-semibold text-[var(--color-text)]">
				{showEditModal ? 'Edit vault' : 'New vault'}
			</h2>

			<div class="space-y-4">
				<div>
					<label for="vault-name" class="k-label">Name</label>
					<input
						id="vault-name"
						type="text"
						bind:value={formName}
						placeholder="My Vault"
						class="k-input"
						use:autofocus
						onkeydown={(e) => e.key === 'Enter' && !showIconPicker && (showEditModal ? handleUpdateVault() : handleCreateVault())}
					/>
				</div>

				<div>
					<span class="k-label">Icon <span class="font-normal text-[var(--color-text-faint)]">(optional)</span></span>
					<div class="relative" bind:this={iconPickerRef}>
						<button
							type="button"
							onclick={() => (showIconPicker = !showIconPicker)}
							class="k-input flex items-center gap-2 text-left hover:bg-[var(--color-hover)]"
							aria-expanded={showIconPicker}
						>
							{#if selectedIcon}
								<svg
									xmlns="http://www.w3.org/2000/svg"
									class="h-4 w-4 text-[var(--color-accent)]"
									viewBox="0 0 20 20"
									fill="currentColor"
								>
									<path fill-rule="evenodd" d={selectedIcon.path} clip-rule="evenodd" />
								</svg>
								<span class="flex-1 text-[var(--color-text)]">{selectedIcon.name}</span>
								<!-- svelte-ignore a11y_click_events_have_key_events -->
								<!-- svelte-ignore a11y_no_static_element_interactions -->
								<span
									role="button"
									tabindex="0"
									aria-label="Clear icon"
									onclick={(e) => {
										e.stopPropagation();
										clearIcon();
									}}
									class="rounded p-0.5 text-[var(--color-text-muted)] hover:bg-[var(--color-hover)] hover:text-[var(--color-text)]"
								>
									<X class="h-3.5 w-3.5" />
								</span>
							{:else}
								<Archive class="h-4 w-4 text-[var(--color-text-faint)]" />
								<span class="flex-1 text-[var(--color-text-faint)]">Choose an icon…</span>
							{/if}
							<ChevronDown
								class="h-4 w-4 text-[var(--color-text-faint)] transition-transform {showIconPicker ? 'rotate-180' : ''}"
							/>
						</button>

						{#if showIconPicker}
							<div class="k-menu absolute left-0 right-0 top-full z-10 mt-1 !p-0">
								<!-- Search Input -->
								<div class="flex items-center gap-2 border-b border-[var(--color-border)] px-3 py-2">
									<Search class="h-4 w-4 text-[var(--color-text-faint)]" />
									<input
										type="text"
										bind:value={iconSearchQuery}
										placeholder="Search icons…"
										aria-label="Search icons"
										class="flex-1 bg-transparent text-sm text-[var(--color-text)] placeholder-[var(--color-text-faint)] outline-none"
									/>
								</div>

								<!-- Icon Grid -->
								<div class="max-h-[200px] overflow-y-auto p-1.5">
									{#if filteredIcons.length === 0}
										<div class="py-4 text-center text-sm text-[var(--color-text-muted)]">
											No icons found
										</div>
									{:else}
										<div class="grid grid-cols-6 gap-0.5">
											{#each filteredIcons as icon (icon.id)}
												<button
													type="button"
													onclick={() => selectIcon(icon.id)}
													class="flex items-center justify-center rounded-md p-2 hover:bg-[var(--color-hover)] {formIconId === icon.id ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]' : 'text-[var(--color-text-muted)]'}"
													title={icon.name}
													aria-label={icon.name}
													aria-pressed={formIconId === icon.id}
												>
													<svg
														xmlns="http://www.w3.org/2000/svg"
														class="h-4 w-4"
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

			{#if showEditModal && editingVault}
				<!-- Danger Zone -->
				<div class="mt-5 border-t border-[var(--color-border)] pt-4">
					{#if !showDeleteConfirm}
						<button onclick={() => (showDeleteConfirm = true)} class="k-btn k-btn-ghost k-btn-sm !text-[var(--color-danger)]">
							<Trash2 class="h-3.5 w-3.5" />
							Delete this vault…
						</button>
					{:else}
						<div class="space-y-3">
							<div class="flex items-start gap-2">
								<AlertTriangle class="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-danger)]" />
								<p class="text-sm text-[var(--color-text-muted)]">
									This permanently deletes the vault and can't be undone. Type <strong class="font-medium text-[var(--color-text)]">{editingVault.name}</strong> to confirm.
								</p>
							</div>

							<input
								type="text"
								bind:value={deleteConfirmName}
								placeholder="Vault name"
								aria-label="Type vault name to confirm"
								class="k-input"
								onkeydown={(e) => e.key === 'Enter' && handleDeleteVault()}
							/>

							{#if deleteError}
								<p class="text-xs text-[var(--color-danger)]">{deleteError}</p>
							{/if}

							<div class="flex justify-end gap-2">
								<button
									onclick={() => {
										showDeleteConfirm = false;
										deleteConfirmName = '';
										deleteError = null;
									}}
									class="k-btn k-btn-ghost k-btn-sm"
								>
									Cancel
								</button>
								<button
									onclick={handleDeleteVault}
									disabled={deleteConfirmName.trim() !== editingVault.name}
									class="k-btn k-btn-danger k-btn-sm"
								>
									Delete vault
								</button>
							</div>
						</div>
					{/if}
				</div>
			{/if}

			<div class="mt-5 flex justify-end gap-2">
				<button onclick={closeModals} class="k-btn k-btn-ghost">Cancel</button>
				<button
					onclick={showEditModal ? handleUpdateVault : handleCreateVault}
					disabled={!formName.trim()}
					class="k-btn k-btn-primary"
				>
					{showEditModal ? 'Save' : 'Create vault'}
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.vault-current {
		background: var(--color-active);
	}
</style>
