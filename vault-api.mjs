/* ============================================================
   LABOUR SECOND BRAIN — dev-server API.

   Serves the shared Obsidian vault (labour-second-brain repo) to
   the app as JSON, live: the vault is git-pulled/edited
   independently, and every request here re-reads it if anything
   changed on disk. No manual export step.

   This is a faithful JS port of the vault's canonical exporter
   (tools/export_vault.py in the vault repo), pinned to data
   contract schema 1.3 — same skip rules, same required fields,
   same enums, same warnings behaviour. Nothing is guessed or
   zero-filled; a missing value stays null; notes that violate the
   contract land in `warnings` rather than being silently dropped.
   If the vault's exporter changes shape, change this file in the
   same breath — the client asserts schema_version and will flag
   a mismatch in the UI rather than run on moved ground.

   READ-ONLY by design: nothing here ever writes into the vault.
   (Vault rule: writes go via branch + PR with human review.)

   Endpoints:
     GET /vault.json          full export (polls, electorates,
                              markers, candidates, notes, warnings)
     GET /vault/doc?file=REL  one note: { file, frontmatter, body }
                              (path-guarded to .md inside the vault)
   ============================================================ */

import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import YAML from 'yaml'

const SKIP_DIRS = new Set(['.git', '.github', '.obsidian', '_Templates', '_Attachments',
  '_FileClasses', '_Bases', 'dist', 'tools'])
const SKIP_FILES = new Set(['README.md', 'CLAUDE.md', 'GETTING-STARTED-GIT.md'])

const TYPES = new Set(['policy', 'issue', 'data', 'project', 'meeting', 'person-org',
  'reference', 'analysis', 'electorate', 'moc'])
const STATUSES = new Set(['draft', 'active', 'needs-review', 'archived'])
const ROLLS = new Set(['general', 'maori'])
const CAMPAIGN_STATUSES = new Set(['defend', 'hold', 'target', 'stretch', 'left-bloc', 'none'])
const PROVENANCES = new Set(['original-report', 'compilation'])

const PARTY_KEYS = ['labour', 'national', 'act', 'green', 'nz_first', 'te_pati_maori', 'opportunity']

const COMMON_REQUIRED = ['title', 'type', 'status', 'last_updated']
const POLL_REQUIRED = ['pollster', 'fieldwork_end', 'party_vote', 'provenance', 'source_url']
const MARKER_REQUIRED = ['location', 'roll', 'campaign_status']
const PROFILE_REQUIRED = ['electorate', 'roll', 'campaign_status']

const PROFILE_FIELDS = [
  'electorate', 'region', 'roll', 'campaign_status', 'incumbent',
  'incumbent_party', 'labour_candidate', 'notional_leader',
  'notional_lab_margin_pct', 'swing_to_flip', 'notional_lab_pv',
  'notional_nat_pv', 'notional_grn_pv', 'notional_left_bloc',
  'notional_right_bloc', 'enrolled_2023', 'nonvoters_2023',
  'nonvoters_under35', 'nonvoter_rate_pct', 'predecessors',
]

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

const isPlaceholder = (v) => typeof v === 'string' && (v.includes('{{') || v.includes(' | '))

/* Vault files arrive with mixed line endings (Windows checkouts write CRLF;
   a trailing bare \r breaks strict YAML 1.2 parsing) — normalize first. */
const normalize = (s) => s.replace(/^﻿/, '').replace(/\r\n?/g, '\n')

function readFrontmatter(raw) {
  const text = normalize(raw)
  if (!text.startsWith('---')) return null
  const end = text.indexOf('\n---', 3)
  if (end === -1) return null
  let fm
  try { fm = YAML.parse(text.slice(3, end)) } catch { return null }
  return fm && typeof fm === 'object' && !Array.isArray(fm) ? fm : null
}

