# Progress

_Last updated: 2026-10-21_

## Done
- **Milestone 1 — Setup ✅ accepted 2026-10-21** (installed on iPhone, test message shown)
  - Vite 8 + React 19 + TS 7 + Tailwind 4 + vite-plugin-pwa; fonts self-hosted (offline).
  - Setup screen (`src/screens/Setup.tsx`): GitHub token checked against `lesezeit-data` (repo must be private; write checked with a wrong-sha PUT), Gemini key optional, both stored in IndexedDB (`src/lib/db.ts`).
  - Home (`src/screens/Home.tsx`) reads `test/hello.json` from `lesezeit-data` via GitHub API (`src/lib/github.ts`), validated with Zod (`shared/schemas.ts`).
  - `.github/workflows/deploy.yml`: typecheck → unit tests → build → Playwright WebKit → Pages deploy.
  - Repos: `enesskocc/lesezeit` (public), `enesskocc/lesezeit-data` (private, contains `test/hello.json`).
- **Milestone 2 — Dictionary (code done, waiting for Enes' iPhone test)**
  - Decisions (Enes, 2026-10-21): both Wiktionaries (de: grammar, German definition, Turkish translations, synonyms/antonyms, family; en: English glosses, inflection tables, Rektion); adaptive shards + manifest; frequency = FrequencyWords/OpenSubtitles 2018; proper nouns, abbreviations, affixes, phrases and archaic-only words dropped.
  - `npm run dict:build` (`scripts/dict/build.ts`, helpers in `lib.ts`, tests `lib.test.ts`): downloads to `%LOCALAPPDATA%\lesezeit-dict-cache` (not OneDrive, ~420 MB), writes `public/dict/` (~181k lemmas, ~745k forms, ~63 MB raw / ~14 MB gzip, shards ≤ 250 KB, largest download per tap ~70 KB gzip).
  - Format + shard lookup: `shared/dict.ts` (shared with the pipeline). App lookup: `src/lib/dict.ts`; UI: `src/screens/Dictionary.tsx` + `src/components/WordCard.tsx` (reused by the M5 word sheet); attribution: `src/screens/Licenses.tsx`.
  - Looked-up shards are cached by the service worker (works offline for those words); manifest maps each shard prefix → content hash, used as `?v=`. App re-reads the manifest after 6 h or on a 404.
  - Noun homographs differing in gender/plural are separate entries with `h` (id `Steuer:n:2`): die/das Steuer, Bank (Bänke/Banken), der Leiter/die Leiter, Kiefer.
  - Windows-reserved shard names get a `~` (`aux~.json`) via `shardFile()`; `public/dict/LICENSE.md` ships the CC BY-SA notice.
  - Code review (agency-agents Code Reviewer) done; 12 findings fixed (double articles, homographs, regional "sein", NFC, reserved names, stale manifest, …).

## Next
1. Enes: iPhone test of the Sözlük tab (fing, Häusern, angefangen). (M2 acceptance)
2. Milestone 3 — Pipeline without AI (feeds, extraction, heuristics, commit to `lesezeit-data`). Stop after M3.

## Open questions
- M3: verify each RSS feed actually yields full text; drop teaser-only feeds.
- M3 heuristic "share of words outside the 5,000 most frequent lemmas": ranks come from subtitles (spoken German), so formal news words rank lower than in a news corpus. Expect slightly higher "rare word" shares; calibrate thresholds on real texts.
- Dictionary quality notes: synonyms/antonyms only from senses 1–2 (no fallback — Wiktionary often lists them only for rare senses); Turkish translations prefer sense 1, else any sense; Rektion only where en.wiktionary glosses say "with X (+ case)". Verb homographs (e.g. separable vs. inseparable "umfahren") are still merged.
- Before M5: switch service worker to `registerType: 'prompt'` (no surprise reload mid-session) and add one E2E test with the service worker enabled (offline launch).
- The read-only-token branch of the write probe (403) is only tested with a mock; the 409 "can write" branch was verified against the real API.
