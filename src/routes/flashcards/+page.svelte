<script lang="ts">
	import {
		flashcards,
		addFlashcard,
		deleteFlashcard,
		gradeFlashcard,
		todayIso,
		type Flashcard
	} from '$lib/db';
	import {
		BookOpen,
		Plus,
		Trash2,
		RotateCcw,
		Check,
		X,
		Brain,
		ArrowRight
	} from 'lucide-svelte';

	// Cards due today or earlier
	let dueCards = $derived.by(() => {
		const today = todayIso();
		return $flashcards.filter((c) => c.nextReview <= today);
	});

	let totalCards = $derived($flashcards.length);

	// Review mode
	let reviewing = $state(false);
	let currentIndex = $state(0);
	let showAnswer = $state(false);
	let reviewQueue = $state<Flashcard[]>([]);

	function startReview() {
		reviewQueue = [...dueCards];
		currentIndex = 0;
		showAnswer = false;
		reviewing = true;
	}

	let currentCard = $derived<Flashcard | null>(
		reviewing && currentIndex < reviewQueue.length
			? reviewQueue[currentIndex]
			: null
	);

	function grade(quality: number) {
		if (!currentCard) return;
		gradeFlashcard(currentCard.id, quality);
		showAnswer = false;
		if (currentIndex < reviewQueue.length - 1) {
			currentIndex++;
		} else {
			reviewing = false;
		}
	}

	function flipCard() {
		showAnswer = !showAnswer;
	}

	// Create form
	let showCreate = $state(false);
	let newQuestion = $state('');
	let newAnswer = $state('');

	function submitCreate() {
		const q = newQuestion.trim();
		const a = newAnswer.trim();
		if (!q || !a) return;
		addFlashcard({ question: q, answer: a });
		newQuestion = '';
		newAnswer = '';
		showCreate = false;
	}

	function handleDelete(card: Flashcard) {
		if (confirm(`Delete flashcard?\n"${card.question.slice(0, 60)}"`)) {
			deleteFlashcard(card.id);
		}
	}
</script>

<svelte:head>
	<title>Flashcards - Kurumi</title>
</svelte:head>

