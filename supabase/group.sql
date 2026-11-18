-- Motion Dojo Connect: the Dojo group, one chat for every student and the team.
-- Run once in the Supabase SQL Editor (after learn.sql). Safe to run again.

create or replace function public.in_group(uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_student or is_sensei or is_moderator from public.profiles where id = uid), false)
$$;

create table if not exists public.group_messages (
  id          uuid primary key default gen_random_uuid(),
  sender_id   uuid not null references public.profiles (id) on delete cascade,
  body        text not null default '' check (char_length(body) <= 4000),
  kind        text not null default 'text' check (kind in ('text', 'voice', 'image', 'video')),
  media_path  text,
  file_size   bigint,
  duration    real,
  thumb       text check (thumb is null or char_length(thumb) <= 6000),
  reply_to    uuid references public.group_messages (id) on delete set null,
  deleted_at  timestamptz,
  created_at  timestamptz not null default now(),
  check (deleted_at is not null
         or (kind = 'text' and char_length(btrim(body)) > 0)
         or (kind <> 'text' and media_path is not null))
);
create index if not exists group_messages_time on public.group_messages (created_at desc);

-- One reaction per person per message
create table if not exists public.group_reactions (
  message_id uuid not null references public.group_messages (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  emoji      text not null check (char_length(emoji) between 1 and 16),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

-- Where each person has read up to (for the unread count)
create table if not exists public.group_reads (
  user_id      uuid primary key references public.profiles (id) on delete cascade,
  last_read_at timestamptz not null default now()
);

-- One row: announcements-only switch and the pinned message
create table if not exists public.group_settings (
  id            int primary key default 1 check (id = 1),
  announce_only boolean not null default false,
  pinned_id     uuid references public.group_messages (id) on delete set null
);
insert into public.group_settings (id) values (1) on conflict do nothing;

-- Students the team has muted, until a time
create table if not exists public.group_mutes (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  until   timestamptz not null,
  by      uuid references public.profiles (id) on delete set null
);

alter table public.group_messages  enable row level security;
alter table public.group_reactions enable row level security;
alter table public.group_reads     enable row level security;
alter table public.group_settings  enable row level security;
alter table public.group_mutes     enable row level security;

drop policy if exists gm_read on public.group_messages;
create policy gm_read on public.group_messages for select to authenticated using (public.in_group(auth.uid()));
drop policy if exists gm_send on public.group_messages;
create policy gm_send on public.group_messages for insert to authenticated with check (
  sender_id = auth.uid()
  and deleted_at is null
  and public.in_group(auth.uid())
  and (public.is_team(auth.uid()) or not (select announce_only from public.group_settings where id = 1))
  and not exists (select 1 from public.group_mutes m where m.user_id = auth.uid() and m.until > now())
);

drop policy if exists gr_read on public.group_reactions;
create policy gr_read on public.group_reactions for select to authenticated using (public.in_group(auth.uid()));
drop policy if exists gr_add on public.group_reactions;
create policy gr_add on public.group_reactions for insert to authenticated with check (user_id = auth.uid() and public.in_group(auth.uid()));
drop policy if exists gr_change on public.group_reactions;
create policy gr_change on public.group_reactions for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists gr_remove on public.group_reactions;
create policy gr_remove on public.group_reactions for delete to authenticated using (user_id = auth.uid());

drop policy if exists greads_own on public.group_reads;
create policy greads_own on public.group_reads for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists gs_read on public.group_settings;
create policy gs_read on public.group_settings for select to authenticated using (public.in_group(auth.uid()));
drop policy if exists gs_team on public.group_settings;
create policy gs_team on public.group_settings for update to authenticated
  using (public.is_team(auth.uid())) with check (public.is_team(auth.uid()));

drop policy if exists gmute_read on public.group_mutes;
create policy gmute_read on public.group_mutes for select to authenticated using (user_id = auth.uid() or public.is_team(auth.uid()));
drop policy if exists gmute_team on public.group_mutes;
create policy gmute_team on public.group_mutes for all to authenticated
  using (public.is_team(auth.uid())) with check (public.is_team(auth.uid()));

-- Delete: your own message, or any message if you're on the team
create or replace function public.delete_group_message(mid uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  p text;
begin
  select media_path into p from public.group_messages
  where id = mid and deleted_at is null and (sender_id = auth.uid() or public.is_team(auth.uid()));
  if not found then
    raise exception 'not_your_message';
  end if;
  update public.group_messages
  set deleted_at = now(), body = '', media_path = null, file_size = null, duration = null, thumb = null
  where id = mid;
  delete from public.group_reactions where message_id = mid;
  return p;
end $$;
grant execute on function public.delete_group_message(uuid) to authenticated;

-- Unread messages in the group for me
create or replace function public.group_unread() returns int
language sql stable security definer set search_path = public as $$
  select case when not public.in_group(auth.uid()) then 0 else (
    select count(*)::int from public.group_messages m
    where m.sender_id <> auth.uid() and m.deleted_at is null
      and m.created_at > coalesce((select last_read_at from public.group_reads where user_id = auth.uid()), now() - interval '7 days')
  ) end
$$;
grant execute on function public.group_unread() to authenticated;

-- Header details: members, announcements switch, pinned message, my mute
create or replace function public.group_info()
returns table (members int, announce_only boolean, pinned_id uuid, muted_until timestamptz)
language sql stable security definer set search_path = public as $$
  select (select count(*)::int from public.profiles where is_student or is_sensei or is_moderator),
         s.announce_only, s.pinned_id,
         (select until from public.group_mutes where user_id = auth.uid() and until > now())
  from public.group_settings s where s.id = 1 and public.in_group(auth.uid())
$$;
grant execute on function public.group_info() to authenticated;

-- Group files live in the private 'chat' bucket under group/
drop policy if exists "group files: members upload" on storage.objects;
create policy "group files: members upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'chat' and (storage.foldername(name))[1] = 'group' and public.in_group(auth.uid()));
drop policy if exists "group files: members read" on storage.objects;
create policy "group files: members read" on storage.objects for select to authenticated
  using (bucket_id = 'chat' and (storage.foldername(name))[1] = 'group' and public.in_group(auth.uid()));

-- Live updates
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['group_messages', 'group_reactions', 'group_settings'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Replies and @mentions: the person gets a notification (and a phone alert)
-- ---------------------------------------------------------------------
alter table public.notifications add column if not exists snippet text;
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'community_post', 'connection_request', 'connection_accepted',
  'assignment_submitted', 'assignment_approved', 'assignment_changes',
  'group_reply', 'group_mention'));

create or replace function public.notify_group_message() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  who text;
  txt text;
  replied uuid;
begin
  select name into who from public.profiles where id = new.sender_id;
  txt := left(case new.kind when 'voice' then 'Voice message' when 'image' then coalesce(nullif(new.body, ''), 'Photo')
                            when 'video' then coalesce(nullif(new.body, ''), 'Video') else new.body end, 140);
  if new.reply_to is not null then
    select sender_id into replied from public.group_messages where id = new.reply_to;
    if replied is not null and replied <> new.sender_id then
      insert into public.notifications (user_id, kind, actor_id, snippet)
      values (replied, 'group_reply', new.sender_id, coalesce(who, 'Someone') || ': ' || txt);
    end if;
  end if;
  insert into public.notifications (user_id, kind, actor_id, snippet)
  select distinct p.id, 'group_mention', new.sender_id, coalesce(who, 'Someone') || ': ' || txt
  from regexp_matches(coalesce(new.body, ''), '@([A-Za-z0-9_]{2,30})', 'g') as m(h)
  join public.profiles p on lower(p.handle) = lower(m.h[1])
  where p.id <> new.sender_id
    and p.id is distinct from replied
    and public.in_group(p.id);
  return new;
end $$;
drop trigger if exists group_messages_notify on public.group_messages;
create trigger group_messages_notify after insert on public.group_messages
for each row execute function public.notify_group_message();

-- ---------------------------------------------------------------------
-- Message history for new members (like WhatsApp's "share message history")
-- all:  new students see everything sent before they joined
-- 14d:  the last 14 days before they joined
-- 100:  the last 100 messages before they joined
-- none: only messages from when they joined
-- The team always sees everything.
-- ---------------------------------------------------------------------
alter table public.group_settings add column if not exists history text not null default 'all';
alter table public.group_settings drop constraint if exists group_settings_history_check;
alter table public.group_settings add constraint group_settings_history_check check (history in ('all', '14d', '100', 'none'));

create or replace function public.group_visible_from(uid uuid) returns timestamptz
language plpgsql stable security definer set search_path = public as $$
declare
  joined timestamptz;
  h text;
  t timestamptz;
begin
  if public.is_team(uid) then return '-infinity'; end if;
  select history into h from public.group_settings where id = 1;
  if coalesce(h, 'all') = 'all' then return '-infinity'; end if;
  -- when they joined: their enrolment (or their profile, if there's no enrolment row)
  select coalesce(
           (select e.created_at from public.enrolments e join auth.users u on lower(u.email) = lower(e.email) where u.id = uid),
           (select created_at from public.profiles where id = uid))
    into joined;
  if joined is null then return '-infinity'; end if;
  if h = 'none' then return joined; end if;
  if h = '14d' then return joined - interval '14 days'; end if;
  select created_at into t from public.group_messages where created_at < joined order by created_at desc offset 99 limit 1;
  return coalesce(t, '-infinity');
end $$;

drop policy if exists gm_read on public.group_messages;
create policy gm_read on public.group_messages for select to authenticated
  using ((select public.in_group(auth.uid())) and created_at >= (select public.group_visible_from(auth.uid())));

-- The group's name (the team can change it)
alter table public.group_settings add column if not exists name text not null default 'Dojo group';
alter table public.group_settings drop constraint if exists group_settings_name_check;
alter table public.group_settings add constraint group_settings_name_check check (char_length(btrim(name)) between 1 and 60);

-- group_info: members, settings, the name, and whether I'm muted
drop function if exists public.group_info();
create function public.group_info()
returns table (members int, announce_only boolean, pinned_id uuid, muted_until timestamptz, history text, name text)
language sql stable security definer set search_path = public as $$
  select (select count(*)::int from public.profiles where is_student or is_sensei or is_moderator),
         s.announce_only, s.pinned_id,
         (select until from public.group_mutes where user_id = auth.uid() and until > now()),
         s.history, s.name
  from public.group_settings s where s.id = 1 and public.in_group(auth.uid())
$$;
grant execute on function public.group_info() to authenticated;

-- Unread count respects what the person can see
create or replace function public.group_unread() returns int
language sql stable security definer set search_path = public as $$
  select case when not public.in_group(auth.uid()) then 0 else (
    select count(*)::int from public.group_messages m
    where m.sender_id <> auth.uid() and m.deleted_at is null
      and m.created_at >= public.group_visible_from(auth.uid())
      and m.created_at > coalesce((select last_read_at from public.group_reads where user_id = auth.uid()), now() - interval '7 days')
  ) end
$$;
