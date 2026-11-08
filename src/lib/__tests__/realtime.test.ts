import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/ask', () => ({ retrieveMemoryContext: async () => [], buildContextBlocks: () => [] }));
const { interpretRealtimeEvent, realtimeSessionConfig } = await import('$lib/realtime');

describe('realtime (GA interface)', () => {
	it('configures the session in the GA shape', () => {
		const session = realtimeSessionConfig();
		expect(session).toMatchObject({
			type: 'realtime',
			model: 'gpt-realtime',
			output_modalities: ['audio'],
			audio: { input: { transcription: { model: expect.any(String) } }, output: { voice: expect.any(String) } },
			tool_choice: 'auto'
		});
		expect(session.tools.map((t) => t.name)).toEqual(['search_memory']);
		// Beta-only fields are gone.
		expect(session).not.toHaveProperty('modalities');
		expect(session).not.toHaveProperty('input_audio_transcription');
		expect(session).not.toHaveProperty('voice');
	});

	// Event shapes from the GA server-events reference.
	it('reads GA transcript, function call and error events', () => {
		expect(interpretRealtimeEvent({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'i1', content_index: 0, transcript: 'What did Ana say?' })).toEqual({
			kind: 'user-transcript',
			id: 'user-i1',
			text: 'What did Ana say?'
		});
		expect(interpretRealtimeEvent({ type: 'response.output_audio_transcript.delta', event_id: 'e', response_id: 'r', item_id: 'i2', output_index: 0, content_index: 0, delta: 'She ' })).toEqual({
			kind: 'assistant-delta',
			id: 'assistant-i2',
			delta: 'She '
		});
		expect(interpretRealtimeEvent({ type: 'response.output_audio_transcript.done', item_id: 'i2', transcript: 'She agreed.' })).toEqual({ kind: 'assistant-done', id: 'assistant-i2' });
		expect(interpretRealtimeEvent({ type: 'response.function_call_arguments.delta', call_id: 'c1', item_id: 'i3', delta: '{"que' })).toEqual({ kind: 'call-delta', callId: 'c1', name: undefined, delta: '{"que' });
		expect(interpretRealtimeEvent({ type: 'response.function_call_arguments.done', call_id: 'c1', name: 'search_memory', arguments: '{"query":"Ana"}' })).toEqual({
			kind: 'call-done',
			callId: 'c1',
			name: 'search_memory',
			args: '{"query":"Ana"}'
		});
		expect(interpretRealtimeEvent({ type: 'error', error: { type: 'invalid_request_error', code: 'x', message: 'Bad', param: null } })).toEqual({ kind: 'error', message: 'Bad' });
	});

	it('still reads the beta names, and ignores informational events', () => {
		expect(interpretRealtimeEvent({ type: 'response.audio_transcript.delta', item_id: 'i', delta: 'x' })?.kind).toBe('assistant-delta');
		expect(interpretRealtimeEvent({ type: 'response.output_text.delta', item_id: 'i', delta: 'x' })?.kind).toBe('assistant-delta');
		for (const type of ['session.created', 'session.updated', 'response.created', 'response.done', 'input_audio_buffer.speech_started']) {
			expect(interpretRealtimeEvent({ type })).toBeNull();
		}
	});
});
