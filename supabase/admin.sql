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
