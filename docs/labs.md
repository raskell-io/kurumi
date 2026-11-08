# Labs

Features that work but are still rough. They're hidden until you turn on
**Settings → Labs** (per device); then they get a sidebar section and
command-palette entries.

| Feature | What it does |
|---------|--------------|
| **Habits** (`/habits`) | A daily habit tracker: tick days off in a week view, see streaks and a 60-day heatmap |
| **Flashcards** (`/flashcards`) | Spaced repetition (SM-2). Write cards, or have AI generate questions and answers from a note. Review with `Space` to reveal and `1`–`4` to grade |
| **Timeline** (`/timeline`) | Everything you captured, grouped by date, filterable by type, person and tag |
| **Smart folders** (`/smart-folders`) | Saved searches that stay up to date, using the [search filters](organize-and-recall.md#search-filters) |
| **Workflows** (`/workflows`) | Instructions in plain words that the assistant carries out on a schedule (daily, weekly, monthly, or when you run it) and writes up as a note, e.g. "every Monday: look at last week's meetings, propose the to-dos that came out of them by project, and summarise where each project stands". See below |

## Workflows

A workflow runs the [agent](ai.md#the-agent) with your instructions, in the
background, without changing anything: it can read your notes, to-dos,
people and projects and follow how they connect, and it can **propose**
to-dos, which wait on Proposals for you to approve. What it writes back is
saved as a note (*Workflow name — date*), and it can send a notification.

- **When:** while Kurumi is open, checked every minute. A run that was due
  while it was closed happens at the next start, once.
- **Where:** every device with the app open would run it; turn *Run
  scheduled workflows on this device* off on the ones that shouldn't. Two
  devices running the same workflow on the same day write the same note.
- **Log:** each workflow keeps its last ten runs: when, what it wrote or
  why it failed, and which tools it used.
- Needs an OpenAI API key (Settings → AI assistant).
