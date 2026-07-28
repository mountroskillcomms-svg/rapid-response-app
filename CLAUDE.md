# Rapid Response app

NZ Labour comms tool: rapid-response briefs, daily sweep, Campaign War Room,
portfolio/interview prep. Vite + React; the dev server holds the Anthropic
API key behind a proxy (`/anthropic`) and serves two local data layers:

- `public/knowledge/` — the app's own curated knowledge folder
  (`src/knowledge.js`, `kb*` getters).
- the **Labour Second Brain vault** (see below) — served via
  `vault-api.mjs` (`/vault.json`, `/vault/doc`), consumed by `src/vault.js`
  (`vb*` getters). `VAULT_CHANNELS` in `src/vault.js` documents which vault
  documents feed which feature; keep it truthful when wiring changes.

## Political data source: the Labour Second Brain vault

This app gets its political facts (polling, electorates, policy positions,
live issues) from a shared Obsidian vault — never from hardcoded values or
from the model's own knowledge.

- Repo: git@github.com:newera2040/labour-second-brain.git
- Available at $LABOUR_VAULT (or ../labour-second-brain as a sibling clone —
  this app reads it live through vault-api.mjs; there is no vendored copy).
- Preferred input: the exported JSON surface. The canonical exporter is
  `python3 tools/export_vault.py` in that repo; this app's `vault-api.mjs`
  is a faithful JS port of it (same schema, same warnings), serving
  `/vault.json` fresh whenever the vault changes on disk. Read the JSON; do
  not parse the Markdown unless asked. (`/vault/doc` serves whole notes for
  the curated prompt channels in `src/vault.js` — extend `VAULT_CHANNELS`
  rather than fetching ad hoc.)

Before writing code that reads it, read these in the vault:
- `04-Projects/Vault Data Contract.md` — the authoritative schema.
- `04-Projects/App Integration Guide.md` — how to wire it up.
- `tools/export_vault.py` and `tools/poll_trend.py` — reference readers.

Rules:
1. Read-only. Never write to the vault from app code. If we need to write
   back, stop and ask — it goes via branch + PR with human review. (Note:
   the vault's Obsidian Git plugin auto-pushes saves to main — so never
   "just edit" files in the vault folder either.)
2. Only depend on fields documented in the data contract. Need something
   undocumented? Flag it — the contract gets extended, not worked around.
3. `null` means "not reported". Never zero-fill, interpolate, or guess.
   Propagate nulls to the UI as "no data".
4. Assert `schema_version` (currently "1.3") at startup; fail loudly if it
   moved. (Implemented: `EXPECTED_SCHEMA` in `src/vault.js`; a mismatch
   turns the 2B header chip red rather than crashing the app — this tool
   must not brick itself mid-campaign, but the mismatch must be impossible
   to miss. If the vault bumps the schema, re-verify every field this app
   reads, then update `EXPECTED_SCHEMA` and `vault-api.mjs` together.)
5. Surface `provenance` (`original-report` vs `compilation`),
   `status: needs-review`, and `last_updated`. Never silently mix verified
   and unverified data.
6. `notional_*` electorate fields are estimates on 2026 boundaries, not
   results. Label them as such.
7. Never invent political facts. Not in the vault → not in the app.

When the app starts consuming a new part of the vault, tell me — it must be
registered in the vault's `04-Projects/` note and the contract's Consumers
list. The current registration draft lives at
`docs/vault-registration-note.md` in this repo.
