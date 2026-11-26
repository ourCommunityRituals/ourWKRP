#!/usr/bin/env node
/**
 * Review canary check (AI Problems Index assessment, 2026-11-26, Step 2).
 *
 * Reads the execution file that anthropics/claude-code-action writes (a JSON
 * array of Claude Code messages) and decides whether the reviewer caught the
 * planted flaw in tests/fixtures/review-canary/planted.ts.txt.
 *
 * The reviewer is asked to end with one line per finding:
 *   CANARY: <file>:<line>
 * or the single line `CANARY: NONE`.
 *
 * Pass: some line names planted.ts.txt with a line in PLANTED_LINES, and no
 * line names clean.ts.txt. Anything else fails, including no answer at all,
 * so a reviewer that did not run can never pass.
 *
 * Usage: node scripts/ci/review-canary-check.mjs <execution-file>
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const PLANTED_FILE = 'planted.ts.txt';
export const CLEAN_FILE = 'clean.ts.txt';
export const PLANTED_LINES = [9, 11];

/** The final answer text: the `result` message, else the last assistant text. */
export function answerText(messages) {
  if (!Array.isArray(messages)) return '';
  const results = messages.filter((m) => m && m.type === 'result' && typeof m.result === 'string');
  if (results.length > 0) return results[results.length - 1].result;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    const content = m && m.type === 'assistant' && m.message && m.message.content;
    if (Array.isArray(content)) {
      const text = content.filter((c) => c && c.type === 'text').map((c) => c.text).join('\n');
      if (text.trim()) return text;
    }
  }
  return '';
}

/** Parse `CANARY:` lines into { none, hits: [{ file, line }] }. */
export function canaryLines(text) {
  const hits = [];
  let none = false;
  for (const raw of String(text).split('\n')) {
    const m = raw.trim().replace(/^[`*\-\s]+|[`*\s]+$/g, '').match(/^CANARY:\s*(.+)$/i);
    if (!m) continue;
    const body = m[1].trim();
    if (/^none$/i.test(body)) {
      none = true;
      continue;
    }
    const at = body.match(/([\w./-]+):(\d+)/);
    if (at) hits.push({ file: at[1].split('/').pop(), line: Number(at[2]) });
  }
  return { none, hits };
}

/** { pass, reason } for one execution file's parsed JSON. */
export function judge(messages) {
  const text = answerText(messages);
  if (!text.trim()) return { pass: false, reason: 'the reviewer gave no answer (did it run?)' };
  const { none, hits } = canaryLines(text);
  if (hits.length === 0 && !none) return { pass: false, reason: 'no CANARY line in the answer' };
  const falseAlarm = hits.find((h) => h.file === CLEAN_FILE);
  if (falseAlarm) return { pass: false, reason: `flagged the clean file at line ${falseAlarm.line}` };
  const [lo, hi] = PLANTED_LINES;
  const caught = hits.find((h) => h.file === PLANTED_FILE && h.line >= lo && h.line <= hi);
  if (!caught) return { pass: false, reason: `missed the planted flaw (${PLANTED_FILE}:${lo}-${hi})` };
  return { pass: true, reason: `caught ${PLANTED_FILE}:${caught.line}` };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const file = process.argv[2];
  let messages = null;
  try {
    messages = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    messages = null;
  }
  const { pass, reason } = judge(messages);
  console.log(`${pass ? 'PASS' : 'FAIL'}: ${reason}`);
  process.exit(pass ? 0 : 1);
}
