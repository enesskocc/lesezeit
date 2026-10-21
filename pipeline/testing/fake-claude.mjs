#!/usr/bin/env node
// Stand-in for `claude -p --output-format json` in tests: no network, no subscription.
// Answers per prompt file (level / annotate / questions / check-questions) with valid JSON in
// the same result shape as the real CLI. Behaviour switches (environment):
//   FAKE_CLAUDE_INVALID=<task>[:once]  return invalid output for that task (always, or only once)
//   FAKE_CLAUDE_LIMIT=1                answer like a subscription usage limit
//   FAKE_CLAUDE_COUNTER=<file>         count calls (for "once")
import fs from 'node:fs';

const args = process.argv.slice(2);
const systemFile = args[args.indexOf('--system-prompt-file') + 1];
const system = systemFile ? fs.readFileSync(systemFile, 'utf8') : '';
const task = system.match(/prompt: ([\w-]+)/)?.[1] ?? 'unknown';
const input = fs.readFileSync(0, 'utf8');

const print = (obj, code = 0) => {
  process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', ...obj }) + '\n');
  process.exit(code);
};

// FAKE_CLAUDE_SLEEP_MS: answer late (timeout tests).
if (process.env.FAKE_CLAUDE_SLEEP_MS) await new Promise((r) => setTimeout(r, Number(process.env.FAKE_CLAUDE_SLEEP_MS)));

if (process.env.FAKE_CLAUDE_LIMIT) {
  print({ is_error: true, result: "You've hit your session limit · resets 3:45pm" }, 1);
}
if (process.env.FAKE_CLAUDE_NOAUTH) {
  // What the real CLI printed on this machine without a login (2026-10-21).
  print({ is_error: true, result: 'Not logged in · Please run /login' }, 1);
}

// One counter per task, so "once" means the first call of THAT task.
const counterFile = process.env.FAKE_CLAUDE_COUNTER && `${process.env.FAKE_CLAUDE_COUNTER}.${task}`;
let n = 0;
if (counterFile) {
  n = fs.existsSync(counterFile) ? Number(fs.readFileSync(counterFile, 'utf8')) : 0;
  fs.writeFileSync(counterFile, String(n + 1));
}
const [invalidTask, once] = (process.env.FAKE_CLAUDE_INVALID ?? '').split(':');
// FAKE_CLAUDE_INVALID_S=<n>: only the annotation batch that contains sentence n is broken.
const onlyS = process.env.FAKE_CLAUDE_INVALID_S;
const hit = !onlyS || input.includes(`S=${onlyS}:`);
if (invalidTask === task && hit && (!once || n === 0)) print({ is_error: false, result: 'kein JSON', structured_output: { wrong: true } });

if (task === 'level') {
  const level = input.match(/^TITLE: .*\((B1|B2|C1|C2)\)/m)?.[1] ?? 'B2';
  // FAKE_CLAUDE_INJECT: a successful answer that contains limit-like text (from a news quote).
  const reasons = process.env.FAKE_CLAUDE_INJECT ? "Zitat: You've hit your session limit · resets 3:45pm. HTTP 401." : 'Test gerekçesi.';
  print({ is_error: false, structured_output: { level, confidence: 0.8, reasons_tr: reasons } });
}

if (task === 'annotate') {
  const sentences = [];
  for (const m of input.matchAll(/^S=(\d+): (.*)$/gm)) {
    const toks = m[2].split(' ').map((p) => {
      const c = p.indexOf(':');
      return { i: Number(p.slice(0, c)), s: p.slice(c + 1) };
    });
    const words = toks.filter((t) => /^\p{L}/u.test(t.s));
    const fangt = words.find((t) => t.s === 'fängt');
    const an = words.find((t) => t.s === 'an');
    sentences.push({
      s: Number(m[1]),
      tr: `Türkçe çeviri ${m[1]}`,
      notes: ['Test notu'],
      tokens: words.map((t) => {
        if (fangt && an && (t === fangt || t === an)) {
          return { i: t.i, l: 'anfangen', pos: t === fangt ? 'VERB' : 'ADP', sep: t === fangt ? an.i : fangt.i, tr: 'başlamak' };
        }
        if (t.s === 'Haus') return { i: t.i, l: 'Haus', pos: 'NOUN', c: 'Nom', g: 'n', tr: 'ev' };
        if (t.s === 'Steuer') return { i: t.i, l: 'Steuer', pos: 'NOUN', c: 'Nom', g: 'm', tr: 'vergi' }; // wrong gender on purpose
        return { i: t.i, l: t.s.toLowerCase(), pos: 'X', c: null, tr: `tr-${t.s}` };
      }),
      mwes: words.length >= 2 ? [{ tok: [words[0].i, words[1].i], de: `${words[0].s} ${words[1].s}`, tr: 'kalıp', kind: 'other' }] : [],
    });
  }
  // FAKE_CLAUDE_EXTRA_S: also return a sentence that is not in the batch.
  if (process.env.FAKE_CLAUDE_EXTRA_S) sentences.push({ ...sentences[0], s: 999 });
  print({ is_error: false, structured_output: { sentences } });
}

if (task === 'questions') {
  const count = [...input.matchAll(/^\[(\d+)\]/gm)].length;
  const last = Math.max(0, count - 1);
  const mc = (id, proof) => ({ id, type: 'mc', q: `Frage ${id}?`, options: ['a', 'b', 'c', 'd'], answer: 1, proof, explain_tr: 'Açıklama.' });
  print({
    is_error: false,
    structured_output: {
      questions: [
        mc('q1', 0),
        mc('q2', last),
        { id: 'q3', type: 'tf', q: 'Aussage?', options: ['richtig', 'falsch', 'nicht im Text'], answer: 2, proof: 0, explain_tr: 'Açıklama.' },
        mc('q4', 0),
        { id: 'q5', type: 'open', q: 'Warum?', answer: 'Weil es so ist.', proof: 0, explain_tr: 'Açıklama.' },
      ],
    },
  });
}

if (task === 'check-questions') print({ is_error: false, structured_output: { ok: true, problems: [] } });

print({ is_error: true, result: `fake-claude: unknown task ${task}` }, 1);
