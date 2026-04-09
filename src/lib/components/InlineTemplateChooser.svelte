<script lang="ts">
	import {
		templates,
		applyTemplateVariables,
		templateHasVariable,
		type Template
	} from '$lib/db';
	import {
		FileText,
		Calendar,
		Users,
		FolderKanban,
		Sparkles,
		Settings
	} from 'lucide-svelte';
	import { goto } from '$app/navigation';

	interface Props {
		/** Called when the user picks a template. Passes the applied body
		 *  + suggested title so the parent can update the memory. */
		onSelect: (body: string, title: string) => void;
		/** Called when the user dismisses without picking (started typing). */
		onDismiss: () => void;
	}

	let { onSelect, onDismiss }: Props = $props();

	let userTemplates = $derived($templates);

	function templateIcon(name: string) {
		const lower = name.toLowerCase();
		if (lower.includes('daily') || lower.includes('journal')) return Calendar;
		if (lower.includes('meeting')) return Users;
		if (lower.includes('project')) return FolderKanban;
		return Sparkles;
	}

	function templatePreview(content: string): string {
		return content
			.split('\n')
			.filter((l) => l.trim())
			.slice(0, 2)
			.map((l) => l.replace(/\{(\w+)\}/g, '·').replace(/^#+\s*/, ''))
			.join(' — ');
	}

	function handleTemplateSelect(template: Template) {
		let title = template.name;

		if (templateHasVariable(template.content, 'title')) {
			const input = prompt('Note title:');
			if (input === null) return;
			title = input || template.name;
		}

		const overrides: Record<string, string> = {};
		if (title) overrides.title = title;

		const body = applyTemplateVariables(template.content, overrides);
		onSelect(body, title);
	}

	function handleManageTemplates() {
		onDismiss();
		goto('/templates');
	}
</script>

<div class="inline-chooser" role="region" aria-label="Choose a template">
	<p class="hint">
		Start typing or pick a template
		<span class="hint-fade">— this disappears when you write</span>
	</p>

	<div class="template-grid">
		{#each userTemplates as template (template.id)}
			{@const Icon = templateIcon(template.name)}
			<button
				class="tpl-card"
				onclick={() => handleTemplateSelect(template)}
			>
				<span class="tpl-icon">
					<Icon class="h-4 w-4" />
				</span>
				<span class="tpl-info">
					<span class="tpl-name">{template.name}</span>
					<span class="tpl-preview">{templatePreview(template.content)}</span>
				</span>
			</button>
		{/each}
	</div>

	<button class="manage-link" onclick={handleManageTemplates}>
		<Settings class="h-3 w-3" />
		Manage templates
	</button>
</div>

<style>
	.inline-chooser {
		padding: 1.5rem 0 1rem;
		animation: fade-in 0.2s ease-out;
	}

	@keyframes fade-in {
		from { opacity: 0; transform: translateY(6px); }
		to { opacity: 1; transform: translateY(0); }
	}

	.hint {
		font-size: 0.875rem;
		color: var(--color-text-muted);
		margin-bottom: 1rem;
	}

	.hint-fade {
		opacity: 0.6;
		font-size: 0.8125rem;
	}

	.template-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
		gap: 0.5rem;
		margin-bottom: 0.75rem;
	}

	.tpl-card {
		display: flex;
		align-items: center;
		gap: 0.625rem;
		padding: 0.625rem 0.75rem;
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border);
		border-radius: 0.5rem;
		cursor: pointer;
		text-align: left;
		transition: all 0.1s;
	}

	.tpl-card:hover {
		border-color: var(--color-accent);
		background: color-mix(in srgb, var(--color-accent) 5%, var(--color-bg-secondary));
	}

	.tpl-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		flex-shrink: 0;
		border-radius: 0.375rem;
		background: color-mix(in srgb, var(--color-accent) 12%, transparent);
		color: var(--color-accent);
	}

	.tpl-info {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}

	.tpl-name {
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--color-text);
	}

	.tpl-preview {
		font-size: 0.6875rem;
		color: var(--color-text-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.manage-link {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		background: none;
		border: none;
		padding: 0.25rem 0.5rem;
		border-radius: 0.25rem;
		color: var(--color-text-muted);
		font-size: 0.6875rem;
		cursor: pointer;
	}

	.manage-link:hover {
		background: var(--color-bg-secondary);
		color: var(--color-text);
	}

	@media (max-width: 480px) {
		.template-grid {
			grid-template-columns: 1fr;
		}
	}
</style>
