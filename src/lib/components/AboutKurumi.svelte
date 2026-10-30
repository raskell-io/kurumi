<script lang="ts">
	import { bindingsFor, formatCombo, shortcutOverrides, type ShortcutId } from '$lib/shortcuts';
	import {
		PenLine,
		Mic,
		Search,
		ListTodo,
		FolderTree,
		RefreshCw,
		Cpu,
		WifiOff,
		Check,
		ArrowRight
	} from 'lucide-svelte';

	// Settings → About: what Kurumi is and why you'd use it.

	const loop = [
		{
			title: 'Capture',
			text: 'Type it, say it, or record the meeting. Saving a thought takes one shortcut, not a filing decision.'
		},
		{
			title: 'Process',
			text: 'Transcripts, summaries, people, projects and follow-ups are pulled out for you, on your device where possible.'
		},
		{
			title: 'Surface',
			text: 'Due items, reminders and related notes come back when they matter: in your daily note, To-dos and Ask Kurumi.'
		},
		{
			title: 'Own',
			text: 'Plain markdown, a database that merges across devices, and sync through storage you control.'
		}
	];

	const features = [
		{ icon: PenLine, title: 'Write fast', text: 'A markdown editor with [[links]], draggable blocks, templates and daily notes.' },
		{ icon: Mic, title: 'Capture by voice', text: 'Voice memos and meeting recordings, transcribed and summarised.' },
		{ icon: Search, title: 'Find anything', text: 'Instant search, search by meaning, and Ask Kurumi: answers from your notes, with citations.' },
		{ icon: ListTodo, title: 'Act on it', text: 'To-dos on a list or board, plus reminders and email drafts proposed from your notes.' },
		{ icon: FolderTree, title: 'Organise loosely', text: 'Vaults, folders, favorites, tags, people, and a graph of how notes connect.' },
		{ icon: RefreshCw, title: 'Sync your way', text: 'A GitHub repo via the local agent, a local folder, S3, R2, WebDAV or Azure.' },
		{ icon: Cpu, title: 'Private AI', text: 'On-device models for transcription, search and summaries. A remote model only if you add a key.' },
		{ icon: WifiOff, title: 'Works offline', text: 'Install it as an app. Everything works without a connection.' }
	];

	const reasons = [
		{ title: 'No account, no Kurumi server.', text: 'Your notes live in your browser and in storage you choose. Nothing passes through us.' },
		{ title: 'Never locked in.', text: 'Export to Markdown (also for Obsidian, Hugo, Zola) or a full backup any time. Import from Obsidian, Roam or Evernote.' },
		{ title: 'An assistant that proposes.', text: 'Reminders and drafts wait for your approval. Nothing is sent or scheduled on your behalf.' },
		{ title: 'Ready for work.', text: 'Meetings, to-dos and separate vaults, synced to your company GitHub with your own credentials.' }
	];

	const tips: { id: ShortcutId; label: string }[] = [
		{ id: 'newNote', label: 'New note' },
		{ id: 'search', label: 'Search everything' },
		{ id: 'dailyNote', label: "Today's note" },
		{ id: 'quickSwitcher', label: 'Jump to a recent note' },
		{ id: 'voice', label: 'Talk to Kurumi' }
	];

	// Current bindings, so rebound shortcuts show correctly.
	const comboFor = (id: ShortcutId) => {
		const combo = bindingsFor(id, $shortcutOverrides)[0];
		return combo ? formatCombo(combo) : null;
	};
</script>

