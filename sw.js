/* ホーム画面から開けるようにするための最小限の Service Worker。
   データは Supabase から都度取るので、キャッシュするのは画面の枠だけ。
   更新したら CACHE の数字を上げる。 */
const CACHE = 'jog-v23';
// 同じドメイン（foggydock.github.io）の他のアプリとキャッシュの置き場が共通なので、消すのはこの接頭辞の古い版だけにする
const CACHE_PREFIX = 'jog-';
// index.html は入れない（Cloudflare Pages では "/" へ転送され、転送済みの応答を画面遷移に返すと開けなくなる）
const SHELL = [
  './',
  './style.css?v=23',
  './js/config.js?v=23',
  './js/app.js?v=23',
  './icon-192.png',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.4/dist/umd/supabase.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // 外部通信は固定版の画面用ライブラリだけ対象。データやAIの通信は保存しない。
  if (url.origin !== location.origin && !SHELL.includes(url.href)) return;
  if (e.request.method !== 'GET') return;

  // 画面のファイルはネットワーク優先。ただし電波が悪くて応答が遅い時に
  // いつまでも待たされないよう、4秒で諦めてキャッシュを出す（届いたら裏で更新）
  const network = fetch(e.request).then((res) => {
    // 成功した応答だけ保存する（エラーや転送された応答をキャッシュすると、次から開けなくなる）
    if (res.ok && !res.redirected) {
      const copy = res.clone();
      e.waitUntil(caches.open(CACHE).then((c) => c.put(e.request, copy)));
    }
    if (!res.ok) throw new Error('画面ファイルを取得できませんでした');
    return res;
  });
  const timeout = new Promise((resolve) => setTimeout(resolve, 4000, null));

  e.respondWith(
    Promise.race([network, timeout]).then((res) =>
      res || caches.match(e.request).then((cached) => cached || network)
    ).catch(async () => (await caches.match(e.request)) || Response.error())
  );
});
