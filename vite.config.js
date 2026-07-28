import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'
import { vaultApi } from './vault-api.mjs'

// Dev-server API for the knowledge folder's policy database.
// The sweep auto-DRAFTS policy entries; a human APPROVES them in the UI,
// which POSTs here and writes a file into public/knowledge/policies/.
// index.json is regenerated from the directory on every write.
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
  const slug = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 80)
  /* URL liveness pre-check for the hallucination sweep. Conservative by
     design: only a HARD-dead result (DNS failure / connection refused /
     404 / 410) counts as dead. 200s, 3xx, 403/405 (bot walls, HEAD-refusers),
     429, 5xx, and timeouts are all "not dead" — the model still checks
     their content. A false "dead" would strike a live source; a false
     "alive" costs nothing, because the model still reads the page. */
  const checkUrl = async (url) => {
    const probe = async (method) => {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 6000)
      try {
        const r = await fetch(url, { method, redirect: 'follow', signal: ctrl.signal })
        return { status: r.status }
      } finally {
        clearTimeout(timer)
      }
    }
    try {
      let r = await probe('HEAD')
      // Some servers 404 HEAD but serve GET — confirm before calling it dead.
      if (r.status === 404 || r.status === 410) r = await probe('GET')
      return r.status === 404 || r.status === 410 ? 'dead' : 'alive'
    } catch (e) {
      // DNS failure / connection refused = hard dead; timeouts and aborts are
      // ambiguous. undici wraps the socket error in e.cause (sometimes an
      // AggregateError), so collect codes from every layer.
      const codes = [
        e?.code, e?.cause?.code, e?.cause?.cause?.code,
        ...(e?.cause?.errors || []).map((x) => x?.code),
      ]
      // ERR_TLS_CERT_ALTNAME_INVALID: on networks with wildcard DNS, a
      // fabricated hostname resolves to a catch-all server whose cert doesn't
      // match — a reader clicking it gets a hard TLS error, so it's dead.
      const dead = ['ENOTFOUND', 'ECONNREFUSED', 'ERR_TLS_CERT_ALTNAME_INVALID']
      return codes.some((c) => dead.includes(c)) ? 'dead' : 'unknown'
    }
  }

  /* Sweep sources — the daily sweep's checklist, fetched server-side for
     zero tokens/searches. Each entry names the STABLE thing (the site's
     news page); the feed URL is discovered dynamically and cached in
     .feed-cache.json, so a site restructuring its feeds self-heals on the
     next run. feedHint seeds the cache with today's known-working URLs. */
  const SWEEP_SITES = [
    { outlet: 'Beehive', page: 'https://www.beehive.govt.nz/releases', feedHint: 'https://www.beehive.govt.nz/rss.xml' },
    { outlet: 'RNZ Politics', page: 'https://www.rnz.co.nz/news/political', feedHint: 'https://www.rnz.co.nz/rss/political.xml' },
    { outlet: 'Stuff', page: 'https://www.stuff.co.nz/nz-news', feedHint: 'https://www.stuff.co.nz/rss' },
    { outlet: 'Newsroom', page: 'https://newsroom.co.nz/category/politics/', feedHint: 'https://newsroom.co.nz/feed/' },
    { outlet: 'interest.co.nz', page: 'https://www.interest.co.nz/news', feedHint: 'https://interest.co.nz/rss' },
    { outlet: 'NZ Herald Politics', page: 'https://www.nzherald.co.nz/politics/' },
    { outlet: 'National Party', page: 'https://www.national.org.nz/news' },
    { outlet: 'ACT Party', page: 'https://www.act.org.nz/news' },
    { outlet: 'Green Party', page: 'https://www.greens.org.nz/news' },
    { outlet: 'NZ First', page: 'https://www.nzfirst.nz/news', feedHint: 'https://www.nzfirst.nz/news.rss' },
    { outlet: 'Scoop Politics', page: 'https://www.scoop.co.nz/news/politics.html' },
    { outlet: 'Labour Party', page: 'https://www.labour.org.nz/news' },
    { outlet: 'Te Pāti Māori', page: 'https://www.tepatimaori.com/press-releases' },
    { outlet: 'TOP', page: 'https://www.top.org.nz/news', feedHint: 'https://www.top.org.nz/news.rss' },
    // Government ministries & agencies — releases and data drops that drive
    // the political cycle. Feed URLs autodiscovered like everything else.
    { outlet: 'MFAT', page: 'https://www.mfat.govt.nz/en/media-and-resources' },
    { outlet: 'Treasury', page: 'https://www.treasury.govt.nz/news-and-events', feedHint: 'https://www.treasury.govt.nz/rss/news' },
    { outlet: 'Ministry of Health', page: 'https://www.health.govt.nz/news', feedHint: 'https://www.health.govt.nz/rss/news' },
    { outlet: 'Ministry of Education', page: 'https://www.education.govt.nz/news' },
    { outlet: 'MBIE', page: 'https://www.mbie.govt.nz/about/news', feedHint: 'https://www.mbie.govt.nz/rss' },
    { outlet: 'MSD', page: 'https://www.msd.govt.nz/about-msd-and-our-work/newsroom' },
    { outlet: 'Ministry of Justice', page: 'https://www.justice.govt.nz/about/news-and-media' },
    { outlet: 'Ministry for the Environment', page: 'https://environment.govt.nz/news' },
    { outlet: 'Stats NZ', page: 'https://www.stats.govt.nz/news', feedHint: 'https://www.stats.govt.nz/rss/news' },
  ]
  /* Seen-URL ledger for delta sweeps: URLs already triaged by a SUCCESSFUL
     sweep. Items are marked seen only via the /sweepfeed/commit call the app
     makes after the model call succeeds — a failed or cancelled sweep commits
     nothing, so no item can be lost to a crash. Entries expire after 45 days. */
  const SWEEP_SEEN_PATH = path.resolve(process.cwd(), '.sweep-seen.json')
  const readSeen = () => {
    try { return JSON.parse(fs.readFileSync(SWEEP_SEEN_PATH, 'utf8').replace(/^﻿/, '')) } catch { return {} }
  }
  const writeSeen = (seen) => {
    const cutoff = Date.now() - 45 * 86400000
    const pruned = Object.fromEntries(Object.entries(seen).filter(([, t]) => t >= cutoff))
    try { fs.writeFileSync(SWEEP_SEEN_PATH, JSON.stringify(pruned)) } catch { /* best effort */ }
  }
  const FEED_CACHE_PATH = path.resolve(process.cwd(), '.feed-cache.json')
  const FEEDLESS_RECHECK_MS = 7 * 86400000 // re-try discovery on feedless sites weekly
  const readFeedCache = () => {
    try { return JSON.parse(fs.readFileSync(FEED_CACHE_PATH, 'utf8').replace(/^﻿/, '')) } catch { return {} }
  }
  const writeFeedCache = (cache) => {
    try { fs.writeFileSync(FEED_CACHE_PATH, JSON.stringify(cache, null, 2)) } catch { /* best effort */ }
  }
  /* Feed autodiscovery: <link rel="alternate" type="…rss/atom…"> tags on the
     site page are the standard self-description; conventional CMS paths are
     the fallback. Returns the first URL whose feed actually parses. */
  const fetchPageHtml = async (url) => {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 10000)
    try {
      const r = await fetch(url, {
        signal: ctrl.signal, redirect: 'follow',
        headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36' },
      })
      if (!r.ok) return null
      return (await r.text()).slice(0, 400000)
    } catch { return null } finally { clearTimeout(timer) }
  }
  const discoverFeed = async (site, prefetchedHtml) => {
    const candidates = []
    const html = prefetchedHtml || (await fetchPageHtml(site.page)) || ''
    for (const m of html.matchAll(/<link[^>]+>/gi)) {
      const t = m[0]
      if (!/rel=["']?alternate["']?/i.test(t)) continue
      if (!/type=["'][^"']*(rss|atom)[^"']*["']/i.test(t)) continue
      const href = t.match(/href=["']([^"']+)["']/i)
      if (href) { try { candidates.push(new URL(href[1], site.page).href) } catch { /* bad href */ } }
    }
    const origin = new URL(site.page).origin
    const slug = site.page.replace(/\/$/, '')
    candidates.push(
      `${slug}.rss`, // NationBuilder-style page feeds (how NZ First's was found)
      `${origin}/rss.xml`, `${origin}/rss`, `${origin}/feed/`, `${origin}/feed`,
      `${slug}/rss`, `${slug}?format=rss`,
    )
    for (const url of [...new Set(candidates)]) {
      const r = await fetchFeed({ outlet: site.outlet, url })
      if (r.items) return { url, items: r.items }
    }
    return null
  }
  /* Listing scraper — the fallback for sites with no feed at all (National,
     ACT, Greens, most ministries). Parses the news INDEX page: anchors whose
     path sits under the index and whose text reads like a headline. Dates are
     usually not extractable from listings, so items come back undated — the
     page lists newest first, and the sweep model triages recency itself. */
  const scrapeListing = async (site, prefetchedHtml) => {
    try {
      const html = prefetchedHtml || (await fetchPageHtml(site.page))
      if (!html) return null
      const base = new URL(site.page)
      const indexPath = base.pathname.replace(/\/$/, '')
      const seen = new Set()
      const items = []
      for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
        let href
        try { href = new URL(m[1], site.page) } catch { continue }
        if (href.origin !== base.origin) continue
        const p = href.pathname.replace(/\/$/, '')
        // Article links live UNDER the index path (or an obvious release path)
        const underIndex = p.startsWith(indexPath + '/') && p.length > indexPath.length + 1
        const releaseish = /\/(news|media|press|release|announcement)s?\//i.test(p)
        const text = decodeEntities(m[2])
        // De-slugified last path segment — the headline of last resort when
        // anchor text is empty (image links), glued card content, or absent.
        let seg = p.split('/').pop() || ''
        try { seg = decodeURIComponent(seg) } catch { /* keep raw */ }
        const slugText = seg.replace(/^(release|speech|news|media|post)[-_]/i, '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim()
        const navish = /(redirect|menu|nav|data|login|signup|donate|volunteer)s?$/i.test(seg) || /^(read more|learn more|find out|view all|see all|next|previous)/i.test(text)
        if (navish) continue
        let headline = null
        if (underIndex || releaseish) {
          // Structurally an article link: prefer clean anchor text; fall back
          // to the slug when the anchor glues in card content (ACT) or is empty.
          if (text.length >= 25 && text.length <= 220) headline = text
          else if (slugText.length >= 25) headline = slugText.slice(0, 180)
        } else if (slugText.length >= 35) {
          // Root-level article slugs with no news prefix (Greens): the slug
          // itself is headline-length; nav slugs never are.
          headline = text.length >= 25 && text.length <= 220 ? text : slugText.slice(0, 180)
        }
        if (!headline) continue
        if (seen.has(href.href)) continue
        seen.add(href.href)
        items.push({ headline, url: href.href, date: '', summary: '' })
        if (items.length >= 15) break // index pages are newest-first
      }
      if (items.length >= 2) return items
      // JS-rendered pages (Labour, others) ship no server-rendered anchors —
      // but the article list is embedded as JSON. Mine path-shaped string
      // values and de-slugify the headline.
      for (const m of html.matchAll(/"(?:url|href|permalink|path)"\s*:\s*"(\/[^"]{10,160})"/g)) {
        let href
        try { href = new URL(m[1], site.page) } catch { continue }
        const p = href.pathname.replace(/\/$/, '')
        const underIndex = p.startsWith(indexPath + '/') && p.length > indexPath.length + 1
        if (!underIndex) continue
        if (seen.has(href.href)) continue
        seen.add(href.href)
        const slugText = p.slice(indexPath.length + 1)
          .replace(/^(release|speech|news|media|post)[-/]/i, '')
          .replace(/[-_/]+/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
        if (slugText.length < 15) continue
        items.push({ headline: slugText, url: href.href, date: '', summary: '' })
        if (items.length >= 15) break
      }
      return items.length >= 2 ? items : null
    } catch {
      return null
    }
  }
  /* Resolve a site to feed items: cached URL → seed hint → autodiscovery →
     index-page scrape. Working feed URLs persist to the cache; sites with no
     discoverable feed are remembered as feedless (re-probed weekly) but still
     scraped every run so their announcements reach the digest. */
  const resolveSite = async (site, cache) => {
    const entry = cache[site.outlet] || {}
    for (const url of [...new Set([entry.url, site.feedHint].filter(Boolean))]) {
      const r = await fetchFeed({ outlet: site.outlet, url })
      if (r.items) {
        cache[site.outlet] = { url, checkedAt: Date.now() }
        return { site, items: r.items }
      }
    }
    /* One page fetch, shared by discovery and scraping — refetching after
       discovery's candidate probes trips rate limits on some sites (Greens).
       Successful scrapes are cached for 24h so a transiently rate-limited
       site serves yesterday's headlines instead of vanishing from coverage. */
    const scrapeFallback = async (pageHtml) => {
      const scrapedItems = await scrapeListing(site, pageHtml)
      if (scrapedItems) {
        cache[site.outlet] = { ...(cache[site.outlet] || {}), lastScrape: { items: scrapedItems, at: Date.now() } }
        return { site, items: scrapedItems, scraped: true }
      }
      const prior = (cache[site.outlet] || {}).lastScrape
      if (prior && Date.now() - prior.at < 86400000) {
        return { site, items: prior.items, scraped: true }
      }
      return { site, uncovered: true }
    }
    if (entry.feedless && Date.now() - (entry.checkedAt || 0) < FEEDLESS_RECHECK_MS) {
      return scrapeFallback()
    }
    const pageHtml = await fetchPageHtml(site.page)
    const found = await discoverFeed(site, pageHtml)
    if (found) {
      cache[site.outlet] = { url: found.url, checkedAt: Date.now() }
      return { site, items: found.items, discovered: found.url }
    }
    if (entry.url) {
      // A feed that worked before failed this run AND discovery came up
      // empty — treat as transient (rate limit, outage), keep the known URL,
      // and report uncovered for this run only. Never demote to feedless.
      cache[site.outlet] = { ...entry, lastError: Date.now() }
      return { site, uncovered: true }
    }
    cache[site.outlet] = { feedless: true, checkedAt: Date.now() }
    return scrapeFallback(pageHtml)
  }
  const decodeEntities = (s) => (s || '')
    .replace(/<!\[CDATA\[|\]\]>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;|&#8217;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&nbsp;/g, ' ')
    .replace(/<[^>]+>/g, ' ') // strip markup AFTER entity decode (descriptions arrive entity-encoded)
    .replace(/\s+/g, ' ').trim()
  const tag = (xml, name) => {
    const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'))
    return m ? decodeEntities(m[1]) : ''
  }
  const parseFeed = (xml) => {
    // RSS <item> or Atom <entry>
    const items = [...xml.matchAll(/<(?:item|entry)[\s>]([\s\S]*?)<\/(?:item|entry)>/gi)].map((m) => {
      const x = m[1]
      let link = tag(x, 'link')
      if (!link) {
        const href = x.match(/<link[^>]*href="([^"]+)"/i)
        link = href ? href[1] : ''
      }
      return {
        headline: tag(x, 'title'),
        url: link,
        date: tag(x, 'pubDate') || tag(x, 'updated') || tag(x, 'published') || tag(x, 'dc:date'),
        summary: (tag(x, 'description') || tag(x, 'summary') || '').slice(0, 220),
      }
    })
    return items.filter((i) => i.headline && i.url)
  }
  const fetchFeed = async (feed) => {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 10000)
    try {
      const r = await fetch(feed.url, {
        signal: ctrl.signal,
        redirect: 'follow',
        headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36', accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' },
      })
      if (!r.ok) return { feed, error: `HTTP ${r.status}` }
      const xml = await r.text()
      const items = parseFeed(xml)
      if (!items.length) return { feed, error: 'no parseable items' }
      return { feed, items }
    } catch (e) {
      return { feed, error: e.name === 'AbortError' ? 'timeout' : String(e?.cause?.code || e.message).slice(0, 60) }
    } finally {
      clearTimeout(timer)
    }
  }

  return {
    name: 'knowledge-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.method === 'POST' && req.url === '/sweepfeed') {
          try {
            const b = await readBody(req)
            const days = Math.max(1, Math.min(Number(b.days) || 1, 14))
            const cutoff = Date.now() - days * 86400000
            const cache = readFeedCache()
            const settled = await Promise.all(SWEEP_SITES.map((s) => resolveSite(s, cache)))
            writeFeedCache(cache)
            const uncovered = settled.filter((s) => s.uncovered).map((s) => `${s.site.outlet} (${s.site.page})`)
            const discovered = settled.filter((s) => s.discovered).map((s) => `${s.site.outlet} → ${s.discovered}`)
            const items = settled
              .filter((s) => s.items)
              .flatMap((s) => s.items
                .map((i) => {
                  const t = Date.parse(i.date)
                  return { outlet: s.site.outlet, ...i, date: Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : i.date, _t: t }
                })
                // Keep items in the window; items with unparseable dates are
                // kept (better a stale extra than a silent gap) but capped.
                .filter((i) => !Number.isFinite(i._t) || i._t >= cutoff)
                .slice(0, 40))
              .map(({ _t, ...i }) => i)
            // Input diet: summaries truncate to 100 chars (classification
            // hinges on the headline and first clause). Stuff and interest.co.nz
            // are sitewide/finance feeds with professionally-written headlines —
            // headline-only for those two. Items are NEVER dropped here; the
            // sweep prompt biases ambiguous headline-only items toward
            // low-priority inclusion, not exclusion.
            const HEADLINE_ONLY = new Set(['Stuff', 'interest.co.nz'])
            for (const i of items) {
              i.summary = HEADLINE_ONLY.has(i.outlet) ? '' : (i.summary || '').slice(0, 100)
            }
            // Delta flag: seen = already triaged by a previously SUCCESSFUL sweep.
            const seenLedger = readSeen()
            for (const i of items) i.seen = !!seenLedger[i.url]
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({
              items,
              failures: [], // per-run fetch errors surface as uncovered instead
              uncovered,
              discovered, // informational: feeds found by autodiscovery this run
              scraped: settled.filter((s) => s.scraped).map((s) => s.site.outlet),
              feeds: settled.filter((s) => s.items).map((s) => s.site.outlet),
            }))
          } catch (e) {
            res.statusCode = 400
            res.end(String(e.message || e))
          }
          return
        }
        if (req.method === 'POST' && req.url === '/sweepfeed/commit') {
          try {
            const b = await readBody(req)
            const seen = readSeen()
            const now = Date.now()
            for (const u of (b.urls || []).slice(0, 500)) { if (typeof u === 'string') seen[u] = now }
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
            const urls = [...new Set((b.urls || []).filter((u) => /^https?:\/\//i.test(u)))].slice(0, 80)
            const results = {}
            // Bounded parallelism: 8 at a time.
            for (let i = 0; i < urls.length; i += 8) {
              await Promise.all(urls.slice(i, i + 8).map(async (u) => { results[u] = await checkUrl(u) }))
            }
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ results }))
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
            if (!b.issue || !Array.isArray(b.angles) || !b.angles.length) throw new Error('issue and angles[] are required')
            const id = slug(b.slug || b.issue)
            const f = path.join(linesDir, `${id}.json`)
            let entry = { slug: id, issue: b.issue, angles: [], updatedAt: '' }
            if (fs.existsSync(f)) { try { entry = JSON.parse(fs.readFileSync(f, 'utf8')) } catch { /* rebuilt below */ } }
            const seen = new Set((entry.angles || []).map((a) => a.trim()))
            for (const a of b.angles) { const t = String(a).trim(); if (t && !seen.has(t)) { entry.angles.push(t); seen.add(t) } }
            entry.angles = entry.angles.slice(-12) // keep the freshest dozen lines per issue
            entry.issue = b.issue
            entry.updatedAt = new Date().toISOString()
            fs.writeFileSync(f, JSON.stringify(entry, null, 2))
            rebuildLinesIndex()
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ ok: true, id, count: entry.angles.length }))
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