export function createVaultReader(vaultDir) {
  const VAULT = path.resolve(vaultDir)
  const POLLS_DIR = path.join(VAULT, '03-Data', 'Polls')
  const MARKERS_DIR = path.join(VAULT, '03-Data', 'Electorate Markers')
  const ELECTORATES_DIR = path.join(VAULT, '09-Electorates')
  const CONTRACT = path.join(VAULT, '04-Projects', 'Vault Data Contract.md')

  const available = () => fs.existsSync(CONTRACT)

  /* Every content note, sorted like the Python exporter (rglob order). */
  function listNotes() {
    const out = []
    const walk = (dir) => {
      let entries
      try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
      for (const e of entries) {
        if (e.isDirectory()) {
          if (!SKIP_DIRS.has(e.name)) walk(path.join(dir, e.name))
        } else if (e.name.endsWith('.md')) {
          const full = path.join(dir, e.name)
          if (path.dirname(full) === VAULT && SKIP_FILES.has(e.name)) continue
          out.push(full)
        }
      }
    }
    walk(VAULT)
    return out.sort()
  }

  /* Change detection: latest mtime + file count over the vault's .md files.
     ~175 stats per request is well under a millisecond of real cost; the
     export itself only rebuilds when this signature moves. */
  function signature(files) {
    let maxM = 0
    for (const f of files) {
      try { const m = fs.statSync(f).mtimeMs; if (m > maxM) maxM = m } catch { /* deleted mid-scan */ }
    }
    return `${files.length}:${maxM}`
  }

  function vaultCommit() {
    try {
      return execFileSync('git', ['-C', VAULT, 'rev-parse', 'HEAD'],
        { encoding: 'utf8', timeout: 10000 }).trim() || null
    } catch { return null }
  }

  const rel = (p) => path.relative(VAULT, p).split(path.sep).join('/')

  function buildExport() {
    const warnings = []
    const warn = (p, message) => warnings.push({ file: rel(p), message })

    const checkCommon = (p, fm) => {
      for (const f of COMMON_REQUIRED) if (fm[f] == null || fm[f] === '') warn(p, `missing required field \`${f}\``)
      for (const [f, v] of Object.entries(fm)) if (isPlaceholder(v)) warn(p, `\`${f}\` still holds template placeholder text`)
      const t = fm.type
      if (t && !TYPES.has(t) && !isPlaceholder(t)) warn(p, `unknown \`type\`: '${t}'`)
      const s = fm.status
      if (s && !STATUSES.has(s) && !isPlaceholder(s)) warn(p, `unknown \`status\`: '${s}'`)
      const d = fm.last_updated
      if (d != null && !(typeof d === 'string' && ISO_DATE.test(d)) && !(d instanceof Date))
        warn(p, `\`last_updated\` is not an ISO YYYY-MM-DD date: '${d}'`)
    }
    const checkEnum = (p, fm, field, allowed) => {
      const v = fm[field]
      if (v == null || isPlaceholder(v)) return
      if (!allowed.has(v)) warn(p, `unknown \`${field}\`: '${v}'`)
    }
    const checkRequired = (p, fm, fields) => {
      for (const f of fields)
        if (!(f in fm) || fm[f] === '' || (Array.isArray(fm[f]) && fm[f].length === 0))
          warn(p, `missing required field \`${f}\``)
    }
    const iso = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v ?? null)

    const buildPoll = (p, fm) => {
      checkRequired(p, fm, POLL_REQUIRED)
      checkEnum(p, fm, 'provenance', PROVENANCES)
      let vote
      const pv = fm.party_vote
      if (pv && typeof pv === 'object' && !Array.isArray(pv)) {
        for (const k of PARTY_KEYS) if (!(k in pv))
          warn(p, `\`party_vote\` missing party key \`${k}\` (use null, not omission, if not reported)`)
        for (const k of Object.keys(pv)) if (!PARTY_KEYS.includes(k))
          warn(p, `\`party_vote\` has undocumented key '${k}'`)
        for (const [k, v] of Object.entries(pv)) if (v === 0)
          warn(p, `\`party_vote.${k}\` is 0 — if the party was not reported this must be null`)
        vote = Object.fromEntries(PARTY_KEYS.map((k) => [k, pv[k] ?? null]))
      } else {
        warn(p, '`party_vote` is missing or not a mapping')
        vote = Object.fromEntries(PARTY_KEYS.map((k) => [k, null]))
      }
      return {
        file: rel(p), title: fm.title ?? null, pollster: fm.pollster ?? null,
        sponsor: fm.sponsor ?? null, fieldwork_start: iso(fm.fieldwork_start),
        fieldwork_end: iso(fm.fieldwork_end), release_date: iso(fm.release_date),
        sample_size: fm.sample_size ?? null, margin_of_error: fm.margin_of_error ?? null,
        method: fm.method ?? null, provenance: fm.provenance ?? null, party_vote: vote,
        preferred_pm: fm.preferred_pm ?? null, source_url: fm.source_url ?? null,
        status: fm.status ?? null, last_updated: iso(fm.last_updated),
      }
    }

    const buildMarker = (p, fm) => {
      checkRequired(p, fm, MARKER_REQUIRED)
      checkEnum(p, fm, 'roll', ROLLS)
      checkEnum(p, fm, 'campaign_status', CAMPAIGN_STATUSES)
      let location = fm.location
      if (!(Array.isArray(location) && location.length === 2 && location.every((n) => typeof n === 'number'))) {
        warn(p, `\`location\` is not a [lat, lng] pair: '${JSON.stringify(location)}'`)
        location = null
      }
      return {
        file: rel(p), electorate: fm.title ?? null, location, roll: fm.roll ?? null,
        leader: fm.leader ?? null, lab_margin: fm.lab_margin ?? null,
        swing_to_flip: fm.swing_to_flip ?? null, campaign_status: fm.campaign_status ?? null,
        last_updated: iso(fm.last_updated),
      }
    }

    const buildProfile = (p, fm) => {
      checkRequired(p, fm, PROFILE_REQUIRED)
      checkEnum(p, fm, 'roll', ROLLS)
      checkEnum(p, fm, 'campaign_status', CAMPAIGN_STATUSES)
      const profile = Object.fromEntries(PROFILE_FIELDS.map((f) => [f, fm[f] ?? null]))
      return {
        ...profile, file: rel(p), title: fm.title ?? null, status: fm.status ?? null,
        last_updated: iso(fm.last_updated), sub_notes: [], candidates: [],
      }
    }

    const buildCandidate = (p, fm) => ({
      file: rel(p), name: fm.title ?? null, party: fm.party ?? null,
      electorate: fm.electorate ?? null, role_2026: fm.role_2026 ?? null,
      incumbent: fm.incumbent ?? null, former_mp: fm.former_mp ?? null,
      status: fm.status ?? null, last_updated: iso(fm.last_updated),
    })

    const polls = []; const markers = []; const profiles = {}
    const candidates = []; const subNotes = []; const notes = []

    for (const p of listNotes()) {
      let fm
      try { fm = readFrontmatter(fs.readFileSync(p, 'utf8')) } catch { fm = null }
      if (fm === null) {
        warn(p, 'no parseable YAML frontmatter — excluded from the export')
        continue
      }
      checkCommon(p, fm)
      const subtype = fm.subtype ?? null
      notes.push({
        file: rel(p), title: fm.title ?? null, type: fm.type ?? null, subtype,
        status: fm.status ?? null, last_updated: iso(fm.last_updated),
        owner: fm.owner ?? null, tags: fm.tags || [], related: fm.related || [],
      })
      const dir = path.dirname(p)
      if (dir === POLLS_DIR && subtype === 'poll') polls.push(buildPoll(p, fm))
      else if (dir === MARKERS_DIR && subtype === 'electorate-marker') markers.push(buildMarker(p, fm))
      else if (dir.startsWith(ELECTORATES_DIR + path.sep)) {
        if (subtype === 'profile') {
          const profile = buildProfile(p, fm)
          profiles[String(profile.electorate || profile.title)] = profile
        } else if (subtype === 'candidate') candidates.push(buildCandidate(p, fm))
        else if (fm.type === 'electorate' && subtype) {
          subNotes.push([path.basename(dir), {
            file: rel(p), title: fm.title ?? null, subtype, last_updated: iso(fm.last_updated),
          }])
        }
      }
    }

    const byFolder = Object.fromEntries(Object.values(profiles).map((pr) => [
      path.basename(path.dirname(pr.file)), pr,
    ]))
    for (const [folder, note] of subNotes) byFolder[folder]?.sub_notes.push(note)
    for (const c of candidates) profiles[String(c.electorate)]?.candidates.push(c.name)

    polls.sort((a, b) => (a.fieldwork_end === null) - (b.fieldwork_end === null)
      || String(a.fieldwork_end).localeCompare(String(b.fieldwork_end)))
    markers.sort((a, b) => String(a.electorate || '').localeCompare(String(b.electorate || '')))

    const contractFm = available() ? readFrontmatter(fs.readFileSync(CONTRACT, 'utf8')) : null
    let schemaVersion = null
    if (contractFm?.schema_version != null) schemaVersion = String(contractFm.schema_version)
    else warn(CONTRACT, 'cannot read `schema_version` from the data contract — consumers cannot version-check')

    const sortedProfiles = Object.values(profiles)
      .sort((a, b) => String(a.electorate || '').localeCompare(String(b.electorate || '')))

    return {
      generated_at: new Date().toISOString().replace(/\.\d{3}Z$/, '+00:00'),
      schema_version: schemaVersion,
      vault_commit: vaultCommit(),
      counts: {
        notes: notes.length, polls: polls.length, markers: markers.length,
        electorates: sortedProfiles.length, candidates: candidates.length,
        warnings: warnings.length,
      },
      polls, electorates: sortedProfiles, candidates, markers, notes, warnings,
    }
  }

  let cache = null // { sig, json }
  function exportJson() {
    const files = listNotes()
    const sig = signature(files)
    if (!cache || cache.sig !== sig) {
      cache = { sig, json: JSON.stringify(buildExport()) }
    }
    return cache.json
  }

  /* One note's frontmatter + body, path-guarded to .md files inside the vault. */
  function readDoc(relFile) {
    const full = path.resolve(VAULT, relFile)
    if (!full.startsWith(VAULT + path.sep) || !full.endsWith('.md')) return null
    let text
    try { text = normalize(fs.readFileSync(full, 'utf8')) } catch { return null }
    const fm = readFrontmatter(text)
    const end = text.startsWith('---') ? text.indexOf('\n---', 3) : -1
    const body = end === -1 ? text : text.slice(end + 4).replace(/^\n/, '')
    return { file: rel(full), frontmatter: fm, body }
  }

  return { available, exportJson, readDoc, path: VAULT }
}

/* Vite plugin: mounts the vault endpoints on the dev server. */
export function vaultApi(vaultDir) {
  const reader = createVaultReader(vaultDir)
  return {
    name: 'labour-vault-api',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url, 'http://localhost')
        if (req.method === 'GET' && url.pathname === '/vault.json') {
          if (!reader.available()) {
            res.statusCode = 404
            res.end(JSON.stringify({ error: `vault not found at ${reader.path} — clone labour-second-brain as a sibling folder or set LABOUR_VAULT in .env` }))
            return
          }
          res.setHeader('Content-Type', 'application/json')
          res.end(reader.exportJson())
          return
        }
        if (req.method === 'GET' && url.pathname === '/vault/doc') {
          const doc = reader.available() ? reader.readDoc(url.searchParams.get('file') || '') : null
          if (!doc) { res.statusCode = 404; res.end('{}'); return }
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(doc))
          return
        }
        next()
      })
    },
  }
}
