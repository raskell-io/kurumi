#!/usr/bin/env node
/**
 * Live checks against OpenAI, for what can't be tested without a key:
 *
 *   OPENAI_API_KEY=sk-... node e2e/live-openai.mjs
 *
 * 1. Recurrence extraction: does `proposeReminders` (the app's real OpenAI
 *    provider and prompt) fill `recurrence` for "every week" style phrases,
 *    and leave one-off reminders at "none"?
 * 2. Realtime voice: does a session start against the GA Realtime API
 *    (client secret + WebRTC call, Chrome with a fake microphone), reach
 *    "connected" and stay free of errors?
 *
 * Starts `vite dev` on a spare port, prints what it saw, exits non-zero on
 * failure. Costs a few cents. Not part of CI.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer';

const KEY = process.env.OPENAI_API_KEY;
if (!KEY) {
	console.error('Set OPENAI_API_KEY to run the live checks.');
	process.exit(2);
}
const PORT = Number(process.env.E2E_LIVE_PORT ?? 5298);
const BASE = `http://localhost:${PORT}`;
const MAC_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = spawn('npx', ['vite', 'dev', '--port', String(PORT), '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
await new Promise((resolve, reject) => {
	const timer = setTimeout(() => reject(new Error('vite dev did not start')), 60_000);
	server.stdout.on('data', (c) => c.toString().replace(/\x1b\[[0-9;]*m/g, '').includes(`localhost:${PORT}`) && (clearTimeout(timer), resolve()));
});

const browser = await puppeteer.launch({
	headless: true,
	...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : existsSync(MAC_CHROME) ? { executablePath: MAC_CHROME } : {}),
	args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required']
});
let failed = 0;
try {
	const page = await browser.newPage();
	await page.evaluateOnNewDocument((key) => {
		localStorage.setItem('kurumi-openai-key', key);
		localStorage.setItem('kurumi-ai-provider', 'openai');
		localStorage.setItem('kurumi-last-auto-digest', new Date().toISOString().slice(0, 10));
		localStorage.setItem('kurumi-last-auto-review', 'x');
	}, KEY);
	await page.goto(BASE, { waitUntil: 'load' });
	await page.waitForSelector('aside', { timeout: 30_000 });
	const mod = (path) => `performance.getEntriesByType('resource').map((e) => e.name).find((n) => n.includes('/src/lib/db/store.ts')).replace('/db/store.ts', '${path}')`;

	// 1. Recurrence extraction
	console.log('\n1. Recurrence extraction (proposeReminders)');
	const cases = [
		{ text: 'Every Monday at 9 we have the team standup, I should prepare the board before it.', want: 'weekly' },
		{ text: 'Reminder: the monthly budget review happens on the first of each month.', want: 'monthly' },
		{ text: 'Water the plants every day before work.', want: 'daily' },
		{ text: "Call the dentist tomorrow to move Friday's appointment.", want: 'none' }
	];
	const results = await page.evaluate(
		`(async () => {
			const { OpenAIProvider } = await import(${mod('/inference/providers/openai.ts')});
			const provider = new OpenAIProvider();
			const cases = ${JSON.stringify(cases)};
			const out = [];
			for (const c of cases) {
				const r = await provider.proposeReminders({ text: c.text, anchorDate: '2026-11-09' });
				out.push({ text: c.text, want: c.want, ok: r.ok, error: r.error ?? null, got: r.ok ? r.value.map((x) => x.recurrence + ' · ' + x.suggestedDate + ' · ' + x.text) : [] });
			}
			return out;
		})()`
	);
	for (const r of results) {
		const recurrences = r.got.map((g) => g.split(' · ')[0]);
		const pass = r.ok && (r.want === 'none' ? recurrences.length === 0 || recurrences.every((x) => x === 'none') : recurrences.includes(r.want));
		if (!pass) failed++;
		console.log(`  ${pass ? '✓' : '✗'} want ${r.want.padEnd(7)} ${r.ok ? JSON.stringify(r.got) : `error: ${r.error}`}\n      "${r.text}"`);
	}

	// 2. Realtime session
	console.log('\n2. Realtime voice session (GA API)');
	const realtime = await page.evaluate(
		`(async () => {
			const rt = await import(${mod('/realtime.ts')});
			const read = (store) => { let v; store.subscribe((x) => (v = x))(); return v; };
			const session = new rt.RealtimeSession();
			const started = await session.start().then(() => 'started', (e) => 'failed: ' + e.message);
			await new Promise((r) => setTimeout(r, 8000));
			const result = { started, status: read(rt.realtimeStatus), error: read(rt.realtimeError), turns: read(rt.realtimeTurns).length, model: rt.REALTIME_MODEL };
			session.stop();
			return result;
		})()`
	);
	const rtPass = realtime.started === 'started' && realtime.status === 'connected' && !realtime.error;
	if (!rtPass) failed++;
	console.log(`  ${rtPass ? '✓' : '✗'} ${JSON.stringify(realtime)}`);
	console.log('    (a fake microphone sends a tone, so no transcript is expected; talk to it in the app for that)');
} finally {
	await browser.close();
	try {
		process.kill(-server.pid);
	} catch {
		server.kill();
	}
}
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
