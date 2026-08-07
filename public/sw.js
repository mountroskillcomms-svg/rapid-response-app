/* Minimal service worker — makes the app installable ("Add to Home Screen")
   and usable offline, without caching anything dynamic.

   Strategy: NETWORK-FIRST with a cache fallback. Always prefer the network so
   a redeploy (new JS/CSS, fresh vault snapshot, KV data) is picked up
   immediately; fall back to the cache only when offline. Successful GETs are
   cached as they load, so a previously-visited app shell still opens offline.

   Never touched (straight to network): all non-GET requests, and the dynamic
   API routes — /anthropic (proxy), /sweepfeed, /urlcheck, /kb (KV). Those are
   POSTs anyway, but the path guard is belt-and-braces. */

const CACHE = 'rr-shell-v1'; // bump to force-refresh all cached assets
const BYPASS = /^\/(anthropic|sweepfeed|urlcheck|kb)(\/|$)/;

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== location.origin || BYPASS.test(url.pathname)) return;

  event.respondWith(
    fetch(request)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
        }
        return res;
      })
      .catch(() => caches.match(request).then((hit) => hit || (request.mode === 'navigate' ? caches.match('/') : undefined)))
  );
});