<div class="about">
	<!-- Hero -->
	<div class="about-hero">
		<img src="/icon-192.avif" alt="" class="about-logo" />
		<p class="about-kicker">クルミ · walnut, because it looks like a brain</p>
		<h3 class="about-headline">Offload a thought in seconds.<br />Find it again when it matters.</h3>
		<p class="about-lede">
			Kurumi is a local-first second brain for notes, voice memos, meetings and tasks. It runs in your
			browser, works offline, and keeps everything on your device, synced through storage you own.
		</p>
		<div class="about-actions">
			<a href="/daily" class="k-btn k-btn-primary no-underline">Open today's note <ArrowRight class="h-4 w-4" /></a>
			<a href="/settings/sync" class="k-btn no-underline">Set up sync</a>
		</div>
	</div>

	<!-- How it works -->
	<h4 class="about-heading">How it works</h4>
	<ol class="about-loop">
		{#each loop as step, i (step.title)}
			<li>
				<span class="about-step">{i + 1}</span>
				<div>
					<div class="about-card-title">{step.title}</div>
					<p>{step.text}</p>
				</div>
			</li>
		{/each}
	</ol>

	<!-- What you can do -->
	<h4 class="about-heading">What you can do</h4>
	<div class="about-grid">
		{#each features as feature (feature.title)}
			{@const Icon = feature.icon}
			<div class="about-card">
				<Icon class="about-icon" />
				<div class="about-card-title">{feature.title}</div>
				<p>{feature.text}</p>
			</div>
		{/each}
	</div>

	<!-- Why -->
	<h4 class="about-heading">Why Kurumi</h4>
	<ul class="about-reasons">
		{#each reasons as reason (reason.title)}
			<li>
				<Check class="about-check" />
				<p><strong>{reason.title}</strong> {reason.text}</p>
			</li>
		{/each}
	</ul>

	<!-- Quick start -->
	<h4 class="about-heading">Get going</h4>
	<ul class="about-tips">
		{#each tips as tip (tip.id)}
			{@const combo = comboFor(tip.id)}
			{#if combo}
				<li><span>{tip.label}</span><span class="k-kbd">{combo}</span></li>
			{/if}
		{/each}
		<li><span>Format with <code>/</code>, link with <code>[[</code>, mention with <code>@</code></span></li>
	</ul>
</div>

<style>
	.about {
		display: flex;
		flex-direction: column;
	}

	.about-hero {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.5rem;
		padding: 0 0 1.5rem;
		border-bottom: 1px solid var(--color-border);
	}

	.about-logo {
		width: 3.5rem;
		height: 3.5rem;
		border-radius: 0.875rem;
		margin-bottom: 0.5rem;
	}

	.about-kicker {
		font-size: 0.75rem;
		letter-spacing: 0.02em;
		color: var(--color-text-faint);
	}

	.about-headline {
		font-size: clamp(1.5rem, 3.2vw, 2rem);
		font-weight: 700;
		line-height: 1.2;
		letter-spacing: -0.01em;
		color: var(--color-text);
	}

	.about-lede {
		max-width: 36rem;
		font-size: 0.9375rem;
		line-height: 1.6;
		color: var(--color-text-muted);
	}

	.about-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-top: 0.75rem;
	}

	.about-heading {
		margin: 2rem 0 0.75rem;
		font-size: 0.75rem;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--color-text-faint);
	}

	.about-loop {
		display: grid;
		gap: 0.75rem;
	}

	.about-loop li {
		display: flex;
		gap: 0.75rem;
	}

	.about-step {
		display: flex;
		width: 1.75rem;
		height: 1.75rem;
		flex-shrink: 0;
		align-items: center;
		justify-content: center;
		border-radius: 999px;
		background: var(--color-accent-soft);
		color: var(--color-accent);
		font-size: 0.8125rem;
		font-weight: 600;
	}

	.about-card-title {
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--color-text);
	}

	.about-loop p,
	.about-card p {
		margin-top: 0.125rem;
		font-size: 0.8125rem;
		line-height: 1.55;
		color: var(--color-text-muted);
	}

	.about-grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: 0.625rem;
	}

	@media (min-width: 560px) {
		.about-grid {
			grid-template-columns: repeat(2, 1fr);
		}
	}

	.about-card {
		padding: 0.875rem 1rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg, 10px);
		background: var(--color-bg-secondary);
	}

	.about-card :global(.about-icon) {
		width: 1.125rem;
		height: 1.125rem;
		margin-bottom: 0.5rem;
		color: var(--color-accent);
	}

	.about-reasons {
		display: grid;
		gap: 0.625rem;
	}

	.about-reasons li {
		display: flex;
		gap: 0.625rem;
		font-size: 0.875rem;
		line-height: 1.55;
		color: var(--color-text-muted);
	}

	.about-reasons strong {
		color: var(--color-text);
		font-weight: 600;
	}

	.about-reasons :global(.about-check) {
		width: 1rem;
		height: 1rem;
		margin-top: 0.2rem;
		flex-shrink: 0;
		color: var(--color-accent);
	}

	.about-tips {
		display: grid;
		gap: 0.375rem;
		font-size: 0.875rem;
		color: var(--color-text-muted);
	}

	.about-tips li {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.375rem 0;
		border-bottom: 1px solid var(--color-border);
	}
</style>
