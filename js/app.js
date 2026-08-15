/* ジョギングログ */
'use strict';

const { SUPABASE_URL, SUPABASE_KEY } = window.JOG_CONFIG;
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const S = {
  user: null,
  runs: [],          // ran_on の新しい順
  notes: [],
  noteFilter: null,  // 選択中のタグ
  todayNote: null,
  editRunId: null,
  editNoteId: null,
  feel: null,
  listLimit: 30,
  yearFilter: 'all',
};

const $ = (id) => document.getElementById(id);
const el = (sel) => document.querySelector(sel);
const els = (sel) => Array.from(document.querySelectorAll(sel));

/* ============================================================
   小道具
   ============================================================ */
function toast(msg, ms = 2400) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add('hidden'), ms);
}

const pad = (n) => String(n).padStart(2, '0');

/** 秒 → "0:29:30" */
function fmtDuration(sec) {
  if (sec == null) return '—';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${h}:${pad(m)}:${pad(s)}`;
}

/** "0:29:30" / "29:30" → 秒。読めなければ null */
function parseDuration(str) {
  if (!str) return null;
  const parts = String(str).trim().split(':').filter((p) => p !== '');
  if (!parts.length || parts.some((p) => !/^\d+$/.test(p))) return null;
  const n = parts.map(Number);
  if (n.length === 3) return n[0] * 3600 + n[1] * 60 + n[2];
  if (n.length === 2) return n[0] * 60 + n[1];
  if (n.length === 1) return n[0] * 60;
  return null;
}

/** 平均ペース（秒/km）。距離か時間が無ければ null */
function paceOf(run) {
  if (!run.duration_sec || !run.distance_km) return null;
  return run.duration_sec / Number(run.distance_km);
}

/**
 * 「自己ベスト」に採用してよい走りか。
 * 3分/km より速い記録は人間の市民ランナーには出せないので、入力ミスとみなして
 * ベスト計算から外す（記録そのものは消さない。一覧には出るので手で直せる）。
 * 距離が短すぎる走りもベストには数えない。
 */
function isPlausibleBest(run) {
  const p = paceOf(run);
  return p != null && p >= 180 && Number(run.distance_km) >= 3;
}

/** 秒/km → "6'59\"/km" */
function fmtPace(secPerKm) {
  if (secPerKm == null || !isFinite(secPerKm)) return '—';
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return s === 60 ? `${m + 1}'00"/km` : `${m}'${pad(s)}"/km`;
}

function fmtDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const w = '日月火水木金土'[new Date(y, m - 1, d).getDay()];
  return `${m}/${d}(${w})`;
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function daysBetween(isoA, isoB) {
  const a = new Date(isoA + 'T00:00:00');
  const b = new Date(isoB + 'T00:00:00');
  return Math.round((b - a) / 86400000);
}

