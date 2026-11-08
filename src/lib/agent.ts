/**
 * Agentic chat — a text-based assistant that can take actions against
 * the vault via OpenAI function calling.
 *
 * Unlike Ask Kurumi (one-shot Q&A) and the Realtime session (voice),
 * the agent maintains a multi-turn conversation with full tool use:
 * it can search, create memories, add action items, and propose
 * reminders — all with the user seeing each tool call and its result
 * inline in the chat.
 *
 * The orchestration loop (streaming):
 *   1. User sends a message
 *   2. Call OpenAI chat completions with stream: true
 *   3. Parse SSE chunks → stream text tokens to the UI in real time
 *   4. If the model calls a tool → execute it → append the result
 *      → call the API again (the model may chain multiple tool calls)
 *   5. When the model produces a final text response → surface it
 *
 * Tool execution is unapproved for read-only ops (search) and
 * approved inline for write ops (create, add action item). The UI
 * shows a tool-call card for each invocation.
 */

import {
	addMemoryObject,
	addActionItem,
	addReminderProposal,
	updateMemoryObject,
	todayIso,
	memoryObjects,
	actionItems,
	getAllPeople,
	getAllTags,
	projects,
	decisions,
	questions
} from './db';
import { exploreGraph } from './graph-walk';
import { get } from 'svelte/store';
import { retrieveMemoryContext, buildContextBlocks } from './ask';
import { generateDailyDigest } from './digest';
import { generateWeeklyReview, mondayOf, addDays } from './weekly-review';
import { remember, forget, memoryPrompt, searchConversations } from './agent-memory';

const OPENAI_KEY_STORAGE = 'kurumi-openai-key';
const AGENT_MODEL_KEY = 'kurumi-agent-model';
const DEFAULT_MODEL = 'gpt-4o-mini';
const MAX_TOOL_ROUNDS = 8;

export const AVAILABLE_MODELS = [
	{ id: 'gpt-4o-mini', label: 'GPT-4o Mini (fast)' },
	{ id: 'gpt-4o', label: 'GPT-4o (best quality)' },
	{ id: 'gpt-4.1-mini', label: 'GPT-4.1 Mini' },
	{ id: 'gpt-4.1', label: 'GPT-4.1' },
	{ id: 'gpt-4.1-nano', label: 'GPT-4.1 Nano (fastest)' }
];

function getApiKey(): string | null {
	if (typeof localStorage === 'undefined') return null;
	return localStorage.getItem(OPENAI_KEY_STORAGE);
}

export function getAgentModel(): string {
	if (typeof localStorage === 'undefined') return DEFAULT_MODEL;
	return localStorage.getItem(AGENT_MODEL_KEY) || DEFAULT_MODEL;
}

export function setAgentModel(model: string) {
	if (typeof localStorage !== 'undefined') {
		localStorage.setItem(AGENT_MODEL_KEY, model);
	}
}

// --- Tool definitions (OpenAI function-calling schema) ----------------------

