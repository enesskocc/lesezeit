# Progress

_Last updated: 2026-10-21_

## Done
- **Milestone 1 — Setup ✅ accepted 2026-10-21** (installed on iPhone, test message shown)
  - Vite 8 + React 19 + TS 7 + Tailwind 4 + vite-plugin-pwa; fonts self-hosted (offline).
  - Setup screen (`src/screens/Setup.tsx`): GitHub token checked against `lesezeit-data` (repo must be private; write checked with a wrong-sha PUT), Gemini key optional, both stored in IndexedDB (`src/lib/db.ts`).
  - Home (`src/screens/Home.tsx`) reads `test/hello.json` from `lesezeit-data` via GitHub API (`src/lib/github.ts`), validated with Zod (`shared/schemas.ts`).
  - `.github/workflows/deploy.yml`: typecheck → unit tests → build → Playwright WebKit → Pages deploy.
  - Repos: `enesskocc/lesezeit` (public), `enesskocc/lesezeit-data` (private, contains `test/hello.json`).
- **Milestone 2 — Dictionary ✅ accepted 2026-10-21** (fing, Häusern, angefangen correct on iPhone)
  - Decisions (Enes, 2026-10-21): both Wiktionaries (de: grammar, German definition, Turkish translations, synonyms/antonyms, family; en: English glosses, inflection tables, Rektion); adaptive shards + manifest; frequency = FrequencyWords/OpenSubtitles 2018; proper nouns, abbreviations, affixes, phrases and archaic-only words dropped.
  - `npm run dict:build` (`scripts/dict/build.ts`, helpers in `lib.ts`, tests `lib.test.ts`): downloads to `%LOCALAPPDATA%\lesezeit-dict-cache` (not OneDrive, ~420 MB), writes `public/dict/` (~181k lemmas, ~745k forms, ~63 MB raw / ~14 MB gzip, shards ≤ 250 KB, largest download per tap ~70 KB gzip).
  - Format + shard lookup: `shared/dict.ts` (shared with the pipeline). App lookup: `src/lib/dict.ts`; UI: `src/screens/Dictionary.tsx` + `src/components/WordCard.tsx` (reused by the M5 word sheet); attribution: `src/screens/Licenses.tsx`.
  - Looked-up shards are cached by the service worker (works offline for those words); manifest maps each shard prefix → content hash, used as `?v=`. App re-reads the manifest after 6 h or on a 404.
  - Noun homographs differing in gender/plural are separate entries with `h` (id `Steuer:n:2`): die/das Steuer, Bank (Bänke/Banken), der Leiter/die Leiter, Kiefer.
  - Windows-reserved shard names get a `~` (`aux~.json`) via `shardFile()`; `public/dict/LICENSE.md` ships the CC BY-SA notice.
  - Code review (agency-agents Code Reviewer) done; 12 findings fixed (double articles, homographs, regional "sein", NFC, reserved names, stale manifest, …).

- **Milestone 3 — Pipeline without AI ✅ accepted 2026-10-21** (first Actions run: 8/8 texts from 7 sources; list + preview clean on iPhone)
  - From GitHub's (US) runners the ZDFheute feed answers 404 although it works from Germany → watch the next scheduled runs; disable with a note if it stays 404.
  - Decisions (Enes, 2026-10-21): cron 03:30 UTC (05:30 CEST / 04:30 CET); skip texts > 1,500 words; phone shows a text list + plain preview until the M5 reader.
  - Public repo: `pipeline/` (run.ts, feeds.ts, extract.ts, text.ts, heuristics.ts, store.ts, dict-fs.ts, pipeline.test.ts), schemas `shared/texts.ts`, app `src/screens/Home.tsx` (list, level filter) + `TextPreview.tsx`, `src/lib/texts.ts`.
  - Private repo: `sources.json`, `pipeline.json` (maxTextsPerRun 8, minWords 250, maxWords 1500, maxFetchesPerRun 60), `.github/workflows/daily.yml` (checks out the public repo into `app/`, `npm ci --omit=dev`, runs the pipeline, commits `texts/` + `state/` with rebase + retry; no secrets needed).
  - Feeds verified 2026-10-21: tagesschau, DLF (2), DW, ZDFheute (general feed; politik sub-feed 404), BR24, MDR, SWR, SPIEGEL, SZ. **ZEIT disabled**: 403 for bot user agents (respected, not disguised).
  - Extraction: teaser/related/newsletter boxes stripped by class before Readability, link-dense blocks + headings dropped, title echo and footer/agency lines removed, paywall via `isAccessibleForFree:false` / `content_tier`, live blogs via URL/title/`LiveBlogPosting`.
  - Heuristic level cuts calibrated on 40 real texts (quartiles): B1 < 0.31 · B2 < 0.35 · C1 < 0.40 · C2. Recalibrate against Claude levels in M4.
  - Code review done (agency-agents Code Reviewer); fixed: per-candidate try/catch, per-item URL parsing, transient HTTP errors not remembered, fail run when everything is blocked, push rebase/retry, splitter (so/12./2025.), exact tracking-param names, atomic JSON writes, refuse `--data` inside the app repo.

