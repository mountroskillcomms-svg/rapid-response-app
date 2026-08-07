/* Cloudflare Pages Function — approved-policy database (KV-backed).

   Hosted twin of the dev server's /kb/policies. In dev the sweep-approved
   policy entries are JSON files under public/knowledge/policies/; here they
   live in KV under keys `policy:<id>`. GET lists the KV entries so the client
   can overlay them on top of the repo-baked static ones (src/knowledge.js
   refreshPolicies). POST approves a new entry. */

import { buildPolicyEntry } from '../../server/kb.mjs'

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } })

export async function onRequestGet({ env }) {
  const kv = env.KV
  if (!kv) return json({ policies: [] })
  const { keys } = await kv.list({ prefix: 'policy:' })
  const policies = (await Promise.all(keys.map((k) => kv.get(k.name, 'json')))).filter(Boolean)
  return json({ policies })
}

export async function onRequestPost({ request, env }) {
  const kv = env.KV
  if (!kv) return new Response('KV namespace not bound (env.KV)', { status: 501 })
  let body
  try { body = await request.json() } catch { return new Response('invalid JSON', { status: 400 }) }
  try {
    const { id, entry } = buildPolicyEntry(body)
    await kv.put(`policy:${id}`, JSON.stringify(entry))
    return json({ ok: true, id })
  } catch (e) {
    return new Response(String(e?.message || e), { status: 400 })
  }
}
