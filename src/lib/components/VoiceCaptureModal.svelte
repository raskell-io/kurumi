<script lang="ts">
	import VoiceRecorder from './VoiceRecorder.svelte';
	import { addVoiceMemo, folders, getFolderPath, transcribeMemoryAudio } from '$lib/db';
	import { storeBlob } from '$lib/db/blob-store';
	import { goto } from '$app/navigation';
	import { X } from 'lucide-svelte';

	interface Props {
		open: boolean;
		onClose: () => void;
	}

	let { open, onClose }: Props = $props();

	let saving = $state(false);
	let saveError = $state<string | null>(null);
	let selectedFolderId = $state<string | null>(null);

	// Reset folder selection when the modal opens
	$effect(() => {
		if (open) {
			selectedFolderId = null;
			saveError = null;
		}
	});

	// Build a hierarchical label for each folder ("Parent / Child")
	let folderOptions = $derived.by(() => {
		return $folders
			.map((f) => {
				const path = getFolderPath(f.id);
				const label = path.map((p) => p.name).join(' / ');
				return { id: f.id, label };
			})
			.sort((a, b) => a.label.localeCompare(b.label));
	});

	function defaultTitle(): string {
		const now = new Date();
		const date = now.toLocaleDateString(undefined, {
			month: 'short',
			day: 'numeric',
			year: 'numeric'
		});
		const time = now.toLocaleTimeString(undefined, {
			hour: 'numeric',
			minute: '2-digit'
		});
		return `Voice memo — ${date}, ${time}`;
	}

	async function handleComplete({ blob, mimeType }: { blob: Blob; mimeType: string }) {
		saving = true;
		saveError = null;
		try {
			const ref = await storeBlob(blob, mimeType);
			const memory = addVoiceMemo({
				title: defaultTitle(),
				rawAudioRef: ref,
				folderId: selectedFolderId
			});
			onClose();
			await goto(`/memory/${memory.id}`);
			// Kick off transcription as fire-and-forget; the memory page will react
			// to the processingState/transcript updates as they land.
			void transcribeMemoryAudio(memory.id, blob, mimeType);
		} catch (err) {
			saveError = err instanceof Error ? err.message : 'Failed to save voice memo';
			saving = false;
		}
	}

	function handleBackdropClick(e: MouseEvent) {
		if (e.target === e.currentTarget && !saving) {
			onClose();
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape' && !saving) {
			onClose();
		}
	}
</script>

{#if open}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
		onclick={handleBackdropClick}
		onkeydown={handleKeydown}
		role="dialog"
		aria-modal="true"
		tabindex="-1"
	>
		<div class="w-full max-w-sm rounded-xl bg-[var(--color-bg)] shadow-2xl">
			<div class="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
				<h2 class="text-base font-semibold text-[var(--color-text)]">Voice memo</h2>
				<button
					type="button"
					onclick={onClose}
					disabled={saving}
					class="rounded-lg p-1 text-[var(--color-text-muted)] hover:bg-[var(--color-bg-secondary)] disabled:opacity-50"
					aria-label="Close"
				>
					<X class="h-5 w-5" />
				</button>
			</div>

			{#if saving}
				<div class="flex flex-col items-center gap-3 p-8">
					<div class="h-8 w-8 animate-spin rounded-full border-2 border-[var(--color-accent)] border-t-transparent"></div>
					<p class="text-sm text-[var(--color-text-muted)]">Saving voice memo…</p>
				</div>
			{:else if saveError}
				<div class="flex flex-col items-center gap-3 p-6 text-center">
					<p class="text-sm text-red-500">{saveError}</p>
					<button
						type="button"
						onclick={() => (saveError = null)}
						class="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text)] hover:bg-[var(--color-bg-secondary)]"
					>
						Try again
					</button>
				</div>
			{:else}
				{#if folderOptions.length > 0}
					<div class="px-4 pt-4">
						<label
							for="voice-folder"
							class="mb-1 block text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]"
						>
							Save to
						</label>
						<select
							id="voice-folder"
							bind:value={selectedFolderId}
							class="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-sm text-[var(--color-text)]"
						>
							<option value={null}>Root</option>
							{#each folderOptions as option (option.id)}
								<option value={option.id}>{option.label}</option>
							{/each}
						</select>
					</div>
				{/if}
				<VoiceRecorder onComplete={handleComplete} onCancel={onClose} />
			{/if}
		</div>
	</div>
{/if}
