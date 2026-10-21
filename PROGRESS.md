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

- **Milestone 3 — Pipeline without AI (code done, waiting for first real Actions run + Enes' iPhone test)**
  - Decisions (Enes, 2026-10-21): cron 03:30 UTC (05:30 CEST / 04:30 CET); skip texts > 1,500 words; phone shows a text list + plain preview until the M5 reader.
  - Public repo: `pipeline/` (run.ts, feeds.ts, extract.ts, text.ts, heuristics.ts, store.ts, dict-fs.ts, pipeline.test.ts), schemas `shared/texts.ts`, app `src/screens/Home.tsx` (list, level filter) + `TextPreview.tsx`, `src/lib/texts.ts`.
  - Private repo: `sources.json`, `pipeline.json` (maxTextsPerRun 8, minWords 250, maxWords 1500, maxFetchesPerRun 60), `.github/workflows/daily.yml` (checks out the public repo into `app/`, `npm ci --omit=dev`, runs the pipeline, commits `texts/` + `state/` with rebase + retry; no secrets needed).
  - Feeds verified 2026-10-21: tagesschau, DLF (2), DW, ZDFheute (general feed; politik sub-feed 404), BR24, MDR, SWR, SPIEGEL, SZ. **ZEIT disabled**: 403 for bot user agents (respected, not disguised).
  - Extraction: teaser/related/newsletter boxes stripped by class before Readability, link-dense blocks + headings dropped, title echo and footer/agency lines removed, paywall via `isAccessibleForFree:false` / `content_tier`, live blogs via URL/title/`LiveBlogPosting`.
  - Heuristic level cuts calibrated on 40 real texts (quartiles): B1 < 0.31 · B2 < 0.35 · C1 < 0.40 · C2. Recalibrate against Claude levels in M4.
  - Code review done (agency-agents Code Reviewer); fixed: per-candidate try/catch, per-item URL parsing, transient HTTP errors not remembered, fail run when everything is blocked, push rebase/retry, splitter (so/12./2025.), exact tracking-param names, atomic JSON writes, refuse `--data` inside the app repo.

## Next
1. Enes: iPhone test of the text list + preview after the first real run. (M3 acceptance: ≥ 8 clean texts, no teaser/paywall)
2. Milestone 4 — Claude in the pipeline. **Before starting: check current Claude Code docs for `claude -p` and `claude setup-token`** (Enes' instruction). Enes must create the OAuth token and add the `CLAUDE_CODE_OAUTH_TOKEN` secret — give step-by-step instructions.

## Open questions
- M3 heuristic "share of words outside the 5,000 most frequent lemmas": ranks come from subtitles (spoken German), so formal news words rank lower than in a news corpus — cuts were calibrated on real news texts, so this is accounted for.
- Day picks (spec step 7: 2 per level, coverage 90–98 %) need AI levels (M4) and the progress backup (M7); until then every stored text of the day is listed.
- DLF's Nachrichten feed is mostly < 250-word bulletins (rejected as "short"); consider adding DLF background feeds later.
- `state/last-run.json` changes every run, so the data repo gets one commit per day even without new texts (harmless).
- Dictionary quality notes: synonyms/antonyms only from senses 1–2 (no fallback — Wiktionary often lists them only for rare senses); Turkish translations prefer sense 1, else any sense; Rektion only where en.wiktionary glosses say "with X (+ case)". Verb homographs (e.g. separable vs. inseparable "umfahren") are still merged.
- Before M5: switch service worker to `registerType: 'prompt'` (no surprise reload mid-session) and add one E2E test with the service worker enabled (offline launch).
- The read-only-token branch of the write probe (403) is only tested with a mock; the 409 "can write" branch was verified against the real API.
