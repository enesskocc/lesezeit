# Progress

_Last updated: 2026-10-15_

## Done
- **Milestone 1 — Setup (code done, waiting for Enes' iPhone test)**
  - Vite 8 + React 19 + TS 7 + Tailwind 4 + vite-plugin-pwa; fonts self-hosted (offline).
  - Setup screen (`src/screens/Setup.tsx`): GitHub token checked against `lesezeit-data` (must have push + repo must be private), Gemini key optional, both stored in IndexedDB (`src/lib/db.ts`).
  - Home (`src/screens/Home.tsx`) reads `test/hello.json` from `lesezeit-data` via GitHub API (`src/lib/github.ts`), validated with Zod (`shared/schemas.ts`).
  - `.github/workflows/deploy.yml`: typecheck → build → Playwright WebKit → Pages deploy.
  - Repos: `enesskocc/lesezeit` (public), `enesskocc/lesezeit-data` (private, contains `test/hello.json`).

## Next
1. Enes: create fine-grained token, install the PWA on iPhone, enter token → Home shows the test message. (M1 acceptance)
2. Milestone 2 — Dictionary: kaikki.org import script (Windows), shards under `public/dict/`, lookup form → lemma → grammar. Acceptance: "fing", "Häusern", "angefangen".
3. Milestone 3 — Pipeline without AI (feeds, extraction, heuristics, commit to `lesezeit-data`). Stop after M3 today.

## Open questions
- M2: shards "by first two letters" may exceed 300 KB for common prefixes (ge-, be-, ver-) → plan: split those shards by 3 letters and keep a small shard index. Needs Enes' OK.
- M2: which free frequency list (Leipzig Corpora, CC BY vs. OpenSubtitles-based lists).
- M3: verify each RSS feed actually yields full text; drop teaser-only feeds.
- Before M5: switch service worker to `registerType: 'prompt'` (no surprise reload mid-session) and add one E2E test with the service worker enabled (offline launch).
- The read-only-token branch of the write probe (403) is only tested with a mock; the 409 "can write" branch was verified against the real API.
