/*
 * オフライン対応（Service Worker）
 * 保存済みのファイルをすぐ返し、裏でネットから最新版を取り直す。
 * 更新は「次に開いたとき」に反映される。
 */
const CACHE = 'shunkan-eisakubun-v2';
const FILES = [
  './',
  './index.html',
  './css/style.css',
  './js/judge.js',
  './js/app.js',
  './data/biz-mail.js',
  './data/biz-meeting.js',
  './data/biz-negotiation.js',
  './data/stage1-be.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(req, { ignoreSearch: true });
      const fresh = fetch(req)
        .then((res) => {
          if (res.ok) cache.put(req, res.clone());
          return res;
        })
        .catch(() => null);
      if (cached) {
        event.waitUntil(fresh);
        return cached;
      }
      return (await fresh) || (req.mode === 'navigate' ? cache.match('./index.html') : Response.error());
    })
  );
});