const TOOLS = [
	{
		type: 'function' as const,
		function: {
			name: 'search_memory',
			description:
				"Search the user's Kurumi vault for memories relevant to a question. Returns snippets with titles and ids.",
			parameters: {
				type: 'object',
				properties: {
					query: { type: 'string', description: 'Natural-language search query' }
				},
				required: ['query']
			}
		}
	},
	{
		type: 'function' as const,
		function: {
			name: 'create_memory',
			description: 'Create a new note in the vault with the given title and markdown body.',
			parameters: {
				type: 'object',
				properties: {
					title: { type: 'string', description: 'Title for the new note' },
					body: { type: 'string', description: 'Markdown body content' }
				},
				required: ['title', 'body']
			}
		}
	},
	{
		type: 'function' as const,
		function: {
			name: 'add_action_item',
			description: 'Add a new to-do to the vault.',
			parameters: {
				type: 'object',
				properties: {
					text: { type: 'string', description: 'What needs to be done' },
					dueDate: {
						type: 'string',
						description: 'Optional ISO date (YYYY-MM-DD) when this is due'
					},
					assignee: { type: 'string', description: 'Optional person to assign to' }
				},
				required: ['text']
			}
		}
	},
	{
		type: 'function' as const,
		function: {
			name: 'add_reminder',
			description:
				'Propose a time-anchored reminder for the user to review. Appears in the /proposals queue.',
			parameters: {
				type: 'object',
				properties: {
					text: { type: 'string', description: 'What to be reminded about' },
					date: {
						type: 'string',
						description: 'ISO date (YYYY-MM-DD) when the reminder should fire'
					}
				},
				required: ['text', 'date']
			}
		}
	},
	{
		type: 'function' as const,
		function: {
			name: 'generate_daily_digest',
			description:
				"Generate a daily digest note summarizing yesterday's captures, open to-dos, and pending proposals.",
			parameters: {
				type: 'object',
				properties: {
					date: {
						type: 'string',
						description:
							'Optional ISO date (YYYY-MM-DD) to generate digest for. Defaults to yesterday.'
					}
				}
			}
		}
	},
	{
		type: 'function' as const,
		function: {
			name: 'generate_weekly_review',
			description:
				'Write the weekly review note: what happened in a week (Monday to Sunday), what is still open, and what is due the week after. Rewrites it if it exists.',
			parameters: {
				type: 'object',
				properties: {
					date: {
						type: 'string',
						description: 'Optional ISO date (YYYY-MM-DD) in the week to review. Defaults to last week.'
					}
				}
			}
		}
	},
	{
		type: 'function' as const,
		function: {
			name: 'propose_todo',
			description:
				'Propose a to-do for the user to approve (it goes to their Proposals queue, nothing is added until they approve). Use for to-dos you found or suggest while running a workflow.',
			parameters: {
				type: 'object',
				properties: {
					text: { type: 'string', description: 'What needs to be done' },
					date: { type: 'string', description: 'Optional ISO date (YYYY-MM-DD) it is due' },
					reason: { type: 'string', description: 'Why, in a few words (e.g. which meeting it came from)' }
				},
				required: ['text']
			}
		}
	},
	{
		type: 'function' as const,
		function: {
			name: 'explore_graph',
			description:
				"Walk the user's knowledge graph from a person, project, #tag or note title: what links to it and from it, who is mentioned, its to-dos, decisions and open questions, then one step further. Use it for questions about how things connect (\"what do we know about Alice's Q4 priorities?\", \"what's going on with Project X?\"). The user sees the path you took as a graph.",
			parameters: {
				type: 'object',
				properties: {
					start: { type: 'string', description: 'Where to start: a person\'s name, project name, #tag or note title' },
					depth: { type: 'number', description: 'How many steps to follow (1-3, default 2)' }
				},
				required: ['start']
			}
		}
	},
	{
		type: 'function' as const,
		function: {
			name: 'remember',
			description:
				"Remember a lasting fact about the user for future conversations (a preference, their role, people and projects they care about). Saved in their note 'Kurumi memory'. One short fact per call. Never store passwords, keys or other secrets.",
			parameters: {
				type: 'object',
				properties: {
					fact: { type: 'string', description: 'The fact, as a short sentence about the user, e.g. "Prefers summaries as bullet points"' }
				},
				required: ['fact']
			}
		}
	},
	{
		type: 'function' as const,
		function: {
			name: 'forget',
			description: 'Forget remembered facts: removes the ones matching the text from the user\'s Kurumi memory note.',
			parameters: {
				type: 'object',
				properties: {
					fact: { type: 'string', description: 'The fact to forget, or words it contains' }
				},
				required: ['fact']
			}
		}
	},
	{
		type: 'function' as const,
		function: {
			name: 'recall_conversations',
			description: 'Search earlier conversations with the user on this device, e.g. when they refer to something discussed before.',
			parameters: {
				type: 'object',
				properties: {
					query: { type: 'string', description: 'Words to look for' }
				},
				required: ['query']
			}
		}
	},
	{
		type: 'function' as const,
		function: {
			name: 'update_memory',
			description: 'Update an existing note in the vault. Can change title, body, or tags.',
			parameters: {
				type: 'object',
				properties: {
					memoryId: { type: 'string', description: 'The ID of the memory to update' },
					title: { type: 'string', description: 'New title (optional)' },
					body: { type: 'string', description: 'New markdown body (optional)' },
					appendBody: { type: 'string', description: 'Text to append to the existing body (optional, use instead of body to add without replacing)' },
					tags: {
						type: 'array',
						items: { type: 'string' },
						description: 'New tags array (optional, replaces existing tags)'
					}
				},
				required: ['memoryId']
			}
		}
	},
	{
		type: 'function' as const,
		function: {
			name: 'list_action_items',
			description: 'List to-dos from the vault, optionally filtered by status.',
			parameters: {
				type: 'object',
				properties: {
					status: {
						type: 'string',
						enum: ['open', 'in_progress', 'done', 'cancelled'],
						description: 'Filter by status (optional, defaults to showing open and in_progress)'
					},
					limit: { type: 'number', description: 'Max items to return (default 15)' }
				}
			}
		}
	},
	{
		type: 'function' as const,
		function: {
			name: 'search_people',
			description: "Search for people mentioned in the user's vault.",
			parameters: {
				type: 'object',
				properties: {
					query: { type: 'string', description: 'Name to search for (optional, returns all if empty)' }
				}
			}
		}
	},
	{
		type: 'function' as const,
		function: {
			name: 'search_topics',
			description: "Search for topics and projects referenced in the user's vault.",
			parameters: {
				type: 'object',
				properties: {
					query: { type: 'string', description: 'Topic to search for (optional, returns all if empty)' }
				}
			}
		}
	}
];