/** その日が属する週の月曜日（YYYY-MM-DD） */
function weekKey(iso) {
  const d = new Date(iso + 'T00:00:00');
  const dow = (d.getDay() + 6) % 7; // 月=0
  d.setDate(d.getDate() - dow);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/* ============================================================
   ログイン
   ============================================================ */
async function initAuth() {
  const { data } = await sb.auth.getSession();
  if (data.session) {
    await onLoggedIn(data.session.user);
  } else {
    $('loginScreen').classList.remove('hidden');
  }
}

async function login() {
  const email = $('loginEmail').value.trim();
  const password = $('loginPassword').value;
  if (!email || !password) {
    $('loginMsg').textContent = 'メールアドレスとパスワードを入れてください';
    return;
  }
  $('loginBtn').disabled = true;
  $('loginMsg').textContent = 'ログイン中…';
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  $('loginBtn').disabled = false;
  if (error) {
    $('loginMsg').textContent = 'ログインできませんでした：' + error.message;
    return;
  }
  $('loginMsg').textContent = '';
  await onLoggedIn(data.user);
}

async function onLoggedIn(user) {
  S.user = user;
  $('loginScreen').classList.add('hidden');
  $('app').classList.remove('hidden');
  $('acctEmail').textContent = user.email;
  await loadAll();
}

/* ============================================================
   データ読み込み
   ============================================================ */
async function loadAll() {
  const [runsRes, notesRes] = await Promise.all([
    sb.from('jog_runs').select('*').order('ran_on', { ascending: false }),
    sb.from('jog_notes').select('*').order('created_at', { ascending: false }),
  ]);
  if (runsRes.error) { toast('記録の読み込みに失敗：' + runsRes.error.message, 5000); return; }
  if (notesRes.error) { toast('メモの読み込みに失敗：' + notesRes.error.message, 5000); return; }

  S.runs = runsRes.data || [];
  S.notes = notesRes.data || [];
  renderAll();
}

function renderAll() {
  renderToday();
  renderRunsTab();
  renderNotesTab();
}

/* ============================================================
   きょう
   ============================================================ */
function renderToday() {
  const d = new Date();
  $('todayDate').textContent =
    `${d.getMonth() + 1}月${d.getDate()}日(${'日月火水木金土'[d.getDay()]})`;

  renderCheer();
  if (!S.todayNote) pickTodayNote();
  renderTodayNote();

  const list = S.runs.slice(0, 5);
  $('recentRuns').innerHTML = list.length
    ? list.map(runRowHTML).join('')
    : '<p class="empty">まだ記録がありません</p>';
}

/** 実データから励ましの一文をつくる（APIは使わない） */
function buildCheer() {
  if (!S.runs.length) {
    return { text: 'ここから始まります。\n最初の1回を記録しましょう。', stats: [] };
  }

  const today = todayISO();
  const totalKm = S.runs.reduce((a, r) => a + Number(r.distance_km || 0), 0);
  const totalSec = S.runs.reduce((a, r) => a + (r.duration_sec || 0), 0);

  // 今月 / 先月
  const ym = today.slice(0, 7);
  const prev = new Date(today + 'T00:00:00');
  prev.setMonth(prev.getMonth() - 1);
  const pym = `${prev.getFullYear()}-${pad(prev.getMonth() + 1)}`;
  const monthKm = sumKm(S.runs.filter((r) => r.ran_on.startsWith(ym)));
  const prevKm = sumKm(S.runs.filter((r) => r.ran_on.startsWith(pym)));

  // 連続週
  const weeks = new Set(S.runs.map((r) => weekKey(r.ran_on)));
  let streak = 0;
  const cur = new Date(weekKey(today) + 'T00:00:00');
  // 今週まだ走っていなくても、先週から続いていれば連続は途切れていない扱い
  if (!weeks.has(weekKey(today))) cur.setDate(cur.getDate() - 7);
  while (weeks.has(`${cur.getFullYear()}-${pad(cur.getMonth() + 1)}-${pad(cur.getDate())}`)) {
    streak++;
    cur.setDate(cur.getDate() - 7);
  }

  const last = S.runs[0];
  const gap = daysBetween(last.ran_on, today);

  // 直近90日で最速（3km以上の走りに限る）
  const recent = S.runs.filter((r) =>
    daysBetween(r.ran_on, today) <= 90 && isPlausibleBest(r));
  const fastest = recent.length
    ? recent.reduce((a, b) => (paceOf(a) <= paceOf(b) ? a : b)) : null;

  // 本文を選ぶ
  const lines = [];
  if (gap === 0) {
    lines.push('今日はもう走りました。おつかれさまでした。');
  } else if (gap === 1) {
    lines.push('昨日走りました。今日は休んでもいい日です。');
  } else if (gap >= 10) {
    lines.push(`前回から${gap}日。\nいきなり戻さなくていいので、まず20分だけ。`);
  } else if (gap >= 4) {
    lines.push(`前回から${gap}日空きました。\n今日は軽く、ゆっくりで十分です。`);
  } else {
    lines.push(`前回は${gap}日前。いい間隔です。`);
  }

  if (streak >= 2) lines.push(`${streak}週続けて走れています。`);
  if (monthKm > 0 && prevKm > 0) {
    lines.push(monthKm >= prevKm
      ? `今月は ${monthKm.toFixed(1)}km。先月ひと月分（${prevKm.toFixed(1)}km）をもう超えました。`
      : `今月はここまで ${monthKm.toFixed(1)}km。先月はひと月で ${prevKm.toFixed(1)}km でした。`);
  } else if (monthKm > 0) {
    lines.push(`今月はここまで ${monthKm.toFixed(1)}km。`);
  }
  if (fastest) {
    lines.push(`直近3か月のベストは ${fmtPace(paceOf(fastest))}（${fmtDate(fastest.ran_on)}）。`);
  }

  const stats = [
    { label: '累計距離', value: totalKm.toFixed(0), unit: 'km' },
    { label: '走った回数', value: S.runs.length, unit: '回' },
    { label: '累計時間', value: (totalSec / 3600).toFixed(0), unit: '時間' },
    { label: '連続', value: streak, unit: '週' },
  ];
  return { text: lines.join('\n'), stats };
}

const sumKm = (rows) => rows.reduce((a, r) => a + Number(r.distance_km || 0), 0);

function renderCheer() {
  const { text, stats } = buildCheer();
  $('cheerText').textContent = text;
  $('cheerStats').innerHTML = stats
    .map((s) => `<div><b>${esc(s.value)}<span style="font-size:11px;color:var(--dim)">${esc(s.unit)}</span></b>${esc(s.label)}</div>`)
    .join('');
}

/**
 * しばらく見ていないメモを優先して1枚選ぶ。
 * 「最後に見てからの日数」を重みにした抽選なので、
 * 直近に見たものはほぼ出ず、放置しているものほど出やすい。
 * 毎回きっちり同じ順にならないよう、確定ではなく抽選にしている。
 */
function pickTodayNote() {
  if (!S.notes.length) { S.todayNote = null; return; }

  const weights = S.notes.map((n) => {
    const days = n.last_shown_at
      ? (Date.now() - new Date(n.last_shown_at)) / 86400000
      : 365;                       // 一度も見ていないものは「1年見ていない」扱い
    const w = Math.min(days, 365) * (n.favorite ? 1.6 : 1);
    return Math.max(w, 0.05);      // 今日見たものも、ごくわずかに残す
  });

  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < S.notes.length; i++) {
    r -= weights[i];
    if (r <= 0) { S.todayNote = S.notes[i]; return; }
  }
  S.todayNote = S.notes[S.notes.length - 1];
}

