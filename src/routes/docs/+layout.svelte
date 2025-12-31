<script lang="ts">
	import { page } from '$app/stores';
	import { Book, Cloud, Shield, ArrowLeft } from 'lucide-svelte';

	const navItems = [
		{ href: '/docs', label: 'Overview', icon: Book },
		{ href: '/docs/sync-setup', label: 'Sync Setup', icon: Cloud },
		{ href: '/docs/architecture', label: 'Architecture', icon: Shield }
	];

	let currentPath = $derived($page.url.pathname);
</script>

<div class="docs-layout">
	<aside class="docs-sidebar">
		<a href="/" class="back-link">
			<ArrowLeft class="h-4 w-4" />
			Back to App
		</a>

		<nav class="docs-nav">
			<h2>Documentation</h2>
			{#each navItems as item}
				<a
					href={item.href}
					class="nav-item"
					class:active={currentPath === item.href}
				>
					<svelte:component this={item.icon} class="h-4 w-4" />
					{item.label}
				</a>
			{/each}
		</nav>
	</aside>

	<main class="docs-content">
		<slot />
	</main>
</div>

<style>
	.docs-layout {
		display: flex;
		min-height: 100dvh;
		background: var(--color-bg);
	}

	.docs-sidebar {
		width: 250px;
		padding: 1.5rem;
		border-right: 1px solid var(--color-border);
		background: var(--color-bg-secondary);
		position: sticky;
		top: 0;
		height: 100dvh;
		overflow-y: auto;
	}

	.back-link {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		color: var(--color-text-muted);
		text-decoration: none;
		font-size: 0.875rem;
		margin-bottom: 2rem;
		transition: color 0.15s;
	}

	.back-link:hover {
		color: var(--color-accent);
	}

	.docs-nav h2 {
		font-size: 0.75rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-text-muted);
		margin-bottom: 1rem;
	}

	.nav-item {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.75rem 1rem;
		color: var(--color-text);
		text-decoration: none;
		border-radius: 0.5rem;
		margin-bottom: 0.25rem;
		transition: all 0.15s;
	}

	.nav-item:hover {
		background: var(--color-border);
	}

	.nav-item.active {
		background: color-mix(in srgb, var(--color-accent) 15%, transparent);
		color: var(--color-accent);
	}

	.docs-content {
		flex: 1;
		padding: 2rem 3rem;
		max-width: 800px;
		margin: 0 auto;
		overflow-y: auto;
		-webkit-overflow-scrolling: touch;
	}

	@media (max-width: 768px) {
		.docs-layout {
			flex-direction: column;
		}

		.docs-sidebar {
			width: 100%;
			height: auto;
			position: relative;
			border-right: none;
			border-bottom: 1px solid var(--color-border);
		}

		.docs-nav {
			display: flex;
			gap: 0.5rem;
			flex-wrap: wrap;
		}

		.docs-nav h2 {
			width: 100%;
		}

		.docs-content {
			padding: 1.5rem;
		}
	}
</style>
