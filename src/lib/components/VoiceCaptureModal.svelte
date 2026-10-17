<script lang="ts">
	import VoiceRecorder, { type RecorderState } from './VoiceRecorder.svelte';
	import {
		addVoiceMemo,
		addMeetingMemo,
		folders,
		getFolderPath,
		transcribeMemoryAudio
	} from '$lib/db';
	import { storeBlob } from '$lib/db/blob-store';
	import { goto } from '$app/navigation';
	import { X } from 'lucide-svelte';

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
	let captureTabAudio = $state(false);
	let recorderState = $state<RecorderState>('idle');
	// Stray clicks / Escape must not throw away a recording in progress
	let busy = $derived(
		saving || recorderState === 'recording' || recorderState === 'paused' || recorderState === 'requesting'
	);

	// Reset folder selection when the modal opens
	$effect(() => {
		if (open) {
			selectedFolderId = null;
			saveError = null;
			captureStartedAt = null;
			captureTabAudio = false;
			recorderState = 'idle';
		}
	});

	// Detect support for getDisplayMedia (used for tab/window audio capture)
	let tabAudioSupported = $derived(
		typeof navigator !== 'undefined' &&
			!!navigator.mediaDevices &&
			typeof navigator.mediaDevices.getDisplayMedia === 'function'
	);

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
							captureMode: captureTabAudio ? 'remote-meeting-enhanced' : 'in-person-meeting',
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
		if (e.target === e.currentTarget && !busy) {
			onClose();
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (open && e.key === 'Escape' && !busy) {
			e.preventDefault();
			onClose();
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div
		class="k-dialog-backdrop"
		onclick={handleBackdropClick}
		role="dialog"
		aria-modal="true"
		aria-labelledby="voice-capture-title"
		tabindex="-1"
	>
		<div class="k-dialog !max-w-sm">
			<div class="flex items-center justify-between py-2.5 pr-2.5 pl-4">
				<h2 id="voice-capture-title" class="text-sm font-semibold text-[var(--color-text)]">
					{mode === 'meeting' ? 'Record meeting' : 'Record voice memo'}
				</h2>
				<button
					type="button"
					onclick={onClose}
					disabled={saving}
					class="k-icon-btn"
					aria-label="Close"
				>
					<X class="h-4 w-4" />
				</button>
			</div>

			{#if saving}
				<div class="flex flex-col items-center gap-3 px-6 py-10">
					<div
						class="h-6 w-6 animate-spin rounded-full border-2 border-[var(--color-accent)] border-t-transparent"
					></div>
					<p class="text-sm text-[var(--color-text-muted)]">Saving {modalTitle.toLowerCase()}…</p>
				</div>
			{:else if saveError}
				<div class="flex flex-col items-center gap-3 px-6 py-8 text-center">
					<p class="text-sm text-[var(--color-danger)]">{saveError}</p>
					<button type="button" onclick={() => (saveError = null)} class="k-btn">Try again</button>
				</div>
			{:else}
				{#if mode === 'meeting'}
					<p class="px-4 text-xs leading-relaxed text-[var(--color-text-muted)]">
						Long-form recording. When you stop, the meeting is transcribed and summarized with
						action items, decisions, and key topics.
					</p>

					<!-- Tab/window audio toggle (remote-meeting-enhanced mode) -->
					<label
						class="mx-2 mt-2 flex cursor-pointer items-start gap-2.5 rounded-[var(--radius-md)] px-2 py-2 hover:bg-[var(--color-hover)]"
						class:opacity-50={!tabAudioSupported}
						class:pointer-events-none={!tabAudioSupported}
					>
						<input
							type="checkbox"
							bind:checked={captureTabAudio}
							disabled={!tabAudioSupported || busy}
							class="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-accent)]"
						/>
						<span class="min-w-0 flex-1">
							<span class="block text-sm text-[var(--color-text)]">Capture tab/window audio</span>
							<span class="mt-0.5 block text-xs text-[var(--color-text-faint)]">
								{#if tabAudioSupported}
									Records a Zoom/Meet/Teams call alongside your mic. After starting, pick the tab or
									window and check “Share tab audio”.
								{:else}
									Not supported in this browser. Use Chrome, Edge, or Firefox.
								{/if}
							</span>
						</span>
					</label>
				{/if}
				{#if folderOptions.length > 0}
					<div class="flex items-center gap-3 px-4 pt-3">
						<label for="voice-folder" class="shrink-0 text-xs text-[var(--color-text-muted)]">
							Save to
						</label>
						<select
							id="voice-folder"
							bind:value={selectedFolderId}
							class="k-input !h-8 min-w-0 flex-1 !text-[0.8125rem]"
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
					onStateChange={(s) => (recorderState = s)}
					audioSources={mode === 'meeting' && captureTabAudio ? 'mic+tab' : 'mic'}
				/>
			{/if}
		</div>
	</div>
{/if}
