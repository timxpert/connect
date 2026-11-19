-- Dojo Challenge: a short brief every couple of weeks. Students hand in a
-- link (TikTok, Instagram, YouTube or Drive), so nothing is stored here.
-- The Grand Sensei picks one entry and writes a short note on it.
-- Visitors only ever see the picked entry. Safe to run more than once.

create table if not exists public.challenges (
  id         uuid primary key default gen_random_uuid(),
  number     int  not null default 0,
  title      text not null check (char_length(title) between 1 and 80),
  brief      text not null default '' check (char_length(brief) <= 1000),
  ends_at    timestamptz not null,
  pick_id    uuid,
  pick_note  text not null default '' check (char_length(pick_note) <= 300),
  created_at timestamptz not null default now()
);

create table if not exists public.challenge_entries (
  id           uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  url          text not null check (char_length(url) between 8 and 500),
  created_at   timestamptz not null default now(),
  unique (challenge_id, user_id)
);
create index if not exists challenge_entries_user_idx on public.challenge_entries (user_id);

-- numbers count up: challenge 1, 2, 3…
create or replace function public.challenge_number() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.number := coalesce((select max(number) from public.challenges), 0) + 1;
  else
    new.number := old.number;
  end if;
  return new;
end $$;
drop trigger if exists challenge_number on public.challenges;
create trigger challenge_number before insert or update on public.challenges
  for each row execute function public.challenge_number();

alter table public.challenges        enable row level security;
alter table public.challenge_entries enable row level security;

drop policy if exists ch_read on public.challenges;
create policy ch_read on public.challenges for select using (true);
drop policy if exists ch_team on public.challenges;
create policy ch_team on public.challenges for all to authenticated
  using (public.is_team(auth.uid())) with check (public.is_team(auth.uid()));

-- members see every entry; visitors only the picked ones
drop policy if exists ce_read on public.challenge_entries;
create policy ce_read on public.challenge_entries for select using (
  public.is_student(auth.uid()) or public.is_team(auth.uid())
  or id in (select pick_id from public.challenges where pick_id is not null));
-- students hand in, replace or take back their own entry while the challenge is open
drop policy if exists ce_insert on public.challenge_entries;
create policy ce_insert on public.challenge_entries for insert to authenticated with check (
  user_id = auth.uid() and public.is_student(auth.uid())
  and exists (select 1 from public.challenges c where c.id = challenge_id and c.ends_at > now()));
drop policy if exists ce_update on public.challenge_entries;
create policy ce_update on public.challenge_entries for update to authenticated
  using (user_id = auth.uid() and exists (select 1 from public.challenges c where c.id = challenge_id and c.ends_at > now()))
  with check (user_id = auth.uid());
drop policy if exists ce_delete on public.challenge_entries;
create policy ce_delete on public.challenge_entries for delete to authenticated using (
  (user_id = auth.uid() and exists (select 1 from public.challenges c where c.id = challenge_id and c.ends_at > now()))
  or public.is_team(auth.uid()));

-- How many handed in, for everyone (visitors see the count, not the entries)
drop function if exists public.challenge_counts();
create function public.challenge_counts()
returns table (challenge_id uuid, entries int)
language sql stable security definer set search_path = public as $$
  select c.id, (select count(*)::int from public.challenge_entries e where e.challenge_id = c.id)
  from public.challenges c
$$;
grant execute on function public.challenge_counts() to anon, authenticated;

-- Each student's streak (challenges handed in back to back; an open one they
-- haven't handed in yet doesn't break it) and how often they were picked.
-- Whether they handed in the open challenge is only shared with members.
drop function if exists public.challenge_stats();
create function public.challenge_stats()
returns table (user_id uuid, streak int, picks int, entered_current boolean)
language plpgsql stable security definer set search_path = public as $$
declare
  u record;
  c record;
  s int;
  cur uuid;
  insider boolean := public.is_student(auth.uid()) or public.is_team(auth.uid());
begin
  select id into cur from public.challenges where ends_at > now() order by ends_at limit 1;
  for u in select p.id from public.profiles p where p.is_student loop
    s := 0;
    for c in select ch.id, ch.ends_at from public.challenges ch order by ch.ends_at desc loop
      if exists (select 1 from public.challenge_entries e where e.challenge_id = c.id and e.user_id = u.id) then
        s := s + 1;
      elsif c.ends_at > now() then
        continue;
      else
        exit;
      end if;
    end loop;
    user_id := u.id;
    streak := s;
    picks := (select count(*)::int from public.challenges ch join public.challenge_entries e on e.id = ch.pick_id where e.user_id = u.id);
    entered_current := case when insider and cur is not null
      then exists (select 1 from public.challenge_entries e where e.challenge_id = cur and e.user_id = u.id) end;
    return next;
  end loop;
end $$;
grant execute on function public.challenge_stats() to anon, authenticated;

-- Notifications: a new challenge (to every student) and being picked
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'community_post', 'connection_request', 'connection_accepted',
  'assignment_submitted', 'assignment_approved', 'assignment_changes',
  'group_reply', 'group_mention',
  'phase_request', 'phase_approved', 'phase_declined',
  'challenge_new', 'challenge_pick'));
alter table public.notifications add column if not exists snippet text;

create or replace function public.notify_challenge() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.notifications (user_id, kind, actor_id, snippet)
    select p.id, 'challenge_new', auth.uid(), new.title from public.profiles p where p.is_student;
  elsif new.pick_id is not null and new.pick_id is distinct from old.pick_id then
    insert into public.notifications (user_id, kind, actor_id, snippet)
    select e.user_id, 'challenge_pick', auth.uid(), new.title from public.challenge_entries e where e.id = new.pick_id;
  end if;
  return new;
end $$;
drop trigger if exists notify_challenge on public.challenges;
create trigger notify_challenge after insert or update on public.challenges
  for each row execute function public.notify_challenge();
