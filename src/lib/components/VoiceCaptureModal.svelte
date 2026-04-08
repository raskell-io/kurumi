<script lang="ts">
	import VoiceRecorder from './VoiceRecorder.svelte';
	import {
		addVoiceMemo,
		addMeetingMemo,
		folders,
		getFolderPath,
		transcribeMemoryAudio
	} from '$lib/db';
	import { storeBlob } from '$lib/db/blob-store';
	import { goto } from '$app/navigation';
	import { X, Mic, Users } from 'lucide-svelte';

	type CaptureMode = 'voice-memo' | 'meeting';

	interface Props {
		open: boolean;
		mode?: CaptureMode;
		onClose: () => void;
	}

	let { open, mode = 'voice-memo', onClose }: Props = $props();

	let saving = $state(false);
	let saveError = $state<string | null>(null);
	let selectedFolderId = $state<string | null>(null);
	let captureStartedAt = $state<number | null>(null);

	// Reset folder selection when the modal opens
	$effect(() => {
		if (open) {
			selectedFolderId = null;
			saveError = null;
			captureStartedAt = null;
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
		const prefix = mode === 'meeting' ? 'Meeting' : 'Voice memo';
		return `${prefix} — ${date}, ${time}`;
	}

	let modalTitle = $derived(mode === 'meeting' ? 'Meeting' : 'Voice memo');
	let modalIcon = $derived(mode === 'meeting' ? Users : Mic);

	async function handleComplete({
		blob,
		mimeType,
		durationMs
	}: {
		blob: Blob;
		mimeType: string;
		durationMs: number;
	}) {
		saving = true;
		saveError = null;
		try {
			const ref = await storeBlob(blob, mimeType);
			const startedAt = captureStartedAt ?? Date.now() - durationMs;
			const endedAt = startedAt + durationMs;

			const memory =
				mode === 'meeting'
					? addMeetingMemo({
							title: defaultTitle(),
							rawAudioRef: ref,
							captureMode: 'in-person-meeting',
							folderId: selectedFolderId,
							startedAt,
							endedAt
						})
					: addVoiceMemo({
							title: defaultTitle(),
							rawAudioRef: ref,
							folderId: selectedFolderId
						});

			onClose();
			await goto(`/memory/${memory.id}`);
			// Kick off the post-capture pipeline as fire-and-forget; the memory
			// page reacts to processingState/transcript/meetingExtras updates as
			// they land.
			void transcribeMemoryAudio(memory.id, blob, mimeType);
		} catch (err) {
			saveError = err instanceof Error ? err.message : `Failed to save ${modalTitle.toLowerCase()}`;
			saving = false;
		}
	}

	function handleRecordingStart() {
		captureStartedAt = Date.now();
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
			<div
				class="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3"
			>
				<div class="flex items-center gap-2">
					{#if mode === 'meeting'}
						<Users class="h-5 w-5 text-[var(--color-accent)]" />
					{:else}
						<Mic class="h-5 w-5 text-[var(--color-accent)]" />
					{/if}
					<h2 class="text-base font-semibold text-[var(--color-text)]">{modalTitle}</h2>
				</div>
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
					<div
						class="h-8 w-8 animate-spin rounded-full border-2 border-[var(--color-accent)] border-t-transparent"
					></div>
					<p class="text-sm text-[var(--color-text-muted)]">Saving {modalTitle.toLowerCase()}…</p>
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
				{#if mode === 'meeting'}
					<div class="px-4 pt-4 text-xs text-[var(--color-text-muted)]">
						Long-form recording. After you stop, the meeting is transcribed and a structured
						summary is generated with action items, decisions, and key topics.
					</div>
				{/if}
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
				<VoiceRecorder
					onComplete={handleComplete}
					onCancel={onClose}
					onStart={handleRecordingStart}
				/>
			{/if}
		</div>
	</div>
{/if}