/** Tools only background workflows get (the chat has add_action_item instead). */
const WORKFLOW_ONLY = new Set(['propose_todo']);

/** What a scheduled workflow may use: reading, and proposing (never changing the vault). */
export const WORKFLOW_TOOLS = ['search_memory', 'list_action_items', 'search_people', 'search_topics', 'explore_graph', 'propose_todo'];

const TOOL_STATUS_LABELS: Record<string, string> = {
	search_memory: 'Searching vault...',
	create_memory: 'Creating note...',
	add_action_item: 'Adding to-do...',
	add_reminder: 'Adding reminder...',
	generate_daily_digest: 'Generating digest...',
	generate_weekly_review: 'Writing weekly review...',
	explore_graph: 'Exploring connections...',
	remember: 'Remembering...',
	forget: 'Forgetting...',
	recall_conversations: 'Looking through past conversations...',
	update_memory: 'Updating note...',
	list_action_items: 'Listing to-dos...',
	search_people: 'Searching people...',
	search_topics: 'Searching topics...'
};

/** The system prompt, built per message: today's date and what the agent remembers. */
export function systemPrompt(): string {
	const remembered = memoryPrompt();
	return [
		...SYSTEM_PROMPT_LINES,
		`Today's date is ${todayIso()}.`,
		...(remembered ? ['', remembered] : [])
	].join('\n');
}

const SYSTEM_PROMPT_LINES = [
	'You are Kurumi, an AI-native second-brain assistant.',
	"You have access to the user's personal vault of notes, voice memos,",
	'meetings, to-dos, and reminders.',
	'',
	'When the user asks a question about their knowledge, ALWAYS call',
	'search_memory first before answering.',
	'',
	'You can also take actions:',
	'- create_memory: create a new note',
	'- update_memory: update an existing note (title, body, tags, or append)',
	'- add_action_item: add a task',
	'- add_reminder: propose a reminder for a future date',
	'- list_action_items: list tasks by status',
	'- search_people: find people in the vault',
	'- search_topics: find topics/projects in the vault',
	'- generate_daily_digest / generate_weekly_review: write a digest or weekly review note',
	'- remember / forget: keep or drop a lasting fact about the user across conversations',
	'- recall_conversations: search earlier conversations',
	'- explore_graph: follow how a person, project, tag or note connects to the rest',
	'  (prefer it over search_memory for "what do we know about X" questions about',
	'  people and projects; cite the notes you used with [[Title]])',
	'',
	'When the user asks you to remember something, or tells you a lasting',
	'preference or fact about themselves that would help in later chats,',
	'call remember (briefly say so). When they ask you to forget, call forget.',
	'',
	'Keep responses concise and conversational. When you use a tool,',
	'briefly explain what you did.',
	''
];

// --- Tool execution ---------------------------------------------------------

