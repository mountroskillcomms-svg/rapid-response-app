/* Cloudflare Pages Function — daily media sweep (RSS/feed aggregation).

   Hosted twin of the dev server's POST /sweepfeed. The feed-discovery cache
   and the seen-URL ledger live in KV (env.KV) instead of .feed-cache.json /
   .sweep-seen.json. Shares the exact aggregation engine with the dev server
   via server/feeds.mjs.

   FREE-TIER NOTE: this endpoint fans out to ~24 news sites and parses their
   HTML/XML, which can exceed Cloudflare's free per-invocation limits (50
   subrequests, 10ms CPU). That's fine by design — the client (RapidResponse
   sweep) treats a thin/failed digest as "feeds unavailable" and falls back to
   the model's own search-driven sweep through the Anthropic proxy. On Workers
   Paid the same code runs to full coverage. KV persists progress across runs,
   so the discovery cache warms over time regardless. */

import { runSweep } from '../server/feeds.mjs'

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } })

export async function onRequestPost({ request, env }) {
  const kv = env.KV
  let body
  try { body = await request.json() } catch { return new Response('invalid JSON', { status: 400 }) }
  try {
    const cache = kv ? (await kv.get('sweep:feed-cache', 'json')) || {} : {}
    const seen = kv ? (await kv.get('sweep:seen', 'json')) || {} : {}
    const out = await runSweep(body.days, cache, seen)
    // runSweep mutated the discovery cache in place — persist it for next run.
    if (kv) { try { await kv.put('sweep:feed-cache', JSON.stringify(cache)) } catch { /* KV write cap */ } }
    return json(out)
  } catch (e) {
    return new Response(String(e?.message || e), { status: 400 })
  }
}
