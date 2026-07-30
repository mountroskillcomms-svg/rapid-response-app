<!--
  HANDOFF PROMPT — paste the body of this file into a fresh Claude chat to
  continue the Cloudflare deployment with full context. Written 2026-07-30.
-->

# Context: deploying the "Rapid Response" app to free Cloudflare hosting

I'm continuing work from a previous chat. Please read this context, then help me execute the Cloudflare deployment described at the end.

## What the app is
A local research-brief tool for a 3-person NZ Labour "Mt Roskill Rapid Response Team." Vite + React 19 single-page app; the core is one large component `src/RapidResponseBrief.jsx` (~10k lines). It runs a multi-stage Anthropic-API pipeline (triage → dossier → position → electorate-link → evidence → angles → verify → hallucination/credibility sweeps), plus a daily media sweep, a Campaign War Room (issue terrain + electorate map + target board), portfolio/interview modes, and an on-demand red-team pass. Guidance-only (never drafts statements).

## Where everything lives
- App: `C:\Users\ethan\rapid-response-app` — a git repo, pushed to **private** `github.com/mountroskillcomms-svg/rapid-response-app` (branch `main`). GitHub username `mountroskillcomms-svg`; email `mountroskillcomms@gmail.com`; git uses HTTPS + Git Credential Manager.
- Second brain (shared data): **private** `github.com/newera2040/labour-second-brain` (an Obsidian vault: polls, electorates, policy, issues, analysis, people-orgs). Currently cloned as a sibling folder `../labour-second-brain` and read live.
- API key: `ANTHROPIC_API_KEY` in `.env` (gitignored, server-side only, never in the browser). Models via `MODEL_DEEP`/`MODEL_FAST` constants (Claude Sonnet/Haiku).

## Critical architecture fact
There is **no production server** — the app was built so the **Vite dev server IS the backend** (`npm run dev`, binds 127.0.0.1). The backend surface, currently implemented as Vite dev-server plugins/proxy in `vite.config.js` and `vault-api.mjs`, is:
1. `/anthropic/*` — proxies to api.anthropic.com, injects `x-api-key` from `.env`, strips origin/referer. (Vite `server.proxy`)
2. `/vault.json` + `/vault/doc?file=` — serves the vault. `vault-api.mjs` is a JS port of the vault's `tools/export_vault.py` (data-contract **schema 1.3**); uses Node `fs` + `execFileSync('git', ['rev-parse'])`.
3. `/knowledge/*` static + `/kb/policies` + `/kb/lines` (POST/DELETE) — the policy/message-line DB; **writes files** to `public/knowledge/`.
4. `/sweepfeed` + `/sweepfeed/commit` (POST) — server-side RSS/feed aggregation for the daily sweep; **writes** `.feed-cache.json` + `.sweep-seen.json`. (~450 lines of `knowledgeApi()` in `vite.config.js`.)
5. `/urlcheck` (POST) — URL-liveness pre-check for the hallucination sweep (server-side fetch).

## Tech/state notes (don't undo these)
- Tailwind is a **local build** (`tailwind.config.js` + `postcss.config.js` + `@tailwind` directives in `src/index.css`) — migrated OFF the Play CDN because the CDN half-loaded on real machines. Do NOT reintroduce the CDN.
- recharts is lazy-loaded via `src/Charts.jsx` (React.lazy); jspdf is dynamically imported in `src/exportImport.js`. Initial JS chunk ~558kB.
- `src/vault.js` is the second-brain client (getters: polls, seat board, doc search, related-notes graph, grounding, etc.). All vault reads are zero-token.
- The app already deeply integrates the vault (prompt grounding + a read-only explorer with poll charts, doc reader, full-text search, related-notes graph, target board, mobilisation lens, home pulse), plus cost controls (vault-grounded search-budget trimming, pre-run $ estimate, a global API-status/billing banner). Debugged twice, clean build/lint.
- A local-run deploy guide already exists: `SETUP.md` (per-person `npm run dev`).

## THE TASK — re-platform for free Cloudflare hosting (decisions already made)
Goal: host it **free, private, and phone-installable** for 3 people, keeping the API.
- **Cloudflare Pages** serves the built SPA; **Pages Functions/Workers** host the backend (API-key proxy + the endpoints above), with the API key as an encrypted **Worker secret** (one shared team key, with a spend cap).
- **Cloudflare Access** (free, ≤50 users) gates the whole app to my 3 specific logins → private, and stops a public URL from burning API credits.
- **PWA** (web-app manifest + icon + service worker) so it "Add to Home Screen" installs on phones.
- **Vault freshness = build-time snapshot + auto-redeploy** (DECIDED): a build step runs the exporter and bakes `vault.json` + doc bodies into the deploy as static assets; the vault repo triggers a Pages rebuild (deploy hook) when it changes. No runtime GitHub calls, no vault secret. Vault is fresh as of the last deploy (hourly/daily), not instant.

### The real work (Cloudflare's serverless runtime has NO filesystem and NO git, so these must be ported)
1. **Vault** → replace the `fs`/`git` reader with the build-time snapshot: run the exporter at build, output `vault.json` + a bundle of doc bodies (issues/policy/analysis + `06-People-Orgs/Coalition Government Key Ministers.md` + electorate sub-notes) as static assets; serve them (and adapt `vault.js`/`vault-api.mjs` accordingly).
2. **`/anthropic/*` proxy** → a Pages Function that forwards to Anthropic with the secret key, strips origin/referer, and passes through streaming/`pause_turn`.
3. **`/kb/policies` + `/kb/lines` writes** → move to **Cloudflare KV** (or make read-only / browser-local in the hosted build — needs a decision).
4. **`/sweepfeed` + `/sweepfeed/commit`** → port the RSS aggregation to a Function; move `.feed-cache.json` + `.sweep-seen.json` state to **KV** (or run stateless).
5. **`/urlcheck`** → a Function (server-side fetch; straightforward).
6. **PWA** → add manifest + icon + a minimal service worker; wire into `index.html`.
7. Keep the existing `npm run dev` local path working too (dev vs. Cloudflare should share backend logic where possible — consider extracting the endpoint handlers into a shared module).

I'll do the Cloudflare account steps myself (connect the repo, set the `ANTHROPIC_API_KEY` secret + any KV bindings, enable Access) — walk me through those like a guide. Start by proposing the concrete file/architecture plan (Functions layout, build step, what changes in `vault.js`/`vite.config.js`), then build it.

Open decision to confirm with me first: how to handle the policy/message-line write-back (KV vs. read-only vs. browser-local) in the hosted version.
