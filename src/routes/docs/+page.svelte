<script lang="ts">
	import { Cloud, Shield, Smartphone, Wifi, Database, Lock } from 'lucide-svelte';
</script>

<svelte:head>
	<title>Documentation - Kurumi</title>
</svelte:head>

<article class="docs-article">
	<h1>Kurumi Documentation</h1>
	<p class="lead">
		Kurumi is a local-first, privacy-focused note-taking app with optional cross-device sync.
	</p>

	<section class="features">
		<div class="feature">
			<div class="feature-icon">
				<Database class="h-6 w-6" />
			</div>
			<h3>Local-First</h3>
			<p>Your notes are stored on your device first. Works offline, instant performance.</p>
		</div>

		<div class="feature">
			<div class="feature-icon">
				<Cloud class="h-6 w-6" />
			</div>
			<h3>Optional Sync</h3>
			<p>Sync across devices using your own Cloudflare account. You control the infrastructure.</p>
		</div>

		<div class="feature">
			<div class="feature-icon">
				<Lock class="h-6 w-6" />
			</div>
			<h3>Privacy-First</h3>
			<p>No analytics, no telemetry. We never see your data.</p>
		</div>

		<div class="feature">
			<div class="feature-icon">
				<Wifi class="h-6 w-6" />
			</div>
			<h3>Conflict-Free</h3>
			<p>Automerge CRDT handles concurrent edits automatically. No manual conflict resolution.</p>
		</div>
	</section>

	<h2>Getting Started</h2>

	<div class="cards">
		<a href="/docs/sync-setup" class="card">
			<Cloud class="h-5 w-5" />
			<div>
				<h4>Sync Setup</h4>
				<p>Set up cross-device sync with Cloudflare R2</p>
			</div>
		</a>

		<a href="/docs/architecture" class="card">
			<Shield class="h-5 w-5" />
			<div>
				<h4>Architecture</h4>
				<p>Learn how Kurumi keeps your data safe</p>
			</div>
		</a>
	</div>

	<h2>Quick Links</h2>
	<ul>
		<li><a href="https://github.com/raskell-io/kurumi" target="_blank" rel="noopener">GitHub Repository</a></li>
		<li><a href="/settings">Settings</a> - Configure sync and export data</li>
	</ul>
</article>

<style>
	.docs-article {
		color: var(--color-text);
	}

	h1 {
		font-size: 2.5rem;
		font-weight: 700;
		margin-bottom: 1rem;
	}

	.lead {
		font-size: 1.25rem;
		color: var(--color-text-muted);
		margin-bottom: 3rem;
	}

	h2 {
		font-size: 1.5rem;
		font-weight: 600;
		margin-top: 3rem;
		margin-bottom: 1.5rem;
	}

	.features {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
		gap: 1.5rem;
		margin-bottom: 2rem;
	}

	.feature {
		padding: 1.5rem;
		background: var(--color-bg-secondary);
		border-radius: 0.75rem;
		border: 1px solid var(--color-border);
	}

	.feature-icon {
		width: 3rem;
		height: 3rem;
		display: flex;
		align-items: center;
		justify-content: center;
		background: color-mix(in srgb, var(--color-accent) 15%, transparent);
		color: var(--color-accent);
		border-radius: 0.5rem;
		margin-bottom: 1rem;
	}

	.feature h3 {
		font-size: 1rem;
		font-weight: 600;
		margin-bottom: 0.5rem;
	}

	.feature p {
		font-size: 0.875rem;
		color: var(--color-text-muted);
		line-height: 1.5;
	}

	.cards {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.card {
		display: flex;
		align-items: flex-start;
		gap: 1rem;
		padding: 1.25rem;
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border);
		border-radius: 0.75rem;
		text-decoration: none;
		color: var(--color-text);
		transition: all 0.15s;
	}

	.card:hover {
		border-color: var(--color-accent);
		background: color-mix(in srgb, var(--color-accent) 5%, var(--color-bg-secondary));
	}

	.card h4 {
		font-weight: 600;
		margin-bottom: 0.25rem;
	}

	.card p {
		font-size: 0.875rem;
		color: var(--color-text-muted);
	}

	ul {
		list-style: disc;
		padding-left: 1.5rem;
	}

	li {
		margin-bottom: 0.5rem;
	}

	a {
		color: var(--color-accent);
	}
</style>
