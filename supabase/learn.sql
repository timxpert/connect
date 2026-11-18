-- Motion Dojo Connect: the Learn section (Black Belt lessons).
-- Run once in the Supabase SQL Editor. Safe to run again.
--
-- Lessons open in order: phase 1 lesson 1 first, then each lesson opens when
-- the one before it is marked done. The grand sensei and moderators see and
-- manage everything. The video link is only ever sent to a signed-in student
-- whose lesson is open, never in the public outline.

create table if not exists public.lessons (
  id         uuid primary key default gen_random_uuid(),
  phase      int  not null check (phase between 1 and 4),
  position   int  not null default 0,
  title      text not null check (char_length(title) between 1 and 140),
  summary    text not null default '' check (char_length(summary) <= 300),
  duration   text not null default '' check (char_length(duration) <= 20),
  video_url  text not null default '',
  notes      text not null default '' check (char_length(notes) <= 8000),
  files      jsonb not null default '[]'::jsonb,
  published  boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists lessons_order on public.lessons (phase, position, created_at);

create table if not exists public.lesson_progress (
  user_id   uuid not null references auth.users (id) on delete cascade,
  lesson_id uuid not null references public.lessons (id) on delete cascade,
  done_at   timestamptz not null default now(),
  primary key (user_id, lesson_id)
);

alter table public.lessons         enable row level security;
alter table public.lesson_progress enable row level security;

-- The team (grand sensei, moderators)
create or replace function public.is_team(uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_sensei or is_moderator from public.profiles where id = uid), false)
$$;

-- Lessons: only the team reads or changes the table directly. Students go
-- through the functions below, which hide video links until a lesson is open.
drop policy if exists lessons_team on public.lessons;
create policy lessons_team on public.lessons for all to authenticated
  using (public.is_team(auth.uid())) with check (public.is_team(auth.uid()));

-- Progress: you read your own; writes go through set_lesson_done()
drop policy if exists progress_own on public.lesson_progress;
create policy progress_own on public.lesson_progress for select to authenticated
  using (user_id = auth.uid() or public.is_team(auth.uid()));

-- Phase assignments: a student hands in their project at the end of a
-- phase; the team approves it (opens the next phase, posts it to the feed)
-- or asks for changes.
create table if not exists public.assignments (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  phase       int  not null check (phase between 1 and 4),
  kind        text not null check (kind in ('image', 'video')),
  media_url   text not null,
  caption     text not null default '' check (char_length(caption) <= 1000),
  status      text not null default 'pending' check (status in ('pending', 'approved', 'changes')),
  feedback    text not null default '' check (char_length(feedback) <= 2000),
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  post_id     uuid references public.posts (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists assignments_user on public.assignments (user_id, phase, created_at desc);
create index if not exists assignments_pending on public.assignments (status, created_at);
alter table public.assignments enable row level security;
drop policy if exists assignments_read on public.assignments;
create policy assignments_read on public.assignments for select to authenticated
  using (user_id = auth.uid() or public.is_team(auth.uid()));

-- What each phase's assignment asks for (written by the team)
create table if not exists public.phase_briefs (
  phase int primary key check (phase between 1 and 4),
  brief text not null default '' check (char_length(brief) <= 4000)
);
alter table public.phase_briefs enable row level security;
drop policy if exists briefs_read on public.phase_briefs;
create policy briefs_read on public.phase_briefs for select using (true);
drop policy if exists briefs_team on public.phase_briefs;
create policy briefs_team on public.phase_briefs for all to authenticated
  using (public.is_team(auth.uid())) with check (public.is_team(auth.uid()));

-- Approved assignments show on the feed with a "Passed phase N" badge.
-- Only the review below can set it.
alter table public.posts add column if not exists assignment_phase int;
create or replace function public.posts_assignment_guard() returns trigger
language plpgsql as $$
begin
  if coalesce(current_setting('connect.trusted', true), '') <> 'on' then
    new.assignment_phase := case when tg_op = 'UPDATE' then old.assignment_phase else null end;
  end if;
  return new;
end $$;
drop trigger if exists posts_assignment_guard on public.posts;
create trigger posts_assignment_guard before insert or update on public.posts
for each row execute function public.posts_assignment_guard();

-- posts_feed again, so it includes the new column
drop view if exists public.posts_feed;
create view public.posts_feed with (security_invoker = true) as
  select p.*,
         to_jsonb(a.*) as author,
         (select count(*) from public.likes l where l.post_id = p.id)::int    as likes,
         (select count(*) from public.comments c where c.post_id = p.id)::int as comments,
         exists (select 1 from public.likes l where l.post_id = p.id and l.user_id = auth.uid())         as liked,
         exists (select 1 from public.bookmarks b where b.post_id = p.id and b.user_id = auth.uid())     as saved,
         coalesce(public.are_connected(auth.uid(), p.author_id), false)                                  as by_connection
  from public.posts p
  join public.profiles a on a.id = p.author_id;
grant select on public.posts_feed to anon, authenticated;

-- New notification kinds
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'community_post', 'connection_request', 'connection_accepted',
  'assignment_submitted', 'assignment_approved', 'assignment_changes'));