export interface ToolCall {
	id: string;
	name: string;
	args: Record<string, unknown>;
	result: unknown;
	status: 'running' | 'done' | 'error';
}

async function executeTool(
	name: string,
	args: Record<string, unknown>
): Promise<unknown> {
	switch (name) {
		case 'search_memory': {
			const query = String(args.query ?? '');
			const memories = await retrieveMemoryContext(query, 6);
			const blocks = buildContextBlocks(memories);
			return {
				count: blocks.length,
				results: blocks.map((b, i) => ({
					index: i + 1,
					memoryId: b.memoryId,
					title: memories[i]?.title ?? 'Untitled',
					snippet: b.text.slice(0, 500)
				}))
			};
		}
		case 'create_memory': {
			const title = String(args.title ?? 'Untitled');
			const body = String(args.body ?? '');
			const memory = addMemoryObject(title, body, null);
			return { ok: true, memoryId: memory.id, title: memory.title };
		}
		case 'add_action_item': {
			const item = addActionItem({
				text: String(args.text ?? ''),
				dueDate: args.dueDate ? String(args.dueDate) : null,
				assignee: args.assignee ? String(args.assignee) : null
			});
			return { ok: true, actionItemId: item.id, text: item.text };
		}
		case 'add_reminder': {
			const proposal = addReminderProposal({
				memoryObjectId: '', // no source memory
				text: String(args.text ?? ''),
				suggestedDate: String(args.date ?? todayIso()),
				reason: 'Created by Kurumi agent'
			});
			return { ok: true, proposalId: proposal.id };
		}
		case 'generate_daily_digest': {
			const date = args.date ? String(args.date) : undefined;
			const memoryId = await generateDailyDigest(date);
			return { ok: true, memoryId, message: 'Daily digest generated' };
		}
		case 'generate_weekly_review': {
			const start = args.date ? mondayOf(String(args.date)) : undefined;
			const memoryId = await generateWeeklyReview(start ? { start, end: addDays(start, 6) } : undefined);
			return { ok: true, memoryId, message: 'Weekly review written' };
		}
		case 'propose_todo': {
			const proposal = addReminderProposal({
				memoryObjectId: '',
				text: String(args.text ?? ''),
				suggestedDate: args.date ? String(args.date) : todayIso(),
				reason: args.reason ? String(args.reason) : 'Proposed by a workflow'
			});
			return { ok: true, proposalId: proposal.id, note: 'Waiting for the user to approve on Proposals' };
		}
		case 'explore_graph': {
			const start = String(args.start ?? '');
			const graph = exploreGraph(
				start,
				{
					notes: get(memoryObjects),
					projects: get(projects),
					todos: get(actionItems),
					decisions: get(decisions),
					questions: get(questions)
				},
				{ depth: typeof args.depth === 'number' ? args.depth : 2 }
			);
			if (!graph.start) return { found: false, message: `Nothing called "${start}" in the vault. Try search_memory.` };
			return { found: true, start: graph.start.label, nodes: graph.nodes, edges: graph.edges };
		}
		case 'remember':
			return remember(String(args.fact ?? ''));
		case 'forget':
			return forget(String(args.fact ?? ''));
		case 'recall_conversations': {
			const hits = searchConversations(String(args.query ?? ''));
			return { count: hits.length, conversations: hits };
		}
		case 'update_memory': {
			const memoryId = String(args.memoryId ?? '');
			if (!memoryId) return { ok: false, error: 'memoryId is required' };
			const all = get(memoryObjects);
			const existing = all.find((m) => m.id === memoryId);
			if (!existing) return { ok: false, error: `Memory ${memoryId} not found` };
			const updates: Record<string, unknown> = {};
			if (args.title) updates.title = String(args.title);
			if (args.body) updates.bodyMarkdown = String(args.body);
			if (args.appendBody) {
				updates.bodyMarkdown = (existing.bodyMarkdown || '') + '\n\n' + String(args.appendBody);
			}
			if (args.tags && Array.isArray(args.tags)) {
				updates.tags = (args.tags as string[]).map(String);
			}
			updateMemoryObject(memoryId, updates);
			return { ok: true, memoryId, title: args.title || existing.title };
		}
		case 'list_action_items': {
			const allActions = get(actionItems);
			const statusFilter = args.status ? String(args.status) : null;
			const limit = typeof args.limit === 'number' ? args.limit : 15;
			let filtered = allActions;
			if (statusFilter) {
				filtered = filtered.filter((a) => a.status === statusFilter);
			} else {
				filtered = filtered.filter((a) => a.status === 'open' || a.status === 'in_progress');
			}
			return {
				count: filtered.length,
				items: filtered.slice(0, limit).map((a) => ({
					id: a.id,
					text: a.text,
					status: a.status,
					dueDate: a.dueDate,
					assignee: a.assignee
				}))
			};
		}
		case 'search_people': {
			const query = String(args.query ?? '').toLowerCase();
			let people = getAllPeople();
			if (query) {
				people = people.filter((p) => p.name.toLowerCase().includes(query));
			}
			return {
				count: people.length,
				people: people.slice(0, 20).map((p) => ({ name: p.name, mentions: p.count }))
			};
		}
		case 'search_topics': {
			const query = String(args.query ?? '').toLowerCase();
			const all = get(memoryObjects);
			const topicCounts = new Map<string, number>();
			for (const m of all) {
				for (const t of [...(m.topics ?? []), ...(m.projects ?? [])]) {
					const key = t;
					topicCounts.set(key, (topicCounts.get(key) || 0) + 1);
				}
			}
			let topics = Array.from(topicCounts.entries())
				.map(([name, count]) => ({ name, count }))
				.sort((a, b) => b.count - a.count);
			if (query) {
				topics = topics.filter((t) => t.name.toLowerCase().includes(query));
			}
			return {
				count: topics.length,
				topics: topics.slice(0, 20).map((t) => ({ name: t.name, mentions: t.count }))
			};
		}
		default:
			return { ok: false, error: `Unknown tool: ${name}` };
	}
}

