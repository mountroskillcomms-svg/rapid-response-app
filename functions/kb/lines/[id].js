/* Cloudflare Pages Function — delete a message-discipline line entry (KV).
   Hosted twin of the dev server's DELETE /kb/lines/:id. */

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } })

export async function onRequestDelete({ params, env }) {
  const kv = env.KV
  if (!kv) return new Response('KV namespace not bound (env.KV)', { status: 501 })
  await kv.delete(`line:${params.id}`)
  return json({ ok: true })
}
