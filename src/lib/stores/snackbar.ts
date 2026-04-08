import { writable } from 'svelte/store';

export const showNewNoteSnackbar = writable(false);
export const triggerSearch = writable(false);
export const triggerVoiceCapture = writable(false);
export const triggerMeetingCapture = writable(false);
export const triggerUploadRecording = writable(false);

/**
 * Signal for the voice assistant push-to-talk hotkey. The home page
 * Ask-Kurumi view subscribes: each increment starts a recording if
 * idle, or stops it (and submits the transcribed question) if already
 * recording. Using a counter so repeated toggles land as distinct
 * signal events, not store updates that get coalesced.
 */
export const triggerVoiceAssistant = writable(0);
