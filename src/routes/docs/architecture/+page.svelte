<script lang="ts">
	import { Database, Cloud, Lock, Shield, Eye, EyeOff } from 'lucide-svelte';
</script>

<svelte:head>
	<title>Architecture - Kurumi</title>
</svelte:head>

<article class="docs-article">
	<h1>Local-First Architecture</h1>
	<p class="lead">
		Kurumi is built on local-first principles. Your data lives on your device, with optional sync to other devices you control.
	</p>

	<section>
		<h2>What is Local-First?</h2>
		<p>
			Local-first software keeps your data on your device first, with optional sync to other devices.
			This is the opposite of cloud-first apps where data lives on a server.
		</p>

		<div class="comparison">
			<div class="comparison-col">
				<h4>Cloud-First</h4>
				<ul>
					<li>Data on their servers</li>
					<li>Requires internet</li>
					<li>Provider controls access</li>
					<li>Network latency</li>
				</ul>
			</div>
			<div class="comparison-col highlight">
				<h4>Local-First (Kurumi)</h4>
				<ul>
					<li>Data on your device</li>
					<li>Works offline</li>
					<li>You control access</li>
					<li>Instant performance</li>
				</ul>
			</div>
		</div>
	</section>

	<section>
		<h2>How Data is Stored</h2>

		<h3>IndexedDB (Local)</h3>
		<p>All your notes, folders, and vaults are stored in your browser's IndexedDB:</p>
		<ul>
			<li>Persists across browser restarts</li>
			<li>Works completely offline</li>
			<li>Only accessible to Kurumi on your device</li>
			<li>Can be exported to JSON anytime</li>
		</ul>

		<h3>Automerge (CRDT)</h3>
		<p>
			Kurumi uses <a href="https://automerge.org" target="_blank" rel="noopener">Automerge</a>,
			a Conflict-free Replicated Data Type (CRDT) library. This enables sync without conflicts.
		</p>

		<div class="diagram">
			<div class="diagram-row">
				<div class="diagram-box">Device A edits title</div>
				<div class="diagram-box">Device B edits title</div>
			</div>
			<div class="diagram-arrow">↓ Sync ↓</div>
			<div class="diagram-result">
				Both changes preserved in history.<br>
				Deterministic resolution, no manual conflicts.
			</div>
		</div>
	</section>

	<section>
		<h2>Cross-Device Sync</h2>
		<p>When you click "Sync Now":</p>
		<ol>
			<li><strong>Pull:</strong> Download remote document from R2</li>
			<li><strong>Merge:</strong> Automerge combines changes (automatic)</li>
			<li><strong>Push:</strong> Upload merged document back to R2</li>
		</ol>
		<p>
			The sync is manual by design—you control when data leaves your device.
		</p>
	</section>

	<section>
		<h2>Security Model</h2>

		<h3>Data in Transit</h3>
		<div class="security-item">
			<Lock class="h-5 w-5" />
			<div>
				<strong>HTTPS/TLS encrypted</strong>
				<p>All sync traffic is encrypted between your device and Cloudflare.</p>
			</div>
		</div>

		<h3>Data at Rest</h3>
		<div class="security-item">
			<Shield class="h-5 w-5" />
			<div>
				<strong>Encrypted storage</strong>
				<p>Browser storage is managed by the browser. R2 data is encrypted by Cloudflare.</p>
			</div>
		</div>

		<h3>Authentication</h3>
		<div class="security-item">
			<Database class="h-5 w-5" />
			<div>
				<strong>Bearer token</strong>
				<p>Only requests with your token can read/write your data.</p>
			</div>
		</div>
	</section>

	<section>
		<h2>Privacy</h2>

		<div class="privacy-grid">
			<div class="privacy-item good">
				<EyeOff class="h-6 w-6" />
				<h4>What we see</h4>
				<p><strong>Nothing.</strong> No servers, no analytics, no telemetry. Kurumi is a static web app.</p>
			</div>

			<div class="privacy-item neutral">
				<Eye class="h-6 w-6" />
				<h4>What Cloudflare sees</h4>
				<p>If you use sync: Your R2 bucket contents (encrypted at rest). They cannot read your sync token.</p>
			</div>
		</div>
	</section>

	<section>
		<h2>Recommendations</h2>
		<ul>
			<li><strong>Use a strong sync token:</strong> Generate with <code>openssl rand -base64 32</code></li>
			<li><strong>Rotate tokens periodically:</strong> Update in both Worker and Kurumi</li>
			<li><strong>Secure your devices:</strong> Use device passwords/biometrics</li>
			<li><strong>Enable 2FA on Cloudflare:</strong> Protect your account</li>
			<li><strong>Export backups:</strong> Regularly export to JSON</li>
		</ul>
	</section>

	<section>
		<h2>Summary</h2>
		<div class="summary-grid">
			<div class="summary-item">
				<Database class="h-5 w-5" />
				<span>Your data is yours</span>
			</div>
			<div class="summary-item">
				<Cloud class="h-5 w-5" />
				<span>Sync is optional</span>
			</div>
			<div class="summary-item">
				<Shield class="h-5 w-5" />
				<span>You control infrastructure</span>
			</div>
			<div class="summary-item">
				<Lock class="h-5 w-5" />
				<span>No vendor lock-in</span>
			</div>
		</div>
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

	.comparison {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1rem;
		margin: 1.5rem 0;
	}

	.comparison-col {
		padding: 1.25rem;
		background: var(--color-bg-secondary);
		border-radius: 0.75rem;
		border: 1px solid var(--color-border);
	}

	.comparison-col.highlight {
		border-color: var(--color-accent);
		background: color-mix(in srgb, var(--color-accent) 5%, var(--color-bg-secondary));
	}

	.comparison-col h4 {
		font-weight: 600;
		margin-bottom: 0.75rem;
	}

	.comparison-col ul {
		list-style: none;
		padding: 0;
		margin: 0;
	}

	.comparison-col li {
		padding: 0.25rem 0;
		font-size: 0.9rem;
	}

	.diagram {
		background: var(--color-bg-secondary);
		padding: 1.5rem;
		border-radius: 0.75rem;
		text-align: center;
		margin: 1.5rem 0;
	}

	.diagram-row {
		display: flex;
		justify-content: center;
		gap: 2rem;
	}

	.diagram-box {
		padding: 0.75rem 1.25rem;
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 0.5rem;
		font-size: 0.875rem;
	}

	.diagram-arrow {
		padding: 1rem;
		color: var(--color-text-muted);
	}

	.diagram-result {
		padding: 1rem;
		background: color-mix(in srgb, #22c55e 10%, transparent);
		border-radius: 0.5rem;
		color: #22c55e;
		font-size: 0.9rem;
	}

	.security-item {
		display: flex;
		gap: 1rem;
		padding: 1rem;
		background: var(--color-bg-secondary);
		border-radius: 0.5rem;
		margin-bottom: 0.75rem;
	}

	.security-item :global(svg) {
		color: var(--color-accent);
		flex-shrink: 0;
		margin-top: 0.25rem;
	}

	.security-item strong {
		display: block;
		margin-bottom: 0.25rem;
	}

	.security-item p {
		font-size: 0.875rem;
		color: var(--color-text-muted);
		margin: 0;
	}

	.privacy-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
		gap: 1rem;
		margin: 1.5rem 0;
	}

	.privacy-item {
		padding: 1.5rem;
		border-radius: 0.75rem;
		text-align: center;
	}

	.privacy-item.good {
		background: color-mix(in srgb, #22c55e 10%, transparent);
		border: 1px solid color-mix(in srgb, #22c55e 30%, transparent);
	}

	.privacy-item.good :global(svg) {
		color: #22c55e;
	}

	.privacy-item.neutral {
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border);
	}

	.privacy-item.neutral :global(svg) {
		color: var(--color-text-muted);
	}

	.privacy-item :global(svg) {
		margin-bottom: 0.75rem;
	}

	.privacy-item h4 {
		font-weight: 600;
		margin-bottom: 0.5rem;
	}

	.privacy-item p {
		font-size: 0.875rem;
		color: var(--color-text-muted);
		margin: 0;
	}

	.summary-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
		gap: 1rem;
		margin-top: 1.5rem;
	}

	.summary-item {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 1rem;
		background: var(--color-bg-secondary);
		border-radius: 0.5rem;
		font-size: 0.9rem;
		font-weight: 500;
	}

	.summary-item :global(svg) {
		color: var(--color-accent);
		flex-shrink: 0;
	}

	@media (max-width: 640px) {
		.comparison {
			grid-template-columns: 1fr;
		}

		.diagram-row {
			flex-direction: column;
			gap: 1rem;
		}
	}
</style>
