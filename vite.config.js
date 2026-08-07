import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'
import { vaultApi } from './vault-api.mjs'
import { runSweep, checkUrls, addSeen, pruneSeen } from './server/feeds.mjs'
import { buildPolicyEntry, mergeLineEntry, slug } from './server/kb.mjs'

/* Dev-server API for the knowledge folder's policy database + the daily
   sweep. The pure logic lives in ./server/{feeds,kb}.mjs and is shared with
   the Cloudflare Pages Functions (functions/*) so the hosted build and the
   dev server never drift. This plugin is the DEV wrapper: it backs that
   logic with the filesystem (the sweep auto-DRAFTS policy entries; a human
   APPROVES them in the UI, which POSTs here and writes a file into
   public/knowledge/policies/; index.json is regenerated on every write). */
function knowledgeApi() {
  // ESM config — no __dirname; vite runs with cwd at the project root.
  const dir = path.resolve(process.cwd(), 'public/knowledge/policies')
  const linesDir = path.resolve(process.cwd(), 'public/knowledge/lines')
  const rebuildIndex = () => {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'index.json')
    fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify({ policies: files.sort() }, null, 2))
  }
  const rebuildLinesIndex = () => {
    const files = fs.readdirSync(linesDir).filter((f) => f.endsWith('.json') && f !== 'index.json')
    fs.writeFileSync(path.join(linesDir, 'index.json'), JSON.stringify({ lines: files.sort() }, null, 2))
  }
  const readBody = (req) => new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (c) => { raw += c })
    req.on('end', () => { try { resolve(JSON.parse(raw)) } catch (e) { reject(e) } })
    req.on('error', reject)
  })

  /* Seen-URL ledger for delta sweeps: URLs already triaged by a SUCCESSFUL
     sweep. Items are marked seen only via the /sweepfeed/commit call the app
     makes after the model call succeeds — a failed or cancelled sweep commits
     nothing, so no item can be lost to a crash. Entries expire after 45 days. */
  const SWEEP_SEEN_PATH = path.resolve(process.cwd(), '.sweep-seen.json')
  const readSeen = () => {
    try { return JSON.parse(fs.readFileSync(SWEEP_SEEN_PATH, 'utf8').replace(/^﻿/, '')) } catch { return {} }
  }
  const writeSeen = (seen) => {
    try { fs.writeFileSync(SWEEP_SEEN_PATH, JSON.stringify(pruneSeen(seen))) } catch { /* best effort */ }
  }
  const FEED_CACHE_PATH = path.resolve(process.cwd(), '.feed-cache.json')
  const readFeedCache = () => {
    try { return JSON.parse(fs.readFileSync(FEED_CACHE_PATH, 'utf8').replace(/^﻿/, '')) } catch { return {} }
  }
  const writeFeedCache = (cache) => {
    try { fs.writeFileSync(FEED_CACHE_PATH, JSON.stringify(cache, null, 2)) } catch { /* best effort */ }
  }

  return {
    name: 'knowledge-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.method === 'POST' && req.url === '/sweepfeed') {
          try {
            const b = await readBody(req)
            const cache = readFeedCache()
            const out = await runSweep(b.days, cache, readSeen())
            writeFeedCache(cache) // runSweep mutated the discovery cache in place
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify(out))
          } catch (e) {
            res.statusCode = 400
            res.end(String(e.message || e))
          }
          return
        }
        if (req.method === 'POST' && req.url === '/sweepfeed/commit') {
          try {
            const b = await readBody(req)
            const seen = addSeen(readSeen(), b.urls)
            writeSeen(seen)
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ ok: true, total: Object.keys(seen).length }))
          } catch (e) {
            res.statusCode = 400
            res.end(String(e.message || e))
          }
          return
        }
        if (req.method === 'POST' && req.url === '/urlcheck') {
          try {
            const b = await readBody(req)
            const out = await checkUrls(b.urls)
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify(out))
          } catch (e) {
            res.statusCode = 400
            res.end(String(e.message || e))
          }
          return
        }
        if (!req.url.startsWith('/kb/policies') && !req.url.startsWith('/kb/lines')) return next()
        fs.mkdirSync(dir, { recursive: true })
        fs.mkdirSync(linesDir, { recursive: true })
        try {
          // Message-discipline memory: merge new angles into the issue's file.
          if (req.method === 'POST' && req.url === '/kb/lines') {
            const b = await readBody(req)
            const id = slug(b.slug || b.issue)
            const f = path.join(linesDir, `${id}.json`)
            let existing = null
            if (fs.existsSync(f)) { try { existing = JSON.parse(fs.readFileSync(f, 'utf8')) } catch { existing = null } }
            const { id: outId, entry, count } = mergeLineEntry(b, existing)
            fs.writeFileSync(path.join(linesDir, `${outId}.json`), JSON.stringify(entry, null, 2))
            rebuildLinesIndex()
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ ok: true, id: outId, count }))
            return
          }
          const delLine = req.url.match(/^\/kb\/lines\/([a-z0-9-]+)$/)
          if (req.method === 'DELETE' && delLine) {
            const f = path.join(linesDir, `${delLine[1]}.json`)
            if (fs.existsSync(f)) fs.unlinkSync(f)
            rebuildLinesIndex()
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ ok: true }))
            return
          }
          if (req.method === 'POST' && req.url === '/kb/policies') {
            const b = await readBody(req)
            const { id, entry } = buildPolicyEntry(b)
            fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(entry, null, 2))
            rebuildIndex()
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ ok: true, id }))
            return
          }
          const del = req.url.match(/^\/kb\/policies\/([a-z0-9-]+)$/)
          if (req.method === 'DELETE' && del) {
            const f = path.join(dir, `${del[1]}.json`)
            if (fs.existsSync(f)) fs.unlinkSync(f)
            rebuildIndex()
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ ok: true }))
            return
          }
          res.statusCode = 404
          res.end('not found')
        } catch (e) {
          res.statusCode = 400
          res.end(String(e.message || e))
        }
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Load ANTHROPIC_API_KEY from .env (server-side only — never sent to the browser)
  const env = loadEnv(mode, process.cwd(), '')
  const apiKey = env.ANTHROPIC_API_KEY || ''
  // Labour Second Brain (shared Obsidian vault): sibling clone by default,
  // overridable via LABOUR_VAULT in .env — never a hardcoded absolute path.
  const vaultDir = env.LABOUR_VAULT || path.resolve(process.cwd(), '../labour-second-brain')

  return {
    plugins: [react(), knowledgeApi(), vaultApi(vaultDir)],
    server: {
      host: '127.0.0.1', // loopback only (not exposed to LAN); matches the 127.0.0.1:5173 URL in use
      proxy: {
        '/anthropic': {
          target: 'https://api.anthropic.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/anthropic/, ''),
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          configure: (proxy) => {
            // Strip browser-y headers so Anthropic sees a server-to-server
            // request rather than a CORS/browser request.
            proxy.on('proxyReq', (proxyReq) => {
              proxyReq.removeHeader('origin')
              proxyReq.removeHeader('referer')
            })
          },
        },
      },
    },
  }
})