function renderTodayNote() {
  const n = S.todayNote;
  const box = $('todayNoteBody');
  if (!n) {
    box.innerHTML = '<p class="empty">メモがまだありません。<br>「メモ」タブで、走る気になる話を貯めていきましょう。</p>';
    return;
  }
  box.innerHTML = `
    ${n.title ? `<h4>${esc(n.title)}</h4>` : ''}
    <p>${esc(n.content)}</p>
    ${n.source ? `<div class="src">— ${esc(n.source)}</div>` : ''}`;
  markShown(n);
}

/** 表示したことを記録（画面は待たせない） */
async function markShown(n) {
  if (markShown._last === n.id) return;
  markShown._last = n.id;
  const patch = { last_shown_at: new Date().toISOString(), shown_count: (n.shown_count || 0) + 1 };
  Object.assign(n, patch);
  await sb.from('jog_notes').update(patch).eq('id', n.id);
}

/* ============================================================
   記録タブ
   ============================================================ */
function runRowHTML(r) {
  const p = paceOf(r);
  return `<div class="run-row" data-run="${r.id}">
    <div class="run-date">${fmtDate(r.ran_on)}</div>
    <div class="run-main">
      <div class="run-dist">${r.distance_km != null ? Number(r.distance_km).toFixed(2) : '—'}<small>km</small></div>
      <div class="run-meta">${fmtDuration(r.duration_sec)}${r.title ? ' ・ ' + esc(r.title) : ''}${r.note ? ' ・ ' + esc(r.note) : ''}</div>
    </div>
    <div class="run-pace">${fmtPace(p)}</div>
  </div>`;
}

function renderRunsTab() {
  renderStatGrid();
  renderOddNotice();
  renderMonthChart();
  renderYearFilter();
  renderAllRuns();
}

