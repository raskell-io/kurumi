<script lang="ts">
	import {
		createAgentSession,
		sendAgentMessage,
		type AgentSession,
		type AgentMessage,
		type ToolCall
	} from '$lib/agent';
	import MarkdownRenderer from './MarkdownRenderer.svelte';
	import {
		Bot,
		User,
		Send,
		X,
		Wrench,
		Search,
		FileText,
		CheckSquare,
		Bell,
		RotateCcw
	} from 'lucide-svelte';

	interface Props {
		onClose: () => void;
	}
	let { onClose }: Props = $props();

	let session = $state<AgentSession>(createAgentSession());
	let input = $state('');
	let messagesEnd: HTMLDivElement | undefined = $state();

	async function handleSend() {
		const trimmed = input.trim();
		if (!trimmed || session.thinking) return;
		input = '';
		session = await sendAgentMessage(session, trimmed);
		scrollToBottom();
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			handleSend();
		}
	}

	function handleReset() {
		session = createAgentSession();
	}

	function scrollToBottom() {
		requestAnimationFrame(() => {
			messagesEnd?.scrollIntoView({ behavior: 'smooth' });
		});
	}

	function toolIcon(name: string) {
		switch (name) {
			case 'search_memory':
				return Search;
			case 'create_memory':
				return FileText;
			case 'add_action_item':
				return CheckSquare;
			case 'add_reminder':
				return Bell;
			default:
				return Wrench;
		}
	}

	function toolLabel(tc: ToolCall): string {
		switch (tc.name) {
			case 'search_memory':
				return `Searched: "${tc.args.query ?? ''}"`;
			case 'create_memory':
				return `Created note: "${tc.args.title ?? ''}"`;
			case 'add_action_item':
				return `Added action: "${tc.args.text ?? ''}"`;
			case 'add_reminder':
				return `Proposed reminder: "${tc.args.text ?? ''}"`;
			default:
				return tc.name;
		}
	}
</script>

