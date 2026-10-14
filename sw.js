/* 离线缓存：外壳「网络优先」（更新即时生效），内容包「先给缓存、后台更新」（省流量、能离线、下次打开就是新版） */
const CACHE = 'tdxl-v3';
const ASSETS = ['./index.html', './app.js', './style.css', './manifest.webmanifest', './icon.svg', './data/content.json'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) =>
    Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  const isData = url.pathname.includes('/data/');
  if (isData) {
    e.respondWith(caches.match(e.request).then((hit) => {
      const fresh = fetch(e.request).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        }
        return res;
      }).catch(() => hit);
      return hit || fresh;          // 有缓存立刻用；同时后台拉新版，下次打开就是新的
    }));
    return;
  }
  e.respondWith(fetch(e.request).then((res) => {
    const copy = res.clone();
    caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
    return res;
  }).catch(() => caches.match(e.request).then((hit) => hit || caches.match('./index.html'))));
});
