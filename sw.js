// このURLのアプリは https://jogging-log.pages.dev/ へ引っ越しました。
// 前の版のオフライン機能を止めて、この端末に残っているキャッシュ（jog-〜）を片付ける。
const CACHE_PREFIX = "jog-";

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith(CACHE_PREFIX)).map(k => caches.delete(k)));
    await self.registration.unregister();
    // 開いている画面を読み込み直して、「引っ越しました」ページを出す
    const clients = await self.clients.matchAll({ type: 'window' });
    clients.forEach(c => c.navigate(c.url));
  })());
});
