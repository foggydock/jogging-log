# ジョギングログ（旧URL用ブランチ）

このブランチは、旧URL https://foggydock.github.io/jogging-log/ を GitHub Pages で配信するためだけのものです。
アプリ本体は `main` ブランチにあり、https://jogging-log.pages.dev/ （Cloudflare Pages）で公開しています。

- `index.html` / `404.html`：新しいURLへ移動するページ。移動する前に、この端末に残っているログイン状態や API キーを消し、前の版のオフライン機能を止めます。
- `sw.js`：前の版の Service Worker を止めて、キャッシュを片付けるためのものです。
