# Capture

Everything you save in Kurumi is a *memory*: a typed note, a voice memo,
a meeting, a file, a reference. They share one shape, so they all show up
in search, Ask Kurumi, the graph and the calendar.

## Notes

`Cmd/Ctrl+N` creates a note. It saves as you type; there is no save
button. A new note you never type into is discarded when you leave it.
The [editor](editor.md) page covers the syntax.

**Templates** (`/templates`): Markdown with placeholders, filled in when
you use them. Kurumi starts you off with *Meeting Notes*, *Daily Journal*
and *Project Brief*. Placeholders:

| Placeholder | Becomes |
|-------------|---------|
| `{title}` | The note's title |
| `{date}` | `2026-10-31` |
| `{weekday}` | `Saturday` |
| `{month}`, `{year}` | `October`, `2026` |
| `{time}` | `14:05` |
| `{datetime}` | Full ISO timestamp |
| `{vault}` | The current vault's name |

## Daily notes

`Cmd/Ctrl+D` opens today's note, creating it from the *Daily Journal*
template the first time. `/daily/2026-10-30` opens any other day. On the
first start each day Kurumi can also write a short digest of yesterday,
but only if something happened.

## Voice memos

Record from the capture button or the command palette. Recording can be
paused and resumed, and a waveform shows it's hearing you. You can record
the microphone, a browser tab's audio, or both.

When you stop, Kurumi transcribes the recording (on your device with
Whisper, or OpenAI as a fallback; see [AI](ai.md)) and then, in parallel:

- writes a title and short and long summaries;
- picks out people, projects and topics;
- proposes [reminders](work.md#reminder-proposals) and
  [email or calendar drafts](work.md#draft-proposals) for you to review.

## Meetings

Meeting mode is a long recording with a structured summary: decisions,
to-dos with owners, open questions and participants. Decisions and open
questions land in the [decision log](work.md#decisions) and
[open questions](work.md#open-questions) by themselves; to-dos become real
[to-dos](work.md#to-dos). For recurring meetings, start the meeting from
its [series](work.md#recurring-meetings) so the agenda comes along.

## Existing recordings

Upload an audio or video file and Kurumi processes it like a voice memo.

## Files and images

Paste or drop any file into a note:

- **images** appear inline (click to enlarge);
- **audio** becomes a player;
- **anything else** (PDF, spreadsheet, …) becomes a chip you click to
  open in a tab or download.

Files live in the browser's storage next to the note and travel with
[sync](sync.md). If you open a note whose file hasn't reached this device
yet, Kurumi says so instead of showing a broken link.

**Photos:** `/photo` in the editor (or *Take photo*) uses your webcam or
phone camera.

## From other apps

- **Share into Kurumi** (installed app on Android, and Chrome/Edge on
  desktop): share text, links, images, recordings or files from any app.
  Text and links become a note, recordings are transcribed, images go
  inline, Markdown files are parsed, anything else is attached.
- **Open `.md` files** with Kurumi (installed app on desktop Chrome/Edge):
  each opens as a note.
- **App icon shortcuts:** long-press or right-click the icon for *New
  note*, *Voice memo*, *Today* and *To-dos*.
- **Web clipper:** Settings → Data has a bookmarklet. Drag it to your
  bookmarks bar; on any page it saves the title, address and the text
  you've selected.
- **Pasting from ChatGPT, web pages or Google Docs** keeps headings,
  lists, tables, code and links (see [Editor](editor.md#pasting)).
