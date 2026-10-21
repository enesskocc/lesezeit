# Progress

_Last updated: 2026-10-22_

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
- **Milestone 4 — Claude in the pipeline ✅ accepted 2026-10-21** (pipeline acceptance + iPhone: two texts listed, level reasons and tap-to-translate work)
  - Real runs 2026-10-21 with the subscription (`authMethod: oauth_token`, Claude Code 2.1.304, Opus): run 1 annotated a B2 text in 6 calls / 3 min (lemma flags 10 = compound nouns missing from the dictionary; questions passed the check first time). Run 2 with `fake_limit_after=6` stopped at the questions step and left `state/pending.json` = `{level:false, batches:[], questions:true, check:true, reason:"limit"}`, matching the saved text (34/34 sentences annotated, `annotated:false`, not listed). Run 3 resumed it with 2 calls and emptied pending. → the C1 text of the day. Next scheduled target: B2.
  - Token: created 2026-10-21 with `claude setup-token`, valid ~1 year → renew around 2027-10 (the morning run turns red with "authentication failed").
  - Docs checked 2026-10-21 (code.claude.com): `claude setup-token` → 1-year OAuth token, secret `CLAUDE_CODE_OAUTH_TOKEN`; native installer; never `--bare` (ignores OAuth); `ANTHROPIC_API_KEY` outranks OAuth → workflow refuses to run with it; `--json-schema` → `structured_output`; failures come as `is_error: true` (subtype may still be "success"); limit text "You've hit your … limit · resets …".
  - **Decisions (Enes, 2026-10-21, deliberate deviation from spec):** model **Opus**; **one annotated text per day** ("quality over quantity, I read slowly"); target level **B2 and C1 in turn**; pipeline fetches a **pool of 4** new texts/day; the app lists **only annotated** texts.
  - Code: `pipeline/claude.ts` (CLI wrapper: limit/budget → `ClaudeLimitError`, one retry on invalid output, spawn/auth failure → `ClaudeFatalError` = red run), `pipeline/tokenize.ts` (deterministic tokens, Claude annotates by index), `pipeline/enrich.ts` (level → batches of 8 sentences → 5 questions → independent check + one rewrite; dictionary cross-check fills gender/plural, flags mismatches; every step saved), `pipeline/daily.ts` (pending first, then pick by target level; ≤ 4 level calls), `prompts/*.md` (v1, one example each), schema v2 in `shared/texts.ts`, `state/pending.json`.
  - Tests: `pipeline/ai.test.ts` with `pipeline/testing/fake-claude.mjs` (no network) — incl. ACCEPTANCE "forced limit → correct pending list, next run finishes it".
  - Workflow: installs Claude Code, checks `claude auth status` → `authMethod: oauth_token`, `--ai` only when the secret exists, manual input `fake_limit_after` for the acceptance test, timeout 45 min. Budget: `maxClaudeCalls` 24/run (a 600-word text ≈ 8 calls) + 30-min AI deadline.
  - Code review (agency-agents Code Reviewer) fixed: timeouts are retryable (not fatal); limit/auth text only checked on failed calls (a news quote can't fake a limit); batch answers must contain exactly the batch sentences; MWEs replaced per sentence; ≥ 50 % failed batches → not published, retried; "running" pending marker survives a killed job; failing texts parked after 2 attempts; Claude outages ("blocked") don't count against a text; question ids renumbered; list groups the daily text by its annotation day.
  - For the manual forced-limit acceptance run use `fake_limit_after` ≥ 6 (up to 4 calls may go to leveling before a text is started).

- **Milestone 5 — Reader ✅ accepted 2026-10-21** (iPhone: word sheet, guess mode, read-aloud, questions, airplane mode)
  - Decisions (Enes, 2026-10-21): display settings (font size, line height, serif/sans) → M10; texts download **automatically** for offline; **topic** labels from Claude in the level call (no extra call; `TOPICS` in `shared/texts.ts`, level prompt v2).
  - Offline design: the pipeline embeds the dictionary entries of every lemma in the text (`text.dict`, ~100–300 lemmas, ~160 KB/text) → word sheets need no dictionary download. `run.ts` back-fills older annotated texts (no Claude); the two existing texts were back-filled by hand on 2026-10-21.
  - App: `src/screens/Reader.tsx` + `src/components/reader/*` (ReaderText, WordSheet with guess mode, SentenceSheet, Questions, BottomSheet), `src/lib/{words,offline}.ts`, Dexie v2 (`prefs`, `wordStatus`, `cards` (no FSRS yet — M6), `readingLog`, `textCache`), "Okuma" tab = last text, service worker `registerType: 'prompt'` + `UpdateBanner` ("Yeni sürüm hazır · Yenile"). TextPreview removed (`#/metin/…` redirects to `#/oku/…`).
  - Word state is per lemma (`w:<lemma>`), expressions `m:<de>`; names (PROPN) count as ignored; separable prefix tokens are shown as their verb.
  - Tests: `e2e/reader.spec.ts` (ACCEPTANCE "an" → anfangen, colours, cards, guess "Hayır", questions/proof, finish), `e2e/offline.spec.ts` (ACCEPTANCE airplane mode with the service worker allowed).

- **Milestone 6 — Vocabulary core (built 2026-10-22, waiting for iPhone OK)**
  - Decisions (Enes, 2026-10-21): **no "listen & type"** (left out of the composer too); **production** added now; verb forms + synonym/antonym → M10, own sentence → M8; **word family rule-based** (stem + known suffix from the dictionary's `fam`, invented distractors with wrong suffixes, checked against the dictionary before showing); **Nomen↔Verb / Verb↔Präp. matching** filled with expressions from downloaded texts as unrated pairs; **flashcard self-rating with 4 buttons + next interval**.
  - FSRS: `ts-fsrs` 5.4.2, learning steps **1m / 5m / 10m** (Good → 5 min → 10 min → days, so a new card meets flashcard → matching → cloze in one session), relearning 10m, fuzz on, mature ≥ 21 days, day starts 04:00. Rating: wrong = Again, slow (> 10 s tap / 20 s typing) or hint or typo or wrong article = Hard, correct = Good, fast on mature = Easy. A mature card reads as "known" in the reader; a lapse makes it yellow again.
  - Code: `src/lib/{srs,exercises,session,review}.ts` (first three pure, unit-tested in `src/lib/vocab.test.ts`), Dexie v3 (`cards` + `fsrs`/`due`/`entry`/`lemma`/`mweKind`/`contexts[].forms`, new `reviewLog`, prefs `newPerDay` 15 / `maxReviews` 150 / `sound` / `sessionMinutes`; the upgrade converts milestone 5 cards using the cached text), `src/components/vocab/*`, screens `Vocab` (Kelimeler tab), `Session` (`#/kelimeler/oturum?dk=10` or `?alistirma=cloze`), `CardDetail` (`#/kart/:id`, delete with undo), limits + sound in Ayarlar.
  - Drills ("Alıştırma (tek tür)") let you try each exercise any time; on new or not-due cards they are practice only (logged, schedule unchanged).
  - Code review (agency-agents Code Reviewer) fixed: cloze blanks by saved character positions (`contexts[].spans`; a repeated word no longer shows the answer), no "typo" for wrong endings or missing umlauts (macht/machte, Mutter/Mütter) and exact plurals, a queued second tap can't record an answer twice, one malformed card can't block the database upgrade, word-family answer time starts when the options appear, flashcard saves at its preview time (shown interval = stored interval), drills respect the review limit and don't count practice as new, a matching drill repeats with matching, limit fields save on blur.
  - Tests: `e2e/vocab.spec.ts` — ACCEPTANCE 10-minute mixed session with Playwright's clock (6 cards from the reader, flashcard → matching → cloze, due dates checked in IndexedDB), drill = practice, list/detail/delete/undo, milestone 5 → 6 database upgrade.

## Next
1. Enes: iPhone test of M6 (steps in the chat), then milestone 7 (backup + coverage).
2. Recalibrate heuristic level cuts against Opus levels once ~20 texts are leveled.

## Open questions
- M3 heuristic "share of words outside the 5,000 most frequent lemmas": ranks come from subtitles (spoken German), so formal news words rank lower than in a news corpus — cuts were calibrated on real news texts, so this is accounted for.
- Day picks: spec step 7 (2 per level, coverage 90–98 %) is replaced by Enes' one-text-per-day B2/C1 rotation; known-word coverage (M7) can later choose among same-level candidates.
- DLF's Nachrichten feed is mostly < 250-word bulletins (rejected as "short"); consider adding DLF background feeds later.
- `state/last-run.json` changes every run, so the data repo gets one commit per day even without new texts (harmless).
- Dictionary quality notes: synonyms/antonyms only from senses 1–2 (no fallback — Wiktionary often lists them only for rare senses); Turkish translations prefer sense 1, else any sense; Rektion only where en.wiktionary glosses say "with X (+ case)". Verb homographs (e.g. separable vs. inseparable "umfahren") are still merged.
- (done in M5) service worker uses `registerType: 'prompt'`; offline launch has an E2E test with the service worker enabled.
- The read-only-token branch of the write probe (403) is only tested with a mock; the 409 "can write" branch was verified against the real API.
