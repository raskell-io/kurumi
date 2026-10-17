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
		Settings2
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
	<p class="hint">Start writing, or begin from a template</p>

	<ul class="tpl-list">
		{#each userTemplates as template (template.id)}
			{@const Icon = templateIcon(template.name)}
			<li>
				<button type="button" class="tpl-row" onclick={() => handleTemplateSelect(template)}>
					<Icon class="tpl-icon h-4 w-4" />
					<span class="tpl-name">{template.name}</span>
					<span class="tpl-preview">{templatePreview(template.content)}</span>
				</button>
			</li>
		{/each}
		<li>
			<button type="button" class="tpl-row manage" onclick={handleManageTemplates}>
				<Settings2 class="tpl-icon h-4 w-4" />
				<span class="tpl-name">Manage templates</span>
			</button>
		</li>
	</ul>
</div>

<style>
	.inline-chooser {
		padding: 0.75rem 0 1rem;
		animation: fadeIn 150ms var(--ease-out);
	}

	.hint {
		margin: 0 0 0.375rem;
		font-size: 0.8125rem;
		color: var(--color-text-faint);
	}

	.tpl-list {
		display: flex;
		flex-direction: column;
		margin: 0 -0.5rem;
		padding: 0;
		list-style: none;
	}

	.tpl-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		min-height: 2rem;
		padding: 0.25rem 0.5rem;
		border-radius: var(--radius-sm);
		text-align: left;
		color: var(--color-text-muted);
		font-size: 0.875rem;
	}

	.tpl-row:hover,
	.tpl-row:focus-visible {
		background: var(--color-hover);
		color: var(--color-text);
		outline: none;
	}

	.tpl-row :global(.tpl-icon) {
		flex-shrink: 0;
		color: var(--color-text-faint);
	}

	.tpl-name {
		flex-shrink: 0;
	}

	.tpl-preview {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 0.75rem;
		color: var(--color-text-faint);
	}

	.manage {
		font-size: 0.8125rem;
		color: var(--color-text-faint);
	}

	@media (max-width: 480px) {
		.tpl-preview {
			display: none;
		}
	}
</style>
