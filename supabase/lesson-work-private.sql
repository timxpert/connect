-- Lesson work: only the Grand Sensei sees everyone's (students see their own).
-- Run once in Supabase → SQL Editor, after nov20.sql.
drop policy if exists lw_read on public.lesson_work;
create policy lw_read on public.lesson_work for select to authenticated
  using (user_id = auth.uid() or public.is_sensei(auth.uid()));
