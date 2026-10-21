// Claude Code in headless mode (`claude -p`), authenticated by the subscription OAuth token
// (CLAUDE_CODE_OAUTH_TOKEN). Verified against code.claude.com docs on 2026-10-21:
//  - never pass --bare (it ignores OAuth credentials)
//  - ANTHROPIC_API_KEY would outrank the subscription token, so we refuse to run with it set
//  - --json-schema puts the validated object into `structured_output`
//  - a failure inside a run is reported on stdout with is_error=true (subtype may still say "success")
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { z } from 'zod';

/** Usage limit, call budget or a forced test limit: stop all AI work, keep the rest pending. */
export class ClaudeLimitError extends Error {
  readonly kind: 'limit' | 'budget';
  constructor(kind: 'limit' | 'budget', message: string) {
    super(message);
    this.kind = kind;
  }
}
/** This step failed (invalid output twice, timeout, API error). The text keeps going. */
export class ClaudeCallError extends Error {}
/**
 * Claude cannot work at all (binary missing, not logged in, token expired/revoked). Retrying the
 * next step would fail the same way and burn the day's text, so the run stops and turns red.
 */
export class ClaudeFatalError extends Error {}

const AUTH_TEXT = /(not logged in|please run \/login|authentication[_ ]failed|invalid (api key|token|bearer)|oauth token (has )?expired|\bunauthorized\b|\b401\b)/i;

export interface ClaudeConfig {
  model: string;
  maxCalls: number;
  /** Executable + leading args. Default ["claude"]; tests use [node, fake-claude.mjs]. */
  command?: string[];
  /** Testing the limit path: throw a limit error once this many calls were made. */
  fakeLimitAfter?: number;
  /** Per call; default 6 min. */
  timeoutMs?: number;
  /** Wall-clock end (ms since epoch). No call starts after it: the rest stays pending, so the
   *  workflow's own timeout never kills a run mid-text. */
  deadline?: number;
}

// Documented messages: "You've hit your session limit · resets 3:45pm", "… weekly limit …",
// "… Opus limit …". Matched loosely because the exact -p wording is not documented.
const LIMIT_TEXT = /(hit your (session |weekly |opus |sonnet |usage )?limit|usage limit|limit reached|out of (extra )?usage|resets \d{1,2}(:\d\d)?\s?(am|pm))/i;

interface ClaudeResult {
  is_error?: boolean;
  subtype?: string;
  result?: string;
  errors?: string[];
  api_error_status?: number | null;
  structured_output?: unknown;
}

/** First top-level JSON object inside a text answer (fallback when structured_output is missing). */
function jsonFromText(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return undefined;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

export class Claude {
  calls = 0;
  private readonly cfg: ClaudeConfig;
  // Empty working directory: no CLAUDE.md, no repo files, nothing for Claude Code to pick up.
  private readonly workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lesezeit-claude-'));

  constructor(cfg: ClaudeConfig) {
    this.cfg = cfg;
    if (process.env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY is set: Claude Code would bill the API instead of the subscription. Unset it.');
    }
  }

  /**
   * One structured answer. Invalid output → one retry, then ClaudeCallError (spec: "Invalid JSON →
   * one retry, then mark the item as failed"). Limit/budget errors are thrown immediately.
   */
  async json<T>(task: string, system: string, prompt: string, schema: object, parse: z.ZodType<T>): Promise<T> {
    let last = '';
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const out = await this.call(system, prompt, schema);
        const parsed = parse.safeParse(out);
        if (parsed.success) return parsed.data;
        last = `invalid output: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`;
      } catch (e) {
        if (e instanceof ClaudeLimitError || e instanceof ClaudeFatalError) throw e;
        last = e instanceof Error ? e.message : String(e);
      }
      console.log(`    ${task}: attempt ${attempt} failed (${last.slice(0, 200)})`);
    }
    throw new ClaudeCallError(`${task}: ${last}`);
  }

  private async call(system: string, prompt: string, schema: object): Promise<unknown> {
    if (this.cfg.fakeLimitAfter !== undefined && this.calls >= this.cfg.fakeLimitAfter) {
      throw new ClaudeLimitError('limit', `Forced test limit after ${this.cfg.fakeLimitAfter} calls (LESEZEIT_FAKE_LIMIT_AFTER)`);
    }
    if (this.calls >= this.cfg.maxCalls) throw new ClaudeLimitError('budget', `Call budget of ${this.cfg.maxCalls} reached`);
    if (this.cfg.deadline && Date.now() > this.cfg.deadline) throw new ClaudeLimitError('budget', 'Run time budget reached');
    this.calls++;

    const systemFile = path.join(this.workDir, `system-${this.calls}.md`);
    fs.writeFileSync(systemFile, system);
    const [cmd = 'claude', ...pre] = this.cfg.command ?? ['claude'];
    const args = [
      ...pre,
      '-p',
      '--output-format', 'json',
      '--model', this.cfg.model,
      '--tools', '', // text only: no file, shell or web tools
      '--json-schema', JSON.stringify(schema),
      '--system-prompt-file', systemFile, // replaces Claude Code's long default prompt
      '--no-session-persistence',
      '--max-turns', '4',
    ];
    const remaining = this.cfg.deadline ? this.cfg.deadline - Date.now() : Infinity;
    const timeout = Math.min(this.cfg.timeoutMs ?? 6 * 60_000, Math.max(remaining, 30_000));
    const r = await run(cmd, args, prompt, this.workDir, timeout);
    if (r.spawnError) throw new ClaudeFatalError(`claude could not be started: ${r.spawnError}`);
    if (r.timedOut) throw new ClaudeCallError(`claude timed out after ${Math.round(timeout / 1000)} s`);

    let res: ClaudeResult | undefined;
    try {
      res = JSON.parse(r.stdout.trim().split('\n').at(-1) ?? '') as ClaudeResult;
    } catch {
      // not JSON at all (crash, invalid flag)
    }
    // Limit/auth patterns are checked ONLY on failures: a successful answer may legitimately
    // contain "limit reached" (it is generated from news text) and must never stop the run.
    if (!res || res.is_error) {
      const text = [res?.result, ...(res?.errors ?? []), res ? '' : r.stdout, r.stderr].filter(Boolean).join(' ');
      if (LIMIT_TEXT.test(text) || res?.api_error_status === 429) throw new ClaudeLimitError('limit', text.slice(0, 300));
      if (AUTH_TEXT.test(text) || res?.api_error_status === 401) {
        throw new ClaudeFatalError(`Claude authentication failed (token missing/expired?): ${text.slice(0, 300)}`);
      }
      throw new ClaudeCallError(res ? `claude error (${res.subtype}): ${text.slice(0, 300)}` : `claude exited ${r.code}: ${text.slice(0, 300)}`);
    }
    return res.structured_output ?? jsonFromText(res.result ?? '');
  }
}

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
  spawnError?: string; // binary missing / not executable (ENOENT, EACCES)
}

function run(cmd: string, args: string[], input: string, cwd: string, timeoutMs: number) {
  return new Promise<RunResult>((resolve) => {
    const child = spawn(cmd, args, { cwd, env: { ...process.env, DISABLE_AUTOUPDATER: '1' }, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    const done = (r: RunResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    child.stdin.on('error', () => {}); // EPIPE when the child dies before reading the prompt
    child.on('error', (e) => done({ code: null, stdout, stderr, spawnError: e.message }));
    child.on('close', (code) => done({ code, stdout, stderr, timedOut }));
    child.stdin.end(input);
  });
}
