import { writable } from 'svelte/store';

export const showNewNoteSnackbar = writable(false);
export const triggerSearch = writable(false);
export const triggerVoiceCapture = writable(false);
