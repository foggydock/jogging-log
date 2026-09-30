-- 既存の jog_skip_days に「寝坊」を追加する。
alter table public.jog_skip_days
  drop constraint if exists jog_skip_days_reason_check;

alter table public.jog_skip_days
  add constraint jog_skip_days_reason_check
  check (reason in ('rain', 'busy', 'rest', 'unmotivated', 'overslept', 'other'));
