<script lang="ts">
	import { goto } from '$app/navigation';
	import { vaults, setCurrentVault } from '$lib/db';
	import { createExampleVault, EXAMPLE_VAULT_NAME } from '$lib/example-vault';
	import { bindingsFor, formatCombo, shortcutOverrides, type ShortcutId } from '$lib/shortcuts';
	import { isTauri } from '$lib/desktop';
	import { detectDesktopOS } from '$lib/desktop/release';
	import { ArrowRight, Mic, Sparkles, ListTodo, HardDrive, FileText, Cpu, Globe, Smartphone, Monitor } from 'lucide-svelte';

	// Settings → About: a landing page. What Kurumi is for, why it's
	// different, and where to get it. The feature-by-feature tour is in docs/.

	const desktop = isTauri();
	const desktopOS = detectDesktopOS();
	const osName = { mac: 'Mac', windows: 'Windows', linux: 'Linux' } as const;

	const stories = [
		{
			icon: Mic,
			kicker: 'Capture',
			title: 'Say it, type it, record the meeting.',
			text: 'One shortcut opens a note. Voice memos and meetings come back as transcripts with a summary, the people involved and what was agreed. No filing decision up front.'
		},
		{
			icon: Sparkles,
			kicker: 'Recall',
			title: 'Ask, and get the answer with its sources.',
			text: 'Search by word or by meaning, or ask Kurumi a question in plain language. Answers quote your own notes, so you can check them.'
		},
		{
			icon: ListTodo,
			kicker: 'Act',
			title: 'Follow-ups find you.',
			text: 'To-dos, reminders and email drafts are proposed from what you wrote. You approve them; due ones show up in your daily note and as notifications.'
		}
	];

	const promises = [
		{ icon: HardDrive, title: 'On your device', text: 'No account and no Kurumi server. Sync goes through storage you pick: a folder, a git repo, your own cloud.' },
		{ icon: FileText, title: 'Plain markdown', text: 'Every note is a markdown file you can read anywhere. Export it all, or the whole vault as a backup, any time.' },
		{ icon: Cpu, title: 'Private AI', text: 'Transcription, search and summaries run on your device. A remote model is used only if you add a key.' }
	];

	const tips: { id: ShortcutId; label: string }[] = [
		{ id: 'newNote', label: 'New note' },
		{ id: 'search', label: 'Search everything' },
		{ id: 'dailyNote', label: "Today's note" },
		{ id: 'voice', label: 'Talk to Kurumi' }
	];

	// Current bindings, so rebound shortcuts show correctly.
	const comboFor = (id: ShortcutId) => {
		const combo = bindingsFor(id, $shortcutOverrides)[0];
		return combo ? formatCombo(combo) : null;
	};

	function exploreExample() {
		const existing = $vaults.find((v) => v.name === EXAMPLE_VAULT_NAME);
		if (existing) {
			setCurrentVault(existing.id);
			goto('/');
		} else {
			goto(`/memory/${createExampleVault()}`);
		}
	}

	let shotFailed = $state(false);
</script>

