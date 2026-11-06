/**
 * `.claude/CLAUDE.md` at the top of the sync folder, so Claude Code started
 * there follows the agent guide without being told. It lives in a hidden
 * directory because Kurumi would import a top-level `.md` as a note.
 */

/** Paths are relative to the file holding the import, hence the `..`. */
const IMPORT = '@../.kurumi/AGENTS.md';

const BLOCK = `# Kurumi vault

This folder is synced with Kurumi, the user's personal memory. Before adding or
changing anything in it, follow the guide in \`.kurumi/AGENTS.md\` at the top of
this folder. If its text doesn't appear below, read that file first.

${IMPORT}
`;

export const CLAUDE_DIR = '.claude';
export const CLAUDE_FILE = 'CLAUDE.md';

/**
 * What the file should contain, or null to leave it alone. The file may be the
 * user's own, so what's there is kept: our block is only ever added once.
 */
export function claudeInstructions(existing: string | null): string | null {
	if (existing === null || !existing.trim()) return BLOCK;
	if (existing.includes(IMPORT)) return null;
	return `${existing.replace(/\s*$/, '')}\n\n${BLOCK}`;
}
