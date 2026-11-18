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

-- The course outline for whoever is asking: no video links.
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
    select l.*, lag(l.done) over (order by l.phase, l.position, l.created_at, l.id) as prev_done
    from l
  )
  select o.id, o.phase, o.position, o.title, o.summary, o.duration, o.published,
         o.video_url <> '', o.done,
         me.team or (me.learner and (o.prev_done is null or o.prev_done))
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
