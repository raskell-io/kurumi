/**
 * OpenAI inference provider.
 *
 * Currently implements only `transcribe()` via Whisper. Other methods are
 * stubs that return a "not implemented" error so the provider satisfies the
 * full InferenceProvider interface — they'll be filled in as later epics
 * (summarization, entity extraction, ...) come online.
 *
 * The API key is read from the same localStorage slot used by the legacy
 * src/lib/ai/ helpers so the existing settings UI continues to work.
 */

import type {
	InferenceProvider,
	InferenceResult,
	ProviderCapabilities,
	TaskOptions,
	TranscribeInput,
	TranscribeResult,
	SummarizeInput,
	MeetingSummary,
	MeetingSummaryInput,
	RewriteTranscriptInput,
	ExtractedEntity,
	ExtractedActionItem,
	ExtractedReminder,
	ProposeRemindersInput,
	ExtractedDraft,
	ProposeDraftsInput,
	ClassifyResult,
	AnswerWithContextInput,
	AnsweredQuestion,
	AliasMergeProposal,
	TtsInput,
	TtsResult,
	RealtimeSessionOptions,
	RealtimeSessionHandle
} from '../types';
import type { ControlledLabel, TranscriptSegment } from '../../db/types';

const OPENAI_KEY_STORAGE = 'kurumi-openai-key';
const TRANSCRIBE_MODEL = 'whisper-1';
const CHAT_MODEL = 'gpt-4o-mini';

function getApiKey(): string | null {
	if (typeof localStorage === 'undefined') return null;
	const key = localStorage.getItem(OPENAI_KEY_STORAGE);
	return key && key.length > 0 ? key : null;
}

function notImplemented<T>(method: string, target: 'remote'): InferenceResult<T> {
	return {
		ok: false,
		error: `OpenAI provider: ${method} not implemented yet`,
		target,
		providerId: 'openai',
		model: 'n/a',
		latencyMs: 0
	};
}

interface WhisperVerboseResponse {
	text: string;
	language?: string;
	segments?: Array<{
		start: number;
		end: number;
		text: string;
	}>;
}

interface ChatCompletionResponse {
	choices?: Array<{
		message?: {
			content?: string;
		};
	}>;
}

/**
 * Shared helper for chat-completion calls. Returns the assistant text or
 * an error message; latency is computed by the caller.
 *
 * Pass `jsonMode: true` when the system prompt asks for JSON output. Sets
 * response_format=json_object so the model is constrained to valid JSON.
 */
async function callChat(
	apiKey: string,
	system: string,
	user: string,
	options?: TaskOptions & { jsonMode?: boolean }
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
	try {
		const body: Record<string, unknown> = {
			model: CHAT_MODEL,
			messages: [
				{ role: 'system', content: system },
				{ role: 'user', content: user }
			],
			max_tokens: options?.maxTokens ?? 512,
			temperature: options?.temperature ?? 0.3
		};
		if (options?.jsonMode) {
			body.response_format = { type: 'json_object' };
		}

		const response = await fetch('https://api.openai.com/v1/chat/completions', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${apiKey}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify(body),
			signal: options?.signal
		});

		if (!response.ok) {
			const errText = await response.text().catch(() => '');
			return {
				ok: false,
				error:
					response.status === 401
						? 'Invalid OpenAI API key'
						: `OpenAI request failed (${response.status}): ${errText.slice(0, 200)}`
			};
		}

		const data = (await response.json()) as ChatCompletionResponse;
		const text = data.choices?.[0]?.message?.content?.trim();
		if (!text) {
			return { ok: false, error: 'OpenAI returned an empty response' };
		}
		return { ok: true, text };
	} catch (err) {
		return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
	}
}

export class OpenAIProvider implements InferenceProvider {
	readonly capabilities: ProviderCapabilities = {
		id: 'openai',
		target: 'remote',
		supportsRealtime: false,
		supportsTts: true,
		supportsTranscribe: true,
		maxContextTokens: 128_000,
		models: ['gpt-4o', 'gpt-4o-mini', TRANSCRIBE_MODEL, 'gpt-4o-mini-tts']
	};