// --- Chat message types -----------------------------------------------------

export interface AgentMessage {
	id: string;
	role: 'user' | 'assistant' | 'tool';
	content: string;
	images?: string[]; // data-URL images attached to user messages
	toolCalls?: ToolCall[];
	createdAt: number;
}

// --- Orchestration ----------------------------------------------------------

export interface AgentSession {
	messages: AgentMessage[];
	thinking: boolean;
	thinkingStatus: string | null; // e.g. "Searching vault...", "Thinking..."
	streamStats: { tokensPerSec: number } | null;
	error: string | null;
}

export interface SendOptions {
	images?: string[];
	model?: string;
	onUpdate?: (session: AgentSession) => void;
	/** Only these tools (by name), e.g. read-only ones for background workflows. */
	tools?: string[];
	/** Added to the system prompt (workflows say what they're running). */
	systemExtra?: string;
}

function generateId(): string {
	return Math.random().toString(36).slice(2, 10);
}

// --- SSE stream parser ------------------------------------------------------

async function* parseSSEStream(
	response: Response
): AsyncGenerator<Record<string, unknown>> {
	const reader = response.body!.getReader();
	const decoder = new TextDecoder();
	let buffer = '';

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, { stream: true });

		const lines = buffer.split('\n');
		buffer = lines.pop() || ''; // keep incomplete line in buffer

		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed || trimmed === 'data: [DONE]') continue;
			if (trimmed.startsWith('data: ')) {
				try {
					yield JSON.parse(trimmed.slice(6));
				} catch { /* malformed chunk */ }
			}
		}
	}
}

/**
 * Send a user message to the agent with streaming support.
 * When `options.onUpdate` is provided, the session is updated in
 * real time as tokens arrive. The final session state is returned.
 */
