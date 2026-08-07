/* Cloudflare Pages Function — URL-liveness pre-check for the hallucination
   sweep. Hosted twin of the dev server's POST /urlcheck. Stateless (no KV).

   Capped at 40 URLs/call so worst-case HEAD+GET probing stays under the free
   plan's 50-subrequest limit. The check is strictly ADDITIVE (only a hard-dead
   URL adds a flag), so any URL beyond the cap is simply read by the model as
   before — never a false "dead".

   Runtime note: in the Workers runtime a DNS/connection failure surfaces as a
   generic fetch error WITHOUT Node's granular socket codes (ENOTFOUND etc.), so
   checkUrl returns "unknown" for those here rather than "dead" — only an HTTP
   404/410 yields "dead" on Cloudflare. "unknown" is safe (the model still reads
   the page); the dev server, on Node/undici, still catches hard-dead hosts. */

import { checkUrls } from '../server/feeds.mjs'

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } })

export async function onRequestPost({ request }) {
  let body
  try { body = await request.json() } catch { return new Response('invalid JSON', { status: 400 }) }
  try {
    const out = await checkUrls(body.urls, 40)
    return json(out)
  } catch (e) {
    return new Response(String(e?.message || e), { status: 400 })
  }
}
