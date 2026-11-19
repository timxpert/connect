-- Group notifications per student: 'important' (default), 'all' or 'off'.
-- Important = messages from the Grand Sensei and the team, polls, live
-- classes, and replies or @mentions to you. Safe to run more than once.
alter table public.profiles add column if not exists alert_level text not null default 'important'
  check (alert_level in ('important', 'all', 'off'));
