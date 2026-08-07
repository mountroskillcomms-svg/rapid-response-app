/* Cloudflare Pages Function — message-discipline line memory (KV-backed).

   Hosted twin of the dev server's /kb/lines. Established angles per issue live
   in KV under keys `line:<slug>`. GET lists them for the client overlay
   (src/knowledge.js refreshLines); POST merges new angles into an issue's
   entry (dedup, keep the freshest dozen). Shared merge logic: server/kb.mjs. */

import { mergeLineEntry, slug } from '../../server/kb.mjs'

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } })

export async function onRequestGet({ env }) {
  const kv = env.KV
  if (!kv) return json({ lines: [] })
  const { keys } = await kv.list({ prefix: 'line:' })
  const lines = (await Promise.all(keys.map((k) => kv.get(k.name, 'json')))).filter(Boolean)
  return json({ lines })
}

export async function onRequestPost({ request, env }) {
  const kv = env.KV
  if (!kv) return new Response('KV namespace not bound (env.KV)', { status: 501 })
  let body
  try { body = await request.json() } catch { return new Response('invalid JSON', { status: 400 }) }
  try {
    // Load the existing entry first so mergeLineEntry can append to it. The id
    // derivation here must match mergeLineEntry's (slug of body.slug||issue).
    const id = slug(body?.slug || body?.issue)
    const existing = id ? await kv.get(`line:${id}`, 'json') : null
    const { id: outId, entry, count } = mergeLineEntry(body, existing)
    await kv.put(`line:${outId}`, JSON.stringify(entry))
    return json({ ok: true, id: outId, count })
  } catch (e) {
    return new Response(String(e?.message || e), { status: 400 })
  }
}
