// PLAYWRIGHT_MODULE=/tmp/jog-review-browser/node_modules/playwright node tests/browser.cjs
// 実データ・設定ファイルを読まず、通信をローカルの偽DBだけに置き換える。
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const http = require('node:http');
const assert = require('node:assert/strict');
const stub = `
window.mock = { rows: { jog_runs: [], jog_notes: [], jog_skip_days: [] }, calls: [], failRead: false, failWrite: false, delay: 0, batches: 0, failBatch: 0 };
window.JOG_CONFIG = { SUPABASE_URL: 'http://localhost', SUPABASE_KEY: 'dummy' };
window.supabase = { createClient: () => ({
  auth: { getSession: async () => ({ data: { session: { user: { id: 'dummy-user', email: 'dummy@example.invalid' } } } }), signOut: async () => ({ error: null }) },
  from(table) {
    let action = 'select', payload, filters = [], orders = [], from = 0, to = Infinity;
    const q = {
      select() { return q; }, eq(k,v) { filters.push([k,v]); return q; },
      order(k,o) { orders.push([k,o.ascending]); return q; }, range(a,b) { from=a; to=b; return q; },
      insert(p) { action='insert'; payload=p; return q; }, update(p) { action='update'; payload=p; return q; },
      upsert(p) { action='upsert'; payload=p; return q; }, delete() { action='delete'; return q; },
      async then(resolve, reject) {
        try {
          mock.calls.push({ table, action });
          if (mock.delay) await new Promise(r => setTimeout(r, mock.delay));
          if (action === 'select' && mock.failRead) throw new Error('dummy read failure');
          if (action !== 'select' && mock.failWrite) throw new Error('dummy write failure');
          let rows = mock.rows[table];
          const matches = r => filters.every(([k,v]) => r[k] === v);
          if (action === 'select') {
            rows = rows.filter(matches).sort((a,b) => { for (const [k,asc] of orders) { if (a[k] !== b[k]) return (a[k] < b[k] ? -1 : 1)*(asc?1:-1); } return 0; });
            return resolve({ data: structuredClone(rows.slice(from,to+1)), error: null });
          }
          if (action === 'insert') {
            mock.batches++;
            if (mock.failBatch === mock.batches) { mock.failRead = true; throw new Error('dummy partial failure'); }
            for (const r of Array.isArray(payload) ? payload : [payload]) rows.push({ id: 'id-'+rows.length, created_at: '2026-01-01', ...structuredClone(r) });
          }
          if (action === 'update') rows.filter(matches).forEach(r => Object.assign(r, payload));
          if (action === 'delete') mock.rows[table] = rows.filter(r => !matches(r));
          if (action === 'upsert') { const r = rows.find(r => r.skipped_on === payload.skipped_on); if(r) Object.assign(r,payload); else rows.push({ id: 'skip-'+rows.length, ...payload }); }
          resolve({ data: null, error: null });
        } catch(e) { reject(e); }
      }
    }; return q;
  }
}) };
`;
const sdkPattern = /https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@[^']+\/dist\/umd\/supabase\.js/;
const server = http.createServer((req,res) => {
  const path = req.url.split('?')[0];
  let body, type='text/javascript';
  if (path === '/' || path === '/index.html') {
    body=fs.readFileSync('index.html','utf8').replace(/<script src="https:[^>]+><\/script>/, '<script src="test-stub.js"></script>').replace(/<script src="js\/config.js[^>]+><\/script>/,'');
    type='text/html';
  } else if (path === '/test-stub.js') body=stub;
  else if (path === '/sw.js') body=fs.readFileSync('sw.js','utf8').replace(sdkPattern,'./test-stub.js').replace("  './js/config.js?v=23',\n",'');
  else if (['/js/app.js','/style.css','/manifest.json','/icon-192.png','/icon-512.png'].includes(path)) {
    body=fs.readFileSync('.'+path); type=path.endsWith('.css')?'text/css':path.endsWith('.png')?'image/png':path.endsWith('.json')?'application/json':'text/javascript';
  } else { res.writeHead(404); return res.end(); }
  res.writeHead(200,{'Content-Type':type});res.end(body);
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const origin=`http://127.0.0.1:${server.address().port}`;
 const browser=await chromium.launch({executablePath:process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
 const page=await context.newPage(); const errors=[], external=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await context.route('**/*', route=>{ if(!route.request().url().startsWith(origin)){external.push(route.request().url());return route.abort();} return route.continue(); });
 const test=async(name,fn)=>{ await fn();console.log('PASS '+name); };
 try {
 await page.goto(origin);await page.waitForFunction(()=>S.loadedAt>0);
 await test('スマホ幅・4タブ・横はみ出しなし',async()=>{
   for(const tab of ['runs','notes','settings','today']) await page.locator('[data-tab="'+tab+'"]').click();
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 });
 await test('時間の空欄区切りを拒否・数値の型を検証',async()=>{
   assert.deepEqual(await page.evaluate(()=>[parseDuration('1::30'),parseDuration(':30'),parseDuration('29:30'),Number.isNaN(numOrNull(false)),Number.isNaN(numOrNull(''))]),[null,null,1770,true,true]);
 });
 await test('保存・編集・削除、送信中の画面保護と通信失敗から復帰',async()=>{
   await page.click('#quickAddBtn');await page.fill('#fDistance','5');await page.fill('#fDuration','30:00');
   await page.evaluate(()=>{mock.failWrite=true;});await page.click('#saveRunBtn');
   await page.waitForFunction(()=>!withBusy.active);assert.equal(await page.inputValue('#fDistance'),'5');
   assert.equal(await page.locator('#runModal').isVisible(),true);
   await page.evaluate(()=>{mock.failWrite=false;mock.delay=150;});await page.click('#saveRunBtn');
   assert.equal(await page.locator('[data-close="runModal"]').first().isDisabled(),true);
   await page.waitForFunction(()=>!withBusy.active);assert.equal(await page.evaluate(()=>mock.rows.jog_runs.length),1);
   await page.evaluate(()=>{mock.delay=0;});await page.locator('#recentRuns [data-run]').first().click();await page.fill('#fDistance','6');await page.click('#saveRunBtn');await page.waitForFunction(()=>!withBusy.active);
   assert.equal(await page.evaluate(()=>mock.rows.jog_runs[0].distance_km),6);
   await page.locator('#recentRuns [data-run]').first().click();await page.click('#deleteRunBtn');await page.waitForFunction(()=>!withBusy.active);assert.equal(await page.evaluate(()=>mock.rows.jog_runs.length),0);
 });
 await test('初期読込の再試行中表示・入力保持',async()=>{
   await page.evaluate(async()=>{S.loadedAt=0;mock.failRead=true;await loadAll();openRunModal(null);$('fTitle').value='残す入力';mock.failRead=false;mock.delay=100;window.pending=loadAll();});
   assert.match(await page.textContent('#loadBannerMsg'),/読み込み中/);assert.equal(await page.locator('#loadRetryBtn').isVisible(),false);
   await page.evaluate(()=>pending);assert.equal(await page.inputValue('#fTitle'),'残す入力');await page.evaluate(()=>{mock.delay=0;closeModal('runModal');});
 });
 await test('メモの追加・編集・削除と、走れなかった理由の保存・削除',async()=>{
   await page.locator('[data-tab="notes"]').click();await page.click('#addNoteBtn');await page.fill('#nContent','ダミー本文');await page.click('#saveNoteBtn');await page.waitForFunction(()=>!withBusy.active);
   await page.locator('#noteList [data-note]').first().click();await page.fill('#nContent','編集後本文');await page.click('#saveNoteBtn');await page.waitForFunction(()=>!withBusy.active);
   assert.equal(await page.evaluate(()=>mock.rows.jog_notes[0].content),'編集後本文');
   await page.locator('#noteList [data-note]').first().click();await page.click('#deleteNoteBtn');await page.waitForFunction(()=>!withBusy.active);assert.equal(await page.evaluate(()=>mock.rows.jog_notes.length),0);
   await page.locator('[data-tab="runs"]').click();await page.evaluate(()=>openSkipModal('2026-01-05'));
   await page.click('[data-skip-reason="rain"]');await page.click('#saveSkipBtn');await page.waitForFunction(()=>!withBusy.active);assert.equal(await page.evaluate(()=>mock.rows.jog_skip_days[0].reason),'rain');
   await page.evaluate(()=>openSkipModal('2026-01-05'));await page.click('#deleteSkipBtn');await page.waitForFunction(()=>!withBusy.active);assert.equal(await page.evaluate(()=>mock.rows.jog_skip_days.length),0);
 });
 await test('古い表示に依存せず取込、不正行の後の正常行、理由の検証',async()=>{
   const status=await page.evaluate(async()=>{
     mock.rows.jog_runs=[{id:'existing',user_id:S.user.id,ran_on:'2026-01-01',duration_sec:600,distance_km:1}];
     S.runs=[];
     const data={runs:[{ran_on:'2026-01-01',duration_sec:600,distance_km:1},{ran_on:'2026-01-02',duration_sec:700,distance_km:-1},{ran_on:'2026-01-02',duration_sec:'700',distance_km:2},null,{ran_on:'2026-01-03',duration_sec:false,distance_km:2}],notes:[{content:'テストメモ',tags:7},{content:'テストメモ',tags:['確認'],shown_count:12,last_shown_at:'2026-01-01T00:00:00Z'}],skip_days:[{skipped_on:'2026-01-04',reason:'toString'}]};
     await importBackup(new File([JSON.stringify(data)],'dummy.json'));
     return {runs:mock.rows.jog_runs.length,notes:mock.rows.jog_notes.length,shown:mock.rows.jog_notes[0].shown_count,status:$('backupStatus').textContent};
   });assert.equal(status.runs,2);assert.equal(status.notes,1);assert.ok(status.shown>=12);assert.match(status.status,/重複1件/);assert.match(status.status,/不備5件/);
 });
 await test('取込途中失敗＋再読込失敗後も、再実行で501件・重複なし',async()=>{
   const result=await page.evaluate(async()=>{
     mock.rows={jog_runs:[],jog_notes:[],jog_skip_days:[]};S.todayNote=null;mock.batches=0;mock.failBatch=2;
     const file=new File([JSON.stringify({runs:Array.from({length:501},(_,i)=>({ran_on:'2026-02-01',duration_sec:i+1,distance_km:1}))})],'dummy.json');
     await importBackup(file);const partial=mock.rows.jog_runs.length;const message=$('backupStatus').textContent;
     const before=mock.batches;await importBackup(file);const blocked=before===mock.batches;
     mock.failRead=false;mock.failBatch=0;await importBackup(file);
     return {partial,message,blocked,total:mock.rows.jog_runs.length};
   });assert.equal(result.partial,500);assert.equal(result.blocked,true);assert.equal(result.total,501);assert.match(result.message,/同じファイル/);
 });
 await test('別端末で更新・削除した今日のメモを再読込で反映',async()=>{
   const result=await page.evaluate(async()=>{
     mock.rows.jog_notes=[{id:'note1',user_id:S.user.id,content:'変更前',tags:['旧タグ'],shown_count:1}];S.todayNote=null;await loadAll();
     mock.rows.jog_notes[0].content='変更後';mock.rows.jog_notes[0].tags=[];S.noteFilter='旧タグ';await loadAll();
     const content=$('todayNoteBody').textContent;const filter=S.noteFilter;
     mock.rows.jog_notes=[];await loadAll();return {content,filter,deleted:S.todayNote===null};
   });assert.match(result.content,/変更後/);assert.equal(result.filter,null);assert.equal(result.deleted,true);
 });
 await test('書出しは最新全件・失敗時はダウンロードしない',async()=>{
   await page.evaluate(()=>{mock.rows.jog_runs.push({id:'fresh',user_id:S.user.id,ran_on:'2026-02-02',duration_sec:100,distance_km:1});});
   const download=page.waitForEvent('download');await page.evaluate(()=>exportBackup());const d=await download;
   const data=JSON.parse(fs.readFileSync(await d.path(),'utf8'));assert.equal(data.runs.length,502);assert.equal(data.runs.some(r=>'user_id' in r),false);
   await page.evaluate(async()=>{mock.failRead=true;await exportBackup();mock.failRead=false;});assert.match(await page.textContent('#backupStatus'),/中止/);
 });
 await test('1001件の同日記録のページングに欠落なし',async()=>{
   assert.equal(await page.evaluate(async()=>{mock.rows.jog_runs=Array.from({length:1001},(_,i)=>({id:String(i).padStart(4,'0'),user_id:S.user.id,ran_on:'2026-02-01',duration_sec:i+1,distance_km:1}));const result=await fetchAll('jog_runs','ran_on');return new Set(result.data.map(r=>r.id)).size;}),1001);
 });
 await test('画像を縮小し、手直し・閉じたフォームを遅い読取で上書きしない',async()=>{
   const result=await page.evaluate(async()=>{
     const canvas=document.createElement('canvas');canvas.width=3000;canvas.height=2000;const c=canvas.getContext('2d');c.fillStyle='white';c.fillRect(0,0,3000,2000);c.fillStyle='black';c.font='80px sans-serif';c.fillText('DUMMY 5.00 km',100,300);
     const file=await new Promise(r=>canvas.toBlob(r,'image/png'));window.dummyImage=file;
     const small=await prepareScreenshot(file);const bmp=await createImageBitmap(small);const width=bmp.width;bmp.close();
     localStorage.setItem('jog_gemini_key','dummy');openRunModal(null);$('fDistance').value='1';
     window.originalFetch=window.fetch;window.fetch=()=>new Promise(r=>window.finishOCR=()=>r(new Response(JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify({distance_km:5,duration_sec:1800})}]}}]}))));
     window.ocr=readScreenshot(file);return {original:file.size,width,size:small.size};
   });assert.ok(result.size<result.original);assert.equal(result.width,1600);
   await page.waitForFunction(()=>!!window.finishOCR);await page.fill('#fDistance','9');await page.evaluate(async()=>{finishOCR();await ocr;});assert.equal(await page.inputValue('#fDistance'),'9');
   await page.evaluate(()=>{window.finishOCR=null;window.ocr=readScreenshot(dummyImage);});await page.waitForFunction(()=>!!window.finishOCR);
   await page.evaluate(async()=>{closeModal('runModal');openRunModal(null);$('fDistance').value='7';finishOCR();await ocr;window.fetch=originalFetch;});assert.equal(await page.inputValue('#fDistance'),'7');
 });
 await test('スクショ通信が30秒で終了し手入力を保持',async()=>{
   await page.evaluate(()=>{window.fetch=(url,opts)=>new Promise((resolve,reject)=>opts.signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError'))));window.ocr=readScreenshot(dummyImage);});
   await page.evaluate(()=>ocr);assert.match(await page.textContent('#shotStatus'),/30秒/);assert.equal(await page.inputValue('#fDistance'),'7');await page.evaluate(()=>{window.fetch=originalFetch;closeModal('runModal');});
 });
 await page.evaluate(()=>loadAll());
 await page.screenshot({path:'/tmp/jog-review-mobile.png',fullPage:false});
 await page.setViewportSize({width:1280,height:900});await page.locator('[data-tab="runs"]').click();
 await page.screenshot({path:process.env.JOG_SCREENSHOT || '/tmp/jog-review-desktop.png',fullPage:false});
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 console.log('PASS ページ例外0・外部通信0（本番DB・Gemini未接続）');
 // 別の使い捨てプロファイルでSWを有効にし、同じダミーSDKのオフライン再起動を確認。
 const offlineContext=await browser.newContext({serviceWorkers:'allow'});const offlinePage=await offlineContext.newPage();
 await offlinePage.goto(origin);await offlinePage.evaluate(()=>navigator.serviceWorker.ready);
 await offlinePage.waitForFunction(()=>!!navigator.serviceWorker.controller);await offlineContext.setOffline(true);
 await offlinePage.reload();await offlinePage.waitForFunction(()=>S.loadedAt>0);
 assert.equal(await offlinePage.evaluate(()=>caches.has('jog-v23')),true);
 console.log('PASS Service Workerで画面とダミーSDKをオフライン再読込');
 await offlineContext.close();
 } finally {await browser.close();server.closeAllConnections();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
