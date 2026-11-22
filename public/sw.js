// The production build fills in the exact shell, worker, sample, font and CMap URLs.
const version = 'DEV_VERSION';
const files = /* PRECACHE */ ['./index.html'];
const scope = self.registration.scope;
const prefix = 'refpin-web:' + scope + ':';
const cacheName = prefix + version;
const shell = new URL('./index.html', scope).href;
const staticUrls = new Set(files.map(file => new URL(file, scope).href));

self.addEventListener('install', event => {
  event.waitUntil(caches.open(cacheName).then(cache =>
    cache.addAll([...staticUrls].map(url => new Request(url, { cache: 'reload' })))));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith(prefix) && name !== cacheName) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === 'navigate' && (url.pathname === new URL(scope).pathname || url.pathname === new URL(shell).pathname)) {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok) return response;
        return await caches.match(shell, { cacheName }) || response;
      } catch {
        return await caches.match(shell, { cacheName }) || Response.error();
      }
    })());
  } else if (staticUrls.has(url.href)) {
    event.respondWith((async () => {
      const cache = await caches.open(cacheName);
      const hit = await cache.match(request);
      if (hit) {
        // PDF.js can request individual byte ranges of a bundled sample offline.
        const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.get('range') || '');
        if (!range) return hit;
        const blob = await hit.blob();
        const start = Number(range[1]);
        const end = range[2] ? Math.min(Number(range[2]), blob.size - 1) : blob.size - 1;
        if (start > end) return new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */' + blob.size } });
        return new Response(blob.slice(start, end + 1, blob.type), { status: 206, headers: {
          'Accept-Ranges': 'bytes', 'Content-Range': 'bytes ' + start + '-' + end + '/' + blob.size,
          'Content-Length': String(end - start + 1), 'Content-Type': blob.type,
        } });
      }
      const response = await fetch(request);
      if (response.status === 200) await cache.put(request, response.clone()).catch(() => {});
      return response;
    })());
  }
});
