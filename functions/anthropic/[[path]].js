/* Cloudflare Pages Function — Anthropic API proxy.

   The hosted twin of vite.config.js's `server.proxy['/anthropic']`. The
   browser calls same-origin `/anthropic/v1/messages` (no key, no CORS); this
   forwards to api.anthropic.com with the secret key injected from a Worker
   secret, exactly as the dev proxy injects it from .env. The client
   (src/RapidResponseBrief.jsx `callClaude`) does NOT stream — it awaits
   res.json() and drives `pause_turn` with sequential POSTs — so a plain
   request/response passthrough is sufficient.

   `[[path]]` is a catch-all: /anthropic/v1/messages → params.path = ['v1','messages'].
   A fetch() issued from the Worker carries no browser Origin/Referer, so the
   dev proxy's header-stripping is automatic here. */

const ANTHROPIC_BASE = 'https://api.anthropic.com'
const ANTHROPIC_VERSION = '2023-06-01'

export async function onRequest(context) {
  const { request, env, params } = context

  if (!env.ANTHROPIC_API_KEY) {
    // Shape matches the API error envelope the client already handles
    // (authentication_error is treated as non-transient — no retry storm).
    return json(500, {
      error: { type: 'authentication_error', message: 'ANTHROPIC_API_KEY is not configured on the server.' },
    })
  }

  const sub = Array.isArray(params.path) ? params.path.join('/') : (params.path || '')
  const url = new URL(request.url)
  const target = `${ANTHROPIC_BASE}/${sub}${url.search}`

  const headers = new Headers()
  headers.set('content-type', request.headers.get('content-type') || 'application/json')
  const accept = request.headers.get('accept')
  if (accept) headers.set('accept', accept)
  headers.set('x-api-key', env.ANTHROPIC_API_KEY)
  headers.set('anthropic-version', ANTHROPIC_VERSION)

  const method = request.method
  const body = method === 'GET' || method === 'HEAD' ? undefined : await request.arrayBuffer()

  let upstream
  try {
    upstream = await fetch(target, { method, headers, body })
  } catch (e) {
    // Network-level failure reaching Anthropic — mark transient so the
    // client's backoff/retry path (api_error) kicks in rather than failing hard.
    return json(502, { error: { type: 'api_error', message: `Upstream fetch failed: ${e?.message || e}` } })
  }

  // Pass the response straight through. Only carry content-type across —
  // rebuilding headers avoids leaking hop-by-hop/encoding headers that would
  // confuse the browser when we hand back an already-decoded body.
  const out = new Headers()
  out.set('content-type', upstream.headers.get('content-type') || 'application/json')
  return new Response(upstream.body, { status: upstream.status, headers: out })
}

const json = (status, obj) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } })
