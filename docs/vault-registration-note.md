<!--
  REGISTRATION for the labour-second-brain vault (§8 of the App Integration
  Guide). SUBMITTED 2026-07-23 — PR open on branch
  `register-rapid-response-app` against `newera2040/labour-second-brain`,
  awaiting a human merge. The commit added, on that branch:
    - 04-Projects/Rapid Response App.md          (the note below)
    - 04-Projects/Vault Data Contract.md         → Consumers list bullet
    - 04-Projects/Projects-MOC.md                → "Apps consuming the vault"
  Once merged, `git pull` on the vault's main brings it into the local clone.
  This file is the source-of-record copy of the note; keep it in sync if the
  vault note is later edited.

  DO NOT edit these files in the live vault folder directly — the Obsidian
  Git plugin auto-pushes to main; changes must go through a branch + PR.
-->

---
title: Rapid Response App
type: project
tags: [project, app]
status: active
last_updated: 2026-07-23
owner: Ethan
related: ["[[Vault Data Contract]]", "[[App Integration Guide]]", "[[Projects-MOC]]"]
---

# Rapid Response App

## What it does
Vite/React comms tool for NZ Labour rapid response: same-day attack/policy
briefs, a daily media sweep, the Campaign War Room (issue terrain +
electorate map), and portfolio/interview prep. AI stages (Claude) are
grounded in this vault instead of web searches wherever the vault already
holds the fact.

## How it uses the vault
Read live via a dev-server JS port of `tools/export_vault.py`
(`vault-api.mjs` in the app repo — same schema, same validation warnings),
plus whole-note bodies for a curated set of prompt channels. The app's
`src/vault.js` `VAULT_CHANNELS` table is the always-current version of this
mapping.

| Reads / writes | Folder or file | Which frontmatter fields | Notes |
|---|---|---|---|
| reads | `03-Data/Polls/` | `party_vote`, `provenance`, `pollster`, `sponsor`, `fieldwork_end`, `sample_size`, `margin_of_error`, `preferred_pm` | poll-of-record table in every AI call's cached prefix; nulls kept as "not reported" |
| reads | `03-Data/Electorate Markers/` | `campaign_status`, `lab_margin`, `swing_to_flip`, `leader`, `roll`, `location` | seat board in the cached prefix; War Room map rings + seat panel |
| reads | `09-Electorates/*/` | full profile schema incl. `notional_*`, `labour_candidate`, `incumbent*`; candidate notes | single-seat scan grounding, labelled as 2026-boundary estimates |
| reads | `02-Issues/` (bodies) | `title`, `status`, `last_updated` + prose | terrain digest; topic-matched full brief into dossier/angles |
| reads | `01-Policy/` (bodies) | same | party platforms into dossier/position; Labour topic docs into position stage |
| reads | `08-Analysis/` (bodies) | same | State of the Race → terrain; Attack & Rebuttal Register → angles/interview; Party Comparison Matrix → interview; Labour Record → record-attack angles |
| reads | `04-Projects/Vault Data Contract.md` | `schema_version` | asserted at startup (expects 1.3); mismatch flagged red in the UI |

- **Schema version depended on:** 1.3
- **Writes back to the vault?** No. Strictly read-only; the app's own
  human-approved outputs (policy DB, message lines) stay in the app's
  `public/knowledge/` folder.

## Where it runs
Local Vite dev server (the server also holds the Anthropic key). Vault
located via `LABOUR_VAULT` env var or as a sibling clone
`../labour-second-brain`; freshness = whatever the local clone's git state
is (Obsidian Git auto-pull keeps it current).

## Status
Integrated and running locally (2026-07-23): stable-prefix injection
(polls + seat board), War Room backdrop (State of the Race, issue digests,
seat profiles), response-pipeline grounding (platforms, issue briefs,
attack register, Labour record), UI status chip + channel panel with the
vault's own contract warnings surfaced.

## Decisions Log
- 2026-07-23: JS port of the exporter inside the app's dev server rather
  than invoking the Python exporter (no Python on the dev machine; live
  re-export on vault change). Pinned to schema 1.3; port and app must be
  updated together with any contract bump.
- 2026-07-23: schema mismatch flags red in the UI instead of hard-failing —
  a comms tool mid-campaign must degrade loudly, not brick.

## Open Questions / Risks
- Exporter port can drift from `tools/export_vault.py` if the vault changes
  its exporter without a schema bump — mitigated by the version assert and
  the warnings surface, but worth a glance at vault PRs touching `tools/`.
- Prose channels read note BODIES, which the contract calls human-facing;
  the app treats them as grounding-with-flags (status, last_updated
  attached), never as machine fields.

## Related
[[App Integration Guide]] · [[Vault Data Contract]] · app repo:
`rapid-response-app` (local), `CLAUDE.md` there carries the vault rules.