-- The course outline for whoever is asking: no video links.
-- A lesson opens when the lesson before it is done. The first lesson of a new
-- phase also needs the previous phase's assignment approved.
drop function if exists public.course_outline();
create function public.course_outline()
returns table (id uuid, phase int, lesson_position int, title text, summary text, duration text,
               published boolean, has_video boolean, done boolean, is_open boolean)
language sql stable security definer set search_path = public as $$
  with me as (
    select auth.uid() as uid,
           public.is_team(auth.uid()) as team,
           (public.is_student(auth.uid()) or public.is_team(auth.uid())) as learner
  ),
  l as (
    select l.*,
           exists (select 1 from public.lesson_progress p, me where p.user_id = me.uid and p.lesson_id = l.id) as done
    from public.lessons l, me
    where l.published or me.team
  ),
  o as (
    select l.*,
           lag(l.done)  over (order by l.phase, l.position, l.created_at, l.id) as prev_done,
           lag(l.phase) over (order by l.phase, l.position, l.created_at, l.id) as prev_phase
    from l
  )
  select o.id, o.phase, o.position, o.title, o.summary, o.duration, o.published,
         o.video_url <> '', o.done,
         me.team or (
           me.learner
           and (o.prev_done is null or o.prev_done)
           and (o.prev_phase is null or o.prev_phase = o.phase
                or exists (select 1 from public.assignments a
                           where a.user_id = me.uid and a.phase = o.prev_phase and a.status = 'approved'))
         )
  from o, me
  order by o.phase, o.position, o.created_at, o.id
$$;
grant execute on function public.course_outline() to anon, authenticated;

-- One lesson with its video and notes, only if it's open for you.
drop function if exists public.get_lesson(uuid);
create function public.get_lesson(lid uuid)
returns table (id uuid, phase int, lesson_position int, title text, summary text, duration text,
               video_url text, notes text, files jsonb, published boolean, done boolean, is_open boolean)
language plpgsql stable security definer set search_path = public as $$
declare
  o record;
begin
  if not (public.is_student(auth.uid()) or public.is_team(auth.uid())) then
    raise exception 'members_only';
  end if;
  select * into o from public.course_outline() c where c.id = lid;
  if not found then
    raise exception 'not_found';
  end if;
  if not o.is_open then
    raise exception 'locked';
  end if;
  return query
    select l.id, l.phase, l.position, l.title, l.summary, l.duration, l.video_url, l.notes, l.files,
           l.published, o.done, true
    from public.lessons l where l.id = lid;
end $$;
grant execute on function public.get_lesson(uuid) to authenticated;

