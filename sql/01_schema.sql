-- ジョギングログ（jogging-log）スキーマ
-- Sou_Diary プロジェクトに jog_ 接頭辞で間借り
-- Supabase ダッシュボード > SQL Editor で実行する

-- ============================================================
-- 1. 走った記録（1回の走り = 1行）
-- ============================================================
create table if not exists public.jog_runs (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  ran_on        date not null,                 -- 走った日
  title         text,                          -- 「朝ジョギング」など
  duration_sec  integer,                       -- ワークアウト時間（秒）
  distance_km   numeric(6,2),                  -- 距離
  avg_hr        integer,                       -- 平均心拍数（拍/分）
  cadence       integer,                       -- 平均ケイデンス（spm）
  kcal          integer,                       -- 消費カロリー（アクティブ）
  elevation_m   integer,                       -- 上昇した高度（m）
  feeling       smallint,                      -- 体感 1〜5（任意）
  note          text,                          -- ひとこと
  source        text default 'manual',         -- manual / screenshot / notion
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists jog_runs_user_date_idx
  on public.jog_runs (user_id, ran_on desc);

-- 同じ日に2本走ることもあるので日付のユニーク制約は付けない

-- ============================================================
-- 2. モチベーションのメモ（調べたこと・名言・コツ）
-- ============================================================
create table if not exists public.jog_notes (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  content       text not null,                 -- メモ本文
  title         text,                          -- 短い見出し（任意）
  source        text,                          -- 出典（本・URL・人）
  tags          text[] default '{}',           -- 「フォーム」「食事」「メンタル」など
  favorite      boolean not null default false,
  shown_count   integer not null default 0,    -- 何回振り返ったか
  last_shown_at timestamptz,                   -- 最後に表示した日時
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists jog_notes_user_idx
  on public.jog_notes (user_id, created_at desc);
create index if not exists jog_notes_shown_idx
  on public.jog_notes (user_id, last_shown_at nulls first);

-- ============================================================
-- 3. RLS（自分の行だけ読み書きできる）
-- ============================================================
alter table public.jog_runs  enable row level security;
alter table public.jog_notes enable row level security;

drop policy if exists jog_runs_own on public.jog_runs;
create policy jog_runs_own on public.jog_runs
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists jog_notes_own on public.jog_notes;
create policy jog_notes_own on public.jog_notes
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ============================================================
-- 4. GRANT（RLSだけでは足りない）
-- ============================================================
grant select, insert, update, delete on public.jog_runs  to authenticated;
grant select, insert, update, delete on public.jog_notes to authenticated;

-- ============================================================
-- 5. updated_at 自動更新
-- ============================================================
create or replace function public.jog_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists jog_runs_touch on public.jog_runs;
create trigger jog_runs_touch before update on public.jog_runs
  for each row execute function public.jog_touch_updated_at();

drop trigger if exists jog_notes_touch on public.jog_notes;
create trigger jog_notes_touch before update on public.jog_notes
  for each row execute function public.jog_touch_updated_at();
