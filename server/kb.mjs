/* ============================================================
   KNOWLEDGE-DB WRITE HELPERS — portable, storage-agnostic.

   The policy database and message-discipline line memory both
   accept human-approved entries. This module owns the pure
   shaping/validation of those entries; the caller owns storage:

     - dev  : vite.config.js writes JSON files into public/knowledge/
     - prod : Cloudflare Pages Functions write to KV

   No `fs`, no `path` — safe to import in the Workers runtime.
   ============================================================ */

/** Filesystem/KV-safe slug: lowercase, strip accents, non-alphanumerics → '-'. */
export const slug = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 80)

/**
 * Shape + validate an approved policy entry from a request body.
 * @throws if title or party is missing (mirrors the dev server's 400).
 * @returns { id, entry } — entry is the JSON persisted under that id.
 */
export function buildPolicyEntry(body) {
  const b = body || {}
  if (!b.title || !b.party) throw new Error('title and party are required')
  const id = slug(b.id || `${b.party}-${b.title}`)
  const entry = {
    id,
    party: b.party,
    title: b.title,
    date: b.date || new Date().toISOString().slice(0, 10),
    summary: b.summary || '',
    source_url: b.source_url || '',
    approvedAt: new Date().toISOString(),
  }
  return { id, entry }
}

/**
 * Merge new angles into an issue's message-discipline line entry.
 * @param body     request body { issue, angles[], slug? }
 * @param existing the current stored entry for this issue, or null
 * @throws if issue or a non-empty angles[] is missing.
 * @returns { id, entry, count }
 */
export function mergeLineEntry(body, existing) {
  const b = body || {}
  if (!b.issue || !Array.isArray(b.angles) || !b.angles.length) {
    throw new Error('issue and angles[] are required')
  }
  const id = slug(b.slug || b.issue)
  const entry = existing && typeof existing === 'object'
    ? { slug: id, issue: b.issue, angles: Array.isArray(existing.angles) ? [...existing.angles] : [], updatedAt: '' }
    : { slug: id, issue: b.issue, angles: [], updatedAt: '' }
  const seen = new Set(entry.angles.map((a) => a.trim()))
  for (const a of b.angles) {
    const t = String(a).trim()
    if (t && !seen.has(t)) { entry.angles.push(t); seen.add(t) }
  }
  entry.angles = entry.angles.slice(-12) // keep the freshest dozen lines per issue
  entry.issue = b.issue
  entry.updatedAt = new Date().toISOString()
  return { id, entry, count: entry.angles.length }
}