- 2026-10-21: dictionary search ignores invisible characters (zero-width space from keyboard suggestions, soft hyphen) and maps Turkish ı/İ → i (Enes could not find "mitbringen" on the iPhone; desktop + iPhone WebKit worked).
- **Milestone 4 — Claude in the pipeline (code done; waiting for Enes' token/secret, then a real run + forced-limit run)**
  - Docs checked 2026-10-21 (code.claude.com): `claude setup-token` → 1-year OAuth token, secret `CLAUDE_CODE_OAUTH_TOKEN`; native installer; never `--bare` (ignores OAuth); `ANTHROPIC_API_KEY` outranks OAuth → workflow refuses to run with it; `--json-schema` → `structured_output`; failures come as `is_error: true` (subtype may still be "success"); limit text "You've hit your … limit · resets …".
  - **Decisions (Enes, 2026-10-21, deliberate deviation from spec):** model **Opus**; **one annotated text per day** ("quality over quantity, I read slowly"); target level **B2 and C1 in turn**; pipeline fetches a **pool of 4** new texts/day; the app lists **only annotated** texts.
  - Code: `pipeline/claude.ts` (CLI wrapper: limit/budget → `ClaudeLimitError`, one retry on invalid output, spawn/auth failure → `ClaudeFatalError` = red run), `pipeline/tokenize.ts` (deterministic tokens, Claude annotates by index), `pipeline/enrich.ts` (level → batches of 8 sentences → 5 questions → independent check + one rewrite; dictionary cross-check fills gender/plural, flags mismatches; every step saved), `pipeline/daily.ts` (pending first, then pick by target level; ≤ 4 level calls), `prompts/*.md` (v1, one example each), schema v2 in `shared/texts.ts`, `state/pending.json`.
  - Tests: `pipeline/ai.test.ts` with `pipeline/testing/fake-claude.mjs` (no network) — incl. ACCEPTANCE "forced limit → correct pending list, next run finishes it".
  - Workflow: installs Claude Code, checks `claude auth status` → `authMethod: oauth_token`, `--ai` only when the secret exists, manual input `fake_limit_after` for the acceptance test, timeout 45 min. Budget: `maxClaudeCalls` 24/run (a 600-word text ≈ 8 calls) + 30-min AI deadline.
  - Code review (agency-agents Code Reviewer) fixed: timeouts are retryable (not fatal); limit/auth text only checked on failed calls (a news quote can't fake a limit); batch answers must contain exactly the batch sentences; MWEs replaced per sentence; ≥ 50 % failed batches → not published, retried; "running" pending marker survives a killed job; failing texts parked after 2 attempts; Claude outages ("blocked") don't count against a text; question ids renumbered; list groups the daily text by its annotation day.
  - For the manual forced-limit acceptance run use `fake_limit_after` ≥ 6 (up to 4 calls may go to leveling before a text is started).

## Next
1. Enes: `claude setup-token` + `gh secret set CLAUDE_CODE_OAUTH_TOKEN --repo enesskocc/lesezeit-data` (token never in chat).
2. Run the workflow normally (1 annotated text) and once with `fake_limit_after` (pending list) → M4 acceptance; then Enes' iPhone check (AI level + tap-to-translate).
3. Recalibrate heuristic level cuts against Opus levels once ~20 texts are leveled.

## Open questions
- M3 heuristic "share of words outside the 5,000 most frequent lemmas": ranks come from subtitles (spoken German), so formal news words rank lower than in a news corpus — cuts were calibrated on real news texts, so this is accounted for.
- Day picks: spec step 7 (2 per level, coverage 90–98 %) is replaced by Enes' one-text-per-day B2/C1 rotation; known-word coverage (M7) can later choose among same-level candidates.
- DLF's Nachrichten feed is mostly < 250-word bulletins (rejected as "short"); consider adding DLF background feeds later.
- `state/last-run.json` changes every run, so the data repo gets one commit per day even without new texts (harmless).
- Dictionary quality notes: synonyms/antonyms only from senses 1–2 (no fallback — Wiktionary often lists them only for rare senses); Turkish translations prefer sense 1, else any sense; Rektion only where en.wiktionary glosses say "with X (+ case)". Verb homographs (e.g. separable vs. inseparable "umfahren") are still merged.
- Before M5: switch service worker to `registerType: 'prompt'` (no surprise reload mid-session) and add one E2E test with the service worker enabled (offline launch).
- The read-only-token branch of the write probe (403) is only tested with a mock; the 409 "can write" branch was verified against the real API.