<div class="landing">
	<header class="hero">
		<img src="/icon-192.avif" alt="" class="hero-logo" />
		<p class="hero-kicker">Kurumi · クルミ, walnut, because it looks like a brain</p>
		<h3 class="hero-title">Offload a thought in seconds.<br />Find it again when it matters.</h3>
		<p class="hero-lede">
			A second brain for notes, voice memos and meetings that lives on your device, works offline and
			keeps your data in plain files you own.
		</p>
		<div class="hero-actions">
			{#if desktop || !desktopOS}
				<a href="/daily" class="k-btn k-btn-primary no-underline">Open today's note <ArrowRight class="h-4 w-4" /></a>
			{:else}
				<a href="/settings/desktop" class="k-btn k-btn-primary no-underline">
					Get Kurumi for {osName[desktopOS]} <ArrowRight class="h-4 w-4" />
				</a>
			{/if}
			<button type="button" class="k-btn" onclick={exploreExample}>Explore an example</button>
		</div>
		<ul class="hero-facts" aria-label="At a glance">
			<li>Free and open source</li>
			<li>No account</li>
			<li>Works offline</li>
		</ul>
	</header>

	{#if !shotFailed}
		<figure class="shot">
			<img
				class="shot-light"
				src="/about/note.webp"
				alt="A note open in Kurumi, with the sidebar of to-dos, projects and meetings"
				loading="lazy"
				width="2880"
				height="1800"
				onerror={() => (shotFailed = true)}
			/>
			<img
				class="shot-dark"
				src="/about/note-dark.webp"
				alt=""
				loading="lazy"
				width="2880"
				height="1800"
				onerror={() => (shotFailed = true)}
			/>
		</figure>
	{/if}

	<section class="stories" aria-label="What it does">
		{#each stories as story (story.kicker)}
			{@const Icon = story.icon}
			<article class="story">
				<div class="story-icon"><Icon class="h-5 w-5" /></div>
				<p class="story-kicker">{story.kicker}</p>
				<h4 class="story-title">{story.title}</h4>
				<p class="story-text">{story.text}</p>
			</article>
		{/each}
	</section>

	<section class="band" aria-labelledby="about-yours">
		<h4 id="about-yours" class="band-title">Your notes stay yours.</h4>
		<p class="band-lede">Kurumi is a static app. There is nothing on our side to sign up for, pay for or shut down.</p>
		<div class="promises">
			{#each promises as promise (promise.title)}
				{@const Icon = promise.icon}
				<div class="promise">
					<Icon class="promise-icon" />
					<div class="promise-title">{promise.title}</div>
					<p>{promise.text}</p>
				</div>
			{/each}
		</div>
	</section>

	<section aria-labelledby="about-everywhere">
		<h4 id="about-everywhere" class="section-title">Wherever you work</h4>
		<div class="places">
			<div class="place">
				<Globe class="place-icon" />
				<div class="place-title">In the browser</div>
				<p>Open <a href="https://kurumi.raskell.io" target="_blank" rel="noopener">kurumi.raskell.io</a>; nothing to install.</p>
			</div>
			<div class="place">
				<Smartphone class="place-icon" />
				<div class="place-title">On your phone</div>
				<p>Add it to the home screen. It starts offline like any app.</p>
			</div>
			<a href="/settings/desktop" class="place place-link no-underline">
				<Monitor class="place-icon" />
				<div class="place-title">On the desktop {#if desktop}<span class="k-badge">You're here</span>{/if}</div>
				<p>An app for Mac, Windows and Linux, with folder sync built in.</p>
			</a>
		</div>
		<p class="places-note">Sync keeps them in step. See <a href="/settings/sync">Settings → Sync</a>.</p>
	</section>

	<section aria-labelledby="about-start">
		<h4 id="about-start" class="section-title">First steps</h4>
		<ul class="tips">
			{#each tips as tip (tip.id)}
				{@const combo = comboFor(tip.id)}
				{#if combo}
					<li><span>{tip.label}</span><span class="k-kbd">{combo}</span></li>
				{/if}
			{/each}
			<li><span>Format with <code>/</code>, link with <code>[[</code>, mention with <code>@</code></span></li>
		</ul>
	</section>
</div>

<style>
	.landing {
		display: flex;
		flex-direction: column;
		gap: 2.75rem;
	}

	/* Hero */
	.hero {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: 0.625rem;
		padding-top: 1rem;
	}

	.hero-logo {
		width: 4rem;
		height: 4rem;
		border-radius: 1rem;
		margin-bottom: 0.25rem;
		box-shadow: var(--shadow-md);
	}

	.hero-kicker {
		font-size: 0.75rem;
		letter-spacing: 0.02em;
		color: var(--color-text-faint);
	}

	.hero-title {
		font-size: clamp(1.75rem, 4.5vw, 2.625rem);
		font-weight: 700;
		line-height: 1.12;
		letter-spacing: -0.02em;
		color: var(--color-text);
		text-wrap: balance;
	}

	.hero-lede {
		max-width: 34rem;
		font-size: 1rem;
		line-height: 1.6;
		color: var(--color-text-muted);
		text-wrap: pretty;
	}

	.hero-actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 0.5rem;
		margin-top: 0.75rem;
	}

	.hero-facts {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 0.25rem 1.25rem;
		margin-top: 0.5rem;
		font-size: 0.75rem;
		color: var(--color-text-faint);
	}

	.hero-facts li::before {
		content: '✓ ';
		color: var(--color-accent);
	}

	/* Product shot: light or dark to match the app's theme */
	.shot {
		margin: -0.5rem 0 0;
		overflow: hidden;
		border: 1px solid var(--color-border);
		border-radius: 12px;
		box-shadow: var(--shadow-lg);
	}

	.shot img {
		display: block;
		width: 100%;
		height: auto;
	}

	.shot-dark {
		display: none !important;
	}

	:global(:root.dark) .shot-light {
		display: none !important;
	}

	:global(:root.dark) .shot-dark {
		display: block !important;
	}

	@media (prefers-color-scheme: dark) {
		:global(:root:not(.light)) .shot-light {
			display: none !important;
		}

		:global(:root:not(.light)) .shot-dark {
			display: block !important;
		}
	}

	/* Capture / Recall / Act */
	.stories {
		display: grid;
		grid-template-columns: 1fr;
		gap: 1.75rem;
	}

	@media (min-width: 720px) {
		.stories {
			grid-template-columns: repeat(3, 1fr);
			gap: 1.5rem;
		}
	}

	.story-icon {
		display: inline-flex;
		width: 2.25rem;
		height: 2.25rem;
		align-items: center;
		justify-content: center;
		border-radius: 0.625rem;
		background: var(--color-accent-soft);
		color: var(--color-accent);
		margin-bottom: 0.75rem;
	}

	.story-kicker {
		font-size: 0.75rem;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--color-accent);
	}

	.story-title {
		margin-top: 0.25rem;
		font-size: 1.0625rem;
		font-weight: 650;
		line-height: 1.3;
		color: var(--color-text);
		text-wrap: balance;
	}

	.story-text {
		margin-top: 0.375rem;
		font-size: 0.875rem;
		line-height: 1.6;
		color: var(--color-text-muted);
	}

	/* Ownership band */
	.band {
		padding: 1.75rem 1.5rem;
		border-radius: 14px;
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border);
		text-align: center;
	}

	.band-title {
		font-size: 1.375rem;
		font-weight: 700;
		letter-spacing: -0.01em;
		color: var(--color-text);
	}

	.band-lede {
		max-width: 32rem;
		margin: 0.375rem auto 0;
		font-size: 0.875rem;
		line-height: 1.6;
		color: var(--color-text-muted);
	}

	.promises {
		display: grid;
		grid-template-columns: 1fr;
		gap: 1.25rem;
		margin-top: 1.5rem;
		text-align: left;
	}

	@media (min-width: 640px) {
		.promises {
			grid-template-columns: repeat(3, 1fr);
		}
	}

	.promise :global(.promise-icon) {
		width: 1.125rem;
		height: 1.125rem;
		color: var(--color-accent);
		margin-bottom: 0.5rem;
	}

	.promise-title,
	.place-title {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.9375rem;
		font-weight: 600;
		color: var(--color-text);
	}

	.promise p,
	.place p {
		margin-top: 0.25rem;
		font-size: 0.8125rem;
		line-height: 1.55;
		color: var(--color-text-muted);
	}

	/* Where to run it */
	.section-title {
		margin-bottom: 0.875rem;
		font-size: 0.75rem;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--color-text-faint);
	}

	.places {
		display: grid;
		grid-template-columns: 1fr;
		gap: 0.625rem;
	}

	@media (min-width: 640px) {
		.places {
			grid-template-columns: repeat(3, 1fr);
		}
	}

	.place {
		display: block;
		padding: 1rem;
		border: 1px solid var(--color-border);
		border-radius: 10px;
		color: inherit;
	}

	.place-link {
		transition:
			border-color 0.15s,
			background 0.15s;
	}

	.place-link:hover {
		border-color: var(--color-accent);
		background: var(--color-bg-secondary);
	}

	.place :global(.place-icon) {
		width: 1.125rem;
		height: 1.125rem;
		color: var(--color-accent);
		margin-bottom: 0.5rem;
	}

	.places-note {
		margin-top: 0.625rem;
		font-size: 0.8125rem;
		color: var(--color-text-faint);
	}

	/* Shortcuts */
	.tips {
		display: grid;
		gap: 0.375rem;
		font-size: 0.875rem;
		color: var(--color-text-muted);
	}

	.tips li {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.375rem 0;
		border-bottom: 1px solid var(--color-border);
	}
</style>