-- Mark a lesson done (opens the next one) or not done.
create or replace function public.set_lesson_done(lid uuid, is_done boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  o record;
begin
  if auth.uid() is null then
    raise exception 'members_only';
  end if;
  select * into o from public.course_outline() c where c.id = lid;
  if not found or not o.is_open then
    raise exception 'locked';
  end if;
  if is_done then
    insert into public.lesson_progress (user_id, lesson_id) values (auth.uid(), lid) on conflict do nothing;
  else
    delete from public.lesson_progress where user_id = auth.uid() and lesson_id = lid;
  end if;
end $$;
grant execute on function public.set_lesson_done(uuid, boolean) to authenticated;

-- Team: move a lesson up or down within its phase.
create or replace function public.move_lesson(lid uuid, dir int)
returns void language plpgsql security definer set search_path = public as $$
declare
  ph int;
begin
  if not public.is_team(auth.uid()) then
    raise exception 'team_only';
  end if;
  select phase into ph from public.lessons where id = lid;
  if ph is null then return; end if;
  -- number the phase 0, 2, 4 ... then nudge this lesson past its neighbour
  with r as (
    select id, (row_number() over (order by position, created_at, id) - 1) * 2 as n
    from public.lessons where phase = ph
  )
  update public.lessons l set position = r.n from r where l.id = r.id;
  update public.lessons set position = position + (case when dir < 0 then -3 else 3 end) where id = lid;
  with r as (
    select id, row_number() over (order by position, created_at, id) as n
    from public.lessons where phase = ph
  )
  update public.lessons l set position = r.n from r where l.id = r.id;
end $$;
grant execute on function public.move_lesson(uuid, int) to authenticated;

-- ---------------------------------------------------------------------
-- Assignments
-- ---------------------------------------------------------------------

-- Hand in the assignment for a phase. Needs every lesson of that phase done,
-- and nothing already waiting or approved for it.
create or replace function public.submit_assignment(ph int, media_kind text, url text, note text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  aid uuid;
begin
  if not public.is_student(me) then
    raise exception 'members_only';
  end if;
  if exists (select 1 from public.course_outline() c where c.phase = ph and c.published and not c.done) then
    raise exception 'finish_lessons';
  end if;
  if exists (select 1 from public.assignments where user_id = me and phase = ph and status in ('pending', 'approved')) then
    raise exception 'already_sent';
  end if;
  if coalesce(btrim(url), '') = '' then
    raise exception 'no_media';
  end if;
  insert into public.assignments (user_id, phase, kind, media_url, caption)
  values (me, ph, case when media_kind = 'image' then 'image' else 'video' end, btrim(url), left(coalesce(note, ''), 1000))
  returning id into aid;
  insert into public.notifications (user_id, kind, actor_id)
  select p.id, 'assignment_submitted', me from public.profiles p where p.is_sensei or p.is_moderator;
  return aid;
end $$;
grant execute on function public.submit_assignment(int, text, text, text) to authenticated;

-- Team: approve (posts it to the feed, moves the student's belt on, opens the
-- next phase) or ask for changes with a note.
create or replace function public.review_assignment(aid uuid, approve boolean, note text)
returns void language plpgsql security definer set search_path = public as $$
declare
  a public.assignments;
  pid uuid;
begin
  if not public.is_team(auth.uid()) then
    raise exception 'team_only';
  end if;
  select * into a from public.assignments where id = aid for update;
  if a.id is null or a.status <> 'pending' then
    raise exception 'not_pending';
  end if;
  perform set_config('connect.trusted', 'on', true);
  if approve then
    insert into public.posts (author_id, kind, media_url, caption, tag, community, assignment_phase)
    values (a.user_id, a.kind, a.media_url, a.caption, 'sharing', false, a.phase)
    returning id into pid;
    update public.profiles set phase = least(4, greatest(coalesce(phase, 1), a.phase + 1))
    where id = a.user_id and is_student;
  end if;
  update public.assignments
     set status = case when approve then 'approved' else 'changes' end,
         feedback = left(coalesce(note, ''), 2000),
         reviewed_by = auth.uid(), reviewed_at = now(), post_id = pid
   where id = aid;
  insert into public.notifications (user_id, kind, actor_id, post_id)
  values (a.user_id, case when approve then 'assignment_approved' else 'assignment_changes' end, auth.uid(), pid);
end $$;
grant execute on function public.review_assignment(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------
-- One device at a time
-- A student's account stays signed in on one device. Signing in somewhere
-- new signs the old device out. The team (sensei, moderators) is exempt.
-- ---------------------------------------------------------------------
create table if not exists public.device_sessions (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  token        text not null,
  label        text not null default '',
  signed_in_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create table if not exists public.device_log (
  id      bigserial primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  label   text not null default '',
  at      timestamptz not null default now()
);
create index if not exists device_log_user on public.device_log (user_id, at desc);
alter table public.device_sessions enable row level security;
alter table public.device_log      enable row level security;
-- no policies: only the functions below touch these

-- This device becomes the student's one device. Every other sign-in of theirs
-- is ended on the server.
create or replace function public.claim_device(tok text, lbl text)
returns void language plpgsql security definer set search_path = public, auth as $$
declare
  me uuid := auth.uid();
  sid text := auth.jwt() ->> 'session_id';
begin
  if me is null then
    raise exception 'not_signed_in';
  end if;
  insert into public.device_sessions (user_id, token, label)
  values (me, tok, left(coalesce(lbl, ''), 80))
  on conflict (user_id) do update set token = excluded.token, label = excluded.label, signed_in_at = now(), last_seen_at = now();
  insert into public.device_log (user_id, label) values (me, left(coalesce(lbl, ''), 80));
  if not public.is_team(me) and sid is not null then
    delete from auth.sessions where user_id = me and id::text <> sid;
  end if;
end $$;
grant execute on function public.claim_device(text, text) to authenticated;

-- Is this still the student's device?
create or replace function public.check_device(tok text)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  ok boolean;
begin
  if me is null then return false; end if;
  if public.is_team(me) then return true; end if;
  update public.device_sessions set last_seen_at = now() where user_id = me and token = tok;
  get diagnostics ok = row_count;
  return ok;
end $$;
grant execute on function public.check_device(text) to authenticated;

-- Team: every student's device, and how often their account changed device
-- in the last 7 days (a lot of changes can mean a shared account).
create or replace function public.team_devices()
returns table (user_id uuid, name text, handle text, email text, label text, last_seen_at timestamptz, changes_7d int)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not public.is_team(auth.uid()) then
    raise exception 'team_only';
  end if;
  return query
    select p.id, p.name, p.handle, u.email::text, d.label, d.last_seen_at,
           (select count(*) from public.device_log l where l.user_id = p.id and l.at > now() - interval '7 days')::int
    from public.profiles p
    join auth.users u on u.id = p.id
    left join public.device_sessions d on d.user_id = p.id
    where p.is_student
    order by 7 desc, d.last_seen_at desc nulls last;
end $$;
grant execute on function public.team_devices() to authenticated;

-- Team: give a student a new member ID. The old one stops working and every
-- device they're signed in on is signed out. Returns the new ID.
create or replace function public.reset_member_id(uid uuid)
returns text language plpgsql security definer set search_path = public, auth as $$
declare
  em text;
  sid text;
begin
  if not public.is_team(auth.uid()) then
    raise exception 'team_only';
  end if;
  select lower(email) into em from auth.users where id = uid;
  update public.enrolments set student_id = public.new_student_id() where lower(email) = em
  returning student_id into sid;
  delete from public.device_sessions where user_id = uid;
  delete from auth.sessions where user_id = uid;
  return sid;
end $$;
grant execute on function public.reset_member_id(uuid) to authenticated;
