# Plugins

Plugins add commands to ⌘K. Install them in **Settings → Plugins**, from a
link to the plugin's `.js` file or from the file itself; *Try the example*
installs [Note tools](../static/plugins/note-tools.js) (note statistics and
a table of contents). Before anything runs, Kurumi shows what the plugin
asks to do, and you approve it. Plugins are installed per device.

## What a plugin can and can't do

Each plugin runs in its own sandbox (an `<iframe sandbox="allow-scripts">`
with a content security policy of `default-src 'none'`):

- It **can't see the app**: not the page, your other notes, settings, API
  keys, local storage, IndexedDB, cookies or the service worker. It has its
  own, empty origin.
- It **can't use the network**: no `fetch`, images, sockets or forms. It
  can't send your notes anywhere.
- It **can only** call the methods below, and Kurumi checks each call
  against the permissions you approved.

| Permission | Lets the plugin |
|------------|-----------------|
| *(none)* | Add commands to ⌘K, show a short message |
| `read` | List and read notes in the current vault |
| `write` | Create notes and change their title or text |

A plugin with `write` can change any note in the vault, so only install
plugins from people you trust. Turning a plugin off stops it at once;
removing it deletes it from this device.

## Writing a plugin

A plugin is one JavaScript file. It starts with its manifest in a comment:

```js
/* kurumi-plugin {
	"id": "word-count",
	"name": "Word count",
	"version": "1.0.0",
	"description": "Counts the words in the open note.",
	"author": "You",
	"permissions": ["read"]
} */

kurumi.commands.register({
	id: 'count',
	title: 'Count words',
	run: async ({ noteId }) => {
		const note = noteId ? await kurumi.notes.get(noteId) : null;
		if (!note) return kurumi.ui.notice('Open a note first.');
		kurumi.ui.notice(`${note.body.split(/\s+/).filter(Boolean).length} words`);
	}
});
```

`id`: 2–49 lowercase letters, digits or dashes; installing a plugin with the
same id again updates it.

### API

Everything is on the global `kurumi`, and every method returns a promise.

| Method | Needs | Returns |
|--------|-------|---------|
| `commands.register({ id, title, run })` | | Adds *title* to ⌘K. `run({ noteId })` is called when it's picked, with the open note's id (or `null`) |
| `ui.notice(text)` | | Shows a short message, prefixed with the plugin's name |
| `notes.list({ query?, limit? })` | `read` | `[{ id, title, tags, updatedAt }]`, newest first. `query` takes anything search does (`tag:x`, `person:"Ana"`, words). `limit` defaults to 50, at most 500 |
| `notes.get(id)` | `read` | `{ id, title, tags, updatedAt, body }` (body is Markdown), or `null` |
| `notes.current()` | `read` | The open note, as `notes.get` |
| `notes.create({ title, body })` | `write` | `{ id }` |
| `notes.update(id, { title?, body? })` | `write` | `true` |

A call the plugin's permissions don't allow fails with an error saying so.
Errors thrown in a command's `run` are shown as a message.

## For developers

`src/lib/plugins/manifest.ts` parses manifests and maps methods to
permissions (`mayCall`); `host.ts` stores plugins (IndexedDB,
`kurumi-plugins`), runs them, and answers calls only from the plugin's own
frame. The e2e scenario *plugins: install after approval, commands work,
the sandbox holds* installs a plugin that tries to reach the page, storage,
cookies, the network and notes without permission, and checks every attempt
is blocked.