<aside class="agent-pane">
	<div class="pane-header">
		<div class="pane-title">
			<Bot class="h-4 w-4 text-[var(--color-accent)]" />
			<span>Kurumi Agent</span>
		</div>
		<div class="pane-actions">
			<button class="pane-btn" onclick={handleReset} title="New conversation">
				<RotateCcw class="h-3.5 w-3.5" />
			</button>
			<button class="pane-btn" onclick={onClose} title="Close">
				<X class="h-3.5 w-3.5" />
			</button>
		</div>
	</div>

	<div class="messages">
		{#if session.messages.length === 0 && !session.thinking}
			<div class="empty">
				<Bot class="h-8 w-8 opacity-30" />
				<p>Ask me anything or tell me what to do.</p>
				<p class="hint">
					I can search your vault, create notes, add action items,
					and propose reminders.
				</p>
			</div>
		{/if}

		{#each session.messages as msg (msg.id)}
			{#if msg.role === 'user'}
				<div class="msg msg-user">
					<div class="msg-avatar"><User class="h-3.5 w-3.5" /></div>
					<div class="msg-body">{msg.content}</div>
				</div>
			{:else if msg.role === 'assistant'}
				{#if msg.toolCalls && msg.toolCalls.length > 0}
					<div class="msg msg-tool">
						{#each msg.toolCalls as tc (tc.id)}
							{@const Icon = toolIcon(tc.name)}
							<div class="tool-card" class:error={tc.status === 'error'}>
								<div class="tool-header">
									<Icon class="h-3 w-3" />
									<span class="tool-label">{toolLabel(tc)}</span>
									<span class="tool-status">{tc.status}</span>
								</div>
							</div>
						{/each}
					</div>
				{/if}
				{#if msg.content}
					<div class="msg msg-assistant">
						<div class="msg-avatar assistant"><Bot class="h-3.5 w-3.5" /></div>
						<div class="msg-body">
							<MarkdownRenderer content={msg.content} />
						</div>
					</div>
				{/if}
			{/if}
		{/each}

		{#if session.thinking}
			<div class="msg msg-assistant">
				<div class="msg-avatar assistant"><Bot class="h-3.5 w-3.5" /></div>
				<div class="msg-body thinking">
					<span class="dot"></span>
					<span class="dot"></span>
					<span class="dot"></span>
				</div>
			</div>
		{/if}

		{#if session.error}
			<div class="error-bar">{session.error}</div>
		{/if}

		<div bind:this={messagesEnd}></div>
	</div>

	<div class="input-area">
		<input
			type="text"
			bind:value={input}
			onkeydown={handleKeydown}
			placeholder="Ask or instruct..."
			disabled={session.thinking}
			class="chat-input"
		/>
		<button
			class="send-btn"
			disabled={!input.trim() || session.thinking}
			onclick={handleSend}
		>
			<Send class="h-4 w-4" />
		</button>
	</div>
</aside>

<style>
	.agent-pane {
		width: 360px;
		height: 100%;
		display: flex;
		flex-direction: column;
		background: var(--color-bg);
		border-left: 1px solid var(--color-border);
		z-index: 30;
	}

	.pane-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.625rem 0.875rem;
		border-bottom: 1px solid var(--color-border);
		background: var(--color-bg-secondary);
	}

	.pane-title {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--color-text);
	}

	.pane-actions {
		display: flex;
		gap: 0.25rem;
	}

	.pane-btn {
		background: none;
		border: none;
		padding: 0.375rem;
		border-radius: 0.375rem;
		cursor: pointer;
		color: var(--color-text-muted);
	}

	.pane-btn:hover {
		background: var(--color-border);
		color: var(--color-text);
	}

	.messages {
		flex: 1;
		overflow-y: auto;
		padding: 0.75rem;
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
	}

	.empty {
		margin: auto;
		text-align: center;
		color: var(--color-text-muted);
		font-size: 0.8125rem;
		padding: 2rem 1rem;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
	}

	.empty .hint {
		font-size: 0.75rem;
		opacity: 0.75;
		max-width: 18rem;
	}

	.msg {
		display: flex;
		gap: 0.5rem;
		align-items: flex-start;
	}

	.msg-user {
		flex-direction: row-reverse;
	}

	.msg-avatar {
		width: 1.5rem;
		height: 1.5rem;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		background: var(--color-bg-secondary);
		color: var(--color-text-muted);
	}

	.msg-avatar.assistant {
		background: color-mix(in srgb, var(--color-accent) 15%, transparent);
		color: var(--color-accent);
	}

	.msg-user .msg-avatar {
		background: var(--color-accent);
		color: white;
	}

	.msg-body {
		max-width: 85%;
		padding: 0.5rem 0.75rem;
		border-radius: 0.75rem;
		font-size: 0.8125rem;
		line-height: 1.5;
	}

	.msg-user .msg-body {
		background: var(--color-accent);
		color: white;
		border-bottom-right-radius: 0.25rem;
	}

	.msg-assistant .msg-body {
		background: var(--color-bg-secondary);
		color: var(--color-text);
		border-bottom-left-radius: 0.25rem;
	}

	.msg-tool {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		padding-left: 2rem;
	}

	.tool-card {
		border: 1px solid var(--color-border);
		border-radius: 0.375rem;
		padding: 0.375rem 0.625rem;
		font-size: 0.6875rem;
		background: var(--color-bg-secondary);
	}

	.tool-card.error {
		border-color: rgba(239, 68, 68, 0.3);
		background: rgba(239, 68, 68, 0.05);
	}

	.tool-header {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		color: var(--color-text-muted);
	}

	.tool-label {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.tool-status {
		font-size: 0.5625rem;
		text-transform: uppercase;
		padding: 0.0625rem 0.25rem;
		border-radius: 999px;
		background: color-mix(in srgb, var(--color-accent) 12%, transparent);
		color: var(--color-accent);
	}

	/* Thinking animation */
	.thinking {
		display: flex;
		gap: 0.25rem;
		padding: 0.625rem 0.875rem !important;
	}

	.dot {
		width: 0.375rem;
		height: 0.375rem;
		border-radius: 50%;
		background: var(--color-text-muted);
		animation: bounce 1.4s infinite;
	}

	.dot:nth-child(2) {
		animation-delay: 0.2s;
	}

	.dot:nth-child(3) {
		animation-delay: 0.4s;
	}

	@keyframes bounce {
		0%,
		80%,
		100% {
			transform: translateY(0);
		}
		40% {
			transform: translateY(-6px);
		}
	}

	.error-bar {
		padding: 0.5rem 0.75rem;
		background: rgba(239, 68, 68, 0.1);
		border: 1px solid rgba(239, 68, 68, 0.3);
		border-radius: 0.375rem;
		color: #ef4444;
		font-size: 0.75rem;
	}

	.input-area {
		display: flex;
		gap: 0.375rem;
		padding: 0.625rem;
		border-top: 1px solid var(--color-border);
		background: var(--color-bg-secondary);
	}

	.chat-input {
		flex: 1;
		padding: 0.5rem 0.75rem;
		border: 1px solid var(--color-border);
		border-radius: 0.5rem;
		background: var(--color-bg);
		color: var(--color-text);
		font-size: 0.8125rem;
		outline: none;
	}

	.chat-input:focus {
		border-color: var(--color-accent);
	}

	.send-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2.25rem;
		height: 2.25rem;
		border-radius: 0.5rem;
		background: var(--color-accent);
		color: white;
		border: none;
		cursor: pointer;
		flex-shrink: 0;
		transition: background 0.15s;
	}

	.send-btn:hover:not(:disabled) {
		background: var(--color-accent-hover);
	}

	.send-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	@media (max-width: 768px) {
		.agent-pane {
			width: 100%;
			position: fixed;
			inset: 0;
			z-index: 50;
		}
	}
</style>
