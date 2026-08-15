/* ホーム画面から開けるようにするための最小限の Service Worker。
   データは Supabase から都度取るので、キャッシュするのは画面の枠だけ。
   更新したら CACHE の数字を上げる。 */
const CACHE = 'jog-v1';
const SHELL = [
  './',
  './index.html',
  './style.css?v=1',
  './js/config.js?v=1',
  './js/app.js?v=1',
  './icon-192.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Supabase と Gemini への通信は必ずネットワークへ（キャッシュしない）
  if (url.origin !== location.origin) return;
  if (e.request.method !== 'GET') return;

  // 画面のファイルはネットワーク優先。つながらなければキャッシュを出す
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
