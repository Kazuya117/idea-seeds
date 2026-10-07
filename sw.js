// アプリの部品（HTML・CSS・JS）だけをキャッシュする。データ（Supabase）への通信には手を出さない。
const CACHE = 'idea-seeds-v1';
const FILES = ['./', 'index.html', 'style.css?v=1', 'app.js?v=1', 'vendor/supabase.js', 'manifest.webmanifest', 'icon.svg', 'privacy.html'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'no-cache' }))))); self.skipWaiting(); });
self.addEventListener('activate', (e) => e.waitUntil(
  caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
));
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' }).then((r) => { const c = r.clone(); caches.open(CACHE).then((k) => k.put(e.request, c)); return r; })
      .catch(() => caches.match(e.request, { ignoreSearch: e.request.mode === 'navigate' }))
  );
});