	async transcribe(
		input: TranscribeInput,
		options?: TaskOptions
	): Promise<InferenceResult<TranscribeResult>> {
		const apiKey = getApiKey();
		const startedAt = Date.now();

		if (!apiKey) {
			return {
				ok: false,
				error: 'OpenAI API key not configured',
				target: 'remote',
				providerId: 'openai',
				model: TRANSCRIBE_MODEL,
				latencyMs: 0
			};
		}

		const form = new FormData();
		// Whisper expects a filename with an audio extension; pick one based on the mime type.
		const ext = pickExtension(input.mimeType);
		form.append('file', new File([input.audio], `recording.${ext}`, { type: input.mimeType }));
		form.append('model', TRANSCRIBE_MODEL);
		form.append('response_format', 'verbose_json');
		if (input.language) {
			form.append('language', input.language);
		}

		try {
			const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
				method: 'POST',
				headers: { Authorization: `Bearer ${apiKey}` },
				body: form,
				signal: options?.signal
			});

			if (!response.ok) {
				const errText = await response.text().catch(() => '');
				return {
					ok: false,
					error:
						response.status === 401
							? 'Invalid OpenAI API key'
							: `Whisper request failed (${response.status}): ${errText.slice(0, 200)}`,
					target: 'remote',
					providerId: 'openai',
					model: TRANSCRIBE_MODEL,
					latencyMs: Date.now() - startedAt
				};
			}

			const data = (await response.json()) as WhisperVerboseResponse;
			const segments: TranscriptSegment[] =
				data.segments?.map((s) => ({
					start: s.start,
					end: s.end,
					text: s.text.trim()
				})) ?? [];

