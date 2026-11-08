/* kurumi-plugin {
	"id": "note-tools",
	"name": "Note tools",
	"version": "1.0.0",
	"author": "Kurumi",
	"description": "Example plugin: note statistics, and a table of contents from a note's headings.",
	"permissions": ["read", "write"]
} */

// Runs in a sandbox: no access to the page, and no network. Everything goes
// through the `kurumi` object (see docs/plugins.md).

kurumi.commands.register({
	id: 'stats',
	title: 'Note statistics',
	run: async ({ noteId }) => {
		const note = noteId ? await kurumi.notes.get(noteId) : null;
		if (!note) return kurumi.ui.notice('Open a note first.');
		const text = note.body.replace(/```[\s\S]*?```/g, ' ');
		const words = (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;
		const links = (note.body.match(/\[\[[^\]]+\]\]/g) || []).length;
		const open = (note.body.match(/^\s*[-*+] \[ \]/gm) || []).length;
		const minutes = Math.max(1, Math.round(words / 230));
		kurumi.ui.notice(`${words} words · ${minutes} min read · ${links} links · ${open} open to-dos`);
	}
});

kurumi.commands.register({
	id: 'toc',
	title: 'Add a table of contents',
	run: async ({ noteId }) => {
		const note = noteId ? await kurumi.notes.get(noteId) : null;
		if (!note) return kurumi.ui.notice('Open a note first.');
		// A "## Contents" section at the top, replaced each time.
		const body = note.body.replace(/^## Contents\n[\s\S]*?(?=^#{1,6} |(?![\s\S]))/m, '').replace(/^\n+/, '');
		const headings = [...body.matchAll(/^(#{2,4})\s+(.+?)\s*#*$/gm)];
		if (!headings.length) return kurumi.ui.notice('No ## headings to list.');
		const toc = headings.map(([, hashes, text]) => `${'  '.repeat(hashes.length - 2)}- [[${note.title}#${text}|${text}]]`).join('\n');
		await kurumi.notes.update(note.id, { body: `## Contents\n\n${toc}\n\n${body}` });
		kurumi.ui.notice(`Table of contents with ${headings.length} headings added.`);
	}
});
