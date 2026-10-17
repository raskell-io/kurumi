<script lang="ts">
	import {
		flashcards,
		addFlashcard,
		deleteFlashcard,
		gradeFlashcard,
		todayIso,
		type Flashcard
	} from '$lib/db';
	import { tick } from 'svelte';
	import { BookOpen, Plus, Trash2, Check, X, Brain } from 'lucide-svelte';

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

	const grades = [
		{ quality: 0, label: 'Again', key: '1', tone: 'again' },
		{ quality: 3, label: 'Hard', key: '2', tone: 'hard' },
		{ quality: 4, label: 'Good', key: '3', tone: 'good' },
		{ quality: 5, label: 'Easy', key: '4', tone: 'easy' }
	] as const;

	// Review shortcuts: Space/Enter reveal, 1-4 grade, Escape exits.
	function handleKeydown(e: KeyboardEvent) {
		if (!reviewing || !currentCard) return;
		if (e.metaKey || e.ctrlKey || e.altKey) return;
		const target = e.target as HTMLElement | null;
		if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
			return;
		}
		if (e.key === 'Escape') {
			e.preventDefault();
			reviewing = false;
			return;
		}
		if (!showAnswer) {
			if (e.key === ' ' || e.key === 'Enter') {
				e.preventDefault();
				showAnswer = true;
			}
			return;
		}
		const g = grades.find((x) => x.key === e.key);
		if (g) {
			e.preventDefault();
			grade(g.quality);
		} else if (e.key === ' ') {
			// Space flips back to the question
			e.preventDefault();
			flipCard();
		}
	}

	// Create form
	let showCreate = $state(false);
	let newQuestion = $state('');
	let newAnswer = $state('');
	let questionInput = $state<HTMLInputElement | null>(null);

	async function toggleCreate() {
		showCreate = !showCreate;
		if (showCreate) {
			await tick();
			questionInput?.focus();
		}
	}

	function handleCreateKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			submitCreate();
		} else if (e.key === 'Escape') {
			showCreate = false;
		}
	}

	function submitCreate() {
		const q = newQuestion.trim();
		const a = newAnswer.trim();
		if (!q || !a) return;
		addFlashcard({ question: q, answer: a });
		newQuestion = '';
		newAnswer = '';
		showCreate = false;
	}

	// Hard delete with no undo path, so this keeps a confirm.
	function handleDelete(card: Flashcard) {
		if (confirm(`Delete flashcard?\n"${card.question.slice(0, 60)}"`)) {
			deleteFlashcard(card.id);
		}
	}
</script>

<svelte:head>
	<title>Flashcards - Kurumi</title>
</svelte:head>

<svelte:window onkeydown={handleKeydown} />

