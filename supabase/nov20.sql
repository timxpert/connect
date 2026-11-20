-- 20 November: belts always show, only the Grand Sensei edits lessons and
-- briefs, and students can hand in work on a lesson.
-- Run once in Supabase → SQL Editor. Safe to run again.

-- 1. Belts can't be hidden any more
update public.profiles set phase_public = true where phase_public is distinct from true;

-- 2. Lessons and phase briefs: the team can read them, only the Grand Sensei changes them
drop policy if exists lessons_team on public.lessons;
drop policy if exists lessons_read on public.lessons;
drop policy if exists lessons_add on public.lessons;
drop policy if exists lessons_change on public.lessons;
drop policy if exists lessons_remove on public.lessons;
create policy lessons_read on public.lessons for select to authenticated using (public.is_team(auth.uid()));
create policy lessons_add on public.lessons for insert to authenticated with check (public.is_sensei(auth.uid()));
create policy lessons_change on public.lessons for update to authenticated using (public.is_sensei(auth.uid())) with check (public.is_sensei(auth.uid()));
create policy lessons_remove on public.lessons for delete to authenticated using (public.is_sensei(auth.uid()));

drop policy if exists briefs_team on public.phase_briefs;
drop policy if exists briefs_add on public.phase_briefs;
drop policy if exists briefs_change on public.phase_briefs;
drop policy if exists briefs_remove on public.phase_briefs;
create policy briefs_add on public.phase_briefs for insert to authenticated with check (public.is_sensei(auth.uid()));
create policy briefs_change on public.phase_briefs for update to authenticated using (public.is_sensei(auth.uid())) with check (public.is_sensei(auth.uid()));
create policy briefs_remove on public.phase_briefs for delete to authenticated using (public.is_sensei(auth.uid()));

-- moving a lesson up or down: Grand Sensei only
create or replace function public.move_lesson_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_sensei(auth.uid()) then
    raise exception 'sensei_only';
  end if;
  return new;
end $$;
drop trigger if exists lessons_sensei_only on public.lessons;
create trigger lessons_sensei_only before update on public.lessons
  for each row execute function public.move_lesson_guard();

-- 3. Work handed in on a lesson
create table if not exists public.lesson_work_open (
  lesson_id uuid primary key references public.lessons (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.lesson_work_open enable row level security;
drop policy if exists lwo_read on public.lesson_work_open;
drop policy if exists lwo_write on public.lesson_work_open;
create policy lwo_read on public.lesson_work_open for select to authenticated using (true);
create policy lwo_write on public.lesson_work_open for all to authenticated
  using (public.is_sensei(auth.uid())) with check (public.is_sensei(auth.uid()));

create table if not exists public.lesson_work (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references public.lessons (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  url text not null check (char_length(url) between 8 and 2000),
  note text not null default '' check (char_length(note) <= 1000),
  created_at timestamptz not null default now(),
  unique (lesson_id, user_id)
);
create index if not exists lesson_work_lesson on public.lesson_work (lesson_id, created_at desc);
alter table public.lesson_work enable row level security;
drop policy if exists lw_read on public.lesson_work;
drop policy if exists lw_add on public.lesson_work;
drop policy if exists lw_change on public.lesson_work;
drop policy if exists lw_remove on public.lesson_work;
-- you see your own; the team sees everyone's
create policy lw_read on public.lesson_work for select to authenticated
  using (user_id = auth.uid() or public.is_team(auth.uid()));
-- students hand in on lessons the Grand Sensei opened for work
create policy lw_add on public.lesson_work for insert to authenticated
  with check (user_id = auth.uid() and public.is_student(auth.uid())
              and exists (select 1 from public.lesson_work_open o where o.lesson_id = lesson_work.lesson_id));
create policy lw_change on public.lesson_work for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy lw_remove on public.lesson_work for delete to authenticated
  using (user_id = auth.uid());
