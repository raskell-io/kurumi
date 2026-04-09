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
 * The orchestration loop:
 *   1. User sends a message
 *   2. Call OpenAI chat completions with tools defined
 *   3. If the model calls a tool → execute it → append the result
 *      → call the API again (the model may chain multiple tool calls)
 *   4. When the model produces a text response → surface it
 *
 * Tool execution is unapproved for read-only ops (search) and
 * approved inline for write ops (create, add action item). The UI
 * shows a tool-call card for each invocation.
 */

import {
	addMemoryObject,
	addActionItem,
	addReminderProposal,
	todayIso
} from './db';
import { retrieveMemoryContext, buildContextBlocks } from './ask';

const OPENAI_KEY_STORAGE = 'kurumi-openai-key';
const CHAT_MODEL = 'gpt-4o-mini';
const MAX_TOOL_ROUNDS = 8;

function getApiKey(): string | null {
	if (typeof localStorage === 'undefined') return null;
	return localStorage.getItem(OPENAI_KEY_STORAGE);
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
			description: 'Add a new action item / task to the vault.',
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
	}
];

const SYSTEM_PROMPT = [
	'You are Kurumi, an AI-native second-brain assistant.',
	"You have access to the user's personal vault of notes, voice memos,",
	'meetings, action items, and reminders.',
	'',
	'When the user asks a question about their knowledge, ALWAYS call',
	'search_memory first before answering.',
	'',
	'You can also take actions:',
	'- create_memory: create a new note',
	'- add_action_item: add a task',
	'- add_reminder: propose a reminder for a future date',
	'',
	`Today's date is ${todayIso()}.`,
	'',
	'Keep responses concise and conversational. When you use a tool,',
	'briefly explain what you did.'
].join('\n');

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
		default:
			return { ok: false, error: `Unknown tool: ${name}` };
	}
}

// --- Chat message types -----------------------------------------------------

export interface AgentMessage {
	id: string;
	role: 'user' | 'assistant' | 'tool';
	content: string;
	toolCalls?: ToolCall[];
	createdAt: number;
}

// --- Orchestration ----------------------------------------------------------

export interface AgentSession {
	messages: AgentMessage[];
	thinking: boolean;
	error: string | null;
}

function generateId(): string {
	return Math.random().toString(36).slice(2, 10);
}

/**
 * Send a user message to the agent and get back the updated session
 * with the assistant's response (and any tool calls that happened
 * along the way). Mutates the session in place for Svelte reactivity.
 */
export async function sendAgentMessage(
	session: AgentSession,
	userMessage: string
): Promise<AgentSession> {
	const apiKey = getApiKey();
	if (!apiKey) {
		session.error = 'OpenAI API key not configured';
		return session;
	}

	session.error = null;
	session.thinking = true;

	// Add the user message
	session.messages = [
		...session.messages,
		{
			id: generateId(),
			role: 'user',
			content: userMessage,
			createdAt: Date.now()
		}
	];

	// Build the OpenAI messages array from session history
	const apiMessages: Array<{
		role: string;
		content: string;
		name?: string;
		tool_call_id?: string;
	}> = [{ role: 'system', content: SYSTEM_PROMPT }];

	for (const msg of session.messages) {
		if (msg.role === 'user' || msg.role === 'assistant') {
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
					model: CHAT_MODEL,
					messages: apiMessages,
					tools: TOOLS,
					tool_choice: 'auto',
					temperature: 0.3
				})
			});

			if (!response.ok) {
				const text = await response.text().catch(() => '');
				throw new Error(`OpenAI error (${response.status}): ${text || 'no body'}`);
			}

			const data = await response.json();
			const choice = data.choices?.[0];
			if (!choice) throw new Error('No response from model');

			const responseMessage = choice.message;

			// If no tool calls, this is the final text response.
			if (!responseMessage.tool_calls || responseMessage.tool_calls.length === 0) {
				const assistantMsg: AgentMessage = {
					id: generateId(),
					role: 'assistant',
					content: responseMessage.content || '',
					createdAt: Date.now()
				};
				session.messages = [...session.messages, assistantMsg];
				apiMessages.push({
					role: 'assistant',
					content: responseMessage.content || ''
				});
				break;
			}

			// Process tool calls
			const toolCalls: ToolCall[] = [];
			apiMessages.push({
				role: 'assistant',
				content: responseMessage.content || '',
				...({ tool_calls: responseMessage.tool_calls } as Record<string, unknown>)
			});

			for (const tc of responseMessage.tool_calls) {
				const name = tc.function.name;
				let args: Record<string, unknown> = {};
				try {
					args = JSON.parse(tc.function.arguments || '{}');
				} catch {
					args = {};
				}

				const toolCall: ToolCall = {
					id: tc.id,
					name,
					args,
					result: null,
					status: 'running'
				};
				toolCalls.push(toolCall);

				try {
					const result = await executeTool(name, args);
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

			// Add a tool-call message to the session for display
			const toolMsg: AgentMessage = {
				id: generateId(),
				role: 'assistant',
				content: responseMessage.content || '',
				toolCalls,
				createdAt: Date.now()
			};
			session.messages = [...session.messages, toolMsg];
		}
	} catch (err) {
		session.error = err instanceof Error ? err.message : 'Agent error';
	} finally {
		session.thinking = false;
	}

	return session;
}

export function createAgentSession(): AgentSession {
	return {
		messages: [],
		thinking: false,
		error: null
	};
}
