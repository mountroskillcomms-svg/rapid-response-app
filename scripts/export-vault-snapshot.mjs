/* ============================================================
   VAULT SNAPSHOT — build step for Cloudflare (and local builds).

   Cloudflare's runtime has no filesystem and no git, so the live
   vault reader (vault-api.mjs, used by the dev server) can't run
   there. Instead we BAKE the vault into static assets at build
   time by reusing the very same reader — no second implementation
   to keep in sync.

   Output → public/vault-snapshot/  (gitignored; regenerated each build)
     vault.json          the full export (reader.exportJson())
     docs/dNNNN.json      one note's { file, frontmatter, body } per note
     manifest.json       { generated_at, vault_commit, docs: { relPath: "docs/dNNNN.json" } }

   The client (src/vault.js) reads these in production; in dev it
   still hits the live /vault.json + /vault/doc endpoints.

   Vault source resolution (first that works wins):
     1. LABOUR_VAULT           explicit local dir
     2. ../labour-second-brain  sibling clone (local default)
     3. VAULT_REPO + GITHUB_TOKEN  download the private repo tarball
        (build-time only — no runtime GitHub calls, no runtime secret)
     4. none → a valid EMPTY snapshot + warning (the app still builds;
        every vault getter already degrades to "")
   ============================================================ */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createVaultReader } from '../vault-api.mjs'

const OUT = path.resolve(process.cwd(), 'public/vault-snapshot')

async function downloadVaultTarball(repo, ref, token) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rr-vault-'))
  const tarPath = path.join(tmp, 'vault.tar.gz')
  const dest = path.join(tmp, 'vault')
  const ghHeaders = {
    Authorization: `Bearer ${token}`,
    'User-Agent': 'rapid-response-build',
    Accept: 'application/vnd.github+json',
  }
  const res = await fetch(`https://api.github.com/repos/${repo}/tarball/${ref}`, { headers: ghHeaders })
  if (!res.ok) throw new Error(`tarball download failed: HTTP ${res.status}`)
  fs.writeFileSync(tarPath, Buffer.from(await res.arrayBuffer()))
  fs.mkdirSync(dest, { recursive: true })
  // GitHub tarballs wrap everything in an owner-repo-<sha>/ dir — strip it.
  // GNU tar (Cloudflare's Linux image) and bsdtar (Windows) both accept this.
  execFileSync('tar', ['-xzf', tarPath, '-C', dest, '--strip-components=1'])
  // Best-effort commit sha (the temp dir isn't a git repo, so the reader
  // can't derive it — fetch it so the UI still shows vault provenance).
  let commit = null
  try {
    const c = await fetch(`https://api.github.com/repos/${repo}/commits/${ref}`, { headers: ghHeaders })
    if (c.ok) commit = (await c.json())?.sha || null
  } catch { /* provenance is nice-to-have */ }
  return { dir: dest, commit, cleanup: () => { try { fs.rmSync(tmp, { recursive: true, force: true }) } catch { /* temp */ } } }
}

async function resolveVaultSource() {
  const env = process.env
  if (env.LABOUR_VAULT && fs.existsSync(env.LABOUR_VAULT)) {
    return { dir: path.resolve(env.LABOUR_VAULT), label: `LABOUR_VAULT (${env.LABOUR_VAULT})` }
  }
  const sibling = path.resolve(process.cwd(), '../labour-second-brain')
  if (fs.existsSync(sibling)) return { dir: sibling, label: 'sibling ../labour-second-brain' }
  if (env.VAULT_REPO && env.GITHUB_TOKEN) {
    const ref = env.VAULT_REF || 'main'
    const t = await downloadVaultTarball(env.VAULT_REPO, ref, env.GITHUB_TOKEN)
    return { ...t, label: `tarball ${env.VAULT_REPO}@${ref}` }
  }
  return null
}

function writeEmptySnapshot(reason) {
  const now = new Date().toISOString()
  const empty = {
    generated_at: now, schema_version: null, vault_commit: null,
    counts: { notes: 0, polls: 0, markers: 0, electorates: 0, candidates: 0, warnings: 1 },
    polls: [], electorates: [], candidates: [], markers: [], notes: [],
    warnings: [{ file: '(build)', message: `vault snapshot built without a vault source: ${reason}` }],
  }
  fs.writeFileSync(path.join(OUT, 'vault.json'), JSON.stringify(empty))
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify({ generated_at: now, vault_commit: null, docs: {} }))
  console.warn(`⚠ vault snapshot: ${reason} — wrote an empty snapshot (app runs with no vault data).`)
}

async function main() {
  // Fresh output dir every build so deleted notes don't linger as stale docs.
  fs.rmSync(OUT, { recursive: true, force: true })
  fs.mkdirSync(path.join(OUT, 'docs'), { recursive: true })

  let src
  try {
    src = await resolveVaultSource()
  } catch (e) {
    writeEmptySnapshot(`vault source error: ${e?.message || e}`)
    return
  }
  if (!src) {
    writeEmptySnapshot('set LABOUR_VAULT, clone ../labour-second-brain, or set VAULT_REPO + GITHUB_TOKEN')
    return
  }

  try {
    const reader = createVaultReader(src.dir)
    if (!reader.available()) {
      writeEmptySnapshot(`no Vault Data Contract found under ${src.label}`)
      return
    }
    const exportObj = JSON.parse(reader.exportJson())
    if (src.commit) exportObj.vault_commit = src.commit // tarball builds have no git

    const docs = {}
    let n = 0
    for (const note of exportObj.notes) {
      const doc = reader.readDoc(note.file)
      if (!doc || !doc.body) continue
      const id = `docs/d${String(++n).padStart(4, '0')}.json`
      fs.writeFileSync(path.join(OUT, id), JSON.stringify(doc))
      docs[note.file] = id
    }
    fs.writeFileSync(path.join(OUT, 'vault.json'), JSON.stringify(exportObj))
    fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify({
      generated_at: exportObj.generated_at, vault_commit: exportObj.vault_commit, docs,
    }))
    console.log(`✓ vault snapshot from ${src.label}: schema ${exportObj.schema_version}, ${exportObj.counts?.notes} notes, ${n} doc bodies, commit ${(exportObj.vault_commit || 'n/a').slice(0, 8)}`)
  } finally {
    src.cleanup?.()
  }
}

main().catch((e) => {
  // Never fail the whole build on a snapshot problem — degrade to empty.
  console.error('vault snapshot failed:', e)
  try { writeEmptySnapshot(`unexpected error: ${e?.message || e}`) } catch { /* give up */ }
})
