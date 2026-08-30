/* ホーム画面から開けるようにするための最小限の Service Worker。
   データは Supabase から都度取るので、キャッシュするのは画面の枠だけ。
   更新したら CACHE の数字を上げる。 */
const CACHE = 'jog-v4';
const SHELL = [
  './',
  './index.html',
  './style.css?v=4',
  './js/config.js?v=4',
  './js/app.js?v=4',
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

  // 画面のファイルはネットワーク優先。ただし電波が悪くて応答が遅い時に
  // いつまでも待たされないよう、4秒で諦めてキャッシュを出す（届いたら裏で更新）
  const network = fetch(e.request).then((res) => {
    const copy = res.clone();
    caches.open(CACHE).then((c) => c.put(e.request, copy));
    return res;
  });
  const timeout = new Promise((resolve) => setTimeout(resolve, 4000, null));

  e.respondWith(
    Promise.race([network, timeout]).then((res) =>
      res || caches.match(e.request).then((cached) => cached || network)
    ).catch(() => caches.match(e.request))
  );
});
