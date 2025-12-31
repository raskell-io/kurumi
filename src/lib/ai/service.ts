import type { AIProvider, AIAction, AIConfig, AIResult } from './types';
import { DEFAULT_MODELS } from './types';

const PROVIDER_KEY = 'kurumi-ai-provider';
const OPENAI_KEY = 'kurumi-openai-key';
const ANTHROPIC_KEY = 'kurumi-anthropic-key';
const MODEL_KEY = 'kurumi-ai-model';

const ACTION_PROMPTS: Record<AIAction, string> = {
	improve:
		'Improve this text for clarity, grammar, and flow. Keep the same meaning and tone. Return only the improved text, nothing else.',
	expand:
		'Expand this text with more detail and elaboration. Maintain the original style. Return only the expanded text, nothing else.',
	summarize:
		'Summarize this text concisely, capturing the key points. Return only the summary, nothing else.',
	simplify:
		'Rewrite this text to be simpler and easier to understand. Return only the simplified text, nothing else.',
	translate: 'Translate this text to {language}. Return only the translation, nothing else.'
};

export function getAIConfig(): AIConfig | null {
	if (typeof localStorage === 'undefined') return null;

	const provider = localStorage.getItem(PROVIDER_KEY) as AIProvider | null;
	if (!provider) return null;

	const apiKey =
		provider === 'openai'
			? localStorage.getItem(OPENAI_KEY)
			: localStorage.getItem(ANTHROPIC_KEY);

	if (!apiKey) return null;

	const model = localStorage.getItem(MODEL_KEY) || DEFAULT_MODELS[provider];

	return { provider, apiKey, model };
}

export function isAIConfigured(): boolean {
	const config = getAIConfig();
	return config !== null && config.apiKey.length > 0;
}

export function getStoredProvider(): AIProvider {
	if (typeof localStorage === 'undefined') return 'openai';
	return (localStorage.getItem(PROVIDER_KEY) as AIProvider) || 'openai';
}

export function getStoredModel(): string {
	if (typeof localStorage === 'undefined') return DEFAULT_MODELS.openai;
	const provider = getStoredProvider();
	return localStorage.getItem(MODEL_KEY) || DEFAULT_MODELS[provider];
}

export function getStoredApiKey(provider: AIProvider): string {
	if (typeof localStorage === 'undefined') return '';
	const key = provider === 'openai' ? OPENAI_KEY : ANTHROPIC_KEY;
	return localStorage.getItem(key) || '';
}

export function saveAISettings(
	provider: AIProvider,
	openaiKey: string,
	anthropicKey: string,
	model: string
): void {
	if (typeof localStorage === 'undefined') return;
	localStorage.setItem(PROVIDER_KEY, provider);
	localStorage.setItem(OPENAI_KEY, openaiKey);
	localStorage.setItem(ANTHROPIC_KEY, anthropicKey);
	localStorage.setItem(MODEL_KEY, model);
}

async function callOpenAI(
	apiKey: string,
	model: string,
	prompt: string
): Promise<AIResult> {
	try {
		const response = await fetch('https://api.openai.com/v1/chat/completions', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${apiKey}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				model,
				messages: [{ role: 'user', content: prompt }],
				max_tokens: 2048
			})
		});

		if (!response.ok) {
			if (response.status === 401) {
				return { success: false, error: 'Invalid API key' };
			}
			if (response.status === 429) {
				return { success: false, error: 'Rate limit exceeded' };
			}
			return { success: false, error: `API error: ${response.status}` };
		}

		const data = await response.json();
		const text = data.choices?.[0]?.message?.content?.trim();

		if (!text) {
			return { success: false, error: 'No response from API' };
		}

		return { success: true, text };
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Network error';
		return { success: false, error: message };
	}
}

async function callAnthropic(
	apiKey: string,
	model: string,
	prompt: string
): Promise<AIResult> {
	try {
		const response = await fetch('https://api.anthropic.com/v1/messages', {
			method: 'POST',
			headers: {
				'x-api-key': apiKey,
				'anthropic-version': '2023-06-01',
				'anthropic-dangerous-direct-browser-access': 'true',
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				model,
				max_tokens: 2048,
				messages: [{ role: 'user', content: prompt }]
			})
		});

		if (!response.ok) {
			if (response.status === 401) {
				return { success: false, error: 'Invalid API key' };
			}
			if (response.status === 429) {
				return { success: false, error: 'Rate limit exceeded' };
			}
			return { success: false, error: `API error: ${response.status}` };
		}

		const data = await response.json();
		const text = data.content?.[0]?.text?.trim();

		if (!text) {
			return { success: false, error: 'No response from API' };
		}

		return { success: true, text };
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Network error';
		return { success: false, error: message };
	}
}

export async function runAction(
	action: AIAction,
	text: string,
	language?: string
): Promise<AIResult> {
	const config = getAIConfig();
	if (!config) {
		return { success: false, error: 'AI not configured' };
	}

	let promptTemplate = ACTION_PROMPTS[action];
	if (action === 'translate' && language) {
		promptTemplate = promptTemplate.replace('{language}', language);
	}

	const prompt = `${promptTemplate}\n\nText:\n${text}`;

	if (config.provider === 'openai') {
		return callOpenAI(config.apiKey, config.model, prompt);
	} else {
		return callAnthropic(config.apiKey, config.model, prompt);
	}
}

export async function testConnection(): Promise<{ success: boolean; error?: string }> {
	const config = getAIConfig();
	if (!config) {
		return { success: false, error: 'AI not configured' };
	}

	const result = await runAction('improve', 'Hello world');
	return { success: result.success, error: result.error };
}