{#if reviewing && currentCard}
	<!-- Review mode: one focused card -->
	<div class="k-page flex min-h-full flex-col">
		<div class="mb-4 flex items-center gap-3">
			<span class="text-xs font-medium tabular-nums text-[var(--color-text-muted)]">
				{currentIndex + 1} of {reviewQueue.length}
			</span>
			<div
				class="h-1 flex-1 overflow-hidden rounded-full bg-[var(--color-hover)]"
				role="progressbar"
				aria-label="Review progress"
				aria-valuemin={0}
				aria-valuemax={reviewQueue.length}
				aria-valuenow={currentIndex}
			>
				<div
					class="h-full rounded-full bg-[var(--color-accent)] transition-[width] duration-200"
					style="width: {(currentIndex / reviewQueue.length) * 100}%"
				></div>
			</div>
			<button class="k-btn k-btn-ghost k-btn-sm" onclick={() => (reviewing = false)}>
				<X class="h-3.5 w-3.5" />
				Exit
				<kbd class="k-kbd hidden sm:inline-flex">Esc</kbd>
			</button>
		</div>

		<button
			type="button"
			class="study-card k-card"
			onclick={flipCard}
			aria-label={showAnswer ? 'Show question' : 'Reveal answer'}
		>
			<span class="text-xs font-medium text-[var(--color-text-faint)]">
				{showAnswer ? 'Answer' : 'Question'}
			</span>
			{#if showAnswer}
				<span class="study-question">{currentCard.question}</span>
				<span class="h-px w-12 bg-[var(--color-border)]" aria-hidden="true"></span>
				<span class="study-text">{currentCard.answer}</span>
			{:else}
				<span class="study-text">{currentCard.question}</span>
			{/if}
		</button>

		<div class="mt-6 flex min-h-[4.5rem] flex-col items-center gap-3">
			{#if showAnswer}
				<p class="text-sm text-[var(--color-text-muted)]">How well did you recall it?</p>
				<div class="grid w-full max-w-md grid-cols-4 gap-2">
					{#each grades as g (g.quality)}
						<button class="k-btn grade-btn {g.tone}" onclick={() => grade(g.quality)}>
							{g.label}
							<kbd class="k-kbd hidden sm:inline-flex">{g.key}</kbd>
						</button>
					{/each}
				</div>
			{:else}
				<button class="k-btn k-btn-primary" onclick={() => (showAnswer = true)}>
					Show answer
					<kbd class="k-kbd hidden !border-transparent !bg-transparent !text-current opacity-70 sm:inline-flex">Space</kbd>
				</button>
			{/if}
		</div>
	</div>
{:else}
	<!-- Dashboard -->
	<div class="k-page">
		<header class="k-page-header flex-wrap">
			<div class="min-w-0">
				<h1 class="k-page-title">Flashcards</h1>
				<p class="k-page-subtitle">
					{totalCards} card{totalCards === 1 ? '' : 's'} · {dueCards.length} due today
				</p>
			</div>
			<div class="flex items-center gap-2">
				<button class="k-btn" onclick={toggleCreate} aria-expanded={showCreate}>
					<Plus class="h-4 w-4" />
					Add card
				</button>
				{#if dueCards.length > 0}
					<button class="k-btn k-btn-primary" onclick={startReview}>
						<Brain class="h-4 w-4" />
						Review {dueCards.length}
					</button>
				{/if}
			</div>
		</header>

		{#if showCreate}
			<div class="k-card mb-6 space-y-2 p-3">
				<input
					type="text"
					bind:this={questionInput}
					bind:value={newQuestion}
					onkeydown={handleCreateKeydown}
					placeholder="Question"
					aria-label="Question"
					class="k-input"
				/>
				<input
					type="text"
					bind:value={newAnswer}
					onkeydown={handleCreateKeydown}
					placeholder="Answer"
					aria-label="Answer"
					class="k-input"
				/>
				<div class="flex justify-end gap-2 pt-1">
					<button class="k-btn k-btn-ghost k-btn-sm" onclick={() => (showCreate = false)}>Cancel</button>
					<button
						class="k-btn k-btn-primary k-btn-sm"
						onclick={submitCreate}
						disabled={!newQuestion.trim() || !newAnswer.trim()}
					>
						Create
					</button>
				</div>
			</div>
		{/if}

		{#if totalCards === 0 && !showCreate}
			<div class="k-empty">
				<BookOpen />
				<p class="k-empty-title">No flashcards yet</p>
				<p class="max-w-sm">
					Add Q: and A: lines to any note and extract them with the Bell button,
					or create a card by hand.
				</p>
				<button class="k-btn mt-2" onclick={toggleCreate}>
					<Plus class="h-4 w-4" />
					Add card
				</button>
			</div>
		{:else if totalCards > 0 && dueCards.length === 0}
			<div class="mb-2 flex items-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-bg-secondary)] px-3 py-2.5 text-sm text-[var(--color-text-muted)]">
				<Check class="h-4 w-4 shrink-0 text-[var(--color-text-faint)]" />
				All caught up — nothing due for review.
			</div>
		{/if}

		{#if totalCards > 0}
			<section>
				<h2 class="k-section-title">All cards</h2>
				<ul>
					{#each $flashcards as card (card.id)}
						{@const due = card.nextReview <= todayIso()}
						<li class="k-row group items-start">
							<div class="min-w-0 flex-1 py-0.5">
								<p class="truncate">{card.question}</p>
								<p class="truncate text-xs text-[var(--color-text-faint)]">{card.answer}</p>
							</div>
							{#if due}
								<span class="k-badge k-badge-accent mt-0.5">Due</span>
							{:else}
								<span class="mt-0.5 text-xs tabular-nums text-[var(--color-text-faint)]">{card.nextReview}</span>
							{/if}
							<button
								class="k-icon-btn row-action hover:!text-[var(--color-danger)]"
								onclick={() => handleDelete(card)}
								aria-label="Delete card"
								title="Delete"
							>
								<Trash2 class="h-4 w-4" />
							</button>
						</li>
					{/each}
				</ul>
			</section>
		{/if}
	</div>
{/if}

<style>
	.study-card {
		display: flex;
		flex: 1;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 1rem;
		width: 100%;
		min-height: 18rem;
		max-height: 32rem;
		padding: 2.5rem 1.5rem;
		text-align: center;
		cursor: pointer;
		box-shadow: var(--shadow-sm);
	}

	.study-card:hover {
		border-color: color-mix(in srgb, var(--color-text) 18%, var(--color-border));
	}

	.study-text {
		max-width: 34rem;
		font-family: var(--font-editor);
		font-size: 1.375rem;
		line-height: 1.5;
		color: var(--color-text);
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}

	.study-question {
		max-width: 34rem;
		font-size: 0.875rem;
		color: var(--color-text-muted);
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}

	@media (min-width: 768px) {
		.study-text {
			font-size: 1.625rem;
		}
	}

	.grade-btn {
		height: 2.5rem;
		padding: 0 0.5rem;
	}

	.grade-btn.again {
		color: var(--color-danger);
	}

	.grade-btn.again:hover {
		background: color-mix(in srgb, var(--color-danger) 10%, transparent);
	}

	.grade-btn.good {
		border-color: color-mix(in srgb, var(--color-accent) 50%, var(--color-border));
		color: var(--color-accent);
	}

	.grade-btn.good:hover {
		background: var(--color-accent-soft);
	}

	/* Row actions appear on hover/focus (always visible on touch) */
	.row-action {
		opacity: 0;
	}

	.k-row:hover .row-action,
	.row-action:focus-visible {
		opacity: 1;
	}

	@media (hover: none) {
		.row-action {
			opacity: 1;
		}
	}
</style>