function renderStatGrid() {
  const totalKm = sumKm(S.runs);
  const totalSec = S.runs.reduce((a, r) => a + (r.duration_sec || 0), 0);
  const ym = todayISO().slice(0, 7);
  const monthRuns = S.runs.filter((r) => r.ran_on.startsWith(ym));
  const year = todayISO().slice(0, 4);
  const yearRuns = S.runs.filter((r) => r.ran_on.startsWith(year));
  const paced = S.runs.filter(isPlausibleBest);
  const best = paced.length ? paced.reduce((a, b) => (paceOf(a) <= paceOf(b) ? a : b)) : null;
  const longest = S.runs.length
    ? S.runs.reduce((a, b) => (Number(a.distance_km || 0) >= Number(b.distance_km || 0) ? a : b)) : null;

  const cards = [
    { label: '累計距離', value: totalKm.toFixed(1), unit: 'km', sub: `${S.runs.length} 回` },
    { label: '累計時間', value: (totalSec / 3600).toFixed(1), unit: 'h', sub: '走った時間の合計' },
    { label: '今月', value: sumKm(monthRuns).toFixed(1), unit: 'km', sub: `${monthRuns.length} 回` },
    { label: `${year}年`, value: sumKm(yearRuns).toFixed(1), unit: 'km', sub: `${yearRuns.length} 回` },
    best ? { label: '自己ベスト(ペース)', value: fmtPace(paceOf(best)).replace('/km', ''), unit: '/km', sub: fmtDate(best.ran_on) } : null,
    longest ? { label: '最長距離', value: Number(longest.distance_km || 0).toFixed(2), unit: 'km', sub: fmtDate(longest.ran_on) } : null,
  ].filter(Boolean);

  $('statGrid').innerHTML = cards.map((c) => `
    <div class="stat">
      <div class="label">${esc(c.label)}</div>
      <div class="value">${esc(c.value)}<span class="unit">${esc(c.unit)}</span></div>
      <div class="sub">${esc(c.sub)}</div>
    </div>`).join('');
}