			return {
				ok: true,
				value: {
					text: data.text.trim(),
					segments,
					language: data.language
				},
				target: 'remote',
				providerId: 'openai',
				model: TRANSCRIBE_MODEL,
				latencyMs: Date.now() - startedAt
			};
		} catch (err) {
			return {
				ok: false,
				error: err instanceof Error ? err.message : 'Network error',
				target: 'remote',
				providerId: 'openai',
				model: TRANSCRIBE_MODEL,
				latencyMs: Date.now() - startedAt
			};
		}
	}

	// --- chat-completion-backed tasks ---------------------------------------

	async summarize(
		input: SummarizeInput,
		options?: TaskOptions
	): Promise<InferenceResult<string>> {
		const apiKey = getApiKey();
		const startedAt = Date.now();
		if (!apiKey) {
			return {
				ok: false,
				error: 'OpenAI API key not configured',
				target: 'remote',
				providerId: 'openai',
				model: CHAT_MODEL,
				latencyMs: 0
			};
		}

		const styleInstruction =
			input.style === 'long'
				? 'Write a thorough summary in a few paragraphs.'
				: input.style === 'bullets'
					? 'Write a bullet-point summary, one bullet per key point.'
					: 'Write a concise summary in 1-3 sentences.';

		const result = await callChat(
			apiKey,
			`You summarize text accurately and concisely. ${styleInstruction} Return only the summary, no preamble.`,
			input.text,
			options
		);

		if (!result.ok) {
			return {
				ok: false,
				error: result.error,
				target: 'remote',
				providerId: 'openai',
				model: CHAT_MODEL,
				latencyMs: Date.now() - startedAt
			};
		}

		return {
			ok: true,
			value: result.text,
			target: 'remote',
			providerId: 'openai',
			model: CHAT_MODEL,
			latencyMs: Date.now() - startedAt
		};
	}

	async summarizeMeeting(
		input: MeetingSummaryInput,
		options?: TaskOptions
	): Promise<InferenceResult<MeetingSummary>> {
		const apiKey = getApiKey();
		const startedAt = Date.now();
		if (!apiKey) {
			return {
				ok: false,
				error: 'OpenAI API key not configured',
				target: 'remote',
				providerId: 'openai',
				model: CHAT_MODEL,
				latencyMs: 0
			};
		}

		const system = `You analyze meeting transcripts and produce structured summaries.
Return ONLY a JSON object with this exact shape (no markdown, no preamble):
{
  "title": "short descriptive title (3-8 words)",
  "summaryShort": "concise 1-2 sentence summary",
  "summaryLong": "thorough multi-paragraph summary",
  "participants": ["names mentioned"],
  "keyTopics": ["topic 1", "topic 2"],
  "actionItems": [{"text": "action description", "assignee": "name or null", "dueDate": "ISO date or null", "confidence": 0.9}],
  "decisions": ["decision 1"],
  "unresolvedQuestions": ["open question 1"],
  "followUpSuggestions": ["follow-up 1"]
}
If the transcript is too short or unclear for a section, return an empty array for that field.`;

		const userPrompt = input.knownParticipants?.length
			? `Known participants: ${input.knownParticipants.join(', ')}\n\nTranscript:\n${input.transcript}`
			: `Transcript:\n${input.transcript}`;

		const result = await callChat(apiKey, system, userPrompt, {
			...options,
			jsonMode: true,
			maxTokens: options?.maxTokens ?? 1500,
			temperature: options?.temperature ?? 0.2
		});

		if (!result.ok) {
			return {
				ok: false,
				error: result.error,
				target: 'remote',
				providerId: 'openai',
				model: CHAT_MODEL,
				latencyMs: Date.now() - startedAt
			};
		}

		try {
			const parsed = JSON.parse(result.text) as Partial<MeetingSummary>;
			const value: MeetingSummary = {
				title: parsed.title ?? '',
				summaryShort: parsed.summaryShort ?? '',
				summaryLong: parsed.summaryLong ?? '',
				participants: Array.isArray(parsed.participants) ? parsed.participants : [],
				keyTopics: Array.isArray(parsed.keyTopics) ? parsed.keyTopics : [],
				actionItems: Array.isArray(parsed.actionItems)
					? parsed.actionItems.map((a) => ({
							text: a.text ?? '',
							assignee: a.assignee ?? null,
							dueDate: a.dueDate ?? null,
							confidence: typeof a.confidence === 'number' ? a.confidence : 0.5
						}))
					: [],
				decisions: Array.isArray(parsed.decisions) ? parsed.decisions : [],
				unresolvedQuestions: Array.isArray(parsed.unresolvedQuestions)
					? parsed.unresolvedQuestions
					: [],
				followUpSuggestions: Array.isArray(parsed.followUpSuggestions)
					? parsed.followUpSuggestions
					: []
			};
			return {
				ok: true,
				value,
				target: 'remote',
				providerId: 'openai',
				model: CHAT_MODEL,
				latencyMs: Date.now() - startedAt
			};
		} catch (err) {
			return {
				ok: false,
				error: `Failed to parse meeting summary JSON: ${err instanceof Error ? err.message : 'unknown'}`,
				target: 'remote',
				providerId: 'openai',
				model: CHAT_MODEL,
				latencyMs: Date.now() - startedAt
			};
		}
	}

	// --- stubs for tasks not yet implemented on this provider ---------------

	async rewriteTranscript(
		_input: RewriteTranscriptInput,
		_options?: TaskOptions
	): Promise<InferenceResult<string>> {
		return notImplemented('rewriteTranscript', 'remote');
	}

	async extractEntities(
		input: { text: string },
		options?: TaskOptions
	): Promise<InferenceResult<ExtractedEntity[]>> {
		const apiKey = getApiKey();
		const startedAt = Date.now();
		if (!apiKey) {
			return {
				ok: false,
				error: 'OpenAI API key not configured',
				target: 'remote',
				providerId: 'openai',
				model: CHAT_MODEL,
				latencyMs: 0
			};
		}

		const system = `You extract named entities from text. Return ONLY a JSON object with this exact shape (no markdown, no preamble):
{
  "entities": [
    {"type": "person", "name": "Alice Smith"},
    {"type": "project", "name": "Q4 Roadmap"},
    {"type": "topic", "name": "performance optimization"},
    {"type": "organization", "name": "Acme Corp"}
  ]
}

Rules:
- type must be one of: person, project, topic, organization, place
- name should be the canonical form (full names for people, proper case for projects)
- only include entities that are clearly mentioned, not implied
- topics are subject-matter themes (not generic words like "the meeting" or "the project")
- if nothing is found, return {"entities": []}`;

		const result = await callChat(apiKey, system, input.text, {
			...options,
			jsonMode: true,
			maxTokens: options?.maxTokens ?? 600,
			temperature: options?.temperature ?? 0.2
		});

		if (!result.ok) {
			return {
				ok: false,
				error: result.error,
				target: 'remote',
				providerId: 'openai',
				model: CHAT_MODEL,
				latencyMs: Date.now() - startedAt
			};
		}

		try {
			const parsed = JSON.parse(result.text) as {
				entities?: Array<{ type?: string; name?: string }>;
			};
			const allowedTypes = new Set([
				'person',
				'project',
				'topic',
				'organization',
				'place',
				'source'
			]);
			const entities: ExtractedEntity[] = (parsed.entities ?? [])
				.filter((e) => e.name && typeof e.name === 'string' && e.type && allowedTypes.has(e.type))
				.map((e) => ({
					type: e.type as ExtractedEntity['type'],
					canonicalName: e.name!.trim(),
					aliases: [],
					confidence: 0.8
				}))
				.filter((e) => e.canonicalName.length > 0);

			return {
				ok: true,
				value: entities,
				target: 'remote',
				providerId: 'openai',
				model: CHAT_MODEL,
				latencyMs: Date.now() - startedAt
			};
		} catch (err) {
			return {
				ok: false,
				error: `Failed to parse entities JSON: ${err instanceof Error ? err.message : 'unknown'}`,
				target: 'remote',
				providerId: 'openai',
				model: CHAT_MODEL,
				latencyMs: Date.now() - startedAt
			};
		}
	}

	async extractActionItems(
		_input: { text: string },
		_options?: TaskOptions
	): Promise<InferenceResult<ExtractedActionItem[]>> {
		return notImplemented('extractActionItems', 'remote');
	}

	async proposeReminders(
		input: ProposeRemindersInput,
		options?: TaskOptions
	): Promise<InferenceResult<ExtractedReminder[]>> {
		const apiKey = getApiKey();
		const startedAt = Date.now();
		const model = CHAT_MODEL;

		if (!apiKey) {
			return {
				ok: false,
				error: 'OpenAI API key not configured',
				target: 'remote',
				providerId: 'openai',
				model,
				latencyMs: 0
			};
		}

		const system = [
			'You extract time-anchored reminders from a memory.',
			'A reminder is a follow-up action that has a clear due date or time window',
			'("tomorrow", "next Monday", "in two weeks", "before the end of the month",',
			'"2026-05-01"). Do NOT invent reminders that aren\'t grounded in the text.',
			'',
			`Resolve every relative date against ANCHOR_DATE (ISO YYYY-MM-DD): ${input.anchorDate}.`,
			'Return absolute ISO YYYY-MM-DD dates only — never relative phrases.',
			'',
			'If the source text describes the reminder as a RECURRING task ("every',
			'week", "daily standup", "monthly review", "weekly 1:1"), set recurrence',
			'to one of "daily" / "weekly" / "monthly" / "yearly". Otherwise omit or',
			'set recurrence to "none".',
			'',
			'Respond with strict JSON of shape:',
			'{"reminders": [{"text": string, "suggestedDate": "YYYY-MM-DD",',
			'                "reason": string | null, "confidence": number,',
			'                "recurrence": "none" | "daily" | "weekly" | "monthly" | "yearly"}]}',
			'',
			'If no time-anchored reminders exist, return {"reminders": []}.'
		].join('\n');

		try {
			const response = await fetch('https://api.openai.com/v1/chat/completions', {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${apiKey}`,
					'Content-Type': 'application/json'
				},
				signal: options?.signal,
				body: JSON.stringify({
					model,
					temperature: 0.1,
					response_format: { type: 'json_object' },
					messages: [
						{ role: 'system', content: system },
						{ role: 'user', content: input.text }
					]
				})
			});

			if (!response.ok) {
				const text = await response.text().catch(() => '');
				return {
					ok: false,
					error: `OpenAI proposeReminders failed (${response.status}): ${text || 'no body'}`,
					target: 'remote',
					providerId: 'openai',
					model,
					latencyMs: Date.now() - startedAt
				};
			}

			const data = await response.json();
			const raw = data.choices?.[0]?.message?.content;
			if (!raw) {
				return {
					ok: true,
					value: [],
					target: 'remote',
					providerId: 'openai',
					model,
					latencyMs: Date.now() - startedAt
				};
			}

			let parsed: unknown;
			try {
				parsed = JSON.parse(raw);
			} catch {
				return {
					ok: false,
					error: 'OpenAI returned non-JSON reminders payload',
					target: 'remote',
					providerId: 'openai',
					model,
					latencyMs: Date.now() - startedAt
				};
			}

			const list = Array.isArray((parsed as { reminders?: unknown })?.reminders)
				? (parsed as { reminders: unknown[] }).reminders
				: [];

			const isoDate = /^\d{4}-\d{2}-\d{2}$/;
			const validRecurrence = new Set<string>([
				'none',
				'daily',
				'weekly',
				'monthly',
				'yearly'
			]);
			const reminders: ExtractedReminder[] = [];
			for (const raw of list) {
				if (!raw || typeof raw !== 'object') continue;
				const item = raw as Record<string, unknown>;
				const text = typeof item.text === 'string' ? item.text.trim() : '';
				const suggestedDate = typeof item.suggestedDate === 'string' ? item.suggestedDate : '';
				if (!text || !isoDate.test(suggestedDate)) continue;
				const recurrence =
					typeof item.recurrence === 'string' && validRecurrence.has(item.recurrence)
						? (item.recurrence as ExtractedReminder['recurrence'])
						: 'none';
				reminders.push({
					text,
					suggestedDate,
					reason: typeof item.reason === 'string' ? item.reason : null,
					confidence:
						typeof item.confidence === 'number' && item.confidence >= 0 && item.confidence <= 1
							? item.confidence
							: 0.7,
					recurrence
				});
			}

			return {
				ok: true,
				value: reminders,
				target: 'remote',
				providerId: 'openai',
				model,
				latencyMs: Date.now() - startedAt
			};
		} catch (err) {
			return {
				ok: false,
				error: err instanceof Error ? err.message : 'proposeReminders network error',
				target: 'remote',
				providerId: 'openai',
				model,
				latencyMs: Date.now() - startedAt
			};
		}
	}

	async proposeDrafts(
		input: ProposeDraftsInput,
		options?: TaskOptions
	): Promise<InferenceResult<ExtractedDraft[]>> {
		const apiKey = getApiKey();
		const startedAt = Date.now();
		const model = CHAT_MODEL;

		if (!apiKey) {
			return {
				ok: false,
				error: 'OpenAI API key not configured',
				target: 'remote',
				providerId: 'openai',
				model,
				latencyMs: 0
			};
		}

		const system = [
			'You identify outgoing follow-ups a user might draft from a memory:',
			'1. An "email" — a short follow-up message to someone mentioned',
			'2. A "calendar-event" — a meeting or block the user should schedule',
			'',
			`Anchor date (ISO YYYY-MM-DD): ${input.anchorDate}. Resolve every relative`,
			'date ("next Tuesday", "in 2 weeks") to an absolute ISO YYYY-MM-DD.',
			'Only propose drafts that are clearly supported by the memory text.',
			'Do NOT invent drafts to fill quota.',
			'',
			'Each draft must have:',
			'- kind: "email" | "calendar-event"',
			'- target: recipient name or attendee list (null if unknown)',
			'- subject: short, under 80 chars',
			'- body: 1-4 sentences, written in the user\'s first person',
			'- suggestedDate: ISO YYYY-MM-DD (calendar-event only, else null)',
			'- suggestedTime: "HH:MM" 24h local (calendar-event only, else null)',
			'- confidence: 0..1',
			'',
			'Respond with strict JSON: {"drafts": [...]}. Empty array if nothing obvious.'
		].join('\n');

		try {
			const response = await fetch('https://api.openai.com/v1/chat/completions', {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${apiKey}`,
					'Content-Type': 'application/json'
				},
				signal: options?.signal,
				body: JSON.stringify({
					model,
					temperature: 0.2,
					response_format: { type: 'json_object' },
					messages: [
						{ role: 'system', content: system },
						{ role: 'user', content: input.text }
					]
				})
			});

			if (!response.ok) {
				const text = await response.text().catch(() => '');
				return {
					ok: false,
					error: `OpenAI proposeDrafts failed (${response.status}): ${text || 'no body'}`,
					target: 'remote',
					providerId: 'openai',
					model,
					latencyMs: Date.now() - startedAt
				};
			}

			const data = await response.json();
			const raw = data.choices?.[0]?.message?.content;
			let parsed: unknown = {};
			if (typeof raw === 'string') {
				try {
					parsed = JSON.parse(raw);
				} catch {
					return {
						ok: true,
						value: [],
						target: 'remote',
						providerId: 'openai',
						model,
						latencyMs: Date.now() - startedAt
					};
				}
			}

			const list = Array.isArray((parsed as { drafts?: unknown })?.drafts)
				? (parsed as { drafts: unknown[] }).drafts
				: [];

			const isoDate = /^\d{4}-\d{2}-\d{2}$/;
			const isoTime = /^\d{2}:\d{2}$/;
			const drafts: ExtractedDraft[] = [];
			for (const rawItem of list) {
				if (!rawItem || typeof rawItem !== 'object') continue;
				const item = rawItem as Record<string, unknown>;
				const kind = item.kind === 'email' || item.kind === 'calendar-event' ? item.kind : null;
				if (!kind) continue;
				const subject = typeof item.subject === 'string' ? item.subject.trim() : '';
				const body = typeof item.body === 'string' ? item.body.trim() : '';
				if (!subject || !body) continue;
				const suggestedDate =
					typeof item.suggestedDate === 'string' && isoDate.test(item.suggestedDate)
						? item.suggestedDate
						: null;
				const suggestedTime =
					typeof item.suggestedTime === 'string' && isoTime.test(item.suggestedTime)
						? item.suggestedTime
						: null;
				drafts.push({
					kind,
					target: typeof item.target === 'string' ? item.target : null,
					subject,
					body,
					suggestedDate,
					suggestedTime,
					confidence:
						typeof item.confidence === 'number' && item.confidence >= 0 && item.confidence <= 1
							? item.confidence
							: 0.6
				});
			}

			return {
				ok: true,
				value: drafts,
				target: 'remote',
				providerId: 'openai',
				model,
				latencyMs: Date.now() - startedAt
			};
		} catch (err) {
			return {
				ok: false,
				error: err instanceof Error ? err.message : 'proposeDrafts network error',
				target: 'remote',
				providerId: 'openai',
				model,
				latencyMs: Date.now() - startedAt
			};
		}
	}

	async classifyMemory(
		_input: { text: string },
		_options?: TaskOptions
	): Promise<InferenceResult<ClassifyResult>> {
		return notImplemented('classifyMemory', 'remote');
	}

	async answerWithContext(
		input: AnswerWithContextInput,
		options?: TaskOptions
	): Promise<InferenceResult<AnsweredQuestion>> {
		const apiKey = getApiKey();
		const startedAt = Date.now();
		if (!apiKey) {
			return {
				ok: false,
				error: 'OpenAI API key not configured',
				target: 'remote',
				providerId: 'openai',
				model: CHAT_MODEL,
				latencyMs: 0
			};
		}

		if (input.context.length === 0) {
			return {
				ok: false,
				error: 'No context memories to answer from',
				target: 'remote',
				providerId: 'openai',
				model: CHAT_MODEL,
				latencyMs: 0
			};
		}

		// Build context blocks tagged with [n] markers and memory IDs so the
		// model can cite reliably with inline footnotes.
		const contextBlocks = input.context
			.map((c, i) => `[${i + 1}] (id: ${c.memoryId})\n${c.text}`)
			.join('\n\n---\n\n');

		const system = `You answer questions about a user's personal memories (notes, voice memos, meeting transcripts).

You are given the user's question and a set of candidate memories that may be relevant. Each memory is tagged with a [n] marker and an id. Read all the memories carefully, then answer the question accurately and concisely.

Rules:
- Base your answer ONLY on the provided memories. Do not invent facts.
- If the memories don't contain enough information, say so plainly.
- Use INLINE [n] markers in your answer text to cite each claim, where n matches the candidate memory number. For example: "Alice agreed to lead the redesign [2] and we set a Q4 deadline [2][5]."
- Place markers right after the claim they support. Multiple markers can be stacked: [1][2].
- Keep the answer focused — typically 2-5 sentences unless the question demands more detail.
- You may use markdown for formatting (bullets, bold).
- The "citations" array in the JSON output must list the memory IDs in the same order they first appear as inline markers in the answer.

Return ONLY a JSON object with this exact shape:
{
  "answer": "your answer in markdown with inline [n] markers",
  "citations": ["memory_id_for_1", "memory_id_for_2"]
}`;

		// Optionally prepend a compact rendering of prior conversation turns
		// so follow-up questions can resolve pronouns and references. Strip
		// any inline [n] markers from prior assistant answers — those numbers
		// referred to a different candidate set and would be misleading now.
		let conversationHeader = '';
		if (input.priorTurns && input.priorTurns.length > 0) {
			const lines: string[] = ['Previous conversation in this thread:'];
			for (const turn of input.priorTurns) {
				const cleanedAnswer = turn.answer.replace(/\[\d+\]/g, '').trim();
				lines.push(`User: ${turn.question}`);
				lines.push(`You: ${cleanedAnswer}`);
			}
			lines.push('');
			conversationHeader = lines.join('\n') + '\n';
		}

		const userPrompt = `${conversationHeader}Question:\n${input.question}\n\nCandidate memories:\n\n${contextBlocks}`;

		const result = await callChat(apiKey, system, userPrompt, {
			...options,
			jsonMode: true,
			maxTokens: options?.maxTokens ?? 800,
			temperature: options?.temperature ?? 0.2
		});

		if (!result.ok) {
			return {
				ok: false,
				error: result.error,
				target: 'remote',
				providerId: 'openai',
				model: CHAT_MODEL,
				latencyMs: Date.now() - startedAt
			};
		}

		try {
			const parsed = JSON.parse(result.text) as {
				answer?: string;
				citations?: string[];
			};
			const answer = (parsed.answer ?? '').trim();
			if (!answer) {
				return {
					ok: false,
					error: 'OpenAI returned an empty answer',
					target: 'remote',
					providerId: 'openai',
					model: CHAT_MODEL,
					latencyMs: Date.now() - startedAt
				};
			}
			// Filter citations to ones that actually exist in the candidate set
			// — guards against hallucinated IDs.
			const validIds = new Set(input.context.map((c) => c.memoryId));
			const citations = (parsed.citations ?? []).filter((id) => validIds.has(id));

			return {
				ok: true,
				value: { answer, citations },
				target: 'remote',
				providerId: 'openai',
				model: CHAT_MODEL,
				latencyMs: Date.now() - startedAt
			};
		} catch (err) {
			return {
				ok: false,
				error: `Failed to parse answer JSON: ${err instanceof Error ? err.message : 'unknown'}`,
				target: 'remote',
				providerId: 'openai',
				model: CHAT_MODEL,
				latencyMs: Date.now() - startedAt
			};
		}
	}

	async generateTitle(
		input: { text: string },
		options?: TaskOptions
	): Promise<InferenceResult<string>> {
		const apiKey = getApiKey();
		const startedAt = Date.now();
		if (!apiKey) {
			return {
				ok: false,
				error: 'OpenAI API key not configured',
				target: 'remote',
				providerId: 'openai',
				model: CHAT_MODEL,
				latencyMs: 0
			};
		}

		const result = await callChat(
			apiKey,
			'Generate a short, descriptive title (3-8 words) for the following text. Return only the title, no quotes, no preamble, no trailing punctuation.',
			input.text,
			{ ...options, maxTokens: 32, temperature: 0.4 }
		);

		if (!result.ok) {
			return {
				ok: false,
				error: result.error,
				target: 'remote',
				providerId: 'openai',
				model: CHAT_MODEL,
				latencyMs: Date.now() - startedAt
			};
		}

		// Strip trailing punctuation and any wrapping quotes the model might add.
		const cleaned = result.text.replace(/^["'`]+|["'`]+$/g, '').replace(/[.!?]+$/, '').trim();

		return {
			ok: true,
			value: cleaned,
			target: 'remote',
			providerId: 'openai',
			model: CHAT_MODEL,
			latencyMs: Date.now() - startedAt
		};
	}

	async proposeCanonicalLabels(
		_input: { text: string },
		_options?: TaskOptions
	): Promise<InferenceResult<ControlledLabel[]>> {
		return notImplemented('proposeCanonicalLabels', 'remote');
	}

	async mergeAliasCandidates(
		_input: { names: string[] },
		_options?: TaskOptions
	): Promise<InferenceResult<AliasMergeProposal[]>> {
		return notImplemented('mergeAliasCandidates', 'remote');
	}

	async tts(input: TtsInput, _options?: TaskOptions): Promise<InferenceResult<TtsResult>> {
		const apiKey = getApiKey();
		const startedAt = Date.now();
		const model = 'gpt-4o-mini-tts';

		if (!apiKey) {
			return {
				ok: false,
				error: 'OpenAI API key not configured',
				target: 'remote',
				providerId: 'openai',
				model,
				latencyMs: 0
			};
		}

		try {
			const response = await fetch('https://api.openai.com/v1/audio/speech', {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${apiKey}`,
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					model,
					input: input.text,
					voice: input.voice ?? 'alloy',
					response_format: 'mp3'
				})
			});

			if (!response.ok) {
				const text = await response.text().catch(() => '');
				return {
					ok: false,
					error: `OpenAI TTS failed (${response.status}): ${text || 'no body'}`,
					target: 'remote',
					providerId: 'openai',
					model,
					latencyMs: Date.now() - startedAt
				};
			}

			const audio = await response.arrayBuffer();
			return {
				ok: true,
				value: { audio, mimeType: 'audio/mpeg' },
				target: 'remote',
				providerId: 'openai',
				model,
				latencyMs: Date.now() - startedAt
			};
		} catch (err) {
			return {
				ok: false,
				error: err instanceof Error ? err.message : 'TTS network error',
				target: 'remote',
				providerId: 'openai',
				model,
				latencyMs: Date.now() - startedAt
			};
		}
	}

	async realtimeSessionStart(
		_options?: RealtimeSessionOptions
	): Promise<InferenceResult<RealtimeSessionHandle>> {
		return notImplemented('realtimeSessionStart', 'remote');
	}
}

function pickExtension(mimeType: string): string {
	if (mimeType.includes('webm')) return 'webm';
	if (mimeType.includes('mp4')) return 'm4a';
	if (mimeType.includes('mpeg')) return 'mp3';
	if (mimeType.includes('wav')) return 'wav';
	if (mimeType.includes('ogg')) return 'ogg';
	return 'webm';
}
