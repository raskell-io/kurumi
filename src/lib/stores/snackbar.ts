import { writable } from 'svelte/store';

export const showNewNoteSnackbar = writable(false);
export const triggerSearch = writable(false);
export const triggerVoiceCapture = writable(false);
export const triggerMeetingCapture = writable(false);
export const triggerUploadRecording = writable(false);
