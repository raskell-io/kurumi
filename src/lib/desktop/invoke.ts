/**
 * Calling the desktop app's own commands (desktop/src-tauri). `@tauri-apps/api`
 * isn't a dependency: the page talks to what Tauri puts on the window.
 */

type Invoke = (cmd: string, args?: unknown, options?: { headers: Record<string, string> }) => Promise<unknown>;

export function invoke(cmd: string, args?: unknown, options?: { headers: Record<string, string> }): Promise<unknown> {
	const internals = (globalThis as { __TAURI_INTERNALS__?: { invoke: Invoke } }).__TAURI_INTERNALS__;
	if (!internals) return Promise.reject(new DOMException('Not in the desktop app', 'NotSupportedError'));
	return internals.invoke(cmd, args, options).catch(rethrow);
}

/** Commands fail with "NotFoundError: …"; callers check DOMException names. */
function rethrow(err: unknown): never {
	const message = typeof err === 'string' ? err : err instanceof Error ? err.message : String(err);
	const match = /^(\w+Error): ([\s\S]*)$/.exec(message);
	if (match?.[1] === 'TypeError') throw new TypeError(match[2]);
	if (match) throw new DOMException(match[2], match[1]);
	throw new DOMException(message, 'UnknownError');
}
