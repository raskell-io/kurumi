/**
 * Voice command parser. Detects command patterns in transcribed
 * speech and routes them to agent tools.
 *
 * Returns null if the input doesn't match any known command,
 * meaning it should be handled as a regular Ask Kurumi question.
 */

import {
	addMemoryObject,
	addActionItem,
	addReminderProposal,
	todayIso
} from './db';
import { goto } from '$app/navigation';

export interface VoiceCommandResult {
	response: string;
	navigateTo?: string;
}

const COMMAND_PATTERNS: Array<{
	pattern: RegExp;
	handler: (match: RegExpMatchArray) => VoiceCommandResult;
}> = [
	// "Create a note about X" / "New note about X"
	{
		pattern: /^(?:create|make|new|start)\s+(?:a\s+)?note\s+(?:about|on|called|titled)\s+(.+)/i,
		handler: (match) => {
			const topic = match[1].trim();
			const memory = addMemoryObject(topic, `# ${topic}\n\n`, null);
			return {
				response: `Created a new note: "${topic}".`,
				navigateTo: `/memory/${memory.id}`
			};
		}
	},
	// "Remind me to X" / "Remind me about X"
	{
		pattern: /^remind\s+me\s+(?:to|about)\s+(.+)/i,
		handler: (match) => {
			const text = match[1].trim();
			// Default to tomorrow
			const tomorrow = new Date();
			tomorrow.setDate(tomorrow.getDate() + 1);
			const date = tomorrow.toISOString().split('T')[0];
			addReminderProposal({
				memoryObjectId: '',
				text,
				suggestedDate: date,
				reason: 'Created by voice command'
			});
			return {
				response: `I'll remind you to "${text}" tomorrow. Check your proposals to review it.`
			};
		}
	},
	// "Add task X" / "Add action item X"
	{
		pattern: /^(?:add|create)\s+(?:a\s+)?(?:task|action\s*item|todo)\s*:?\s+(.+)/i,
		handler: (match) => {
			const text = match[1].trim();
			addActionItem({ text, dueDate: null, assignee: null });
			return {
				response: `Added action item: "${text}".`
			};
		}
	},
	// "Open my daily note" / "Open today's note"
	{
		pattern: /^(?:open|go\s+to|show)\s+(?:my\s+)?(?:daily|today'?s?)\s+(?:note|journal)/i,
		handler: () => {
			return {
				response: `Opening today's daily note.`,
				navigateTo: '/daily'
			};
		}
	},
	// "Open inbox" / "Show inbox"
	{
		pattern: /^(?:open|go\s+to|show)\s+(?:my\s+)?inbox/i,
		handler: () => {
			return {
				response: 'Opening your inbox.',
				navigateTo: '/inbox'
			};
		}
	},
	// "What's due today" / "Show my tasks"
	{
		pattern: /^(?:what'?s?\s+(?:due|on)\s+today|show\s+(?:my\s+)?(?:tasks|actions|action\s*items))/i,
		handler: () => {
			return {
				response: 'Opening your action items.',
				navigateTo: '/actions'
			};
		}
	}
];

/**
 * Try to parse a transcribed voice input as a command.
 * Returns null if no command matches — caller should fall
 * through to Ask Kurumi.
 */
export function parseVoiceCommand(transcript: string): VoiceCommandResult | null {
	const trimmed = transcript.trim();
	for (const { pattern, handler } of COMMAND_PATTERNS) {
		const match = trimmed.match(pattern);
		if (match) {
			try {
				return handler(match);
			} catch {
				return null;
			}
		}
	}
	return null;
}