<main class="fc-page">
	{#if reviewing && currentCard}
		<!-- Review mode -->
		<div class="review">
			<div class="review-header">
				<span class="review-progress">
					{currentIndex + 1} / {reviewQueue.length}
				</span>
				<button class="review-exit" onclick={() => (reviewing = false)}>
					<X class="h-4 w-4" />
					Exit review
				</button>
			</div>

			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div class="card" onclick={flipCard}>
				<div class="card-label">{showAnswer ? 'Answer' : 'Question'}</div>
				<div class="card-content">
					{showAnswer ? currentCard.answer : currentCard.question}
				</div>
				{#if !showAnswer}
					<div class="card-hint">Click to reveal answer</div>
				{/if}
			</div>

			{#if showAnswer}
				<div class="grade-buttons">
					<p class="grade-prompt">How well did you recall this?</p>
					<div class="grade-row">
						<button class="grade-btn again" onclick={() => grade(0)}>
							<RotateCcw class="h-4 w-4" />
							Again
						</button>
						<button class="grade-btn hard" onclick={() => grade(3)}>
							Hard
						</button>
						<button class="grade-btn good" onclick={() => grade(4)}>
							<Check class="h-4 w-4" />
							Good
						</button>
						<button class="grade-btn easy" onclick={() => grade(5)}>
							<Brain class="h-4 w-4" />
							Easy
						</button>
					</div>
				</div>
			{/if}
		</div>
	{:else}
		<!-- Dashboard -->
		<header class="page-header">
			<div class="header-icon">
				<BookOpen class="h-8 w-8" />
			</div>
			<h1>Flashcards</h1>
			<p class="count">
				{totalCards} card{totalCards === 1 ? '' : 's'} ·
				{dueCards.length} due today
			</p>
		</header>

		<div class="actions-bar">
			{#if dueCards.length > 0}
				<button class="start-btn" onclick={startReview}>
					<Brain class="h-4 w-4" />
					Review {dueCards.length} due card{dueCards.length === 1 ? '' : 's'}
				</button>
			{/if}
			<button class="create-btn" onclick={() => (showCreate = !showCreate)}>
				<Plus class="h-4 w-4" />
				Add card
			</button>
		</div>

		{#if showCreate}
			<div class="create-form">
				<input
					type="text"
					bind:value={newQuestion}
					placeholder="Question"
					class="form-input"
				/>
				<input
					type="text"
					bind:value={newAnswer}
					placeholder="Answer"
					class="form-input"
				/>
				<div class="form-actions">
					<button class="btn-cancel" onclick={() => (showCreate = false)}>Cancel</button>
					<button class="btn-submit" onclick={submitCreate} disabled={!newQuestion.trim() || !newAnswer.trim()}>Create</button>
				</div>
			</div>
		{/if}

		{#if totalCards === 0 && !showCreate}
			<div class="empty-state">
				<p>No flashcards yet.</p>
				<p class="muted">
					Add Q: and A: lines to any note, then use the Bell button to extract
					them. Or create cards manually with the button above.
				</p>
			</div>
		{:else if dueCards.length === 0 && !reviewing}
			<div class="empty-state">
				<Check class="h-8 w-8 text-[var(--color-accent)]" />
				<p>All caught up! No cards due for review.</p>
			</div>
		{/if}

		{#if totalCards > 0}
			<section class="card-list">
				<h2 class="section-title">All cards</h2>
				<ul class="cards">
					{#each $flashcards as card (card.id)}
						<li class="card-row">
							<div class="card-row-body">
								<span class="card-q">{card.question}</span>
								<span class="card-a">{card.answer}</span>
							</div>
							<div class="card-row-meta">
								<span class="card-next">
									{card.nextReview <= todayIso() ? 'Due' : card.nextReview}
								</span>
								<button class="icon-btn danger" onclick={() => handleDelete(card)} title="Delete">
									<Trash2 class="h-3.5 w-3.5" />
								</button>
							</div>
						</li>
					{/each}
				</ul>
			</section>
		{/if}
	{/if}
</main>

<style>
	.fc-page {
		max-width: 700px;
		margin: 0 auto;
		padding: 2rem 1.5rem 4rem;
	}

	.page-header {
		text-align: center;
		margin-bottom: 1.5rem;
	}

	.header-icon {
		display: inline-flex;
		padding: 1rem;
		background: color-mix(in srgb, var(--color-accent) 15%, transparent);
		color: var(--color-accent);
		border-radius: 1rem;
		margin-bottom: 0.75rem;
	}

	.page-header h1 {
		font-size: 2rem;
		font-weight: 700;
		color: var(--color-text);
		margin-bottom: 0.25rem;
	}

	.count {
		color: var(--color-text-muted);
		font-size: 0.875rem;
	}

	.actions-bar {
		display: flex;
		gap: 0.5rem;
		justify-content: center;
		margin-bottom: 1.5rem;
	}

	.start-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.625rem 1.25rem;
		background: var(--color-accent);
		color: white;
		border: none;
		border-radius: 0.5rem;
		font-size: 0.875rem;
		font-weight: 500;
		cursor: pointer;
	}

	.start-btn:hover {
		background: var(--color-accent-hover);
	}

	.create-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.625rem 1rem;
		background: transparent;
		border: 1px solid var(--color-border);
		border-radius: 0.5rem;
		color: var(--color-text);
		font-size: 0.875rem;
		cursor: pointer;
	}

	.create-btn:hover {
		border-color: var(--color-accent);
	}

	.create-form {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin-bottom: 1.5rem;
		padding: 1rem;
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border);
		border-radius: 0.5rem;
	}

	.form-input {
		padding: 0.5rem 0.75rem;
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 0.375rem;
		color: var(--color-text);
		font-size: 0.875rem;
		outline: none;
	}

	.form-input:focus {
		border-color: var(--color-accent);
	}

	.form-actions {
		display: flex;
		gap: 0.5rem;
		justify-content: flex-end;
	}

	.btn-cancel,
	.btn-submit {
		padding: 0.375rem 0.875rem;
		border-radius: 0.375rem;
		font-size: 0.8125rem;
		cursor: pointer;
	}

	.btn-cancel {
		background: transparent;
		border: 1px solid var(--color-border);
		color: var(--color-text-muted);
	}

	.btn-submit {
		background: var(--color-accent);
		border: 1px solid var(--color-accent);
		color: white;
	}

	.btn-submit:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.empty-state {
		text-align: center;
		padding: 3rem 2rem;
		color: var(--color-text);
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
	}

	.empty-state .muted {
		color: var(--color-text-muted);
		font-size: 0.8125rem;
		max-width: 28rem;
	}

	/* Review mode */
	.review {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1.5rem;
		padding-top: 2rem;
	}

	.review-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		width: 100%;
	}

	.review-progress {
		font-size: 0.875rem;
		color: var(--color-text-muted);
		font-weight: 500;
	}

	.review-exit {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		background: transparent;
		border: 1px solid var(--color-border);
		padding: 0.375rem 0.75rem;
		border-radius: 0.375rem;
		color: var(--color-text-muted);
		font-size: 0.75rem;
		cursor: pointer;
	}

	.card {
		width: 100%;
		min-height: 14rem;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 2rem;
		background: var(--color-bg-secondary);
		border: 2px solid var(--color-border);
		border-radius: 1rem;
		cursor: pointer;
		transition: border-color 0.15s;
		text-align: center;
	}

	.card:hover {
		border-color: var(--color-accent);
	}

	.card-label {
		font-size: 0.6875rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--color-accent);
		margin-bottom: 1rem;
	}

	.card-content {
		font-size: 1.25rem;
		font-weight: 500;
		color: var(--color-text);
		line-height: 1.5;
		max-width: 32rem;
	}

	.card-hint {
		margin-top: 1.5rem;
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}

	.grade-buttons {
		text-align: center;
	}

	.grade-prompt {
		font-size: 0.875rem;
		color: var(--color-text-muted);
		margin-bottom: 0.75rem;
	}

	.grade-row {
		display: flex;
		gap: 0.5rem;
	}

	.grade-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.625rem 1rem;
		border: 1px solid var(--color-border);
		border-radius: 0.5rem;
		background: var(--color-bg-secondary);
		color: var(--color-text);
		font-size: 0.875rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.15s;
	}

	.grade-btn:hover {
		border-color: var(--color-accent);
	}

	.grade-btn.again {
		color: #ef4444;
		border-color: rgba(239, 68, 68, 0.3);
	}

	.grade-btn.again:hover {
		background: rgba(239, 68, 68, 0.1);
	}

	.grade-btn.easy {
		color: #22c55e;
		border-color: rgba(34, 197, 94, 0.3);
	}

	.grade-btn.easy:hover {
		background: rgba(34, 197, 94, 0.1);
	}

	.grade-btn.good {
		color: var(--color-accent);
		border-color: var(--color-accent);
	}

	.grade-btn.good:hover {
		background: color-mix(in srgb, var(--color-accent) 10%, transparent);
	}

	/* Card list */
	.section-title {
		font-size: 0.75rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--color-text-muted);
		margin-bottom: 0.75rem;
	}

	.cards {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}

	.card-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.75rem;
		padding: 0.5rem 0.75rem;
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border);
		border-radius: 0.5rem;
	}

	.card-row-body {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
	}

	.card-q {
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--color-text);
	}

	.card-a {
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}

	.card-row-meta {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-shrink: 0;
	}

	.card-next {
		font-size: 0.6875rem;
		color: var(--color-text-muted);
	}

	.icon-btn {
		background: none;
		border: none;
		padding: 0.375rem;
		border-radius: 0.375rem;
		cursor: pointer;
		color: var(--color-text-muted);
	}

	.icon-btn.danger:hover {
		background: rgba(239, 68, 68, 0.15);
		color: #ef4444;
	}
</style>
