-- ページ境界で同じ日付・日時の行が重複または欠落しないよう、
-- user_id + 表示順 + id の並びに対応するインデックスへ置き換える。
create index if not exists jog_runs_user_date_id_idx
  on public.jog_runs (user_id, ran_on desc, id desc);

create index if not exists jog_notes_user_created_id_idx
  on public.jog_notes (user_id, created_at desc, id desc);

drop index if exists public.jog_runs_user_date_idx;
drop index if exists public.jog_notes_user_idx;
