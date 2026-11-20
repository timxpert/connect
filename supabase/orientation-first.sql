-- Orientation first: a student's lessons in phase 1 and up stay locked until
-- every published orientation lesson (phase 0) is done. The team sees everything.
-- The orientation itself is open to everyone, visitors included.
-- Run once in Supabase → SQL Editor. Safe to run again.
create or replace function public.course_outline()
returns table (id uuid, phase int, lesson_position int, title text, summary text, duration text,
               published boolean, has_video boolean, done boolean, is_open boolean, size_mb int, section text)
language sql stable security definer set search_path = public as $$
  with me as (
    select auth.uid() as uid,
           public.is_team(auth.uid()) as team,
           public.is_student(auth.uid()) as student,
           (select p.phase from public.profiles p where p.id = auth.uid()) as cur,
           not exists (
             select 1 from public.lessons z
             where z.phase = 0 and z.published
               and not exists (select 1 from public.lesson_progress q where q.user_id = auth.uid() and q.lesson_id = z.id)
           ) as oriented
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
         me.team
         or o.phase = 0
         or (
           me.student and me.cur is not null and me.oriented
           and (o.phase < me.cur
                or (o.phase = me.cur and (o.prev_phase is distinct from o.phase or o.prev_done)))
         ),
         o.size_mb, o.section
  from o, me
  order by o.phase, o.position, o.created_at, o.id
$$;
grant execute on function public.course_outline() to anon, authenticated;

-- once the orientation is ticked off it stays ticked off (students can't untick it)
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
  elsif o.phase = 0 and not public.is_team(auth.uid()) then
    return;
  else
    delete from public.lesson_progress where user_id = auth.uid() and lesson_id = lid;
  end if;
end $$;
grant execute on function public.set_lesson_done(uuid, boolean) to authenticated;

-- visitors can open the orientation (every other lesson stays members only)
create or replace function public.get_lesson(lid uuid)
returns table (id uuid, phase int, lesson_position int, title text, summary text, duration text,
               video_url text, notes text, files jsonb, published boolean, done boolean, is_open boolean, size_mb int, portrait boolean,
               images jsonb, section text)
language plpgsql stable security definer set search_path = public as $$
declare
  o record;
begin
  select * into o from public.course_outline() c where c.id = lid;
  if not found then
    raise exception 'not_found';
  end if;
  if o.phase <> 0 and not (public.is_student(auth.uid()) or public.is_team(auth.uid())) then
    raise exception 'members_only';
  end if;
  if not o.is_open then
    raise exception 'locked';
  end if;
  return query
    select l.id, l.phase, l.position, l.title, l.summary, l.duration, l.video_url, l.notes, l.files,
           l.published, o.done, true, l.size_mb, l.portrait, l.images, l.section
    from public.lessons l where l.id = lid;
end $$;
grant execute on function public.get_lesson(uuid) to anon, authenticated;
