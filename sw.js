// sw.js — offline support for Groove Galaxy.
// • App shell precached on install (list shared with the app via shell-files.json).
// • same-origin code (js/css/html): network-first (so edits show), fall back to cache.
// • same-origin static assets (vrm/vrma/img/mp3/fonts): stale-while-revalidate (instant, self-updating).
// • CDN (three.js / three-vrm / fonts): cache-first (version-pinned, immutable).
const CACHE = 'groove-v1';
const SHELL_FALLBACK = ['./', './index.html', './app.js', './face.js', './styles.css', './manifest.webmanifest'];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    let shell = SHELL_FALLBACK;
    try { const r = await fetch('./shell-files.json', { cache: 'no-store' }); if (r.ok) shell = await r.json(); } catch {}
    await Promise.allSettled(shell.map((u) => c.add(u)));
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

const isCDN = (h) => /(^|\.)jsdelivr\.net$|fonts\.(googleapis|gstatic)\.com$/.test(h);

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  if (!sameOrigin && !isCDN(url.host)) return; // not ours to handle

  const isStaticAsset = /\.(vrm|vrma|png|jpe?g|webp|gif|woff2?|ico|mp3|ogg|m4a|svg)$/i.test(url.pathname);

  if (sameOrigin && isStaticAsset) {
    // stale-while-revalidate
    e.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(req);
      const fetching = fetch(req).then((res) => { if (res && res.ok) cache.put(req, res.clone()).catch(() => {}); return res; }).catch(() => null);
      if (hit) { fetching; return hit; }
      const res = await fetching;
      if (res) return res;
      throw new Error('offline and uncached: ' + url.pathname);
    })());
  } else if (sameOrigin) {
    // network-first (code stays fresh during dev)
    e.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        const res = await fetch(req);
        if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
        return res;
      } catch {
        const hit = await cache.match(req) || await cache.match('./index.html');
        if (hit) return hit;
        throw new Error('offline and uncached: ' + url.pathname);
      }
    })());
  } else {
    // cache-first for immutable CDN assets
    e.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone()).catch(() => {});
      return res;
    })());
  }
});
