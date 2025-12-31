<script lang="ts">
	import { CheckCircle, ExternalLink } from 'lucide-svelte';
</script>

<svelte:head>
	<title>Sync Setup - Kurumi</title>
</svelte:head>

<article class="docs-article">
	<h1>Cloudflare R2 Sync Setup</h1>
	<p class="lead">
		Set up cross-device sync using Cloudflare Workers and R2 storage. Free tier is more than enough for personal use.
	</p>

	<section class="prereqs">
		<h2>Prerequisites</h2>
		<ul class="checklist">
			<li>
				<CheckCircle class="h-4 w-4" />
				<span>A <a href="https://dash.cloudflare.com/sign-up" target="_blank" rel="noopener">Cloudflare account</a> (free)</span>
			</li>
			<li>
				<CheckCircle class="h-4 w-4" />
				<span><a href="https://mise.jdx.dev/" target="_blank" rel="noopener">mise</a> installed (<code>brew install mise</code>)</span>
			</li>
		</ul>
	</section>

	<section>
		<h2>Step 1: Enable R2</h2>
		<ol>
			<li>Go to <a href="https://dash.cloudflare.com" target="_blank" rel="noopener">Cloudflare Dashboard</a></li>
			<li>Click <strong>R2 Object Storage</strong> in the sidebar</li>
			<li>Click <strong>Get Started</strong> or <strong>Activate R2</strong></li>
			<li>Accept the terms (no credit card required for free tier)</li>
		</ol>
	</section>

	<section>
		<h2>Step 2: Deploy the Worker</h2>
		<p>Clone the repo and run the setup command:</p>
		<pre><code>git clone https://github.com/raskell-io/kurumi.git
cd kurumi/worker
mise run setup</code></pre>

		<p>This will:</p>
		<ol>
			<li>Install dependencies</li>
			<li>Log you into Cloudflare (opens browser)</li>
			<li>Create the R2 bucket</li>
			<li>Generate a sync token (save this!)</li>
			<li>Deploy the worker</li>
		</ol>

		<div class="note">
			<strong>Note:</strong> If the browser login fails, use an API token instead:
			<ol>
				<li>Create a token at <a href="https://dash.cloudflare.com/profile/api-tokens" target="_blank" rel="noopener">Cloudflare API Tokens</a></li>
				<li>Use the "Edit Cloudflare Workers" template</li>
				<li>Run: <code>export CLOUDFLARE_API_TOKEN="your-token"</code></li>
				<li>Then run the individual commands: <code>mise run bucket && mise run token && mise run secret && mise run deploy</code></li>
			</ol>
		</div>
	</section>

	<section>
		<h2>Step 3: Configure Kurumi</h2>
		<ol>
			<li>Go to <a href="/settings">Settings</a></li>
			<li>In <strong>Cloudflare Sync</strong>:
				<ul>
					<li><strong>Sync Worker URL:</strong> <code>https://kurumi-sync.your-subdomain.workers.dev/sync</code></li>
					<li><strong>Sync Token:</strong> The token from Step 2</li>
				</ul>
			</li>
			<li>Click <strong>Save Settings</strong></li>
			<li>Click <strong>Test Connection</strong></li>
			<li>Click <strong>Sync Now</strong></li>
		</ol>
	</section>

	<section>
		<h2>Usage</h2>
		<h3>Manual Sync</h3>
		<p>Click <strong>Sync Now</strong> in Settings whenever you want to sync changes.</p>

		<h3>Multiple Devices</h3>
		<ol>
			<li>Set up Kurumi on each device with the same Worker URL and token</li>
			<li>Sync on Device A after making changes</li>
			<li>Sync on Device B to receive those changes</li>
			<li>Edits on both devices merge automatically</li>
		</ol>
	</section>

	<section>
		<h2>Troubleshooting</h2>

		<h3>"Connection failed"</h3>
		<ul>
			<li>Verify your Worker URL ends with <code>/sync</code></li>
			<li>Check the Worker is deployed: <code>mise run tail</code> in the worker directory</li>
		</ul>

		<h3>"Invalid authentication token"</h3>
		<ul>
			<li>The token must match exactly between Kurumi and the Worker secret</li>
			<li>Re-set the secret: <code>mise run secret</code></li>
		</ul>
	</section>

	<section>
		<h2>Cost</h2>
		<p>Cloudflare's free tier includes:</p>
		<ul>
			<li><strong>Workers:</strong> 100,000 requests/day</li>
			<li><strong>R2:</strong> 10 GB storage, 10M reads/month, 1M writes/month</li>
		</ul>
		<p>For personal use, you'll likely never exceed these limits.</p>
	</section>
</article>

<style>
	.docs-article {
		color: var(--color-text);
		line-height: 1.7;
	}

	h1 {
		font-size: 2rem;
		font-weight: 700;
		margin-bottom: 1rem;
	}

	.lead {
		font-size: 1.125rem;
		color: var(--color-text-muted);
		margin-bottom: 2rem;
	}

	h2 {
		font-size: 1.25rem;
		font-weight: 600;
		margin-top: 2.5rem;
		margin-bottom: 1rem;
		padding-bottom: 0.5rem;
		border-bottom: 1px solid var(--color-border);
	}

	h3 {
		font-size: 1rem;
		font-weight: 600;
		margin-top: 1.5rem;
		margin-bottom: 0.75rem;
	}

	p {
		margin-bottom: 1rem;
	}

	ol, ul {
		margin-bottom: 1rem;
		padding-left: 1.5rem;
	}

	li {
		margin-bottom: 0.5rem;
	}

	ol {
		list-style: decimal;
	}

	ul {
		list-style: disc;
	}

	ul ul {
		margin-top: 0.5rem;
		margin-bottom: 0;
	}

	a {
		color: var(--color-accent);
	}

	code {
		background: var(--color-bg-secondary);
		padding: 0.2em 0.4em;
		border-radius: 0.25rem;
		font-size: 0.9em;
		font-family: 'SF Mono', 'Fira Code', monospace;
	}

	pre {
		background: var(--color-bg-secondary);
		padding: 1rem;
		border-radius: 0.5rem;
		overflow-x: auto;
		margin-bottom: 1rem;
	}

	pre code {
		background: none;
		padding: 0;
	}

	.checklist {
		list-style: none;
		padding-left: 0;
	}

	.checklist li {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		color: var(--color-text);
	}

	.checklist li :global(svg) {
		color: #22c55e;
		flex-shrink: 0;
	}

	.note {
		background: color-mix(in srgb, var(--color-accent) 10%, transparent);
		border-left: 3px solid var(--color-accent);
		padding: 1rem 1.25rem;
		border-radius: 0 0.5rem 0.5rem 0;
		margin: 1.5rem 0;
	}

	.note strong {
		color: var(--color-accent);
	}

	.note ol {
		margin-top: 0.75rem;
		margin-bottom: 0;
	}

	section {
		margin-bottom: 1rem;
	}

	.prereqs {
		background: var(--color-bg-secondary);
		padding: 1.5rem;
		border-radius: 0.75rem;
		margin-bottom: 2rem;
	}

	.prereqs h2 {
		margin-top: 0;
		border: none;
		padding: 0;
	}
</style>
