/* ============================================================
   SWEEP + URL-CHECK ENGINE — portable, storage-agnostic.

   The daily media sweep's server-side RSS/feed aggregation and
   the hallucination sweep's URL-liveness pre-check, extracted
   from the Vite dev server so the SAME code runs in two homes:

     - dev  : vite.config.js wraps these with fs-backed cache/seen
     - prod : Cloudflare Pages Functions wrap them with KV

   Nothing here touches `fs`, `path`, or any Node built-in — only
   Web-standard APIs (fetch, AbortController, URL, regex) that run
   identically in Node 18+ and the Workers runtime. Persistent
   state (the feed cache and seen-URL ledger) is passed in as
   plain objects and mutated/returned; each caller owns storage.
   ============================================================ */

/* Sweep sources — the daily sweep's checklist, fetched server-side for
   zero tokens/searches. Each entry names the STABLE thing (the site's
   news page); the feed URL is discovered dynamically and cached, so a
   site restructuring its feeds self-heals on the next run. feedHint
   seeds the cache with today's known-working URLs. */
export const SWEEP_SITES = [
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

const FEEDLESS_RECHECK_MS = 7 * 86400000 // re-try discovery on feedless sites weekly
const SEEN_TTL_MS = 45 * 86400000 // seen-URL ledger entries expire after 45 days

/* URL liveness pre-check for the hallucination sweep. Conservative by
   design: only a HARD-dead result (DNS failure / connection refused /
   404 / 410) counts as dead. 200s, 3xx, 403/405 (bot walls, HEAD-refusers),
   429, 5xx, and timeouts are all "not dead" — the model still checks
   their content. A false "dead" would strike a live source; a false
   "alive" costs nothing, because the model still reads the page. */
async function checkUrl(url) {
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

/* Feed autodiscovery: <link rel="alternate" type="…rss/atom…"> tags on the
   site page are the standard self-description; conventional CMS paths are
   the fallback. Returns the first URL whose feed actually parses. */
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

/* Input diet: summaries truncate to 100 chars (classification hinges on the
   headline and first clause). Stuff and interest.co.nz are sitewide/finance
   feeds with professionally-written headlines — headline-only for those two. */
const HEADLINE_ONLY = new Set(['Stuff', 'interest.co.nz'])

/**
 * Run one media sweep across every SWEEP_SITES source.
 * @param {number} days   look-back window (clamped 1–14)
 * @param {object} cache  feed-discovery cache — MUTATED in place; the caller
 *                        persists it afterwards (fs in dev, KV in prod)
 * @param {object} seen   seen-URL ledger { url: timestamp } — read-only here;
 *                        used to flag already-triaged items for delta sweeps
 * @returns the sweep response the client expects (items, uncovered, …)
 */
export async function runSweep(days, cache, seen = {}) {
  const window = Math.max(1, Math.min(Number(days) || 1, 14))
  const cutoff = Date.now() - window * 86400000
  const settled = await Promise.all(SWEEP_SITES.map((s) => resolveSite(s, cache)))
  const uncovered = settled.filter((s) => s.uncovered).map((s) => `${s.site.outlet} (${s.site.page})`)
  const discovered = settled.filter((s) => s.discovered).map((s) => `${s.site.outlet} → ${s.discovered}`)
  const items = settled
    .filter((s) => s.items)
    .flatMap((s) => s.items
      .map((i) => {
        const t = Date.parse(i.date)
        return { outlet: s.site.outlet, ...i, date: Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : i.date, _t: t }
      })
      // Keep items in the window; items with unparseable dates are kept
      // (better a stale extra than a silent gap) but capped.
      .filter((i) => !Number.isFinite(i._t) || i._t >= cutoff)
      .slice(0, 40))
    .map(({ _t, ...i }) => i)
  for (const i of items) {
    i.summary = HEADLINE_ONLY.has(i.outlet) ? '' : (i.summary || '').slice(0, 100)
  }
  // Delta flag: seen = already triaged by a previously SUCCESSFUL sweep.
  for (const i of items) i.seen = !!seen[i.url]
  return {
    items,
    failures: [], // per-run fetch errors surface as uncovered instead
    uncovered,
    discovered, // informational: feeds found by autodiscovery this run
    scraped: settled.filter((s) => s.scraped).map((s) => s.site.outlet),
    feeds: settled.filter((s) => s.items).map((s) => s.site.outlet),
  }
}

/**
 * URL-liveness pre-check for the hallucination sweep. Dedupes, filters to
 * http(s), caps at `max`, and probes 8 at a time.
 * `max` defaults to 80 (dev/Node — no subrequest ceiling); the Cloudflare
 * Function passes a lower cap to stay under the free plan's 50-subrequest
 * limit. Capping only means fewer URLs get a liveness pre-flag — the check is
 * strictly additive, so unchecked URLs are still read by the model.
 * @returns { results: { [url]: 'alive' | 'dead' | 'unknown' } }
 */
export async function checkUrls(rawUrls, max = 80) {
  const urls = [...new Set((rawUrls || []).filter((u) => /^https?:\/\//i.test(u)))].slice(0, max)
  const results = {}
  for (let i = 0; i < urls.length; i += 8) {
    await Promise.all(urls.slice(i, i + 8).map(async (u) => { results[u] = await checkUrl(u) }))
  }
  return { results }
}

/** Add URLs to the seen ledger with the current timestamp (caps the batch at
    500, matching the dev server). Mutates and returns `seen`. */
export function addSeen(seen, urls) {
  const now = Date.now()
  for (const u of (urls || []).slice(0, 500)) { if (typeof u === 'string') seen[u] = now }
  return seen
}

/** Drop seen-ledger entries older than 45 days. Returns a new object. */
export function pruneSeen(seen) {
  const cutoff = Date.now() - SEEN_TTL_MS
  return Object.fromEntries(Object.entries(seen || {}).filter(([, t]) => t >= cutoff))
}
