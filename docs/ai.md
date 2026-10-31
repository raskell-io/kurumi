# AI

Kurumi uses AI to transcribe recordings, summarize them, pull out
to-dos and follow-ups, answer questions about your notes, and talk back.
Each task runs **on your device first** and only goes to a remote API if
you've added a key and the device can't do it. All AI is optional:
without it, Kurumi is a notes app with search.

## On your device (Settings → Local AI)

Models run in the browser with [transformers.js](https://huggingface.co/docs/transformers.js).
They download once, are cached, and then work offline. **Download all**
fetches every model you've enabled in one go, for example before a
flight.

| What for | Model | Default |
|----------|-------|---------|
| Transcription | Whisper tiny / base / small | On, *tiny* |
| Search by meaning, similar notes | all-MiniLM-L6 (English) or multilingual-e5-small | On, MiniLM (~25 MB) |
| Summaries, titles, Ask Kurumi | SmolLM2 360M, Qwen2 0.5B, Llama 3.2 1B / 3B, Qwen2.5 3B | Off (≥ 360 MB download) |
| Speech | MMS text-to-speech | Used when no remote voice is set up |

*Preload on startup* downloads enabled models in the background when the
app opens, so the first recording doesn't wait. Small local text models
are useful offline but noticeably weaker than remote ones.

## Remote providers (Settings → AI assistant)

Add an API key and Kurumi uses that provider for what the device can't
do, or does less well. Keys are stored in this browser and sent only to
that provider.

| Provider | Used for |
|----------|----------|
| **OpenAI** | Transcription, summaries, meeting summaries, extraction of people/to-dos/reminders/drafts, Ask Kurumi, the agent, voice (TTS and realtime conversation) |
| **Anthropic** or OpenAI | Editor actions on selected text: improve, expand, summarize, simplify, translate |
| Mistral, Perplexity, Grok (xAI), Qwen (DashScope), Azure OpenAI, Groq | Text tasks (summaries, extraction, Ask Kurumi) |

## What runs where

Kurumi tries providers in this order: on-device Whisper, the on-device
text model (if on), OpenAI, the other providers, on-device speech. The
first that can do the task and succeeds wins. Offline, only on-device
models run, and tasks that need a remote provider wait.

| Task | On-device | Remote fallback |
|------|-----------|-----------------|
| Transcribe a recording | Whisper | OpenAI |
| Title and summaries | Local text model | OpenAI, others |
| Meeting summary, reminders, drafts | (needs a capable model) | OpenAI, others |
| Search by meaning | MiniLM / e5 | none needed |
| Ask Kurumi | Local text model | OpenAI, others |
| Agent chat, realtime voice | none | OpenAI |
| Read answers aloud | MMS | OpenAI |

**What leaves your device:** with only local models, nothing. With a
key, the text of the task (a transcript, a note, a question and the
notes found for it) goes to that provider under your account.

## Ask Kurumi

The home page question box. It searches your notes (keyword and meaning
together), passes the best matches to the model, and answers with `[1]`
citations linking to the notes. It keeps the conversation for follow-up
questions, and each answer has a speaker button to read it aloud. See
[Organize & recall](organize-and-recall.md#ask-kurumi).

## The agent

`Cmd/Ctrl+`` ` opens a chat pane that can act on your vault: search
notes, create and update notes, add to-dos, propose reminders, look up
people and topics. Each tool call shows as a card in the chat; changes
are approved inline. Type `[[`, `@`, `#` or `//` to point it at a note,
person, tag or date. Save the conversation, or a single answer, as a
note. Needs an OpenAI key.

## Voice

- **Push to talk:** hold `Cmd/Ctrl+Shift+V` anywhere, speak, release.
  Kurumi transcribes, then answers or acts: "create a note about the
  roadmap call", "remind me to call Ana tomorrow", "what's due today".
- **Voice mode** on the home page keeps the conversation hands-free.
- **Realtime conversation** (OpenAI): a live two-way voice session that
  can look things up in your notes while it talks.

## Daily digest

On the first start each day, Kurumi can write a short note about what
happened (captures, to-dos done and due). It skips days with nothing in
them.
