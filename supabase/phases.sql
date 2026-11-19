-- Phase check: every student says which phase they're in, and the Grand
-- Sensei (or a moderator) confirms it. Lessons only open once the phase is
-- confirmed: every phase up to it, then lesson by lesson inside it.
-- The team can confirm the phase they asked for, put them in a different
-- phase, or decline (they choose again). Safe to run more than once.

alter table public.profiles add column if not exists phase_request    smallint check (phase_request between 1 and 4);
alter table public.profiles add column if not exists phase_request_at timestamptz;
alter table public.profiles add column if not exists phase_declined_at timestamptz;

-- Only the team (through the functions below) can set a student's phase now.
create or replace function public.profiles_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  uemail text;
  trusted boolean := coalesce(current_setting('connect.trusted', true), '') = 'on';
begin
  if tg_op = 'INSERT' then
    select lower(email) into uemail from auth.users where id = new.id;
    new.is_student   := exists (select 1 from public.enrolments where lower(email) = uemail);
    new.is_moderator := false;
    new.is_sensei    := exists (select 1 from public.sensei_emails where lower(email) = uemail);
    if auth.uid() is not null and coalesce(auth.role(), '') <> 'service_role' and not trusted then
      new.phase := null;
      new.phase_request := null;
      new.phase_request_at := null;
      new.phase_declined_at := null;
    end if;
  elsif auth.uid() is not null
        and coalesce(auth.role(), '') <> 'service_role'
        and not trusted then
    -- A member editing their own profile can't touch these. Only the dashboard,
    -- the service role, or the functions that set connect.trusted can.
    new.is_student        := old.is_student;
    new.is_moderator      := old.is_moderator;
    new.is_sensei         := old.is_sensei;
    new.phase             := old.phase;
    new.phase_request     := old.phase_request;
    new.phase_request_at  := old.phase_request_at;
    new.phase_declined_at := old.phase_declined_at;
  end if;
  if new.is_sensei then
    new.is_student := false;  -- the grand sensei is never listed as a student
  end if;
  if not new.is_student or new.is_sensei then
    new.phase := null;
    new.phase_request := null;
  end if;
  return new;
end $$;

-- Existing students: anyone with an approved assignment keeps their phase.
-- Everyone else's self-chosen phase becomes a request for the team to confirm.
do $$
begin
  perform set_config('connect.trusted', 'on', true);
  update public.profiles p
     set phase = least(4, greatest(coalesce(p.phase, 1), (select max(a.phase) + 1 from public.assignments a where a.user_id = p.id and a.status = 'approved')))
   where p.is_student
     and exists (select 1 from public.assignments a where a.user_id = p.id and a.status = 'approved');
  update public.profiles p
     set phase_request = p.phase, phase_request_at = now(), phase = null
   where p.is_student and p.phase is not null and p.phase_request is null
     and not exists (select 1 from public.assignments a where a.user_id = p.id and a.status = 'approved');
end $$;

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'community_post', 'connection_request', 'connection_accepted',
  'assignment_submitted', 'assignment_approved', 'assignment_changes',
  'group_reply', 'group_mention',
  'phase_request', 'phase_approved', 'phase_declined'));
alter table public.notifications add column if not exists snippet text;

-- Student: "I'm in phase N"
create or replace function public.request_phase(ph int) returns void
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
begin
  if not public.is_student(me) then
    raise exception 'members_only';
  end if;
  if ph is null or ph not between 1 and 4 then
    raise exception 'bad_phase';
  end if;
  if exists (select 1 from public.profiles where id = me and phase is not null) then
    raise exception 'already_placed';
  end if;
  perform set_config('connect.trusted', 'on', true);
  update public.profiles set phase_request = ph, phase_request_at = now(), phase_declined_at = null where id = me;
  delete from public.notifications where kind = 'phase_request' and actor_id = me;
  insert into public.notifications (user_id, kind, actor_id, snippet)
  select p.id, 'phase_request', me, 'Phase ' || ph from public.profiles p where p.is_sensei or p.is_moderator;
end $$;
grant execute on function public.request_phase(int) to authenticated;

-- Team: put a student in a phase (what they asked for, or a different one),
-- or decline with ph = null so they choose again.
create or replace function public.set_student_phase(uid uuid, ph int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_team(auth.uid()) then
    raise exception 'team_only';
  end if;
  if ph is not null and ph not between 1 and 4 then
    raise exception 'bad_phase';
  end if;
  if not exists (select 1 from public.profiles where id = uid and is_student) then
    raise exception 'not_a_student';
  end if;
  perform set_config('connect.trusted', 'on', true);
  if ph is null then
    update public.profiles set phase_request = null, phase_request_at = null, phase_declined_at = now(), phase = null where id = uid;
  else
    update public.profiles set phase = ph, phase_request = null, phase_request_at = null, phase_declined_at = null where id = uid;
  end if;
  delete from public.notifications where kind = 'phase_request' and actor_id = uid;
  insert into public.notifications (user_id, kind, actor_id, snippet)
  values (uid, case when ph is null then 'phase_declined' else 'phase_approved' end, auth.uid(), case when ph is null then null else 'Phase ' || ph end);
end $$;
grant execute on function public.set_student_phase(uuid, int) to authenticated;

-- Team: students waiting for their phase to be confirmed
drop function if exists public.phase_requests();
create function public.phase_requests()
returns table (id uuid, name text, handle text, avatar_url text, phase_request int, phase_request_at timestamptz)
language sql stable security definer set search_path = public as $$
  select p.id, p.name, p.handle, p.avatar_url, p.phase_request, p.phase_request_at
  from public.profiles p
  where public.is_team(auth.uid()) and p.is_student and p.phase_request is not null
  order by p.phase_request_at
$$;
grant execute on function public.phase_requests() to authenticated;

-- Lessons: nothing opens until the phase is confirmed. Then every phase before
-- it is open, and inside it lessons open one by one. Approving a phase's
-- assignment moves the student to the next phase (review_assignment).
drop function if exists public.course_outline();
create function public.course_outline()
returns table (id uuid, phase int, lesson_position int, title text, summary text, duration text,
               published boolean, has_video boolean, done boolean, is_open boolean, size_mb int)
language sql stable security definer set search_path = public as $$
  with me as (
    select auth.uid() as uid,
           public.is_team(auth.uid()) as team,
           public.is_student(auth.uid()) as student,
           (select p.phase from public.profiles p where p.id = auth.uid()) as cur
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
           me.student and me.cur is not null
           and (o.phase < me.cur
                or (o.phase = me.cur and (o.prev_phase is distinct from o.phase or o.prev_done)))
         ),
         o.size_mb
  from o, me
  order by o.phase, o.position, o.created_at, o.id
$$;
grant execute on function public.course_outline() to anon, authenticated;
