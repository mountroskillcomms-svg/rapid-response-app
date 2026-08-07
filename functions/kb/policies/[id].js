/* Cloudflare Pages Function — delete an approved policy (KV).

   Hosted twin of the dev server's DELETE /kb/policies/:id. Only removes
   KV-added entries; a repo-BAKED policy (a static file under
   public/knowledge/policies/) has no KV key, so deleting it is a no-op here
   and it reappears from the static overlay — baked entries are curated via the
   repo, not the hosted UI. */

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } })

export async function onRequestDelete({ params, env }) {
  const kv = env.KV
  if (!kv) return new Response('KV namespace not bound (env.KV)', { status: 501 })
  await kv.delete(`policy:${params.id}`)
  return json({ ok: true })
}
