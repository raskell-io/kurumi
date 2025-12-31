export type AIProvider = 'openai' | 'anthropic';

export type AIAction = 'improve' | 'expand' | 'summarize' | 'simplify' | 'translate';

export interface AIConfig {
	provider: AIProvider;
	apiKey: string;
	model: string;
}

export interface AIResult {
	success: boolean;
	text?: string;
	error?: string;
}

export const DEFAULT_MODELS: Record<AIProvider, string> = {
	openai: 'gpt-4o',
	anthropic: 'claude-sonnet-4-20250514'
};

export const AVAILABLE_MODELS: Record<AIProvider, { id: string; name: string }[]> = {
	openai: [
		{ id: 'gpt-4o', name: 'GPT-4o' },
		{ id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
		{ id: 'gpt-4-turbo', name: 'GPT-4 Turbo' }
	],
	anthropic: [
		{ id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4' },
		{ id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet' },
		{ id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku' }
	]
};
