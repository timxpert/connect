-- Motion Dojo Connect: ban and remove students (grand sensei and moderators).
-- Run once in the Supabase SQL Editor, after learn.sql and group.sql. Safe to run again.
--
-- Ban:    the student is signed out everywhere, can't sign in again, disappears
--         from Members and the group, and their posts are hidden. Can be undone.
-- Remove: deletes the student's Connect account, everything they posted, and
--         their member ID. Can't be undone; they'd need to enrol again.

alter table public.profiles   add column if not exists banned_at timestamptz;
alter table public.enrolments add column if not exists banned boolean not null default false;

-- Banned members' posts are hidden from everyone except the team
drop policy if exists "posts are public" on public.posts;
create policy "posts are public" on public.posts for select using (
  not exists (select 1 from public.profiles b where b.id = author_id and b.banned_at is not null)
  or author_id = auth.uid()
  or public.is_team(auth.uid())
);

create or replace function public.ban_user(uid uuid, on_ boolean) returns void
language plpgsql security definer set search_path = public, auth as $$
declare
  em text;
begin
  if not public.is_team(auth.uid()) then
    raise exception 'team_only';
  end if;
  if public.is_team(uid) then
    raise exception 'cant_ban_team';
  end if;
  select lower(email) into em from auth.users where id = uid;
  perform set_config('connect.trusted', 'on', true);
  if on_ then
    update public.profiles set banned_at = now(), is_student = false where id = uid;
    update public.enrolments set banned = true where lower(email) = em;
    delete from public.device_sessions where user_id = uid;
    delete from auth.sessions where user_id = uid;
  else
    update public.enrolments set banned = false where lower(email) = em;
    update public.profiles
       set banned_at = null,
           is_student = exists (select 1 from public.enrolments e where lower(e.email) = em)
     where id = uid;
  end if;
end $$;
grant execute on function public.ban_user(uuid, boolean) to authenticated;

create or replace function public.remove_user(uid uuid) returns void
language plpgsql security definer set search_path = public, auth as $$
declare
  em text;
begin
  if not public.is_team(auth.uid()) then
    raise exception 'team_only';
  end if;
  if public.is_team(uid) then
    raise exception 'cant_remove_team';
  end if;
  select lower(email) into em from auth.users where id = uid;
  delete from public.enrolments where lower(email) = em;
  delete from auth.users where id = uid;  -- their profile, posts, messages and files' records go with it
end $$;
grant execute on function public.remove_user(uuid) to authenticated;

-- The team's Students page: everyone enrolled or banned, with their device
drop function if exists public.team_devices();
create function public.team_devices()
returns table (user_id uuid, name text, handle text, email text, label text, last_seen_at timestamptz, changes_7d int, banned boolean)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not public.is_team(auth.uid()) then
    raise exception 'team_only';
  end if;
  return query
    select p.id, p.name, p.handle, u.email::text, d.label, d.last_seen_at,
           (select count(*) from public.device_log l where l.user_id = p.id and l.at > now() - interval '7 days')::int,
           p.banned_at is not null
    from public.profiles p
    join auth.users u on u.id = p.id
    left join public.device_sessions d on d.user_id = p.id
    where (p.is_student or p.banned_at is not null) and not (p.is_sensei or p.is_moderator)
    order by (p.banned_at is not null), 7 desc, d.last_seen_at desc nulls last;
end $$;
grant execute on function public.team_devices() to authenticated;

-- ---------------------------------------------------------------------
-- Removing and banning people from the group (they stay on Connect)
-- Remove: they leave the group and can join again themselves.
-- Ban:    they leave the group and can't join again until the team lets them.
-- ---------------------------------------------------------------------
create table if not exists public.group_removed (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  banned  boolean not null default false,
  by      uuid references public.profiles (id) on delete set null,
  at      timestamptz not null default now()
);
alter table public.group_removed enable row level security;
drop policy if exists gremoved_read on public.group_removed;
create policy gremoved_read on public.group_removed for select to authenticated
  using (user_id = auth.uid() or public.is_team(auth.uid()));

create or replace function public.in_group(uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_student or is_sensei or is_moderator from public.profiles where id = uid), false)
     and not exists (select 1 from public.group_removed r where r.user_id = uid)
$$;

create or replace function public.remove_from_group(uid uuid, ban boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_team(auth.uid()) then raise exception 'team_only'; end if;
  if public.is_team(uid) then raise exception 'cant_remove_team'; end if;
  insert into public.group_removed (user_id, banned, by) values (uid, ban, auth.uid())
  on conflict (user_id) do update set banned = excluded.banned, by = excluded.by, at = now();
end $$;
grant execute on function public.remove_from_group(uuid, boolean) to authenticated;

create or replace function public.add_to_group(uid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_team(auth.uid()) then raise exception 'team_only'; end if;
  delete from public.group_removed where user_id = uid;
end $$;
grant execute on function public.add_to_group(uuid) to authenticated;

-- Someone who was removed (not banned) can come back
create or replace function public.rejoin_group() returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from public.group_removed where user_id = auth.uid() and not banned;
  if exists (select 1 from public.group_removed where user_id = auth.uid()) then
    raise exception 'banned_from_group';
  end if;
end $$;
grant execute on function public.rejoin_group() to authenticated;

-- 'member', 'removed', 'banned' or 'none' (not a Black Belt member)
create or replace function public.my_group_status() returns text
language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from public.group_removed where user_id = auth.uid() and banned) then 'banned'
    when exists (select 1 from public.group_removed where user_id = auth.uid()) then 'removed'
    when public.in_group(auth.uid()) then 'member'
    else 'none' end
$$;
grant execute on function public.my_group_status() to authenticated;

-- Everyone in the group (for the member list and @mentions)
create or replace function public.group_members() returns setof public.profiles
language sql stable security definer set search_path = public as $$
  select p.* from public.profiles p
  where public.in_group(auth.uid()) and public.in_group(p.id)
  order by p.name
$$;
grant execute on function public.group_members() to authenticated;

-- The member count leaves out people who were removed
drop function if exists public.group_info();
create function public.group_info()
returns table (members int, announce_only boolean, pinned_id uuid, muted_until timestamptz, history text, name text)
language sql stable security definer set search_path = public as $$
  select (select count(*)::int from public.profiles p where public.in_group(p.id)),
         s.announce_only, s.pinned_id,
         (select until from public.group_mutes where user_id = auth.uid() and until > now()),
         s.history, s.name
  from public.group_settings s where s.id = 1 and public.in_group(auth.uid())
$$;
grant execute on function public.group_info() to authenticated;
