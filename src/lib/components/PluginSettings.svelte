<script lang="ts">
	/**
	 * Settings → Plugins: install from a URL or file (after approving what the
	 * plugin may do), turn off, remove. $lib/plugins/host.ts runs them.
	 */
	import { onMount } from 'svelte';
	import { installedPlugins, startPlugins, inspectPlugin, fetchPlugin, installPlugin, setPluginEnabled, removePlugin } from '$lib/plugins/host';
	import { PERMISSIONS, type PluginManifest } from '$lib/plugins/manifest';
	import { ShieldCheck, Trash2 } from 'lucide-svelte';

	let url = $state('');
	let busy = $state(false);
	let error = $state<string | null>(null);
	// A plugin read but not installed yet: waiting for the user's approval.
	let pending = $state<{ manifest: PluginManifest; code: string; source: string; update: boolean } | null>(null);

	onMount(() => void startPlugins());

	async function review(load: () => Promise<{ code: string; source: string }>) {
		error = null;
		busy = true;
		try {
			const { code, source } = await load();
			const manifest = inspectPlugin(code);
			pending = { manifest, code, source, update: $installedPlugins.some((p) => p.manifest.id === manifest.id) };
		} catch (err) {
			error = err instanceof Error ? err.message : 'Could not read the plugin';
		} finally {
			busy = false;
		}
	}

	const fromUrl = () => review(async () => ({ code: await fetchPlugin(url.trim()), source: url.trim() }));
	const example = () => review(async () => ({ code: await fetchPlugin('/plugins/note-tools.js'), source: 'Kurumi example' }));

	function fromFile(event: Event) {
		const file = (event.target as HTMLInputElement).files?.[0];
		(event.target as HTMLInputElement).value = '';
		if (file) void review(async () => ({ code: await file.text(), source: file.name }));
	}

	async function approve() {
		if (!pending) return;
		await installPlugin(pending.code, pending.source);
		pending = null;
		url = '';
	}
</script>

<section id="plugins" class="set-section" aria-labelledby="plugins-title">
	<h2 id="plugins-title" class="set-section-title">Plugins</h2>
	<p class="set-section-desc">
		Small programs that add commands to ⌘K. Each runs in a sandbox: it can't see the page, your other data or
		the internet, only what you allow below. Installed on this device.
	</p>

	{#if pending}
		<div class="approve" role="dialog" aria-label="Install plugin">
			<p class="title"><ShieldCheck class="h-4 w-4 text-[var(--color-accent)]" /> {pending.update ? 'Update' : 'Install'} “{pending.manifest.name}” {pending.manifest.version}?</p>
			{#if pending.manifest.description}<p class="desc">{pending.manifest.description}</p>{/if}
			<p class="desc">From {pending.source}{pending.manifest.author ? ` · by ${pending.manifest.author}` : ''}</p>
			<p class="label">It will be able to:</p>
			<ul>
				<li>Add commands to ⌘K and show short messages</li>
				{#each pending.manifest.permissions as permission (permission)}
					<li><strong>{PERMISSIONS[permission]}</strong></li>
				{/each}
			</ul>
			<p class="desc">It can't use the network. Only install plugins you trust with these.</p>
			<div class="actions">
				<button type="button" class="k-btn k-btn-ghost k-btn-sm" onclick={() => (pending = null)}>Cancel</button>
				<button type="button" class="k-btn k-btn-primary k-btn-sm" onclick={approve}>{pending.update ? 'Update' : 'Install'}</button>
			</div>
		</div>
	{/if}

	<div class="set-rows">
		{#each $installedPlugins as plugin (plugin.manifest.id)}
			<div class="set-row">
				<div class="set-row-text">
					<div class="set-row-label">{plugin.manifest.name} <span class="version">{plugin.manifest.version}</span></div>
					<p class="set-row-help">
						{plugin.manifest.description}
						<br />Can: {['commands', ...plugin.manifest.permissions.map((p) => PERMISSIONS[p].toLowerCase())].join(', ')} · from {plugin.source}
					</p>
				</div>
				<div class="flex items-center gap-2">
					<input
						type="checkbox"
						class="switch-input"
						checked={plugin.enabled}
						onchange={(e) => setPluginEnabled(plugin.manifest.id, (e.target as HTMLInputElement).checked)}
						aria-label="Turn {plugin.manifest.name} on or off"
					/>
					<button type="button" class="k-icon-btn danger" onclick={() => removePlugin(plugin.manifest.id)} aria-label="Remove {plugin.manifest.name}" title="Remove">
						<Trash2 class="h-3.5 w-3.5" />
					</button>
				</div>
			</div>
		{/each}

		<div class="set-row">
			<div class="set-row-text">
				<label class="set-row-label" for="plugin-url">Install a plugin</label>
				<p class="set-row-help">A link to a plugin's <code>.js</code> file, or the file itself. <a href="https://github.com/raskell-io/kurumi/blob/main/docs/plugins.md" target="_blank" rel="noopener noreferrer">Writing plugins</a></p>
			</div>
			<form class="install" onsubmit={(e) => { e.preventDefault(); if (url.trim()) void fromUrl(); }}>
				<input id="plugin-url" class="k-input sm:!w-64" type="url" bind:value={url} placeholder="https://…/plugin.js" />
				<button class="k-btn k-btn-sm" disabled={busy || !url.trim()}>Review</button>
			</form>
		</div>
		<div class="set-row">
			<div class="set-row-text"><div class="set-row-label">Or</div></div>
			<div class="flex flex-wrap items-center gap-2">
				<label class="k-btn k-btn-sm">From a file…<input type="file" accept=".js,text/javascript" class="sr-only" onchange={fromFile} /></label>
				<button type="button" class="k-btn k-btn-sm" onclick={example} disabled={busy}>Try the example</button>
			</div>
		</div>
	</div>
	{#if error}<p class="error" role="alert">{error}</p>{/if}
</section>

<style>
	.approve {
		margin-bottom: 1rem;
		padding: 0.75rem;
		border: 1px solid color-mix(in srgb, var(--color-accent) 40%, var(--color-border));
		border-radius: var(--radius-md);
		background: color-mix(in srgb, var(--color-accent) 5%, var(--color-bg));
		font-size: 0.8125rem;
	}

	.title {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		font-weight: 600;
		color: var(--color-text);
	}

	.desc {
		margin-top: 0.25rem;
		color: var(--color-text-muted);
	}

	.label {
		margin-top: 0.5rem;
		color: var(--color-text-muted);
	}

	ul {
		margin: 0.25rem 0 0 1.25rem;
		list-style: disc;
		color: var(--color-text);
	}

	.actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.375rem;
		margin-top: 0.5rem;
	}

	.version {
		margin-left: 0.25rem;
		font-weight: 400;
		color: var(--color-text-faint);
	}

	.install {
		display: flex;
		gap: 0.375rem;
	}

	.switch-input {
		accent-color: var(--color-accent);
	}

	.error {
		margin-top: 0.5rem;
		font-size: 0.8125rem;
		color: var(--color-danger);
	}
</style>
