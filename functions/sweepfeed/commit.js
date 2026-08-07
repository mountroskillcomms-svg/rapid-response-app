/* Cloudflare Pages Function — commit sweep items to the seen-URL ledger.

   Hosted twin of the dev server's POST /sweepfeed/commit. Called by the client
   only AFTER a successful sweep, so a failed/cancelled run marks nothing. The
   ledger (KV key `sweep:seen`) drives delta sweeps; entries expire after 45
   days (pruneSeen on write). */

import { addSeen, pruneSeen } from '../../server/feeds.mjs'

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } })

export async function onRequestPost({ request, env }) {
  const kv = env.KV
  let body
  try { body = await request.json() } catch { return new Response('invalid JSON', { status: 400 }) }
  try {
    const seen = kv ? (await kv.get('sweep:seen', 'json')) || {} : {}
    addSeen(seen, body.urls)
    const total = Object.keys(seen).length // reported count (matches dev: pre-prune)
    if (kv) { try { await kv.put('sweep:seen', JSON.stringify(pruneSeen(seen))) } catch { /* KV write cap */ } }
    return json({ ok: true, total })
  } catch (e) {
    return new Response(String(e?.message || e), { status: 400 })
  }
}