function renderMonthChart() {
  const by = new Map();
  S.runs.forEach((r) => {
    const k = r.ran_on.slice(0, 7);
    by.set(k, (by.get(k) || 0) + Number(r.distance_km || 0));
  });
  // 直近24か月（走っていない月も 0 で並べる）
  const months = [];
  const d = new Date(todayISO() + 'T00:00:00');
  d.setDate(1);
  for (let i = 0; i < 24; i++) {
    months.unshift(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`);
    d.setMonth(d.getMonth() - 1);
  }
  const max = Math.max(1, ...months.map((m) => by.get(m) || 0));
  $('monthChart').innerHTML = months.map((m) => {
    const v = by.get(m) || 0;
    const h = Math.round((v / max) * 100);
    const mm = Number(m.slice(5));
    return `<div class="bar" title="${m} ${v.toFixed(1)}km">
      ${v > 0 ? `<span>${v.toFixed(0)}</span>` : ''}
      <i style="height:${h}%"></i>
      <em>${mm === 1 ? m.slice(2, 4) + '/1' : mm}</em>
    </div>`;
  }).join('');

  scrollChartToEnd();
}

/**
 * 最新の月が見えるように右端まで送る。
 * タブが非表示のうちは幅が 0 で送れないので、タブを開いたときにも呼ぶ。
 */
function scrollChartToEnd() {
  const box = el('.chart-scroll');
  if (!box) return;
  // scrollWidth を読むとレイアウトが確定するので、その場で送れる。
  // 表示直後で幅が出ていない場合に備えて、次のターンでもう一度送る。
  box.scrollLeft = box.scrollWidth;
  setTimeout(() => { box.scrollLeft = box.scrollWidth; }, 0);
}

/** 明らかにありえない記録（入力ミス）を拾って直せるようにする */
function renderOddNotice() {
  const odd = S.runs.filter((r) => {
    const p = paceOf(r);
    return p != null && p < 180;   // 3分/km より速い＝入力ミス
  });
  const box = $('oddNotice');
  if (!odd.length) { box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  box.innerHTML = `
    <div class="card-title">⚠️ 数字を確かめたい記録が ${odd.length} 件</div>
    <p class="hint">時間に対して距離が長すぎます（Notion に入力された時点でずれていた可能性）。
      タップすると直せます。直すまで自己ベストの計算からは外してあります。</p>
    <div class="run-list">${odd.map(runRowHTML).join('')}</div>`;
}

function renderYearFilter() {
  const years = [...new Set(S.runs.map((r) => r.ran_on.slice(0, 4)))].sort().reverse();
  const sel = $('yearFilter');
  sel.innerHTML = `<option value="all">すべての年</option>` +
    years.map((y) => `<option value="${y}">${y}年</option>`).join('');
  sel.value = S.yearFilter;
}

function filteredRuns() {
  return S.yearFilter === 'all'
    ? S.runs
    : S.runs.filter((r) => r.ran_on.startsWith(S.yearFilter));
}

function renderAllRuns() {
  const rows = filteredRuns();
  $('runCount').textContent = `${rows.length}件`;
  const shown = rows.slice(0, S.listLimit);
  $('allRuns').innerHTML = shown.length
    ? shown.map(runRowHTML).join('')
    : '<p class="empty">記録がありません</p>';
  $('moreRunsBtn').classList.toggle('hidden', rows.length <= S.listLimit);
}

/* ============================================================
   メモタブ
   ============================================================ */
function renderNotesTab() {
  const tags = [...new Set(S.notes.flatMap((n) => n.tags || []))].sort();
  $('tagChips').innerHTML = tags.length
    ? [`<button class="chip ${S.noteFilter ? '' : 'on'}" data-tag="">すべて</button>`]
      .concat(tags.map((t) =>
        `<button class="chip ${S.noteFilter === t ? 'on' : ''}" data-tag="${esc(t)}">${esc(t)}</button>`))
      .join('')
    : '';

  const list = S.noteFilter
    ? S.notes.filter((n) => (n.tags || []).includes(S.noteFilter))
    : S.notes;

  $('noteList').innerHTML = list.length
    ? list.map((n) => `
      <div class="note-card" data-note="${n.id}">
        <h4>${n.favorite ? '⭐️ ' : ''}${esc(n.title || n.content.slice(0, 24))}</h4>
        <p>${esc(n.content.length > 140 ? n.content.slice(0, 140) + '…' : n.content)}</p>
        <div class="meta">
          ${n.source ? `<span>— ${esc(n.source)}</span>` : ''}
          ${(n.tags || []).map((t) => `<span>#${esc(t)}</span>`).join('')}
          ${n.shown_count ? `<span>${n.shown_count}回ふり返り</span>` : ''}
        </div>
      </div>`).join('')
    : '<p class="empty">メモがありません。右上の「＋ 追加」から。</p>';
}

/* ============================================================
   記録モーダル
   ============================================================ */
function openRunModal(run) {
  S.editRunId = run ? run.id : null;
  S.feel = run ? run.feeling : null;
  $('runModalTitle').textContent = run ? '記録を編集' : '走った記録';
  $('fRanOn').value = run ? run.ran_on : todayISO();
  $('fTitle').value = run ? (run.title || '') : '朝ジョギング';
  $('fDuration').value = run ? fmtDuration(run.duration_sec).replace('—', '') : '';
  $('fDistance').value = run && run.distance_km != null ? run.distance_km : '';
  $('fHr').value = run && run.avg_hr != null ? run.avg_hr : '';
  $('fCadence').value = run && run.cadence != null ? run.cadence : '';
  $('fKcal').value = run && run.kcal != null ? run.kcal : '';
  $('fElev').value = run && run.elevation_m != null ? run.elevation_m : '';
  $('fNote').value = run ? (run.note || '') : '';
  $('shotStatus').textContent = '';
  $('deleteRunBtn').classList.toggle('hidden', !run);
  renderFeel();
  updatePacePreview();
  $('runModal').classList.remove('hidden');
}

function renderFeel() {
  els('#feelRow button').forEach((b) =>
    b.classList.toggle('on', Number(b.dataset.feel) === S.feel));
}

function updatePacePreview() {
  const sec = parseDuration($('fDuration').value);
  const km = parseFloat($('fDistance').value);
  $('pacePreview').textContent =
    sec && km ? `平均ペース ${fmtPace(sec / km)}` : '';
}

async function saveRun() {
  const ran_on = $('fRanOn').value;
  if (!ran_on) { toast('日付を入れてください'); return; }

  const durStr = $('fDuration').value.trim();
  const duration_sec = durStr ? parseDuration(durStr) : null;
  if (durStr && duration_sec == null) {
    toast('時間は 0:29:30 のように入れてください', 3500);
    return;
  }

  const num = (id) => {
    const v = $(id).value.trim();
    return v === '' ? null : Number(v);
  };
  const distance_km = num('fDistance');
  if (duration_sec == null && distance_km == null) {
    toast('時間か距離のどちらかは入れてください', 3500);
    return;
  }

  const row = {
    user_id: S.user.id,
    ran_on,
    title: $('fTitle').value.trim() || null,
    duration_sec,
    distance_km,
    avg_hr: num('fHr'),
    cadence: num('fCadence'),
    kcal: num('fKcal'),
    elevation_m: num('fElev'),
    feeling: S.feel,
    note: $('fNote').value.trim() || null,
  };

  $('saveRunBtn').disabled = true;
  let error;
  if (S.editRunId) {
    ({ error } = await sb.from('jog_runs').update(row).eq('id', S.editRunId));
  } else {
    row.source = row.source || 'manual';
    ({ error } = await sb.from('jog_runs').insert(row));
  }
  $('saveRunBtn').disabled = false;

  if (error) { toast('保存に失敗：' + error.message, 5000); return; }
  $('runModal').classList.add('hidden');
  toast('保存しました');
  await loadAll();
}

async function deleteRun() {
  if (!S.editRunId) return;
  if (!confirm('この記録を削除します。よろしいですか？')) return;
  const { error } = await sb.from('jog_runs').delete().eq('id', S.editRunId);
  if (error) { toast('削除に失敗：' + error.message, 5000); return; }
  $('runModal').classList.add('hidden');
  toast('削除しました');
  await loadAll();
}

/* ============================================================
   メモモーダル
   ============================================================ */
function openNoteModal(note) {
  S.editNoteId = note ? note.id : null;
  $('noteModalTitle').textContent = note ? 'メモを編集' : 'メモを追加';
  $('nTitle').value = note ? (note.title || '') : '';
  $('nContent').value = note ? note.content : '';
  $('nSource').value = note ? (note.source || '') : '';
  $('nTags').value = note ? (note.tags || []).join(', ') : '';
  $('nFav').checked = note ? !!note.favorite : false;
  $('deleteNoteBtn').classList.toggle('hidden', !note);
  $('noteModal').classList.remove('hidden');
}

async function saveNote() {
  const content = $('nContent').value.trim();
  if (!content) { toast('本文を入れてください'); return; }
  const row = {
    user_id: S.user.id,
    title: $('nTitle').value.trim() || null,
    content,
    source: $('nSource').value.trim() || null,
    tags: $('nTags').value.split(',').map((t) => t.trim()).filter(Boolean),
    favorite: $('nFav').checked,
  };

  $('saveNoteBtn').disabled = true;
  const { error } = S.editNoteId
    ? await sb.from('jog_notes').update(row).eq('id', S.editNoteId)
    : await sb.from('jog_notes').insert(row);
  $('saveNoteBtn').disabled = false;

  if (error) { toast('保存に失敗：' + error.message, 5000); return; }
  $('noteModal').classList.add('hidden');
  toast('保存しました');
  S.todayNote = null;
  await loadAll();
}

async function deleteNote() {
  if (!S.editNoteId) return;
  if (!confirm('このメモを削除します。よろしいですか？')) return;
  const { error } = await sb.from('jog_notes').delete().eq('id', S.editNoteId);
  if (error) { toast('削除に失敗：' + error.message, 5000); return; }
  $('noteModal').classList.add('hidden');
  if (S.todayNote && S.todayNote.id === S.editNoteId) S.todayNote = null;
  toast('削除しました');
  await loadAll();
}

/* ============================================================
   スクショ読み取り（Gemini）
   ============================================================ */
const GEMINI_MODEL = 'gemini-2.5-flash';

function getKey() { return localStorage.getItem('jog_gemini_key') || ''; }

async function readScreenshot(file) {
  const key = getKey();
  if (!key) {
    $('shotStatus').textContent = '先に「設定」タブで Gemini APIキーを保存してください。';
    return;
  }
  $('shotStatus').textContent = '読み取り中…（10秒ほどかかります）';

  let b64;
  try {
    b64 = await new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(String(fr.result).split(',')[1]);
      fr.onerror = () => rej(new Error('画像を読めませんでした'));
      fr.readAsDataURL(file);
    });
  } catch (e) {
    $('shotStatus').textContent = e.message;
    return;
  }

  const prompt = `このAppleフィットネスのワークアウト画面から数値を読み取り、JSONだけを返してください。
説明文やコードブロックは不要です。読み取れない項目は null にしてください。
{
  "ran_on": "YYYY-MM-DD形式の日付（画面上部の月日から。年が無ければ${todayISO().slice(0, 4)}年とする）",
  "duration_sec": ワークアウト時間を秒に直した整数,
  "distance_km": 距離のkm数（小数）,
  "avg_hr": 平均心拍数の整数,
  "cadence": 平均ケイデンスの整数,
  "kcal": アクティブキロカロリーの整数,
  "elevation_m": 上昇した高度のm数の整数
}`;

  let json;
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(key)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              { inline_data: { mime_type: file.type || 'image/png', data: b64 } },
            ],
          }],
          generationConfig: { temperature: 0, responseMimeType: 'application/json' },
        }),
      });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`APIエラー ${res.status}：${body.slice(0, 160)}`);
    }
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('AIが読み取れませんでした。手入力してください。');
    json = JSON.parse(text);
  } catch (e) {
    $('shotStatus').textContent = '失敗：' + e.message;
    return;
  }

  // 読めた項目だけ埋める（元の入力は消さない）
  const set = (id, v, fmt) => {
    if (v == null || v === '') return 0;
    $(id).value = fmt ? fmt(v) : v;
    return 1;
  };
  let n = 0;
  n += set('fRanOn', /^\d{4}-\d{2}-\d{2}$/.test(json.ran_on || '') ? json.ran_on : null);
  n += set('fDuration', json.duration_sec, fmtDuration);
  n += set('fDistance', json.distance_km);
  n += set('fHr', json.avg_hr);
  n += set('fCadence', json.cadence);
  n += set('fKcal', json.kcal);
  n += set('fElev', json.elevation_m);
  updatePacePreview();

  $('shotStatus').textContent = n
    ? `${n}項目を読み取りました。内容を確かめて保存してください。`
    : '読み取れませんでした。手入力してください。';
}

/* ============================================================
   バックアップ
   ============================================================ */
function exportBackup() {
  const payload = {
    version: 1,
    exported_at: new Date().toISOString(),
    runs: S.runs.map(({ id, user_id, created_at, updated_at, ...r }) => r),
    notes: S.notes.map(({ id, user_id, created_at, updated_at, ...n }) => n),
  };
  const blob = new Blob([JSON.stringify(payload, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `jogging-log-${todayISO()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  $('backupStatus').textContent = `${payload.runs.length}件の記録と${payload.notes.length}件のメモを書き出しました。`;
}

async function importBackup(file) {
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    $('backupStatus').textContent = 'JSONとして読めませんでした。';
    return;
  }

  const runs = Array.isArray(data.runs) ? data.runs : [];
  const notes = Array.isArray(data.notes) ? data.notes : [];
  if (!runs.length && !notes.length) {
    $('backupStatus').textContent = '取り込めるデータが入っていません。';
    return;
  }

  // すでにある日付＋時間の組み合わせは重複とみなして飛ばす
  const seen = new Set(S.runs.map((r) => `${r.ran_on}|${r.duration_sec}`));
  const newRuns = runs
    .filter((r) => r.ran_on && !seen.has(`${r.ran_on}|${r.duration_sec ?? null}`))
    .map((r) => ({
      user_id: S.user.id,
      ran_on: r.ran_on,
      title: r.title ?? null,
      duration_sec: r.duration_sec ?? null,
      distance_km: r.distance_km ?? null,
      avg_hr: r.avg_hr ?? null,
      cadence: r.cadence ?? null,
      kcal: r.kcal ?? null,
      elevation_m: r.elevation_m ?? null,
      feeling: r.feeling ?? null,
      note: r.note ?? null,
      source: r.source || 'import',
    }));

  const existingNotes = new Set(S.notes.map((n) => n.content));
  const newNotes = notes
    .filter((n) => n.content && !existingNotes.has(n.content))
    .map((n) => ({
      user_id: S.user.id,
      title: n.title ?? null,
      content: n.content,
      source: n.source ?? null,
      tags: Array.isArray(n.tags) ? n.tags : [],
      favorite: !!n.favorite,
    }));

  const skipped = (runs.length - newRuns.length) + (notes.length - newNotes.length);
  if (!newRuns.length && !newNotes.length) {
    $('backupStatus').textContent = `新しいデータはありませんでした（${skipped}件はすでに入っています）。`;
    return;
  }
  if (!confirm(`記録${newRuns.length}件・メモ${newNotes.length}件を取り込みます。よろしいですか？`)) return;

  // 500件ずつ送る。途中で失敗したらそこで止めて理由を出す
  let done = 0;
  for (const [table, rows] of [['jog_runs', newRuns], ['jog_notes', newNotes]]) {
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      $('backupStatus').textContent = `取り込み中… ${done}件`;
      const { error } = await sb.from(table).insert(chunk);
      if (error) {
        $('backupStatus').textContent =
          `${done}件まで取り込んだところで失敗しました：${error.message}`;
        await loadAll();
        return;
      }
      done += chunk.length;
    }
  }

  await loadAll();
  $('backupStatus').textContent =
    `${done}件を取り込みました${skipped ? `（${skipped}件は重複のため飛ばしました）` : ''}。`;
}

/* ============================================================
   イベント
   ============================================================ */
function switchTab(name) {
  els('.tab-panel').forEach((p) => p.classList.add('hidden'));
  $('tab-' + name).classList.remove('hidden');
  els('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  if (name === 'runs') scrollChartToEnd();
  window.scrollTo(0, 0);
}

function bind() {
  $('loginBtn').addEventListener('click', login);
  $('loginPassword').addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); });

  els('.tab-btn').forEach((b) =>
    b.addEventListener('click', () => switchTab(b.dataset.tab)));

  $('quickAddBtn').addEventListener('click', () => openRunModal(null));
  $('addRunBtn').addEventListener('click', () => openRunModal(null));
  $('addNoteBtn').addEventListener('click', () => openNoteModal(null));

  $('nextNoteBtn').addEventListener('click', () => {
    markShown._last = null;
    pickTodayNote();
    renderTodayNote();
  });

  // 記録の行をタップして編集
  document.addEventListener('click', (e) => {
    const runEl = e.target.closest('[data-run]');
    if (runEl) {
      const r = S.runs.find((x) => x.id === runEl.dataset.run);
      if (r) openRunModal(r);
      return;
    }
    const noteEl = e.target.closest('[data-note]');
    if (noteEl) {
      const n = S.notes.find((x) => x.id === noteEl.dataset.note);
      if (n) openNoteModal(n);
      return;
    }
    const chip = e.target.closest('[data-tag]');
    if (chip) {
      S.noteFilter = chip.dataset.tag || null;
      renderNotesTab();
    }
  });

  els('[data-close]').forEach((b) =>
    b.addEventListener('click', () => $(b.dataset.close).classList.add('hidden')));
  els('.modal').forEach((m) =>
    m.addEventListener('click', (e) => { if (e.target === m) m.classList.add('hidden'); }));

  $('saveRunBtn').addEventListener('click', saveRun);
  $('deleteRunBtn').addEventListener('click', deleteRun);
  $('saveNoteBtn').addEventListener('click', saveNote);
  $('deleteNoteBtn').addEventListener('click', deleteNote);

  $('fDuration').addEventListener('input', updatePacePreview);
  $('fDistance').addEventListener('input', updatePacePreview);
  els('#feelRow button').forEach((b) => b.addEventListener('click', () => {
    S.feel = S.feel === Number(b.dataset.feel) ? null : Number(b.dataset.feel);
    renderFeel();
  }));

  $('shotFile').addEventListener('change', (e) => {
    if (e.target.files[0]) readScreenshot(e.target.files[0]);
    e.target.value = '';
  });

  $('yearFilter').addEventListener('change', (e) => {
    S.yearFilter = e.target.value;
    S.listLimit = 30;
    renderAllRuns();
  });
  $('moreRunsBtn').addEventListener('click', () => {
    S.listLimit += 100;
    renderAllRuns();
  });

  $('geminiKey').value = getKey();
  $('keyStatus').textContent = getKey() ? '保存済み' : '未設定';
  $('saveKeyBtn').addEventListener('click', () => {
    const v = $('geminiKey').value.trim();
    if (v) localStorage.setItem('jog_gemini_key', v);
    else localStorage.removeItem('jog_gemini_key');
    $('keyStatus').textContent = v ? '保存しました' : '消しました';
  });

  $('exportBtn').addEventListener('click', exportBackup);
  $('importBtn').addEventListener('click', () => $('importFile').click());
  $('importFile').addEventListener('change', (e) => {
    if (e.target.files[0]) importBackup(e.target.files[0]);
    e.target.value = '';
  });

  $('logoutBtn').addEventListener('click', async () => {
    await sb.auth.signOut();
    location.reload();
  });
}

bind();
initAuth();

// ホーム画面に追加して使えるようにする（file:// では登録できないので囲う）
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* 登録できなくても動く */ });
}
