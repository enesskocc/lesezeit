# Lesezeit — project notes for Claude

Private German reading + vocabulary PWA for Enes only. Never published to any store.

- **Read first:** `PROGRESS.md` (where we are), then `SPEC.md` (source of truth). `docs/prototype.html` is UX reference only — its words and translations are samples, never real data.
- **Talk to Enes in Turkish.** App UI is Turkish, reading content German, code comments English.
- **Work milestone by milestone** (SPEC.md → Milestones). Before each: list files + unsure decisions. After each: stop, give exact iPhone test steps, wait for OK.
- **Ask before any step where Enes must log in, create a token/repo, add a secret or click on GitHub** — give exact step-by-step instructions.
- **Zero cost:** only GitHub Free (Pages, Actions, repos), Gemini free tier, Claude via `claude -p` + OAuth token. Never add anything that needs billing; never fall back to a paid API key.
- **Never commit tokens, keys or full news texts to this public repo.** Texts live only in the private `enesskocc/lesezeit-data` (local clone: `..\lesezeit-data`, never nested inside this folder). Test fixtures must be synthetic.

## Repos
- `enesskocc/lesezeit` (public) = this folder. App, pipeline scripts, dictionary shards. Pages: https://enesskocc.github.io/lesezeit/
- `enesskocc/lesezeit-data` (private). `texts/`, `inbox/`, `backup/`, `sources.json`, daily workflow.

## Commands
- `npm run dev` / `npm run build` / `npm run typecheck`
- `npm run test:e2e` — Playwright WebKit (iPhone 15 profile) against `vite preview`; build first. GitHub API is mocked.
- `npm run lock:check` before every push (Windows npm drops Linux-only optional deps → CI `npm ci` fails); fix with `npm run lock:refresh`.
- `npm run icons` — regenerate PWA icons from `public/icon.svg`.
- `npm run test:unit` — node:test unit tests (dictionary importer + pipeline). Pipeline fixtures are synthetic HTML only.
- `npm run pipeline -- --data <folder>` — run the daily pipeline locally. Use a temp folder (e.g. `%LOCALAPPDATA%\lz-dry`) with a copy of `sources.json`/`pipeline.json`; it refuses paths inside this repo. In production it runs from `lesezeit-data/.github/workflows/daily.yml` (03:30 UTC + manual "Run workflow").
- `fs.rmSync` silently does nothing on this machine's "Masaüstü" paths (Node 24) — always use `fs.promises.rm`. That is why `prebuild` clears `dist/` itself.
- `npm run dict:build` — rebuild `public/dict/` from Wiktionary (~3 min, downloads ~420 MB once to `%LOCALAPPDATA%\lesezeit-dict-cache`, never into OneDrive). Rebuild rarely: every rebuild adds ~14 MB to git history.
- Node runs `.ts` scripts directly (type stripping): imports inside `scripts/` and `shared/` used by scripts need explicit `.ts` extensions; no enums/namespaces (`erasableSyntaxOnly`).
- Graphify: `python -m graphify update .` after big changes; query with `python -m graphify query "..."`.

## Decisions (with date)
- 2026-10-15: E2E = **Playwright WebKit**, not Detox (Detox only drives native RN apps). Enes: this project only — the global Detox rule stays for Expo apps.
- 2026-10-15: Shared origin `enesskocc.github.io` (other Pages sites) accepted; token is scoped to `lesezeit-data` only. **Never create the `enesskocc.github.io` user-site repo with a root `/sw.js`** — a root-scoped service worker would control `/lesezeit/` too.
- 2026-10-15: Write access is checked with a wrong-sha PUT (409 = can write, nothing written; 403 = read-only), because `permissions.push` shows the user's role, not the fine-grained token's.
- 2026-10-15: Hash routing (`#/kurulum`) because Pages has no SPA fallback. Gemini key optional until milestone 8.
- 2026-10-21 (Enes): **one Opus-annotated text per day**, B2/C1 in turn, pool of 4 fetched texts; app lists annotated texts only. Overrides the spec's "2 per level".
- 2026-10-22 (Enes, after the iPhone test): vocabulary practice is **matching only** — no flashcard, cloze, artikel, production, word family or listen & type. Matching tiles are silent when tapped; German tiles have a 🔊 button; no sound toggle. FSRS learning steps 1m/5m/10m = three matching rounds (see PROGRESS M6).
- Claude in CI: `claude -p` with `CLAUDE_CODE_OAUTH_TOKEN`; never `--bare`; never set `ANTHROPIC_API_KEY` (it would bill the API). Tests use `pipeline/testing/fake-claude.mjs`; `LESEZEIT_CLAUDE_CMD` (JSON array) swaps the binary, `LESEZEIT_FAKE_LIMIT_AFTER=N` forces a limit.
- iOS: a home-screen PWA has storage separate from Safari → keys must be entered inside the installed app.
