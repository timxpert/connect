-- 25 November
--  1. Lessons with "Preview" in the title: open to everyone (visitors too),
--     and they don't count as course lessons (they never lock the next one
--     and aren't needed for the orientation).
--  2. Banned from the Dojo group = no lessons (previews still play).
--  3. Every new member gets a welcome message from the Grand Sensei.
-- Run once in Supabase → SQL Editor, after orientation-first.sql. Safe to run again.

create or replace function public.is_preview(t text) returns boolean
language sql immutable as $$ select coalesce(t, '') ~* '\mpreview\M' $$;

create or replace function public.banned_from_group(uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.group_removed r where r.user_id = uid and r.banned)
$$;
grant execute on function public.banned_from_group(uuid) to anon, authenticated;

create or replace function public.course_outline()
returns table (id uuid, phase int, lesson_position int, title text, summary text, duration text,
               published boolean, has_video boolean, done boolean, is_open boolean, size_mb int, section text)
language sql stable security definer set search_path = public as $$
  with me as (
    select auth.uid() as uid,
           public.is_team(auth.uid()) as team,
           public.is_student(auth.uid()) as student,
           public.banned_from_group(auth.uid()) as banned,
           (select p.phase from public.profiles p where p.id = auth.uid()) as cur,
           not exists (
             select 1 from public.lessons z
             where z.phase = 0 and z.published and not public.is_preview(z.title)
               and not exists (select 1 from public.lesson_progress q where q.user_id = auth.uid() and q.lesson_id = z.id)
           ) as oriented
  ),
  l as (
    select l.*,
           public.is_preview(l.title) as pv,
           exists (select 1 from public.lesson_progress p, me where p.user_id = me.uid and p.lesson_id = l.id) as done
    from public.lessons l, me
    where l.published or me.team
  ),
  o as (
    -- "the lesson before" skips previews
    select l.*,
           lag(l.done)  over (partition by l.pv order by l.phase, l.position, l.created_at, l.id) as prev_done,
           lag(l.phase) over (partition by l.pv order by l.phase, l.position, l.created_at, l.id) as prev_phase
    from l
  )
  select o.id, o.phase, o.position, o.title, o.summary, o.duration, o.published,
         o.video_url <> '', o.done,
         me.team
         or o.pv
         or (not me.banned and (
               o.phase = 0
               or (me.student and me.cur is not null and me.oriented
                   and (o.phase < me.cur
                        or (o.phase = me.cur and (o.prev_phase is distinct from o.phase or o.prev_done))))
            )),
         o.size_mb, o.section
  from o, me
  order by o.phase, o.position, o.created_at, o.id
$$;
grant execute on function public.course_outline() to anon, authenticated;

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
  if not public.is_preview(o.title) and not public.is_team(auth.uid()) then
    if public.banned_from_group(auth.uid()) then
      raise exception 'banned';
    end if;
    if o.phase <> 0 and not public.is_student(auth.uid()) then
      raise exception 'members_only';
    end if;
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

-- 3. Welcome message from the Grand Sensei, once per member
create table if not exists public.welcome_sent (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  at timestamptz not null default now()
);
alter table public.welcome_sent enable row level security;

create or replace function public.send_welcome(uid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  sensei uuid;
  who text;
  a uuid;
  b uuid;
  cid uuid;
begin
  if exists (select 1 from public.welcome_sent where user_id = uid) then return; end if;
  select p.id into sensei from public.profiles p
    join auth.users u on u.id = p.id
    where lower(u.email) in (select lower(email) from public.sensei_emails)
    order by p.created_at limit 1;
  if sensei is null or sensei = uid then return; end if;
  select coalesce(nullif(trim(name), ''), handle) into who from public.profiles where id = uid;
  a := least(sensei, uid);
  b := greatest(sensei, uid);
  insert into public.conversations (user_a, user_b) values (a, b)
    on conflict (user_a, user_b) do nothing;
  select id into cid from public.conversations where user_a = a and user_b = b;
  insert into public.messages (conversation_id, sender_id, body)
  values (cid, sensei,
          'You''re welcome to the official Motion Dojo Community, ' || who
          || '. Start with the orientation video in Learn, then pick your phase and wait for approval.');
  update public.conversations set last_message_at = now() where id = cid;
  insert into public.welcome_sent (user_id) values (uid) on conflict do nothing;
end $$;

-- new members: when their profile is made as a student, or when they become one
create or replace function public.welcome_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.is_student and not coalesce(new.is_sensei, false) and not coalesce(new.is_moderator, false)
     and (tg_op = 'INSERT' or not coalesce(old.is_student, false)) then
    begin
      perform public.send_welcome(new.id);
    exception when others then
      null; -- a welcome message must never stop someone signing up
    end;
  end if;
  return new;
end $$;
drop trigger if exists profiles_welcome on public.profiles;
create trigger profiles_welcome after insert or update of is_student on public.profiles
  for each row execute function public.welcome_trigger();

-- OPTIONAL: also send it to every member who's already here.
-- Remove the two dashes at the start of the next line and run it once.
-- select public.send_welcome(p.id) from public.profiles p where p.is_student and not p.is_sensei and not p.is_moderator;