export async function sendAgentMessage(
	session: AgentSession,
	userMessage: string,
	options?: SendOptions
): Promise<AgentSession> {
	const apiKey = getApiKey();
	if (!apiKey) {
		session.error = 'OpenAI API key not configured';
		return session;
	}

	const model = options?.model || getAgentModel();
	const onUpdate = options?.onUpdate;

	session.error = null;
	session.thinking = true;
	session.thinkingStatus = 'Thinking...';
	onUpdate?.(session);

	// Add the user message
	session.messages = [
		...session.messages,
		{
			id: generateId(),
			role: 'user',
			content: userMessage,
			images: options?.images?.length ? options.images : undefined,
			createdAt: Date.now()
		}
	];
	onUpdate?.(session);

	// Build the OpenAI messages array from session history
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const apiMessages: Array<Record<string, any>> = [
		{ role: 'system', content: options?.systemExtra ? `${systemPrompt()}\n\n${options.systemExtra}` : systemPrompt() }
	];

	for (const msg of session.messages) {
		if (msg.role === 'user') {
			if (msg.images?.length) {
				apiMessages.push({
					role: 'user',
					content: [
						{ type: 'text', text: msg.content },
						...msg.images.map((url) => ({
							type: 'image_url',
							image_url: { url, detail: 'low' as const }
						}))
					]
				});
			} else {
				apiMessages.push({ role: 'user', content: msg.content });
			}
		} else if (msg.role === 'assistant') {
			apiMessages.push({ role: msg.role, content: msg.content });
		}
	}

	try {
		let rounds = 0;
		while (rounds < MAX_TOOL_ROUNDS) {
			rounds++;

			const response = await fetch('https://api.openai.com/v1/chat/completions', {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${apiKey}`,
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					model,
					messages: apiMessages,
					tools: options?.tools ? TOOLS.filter((t) => options.tools!.includes(t.function.name)) : TOOLS.filter((t) => !WORKFLOW_ONLY.has(t.function.name)),
					tool_choice: 'auto',
					temperature: 0.3,
					stream: true
				})
			});

			if (!response.ok) {
				const text = await response.text().catch(() => '');
				throw new Error(`OpenAI error (${response.status}): ${text || 'no body'}`);
			}

			// Parse the streaming response
			let contentAccum = '';
			const toolCallAccum: Map<number, {
				id: string;
				name: string;
				arguments: string;
			}> = new Map();
			let finishReason: string | null = null;

			// Token speed tracking
			let streamTokenCount = 0;
			let streamStartTime = 0;

			// Create a partial assistant message for streaming text
			const streamMsgId = generateId();
			let streamMsgAdded = false;

			for await (const chunk of parseSSEStream(response)) {
				const choice = (chunk.choices as Array<Record<string, unknown>>)?.[0];
				if (!choice) continue;

				const delta = choice.delta as Record<string, unknown> | undefined;
				if (!delta) {
					if (choice.finish_reason) finishReason = String(choice.finish_reason);
					continue;
				}

				if (choice.finish_reason) finishReason = String(choice.finish_reason);

				// Accumulate text content
				if (typeof delta.content === 'string' && delta.content) {
					contentAccum += delta.content;
					streamTokenCount++;
					if (!streamStartTime) streamStartTime = Date.now();

					// Update the streaming message in real time
					if (!streamMsgAdded) {
						session.messages = [
							...session.messages,
							{
								id: streamMsgId,
								role: 'assistant',
								content: contentAccum,
								createdAt: Date.now()
							}
						];
						streamMsgAdded = true;
					} else {
						// Update the last message's content
						const msgs = [...session.messages];
						const last = msgs[msgs.length - 1];
						if (last.id === streamMsgId) {
							msgs[msgs.length - 1] = { ...last, content: contentAccum };
							session.messages = msgs;
						}
					}
					session.thinkingStatus = null;
					// Update tokens/sec every few tokens to avoid excessive recalc
					const elapsed = (Date.now() - streamStartTime) / 1000;
					if (elapsed > 0.3) {
						session.streamStats = { tokensPerSec: Math.round(streamTokenCount / elapsed) };
					}
					onUpdate?.(session);
				}

				// Accumulate tool calls
				if (delta.tool_calls && Array.isArray(delta.tool_calls)) {
					for (const tc of delta.tool_calls as Array<Record<string, unknown>>) {
						const idx = typeof tc.index === 'number' ? tc.index : 0;
						const existing = toolCallAccum.get(idx);
						const fn = tc.function as Record<string, unknown> | undefined;

						if (existing) {
							if (fn?.arguments) existing.arguments += String(fn.arguments);
						} else {
							toolCallAccum.set(idx, {
								id: (tc.id as string) || `tc_${generateId()}`,
								name: (fn?.name as string) || '',
								arguments: (fn?.arguments as string) || ''
							});
						}
					}
				}
			}

			// Stream finished — handle the result
			if (toolCallAccum.size === 0) {
				// Pure text response — finalize
				if (!streamMsgAdded && contentAccum) {
					session.messages = [
						...session.messages,
						{
							id: streamMsgId,
							role: 'assistant',
							content: contentAccum,
							createdAt: Date.now()
						}
					];
				}
				apiMessages.push({ role: 'assistant', content: contentAccum });
				break;
			}

			// Tool calls — process them
			// Remove the partial streaming message if it was just empty
			if (streamMsgAdded && !contentAccum.trim()) {
				session.messages = session.messages.filter((m) => m.id !== streamMsgId);
			}

			const toolCalls: ToolCall[] = [];
			const apiToolCalls = [];

			for (const [, tc] of toolCallAccum) {
				apiToolCalls.push({
					id: tc.id,
					type: 'function',
					function: { name: tc.name, arguments: tc.arguments }
				});
			}

			apiMessages.push({
				role: 'assistant',
				content: contentAccum || '',
				tool_calls: apiToolCalls
			});

			for (const [, tc] of toolCallAccum) {
				let args: Record<string, unknown> = {};
				try {
					args = JSON.parse(tc.arguments || '{}');
				} catch {
					args = {};
				}

				const toolCall: ToolCall = {
					id: tc.id,
					name: tc.name,
					args,
					result: null,
					status: 'running'
				};
				toolCalls.push(toolCall);

				// Show thinking status with tool name
				session.thinkingStatus = TOOL_STATUS_LABELS[tc.name] || `Running ${tc.name}...`;
				onUpdate?.(session);

				try {
					// A tool outside the allowed set is refused, even if the model asks for it.
					const allowed = options?.tools ? options.tools.includes(tc.name) : !WORKFLOW_ONLY.has(tc.name);
					const result = allowed ? await executeTool(tc.name, args) : { ok: false, error: `Tool ${tc.name} isn't available here` };
					toolCall.result = result;
					toolCall.status = 'done';
					apiMessages.push({
						role: 'tool',
						content: JSON.stringify(result),
						tool_call_id: tc.id
					});
				} catch (err) {
					const errMsg =
						err instanceof Error ? err.message : 'Tool execution failed';
					toolCall.result = { error: errMsg };
					toolCall.status = 'error';
					apiMessages.push({
						role: 'tool',
						content: JSON.stringify({ error: errMsg }),
						tool_call_id: tc.id
					});
				}
			}

			// Add tool-call message to session
			const toolMsg: AgentMessage = {
				id: generateId(),
				role: 'assistant',
				content: contentAccum || '',
				toolCalls,
				createdAt: Date.now()
			};
			session.messages = [...session.messages, toolMsg];
			session.thinkingStatus = 'Thinking...';
			onUpdate?.(session);
		}
	} catch (err) {
		session.error = err instanceof Error ? err.message : 'Agent error';
	} finally {
		session.thinking = false;
		session.thinkingStatus = null;
		session.streamStats = null;
		onUpdate?.(session);
	}

	return session;
}

export function createAgentSession(): AgentSession {
	return {
		messages: [],
		thinking: false,
		thinkingStatus: null,
		streamStats: null,
		error: null
	};
}

/**
 * Generate a concise title for a conversation based on the first exchange.
 * Fire-and-forget — returns the title string or null on failure.
 */
export async function generateConversationTitle(
	userMessage: string,
	assistantReply: string
): Promise<string | null> {
	const apiKey = getApiKey();
	if (!apiKey) return null;
	try {
		const res = await fetch('https://api.openai.com/v1/chat/completions', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${apiKey}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				model: 'gpt-4o-mini',
				messages: [
					{
						role: 'system',
						content:
							'Generate a concise 3-5 word title for this conversation. Return ONLY the title, no quotes or punctuation.'
					},
					{ role: 'user', content: userMessage },
					{ role: 'assistant', content: assistantReply.slice(0, 300) }
				],
				temperature: 0.3,
				max_tokens: 20
			})
		});
		if (!res.ok) return null;
		const data = await res.json();
		const title = data.choices?.[0]?.message?.content?.trim();
		return title || null;
	} catch {
		return null;
	}
}
