// node tools/check-assets.cjs — 配信前にHTMLと事前キャッシュの版ずれを検出する。
const fs = require('node:fs');
const assert = require('node:assert/strict');
const html = fs.readFileSync('index.html', 'utf8');
const sw = fs.readFileSync('sw.js', 'utf8');
const version = sw.match(/const CACHE = 'jog-v(\d+)'/)[1];
const assets = [...html.matchAll(/(?:src|href)="([^" ]+\?v=\d+)"/g)]
  .map((m) => m[1]).filter((url) => /\.(?:js|css)\?/.test(url));
assert.equal(assets.length, 3);
for (const asset of assets) {
  assert.ok(asset.endsWith(`?v=${version}`), `版ずれ: ${asset}`);
  assert.ok(sw.includes(`'./${asset}'`), `事前キャッシュにない: ${asset}`);
  assert.ok(fs.existsSync(asset.split('?')[0]));
}
const sdk = html.match(/<script src="(https:[^"]+)"/)[1];
assert.ok(sw.includes(`'${sdk}'`), '画面用ライブラリが事前キャッシュと一致しません');
console.log(`アセットとキャッシュの版が一致: jog-v${version}`);

const base = process.argv[process.argv.indexOf('--base') + 1];
if (process.argv.includes('--base')) {
  const { execFileSync } = require('node:child_process');
  const changed = execFileSync('git', ['diff', '--name-only', base, '--', 'index.html', 'style.css', 'js', 'sw.js'], { encoding: 'utf8' }).trim();
  if (changed) {
    const previous = execFileSync('git', ['show', `${base}:sw.js`], { encoding: 'utf8' }).match(/const CACHE = 'jog-v(\d+)'/)[1];
    assert.ok(Number(version) > Number(previous), '画面更新時はCACHEの番号も上げてください');
  }
}
