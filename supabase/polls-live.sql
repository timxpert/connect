-- Polls and live classes in the groups.
-- Only the Grand Sensei and the team post them in the community group; only
-- the Grand Sensei in his own groups. Everyone in the group can vote.
-- Run after edit-pin.sql. Safe to run more than once.

alter table public.group_messages drop constraint if exists group_messages_kind_check;
alter table public.group_messages add constraint group_messages_kind_check
  check (kind in ('text', 'voice', 'image', 'video', 'file', 'join', 'pin', 'poll', 'live'));
alter table public.group_messages drop constraint if exists group_messages_content;
alter table public.group_messages add constraint group_messages_content check (
  deleted_at is not null
  or kind in ('join', 'pin')
  or (kind in ('text', 'poll', 'live') and char_length(btrim(body)) > 0)
  or (kind not in ('text', 'join', 'pin', 'poll', 'live') and media_path is not null));

create or replace function public.team_only_kinds() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.kind in ('poll', 'live') and not (
    case when new.group_id is null then public.is_team(new.sender_id) else public.is_sensei(new.sender_id) end
  ) then
    raise exception 'team_only';
  end if;
  return new;
end $$;
drop trigger if exists team_only_kinds on public.group_messages;
create trigger team_only_kinds before insert on public.group_messages
  for each row execute function public.team_only_kinds();

-- Votes: one row per answer picked
create table if not exists public.poll_votes (
  message_id uuid not null references public.group_messages (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  option     smallint not null check (option between 0 and 19),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, option)
);
alter table public.poll_votes enable row level security;
drop policy if exists pv_read on public.poll_votes;
create policy pv_read on public.poll_votes for select to authenticated
  using (exists (select 1 from public.group_messages m where m.id = message_id));
drop policy if exists pv_add on public.poll_votes;
create policy pv_add on public.poll_votes for insert to authenticated
  with check (user_id = auth.uid() and exists (select 1 from public.group_messages m where m.id = message_id and m.kind = 'poll' and m.deleted_at is null));
drop policy if exists pv_remove on public.poll_votes;
create policy pv_remove on public.poll_votes for delete to authenticated using (user_id = auth.uid());

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'poll_votes') then
    alter publication supabase_realtime add table public.poll_votes;
  end if;
end $$;
