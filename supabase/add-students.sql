-- =====================================================================
-- Add students who enrolled before Connect existed.
-- 1. Paste their emails between the two $$ lines (one per line, or
--    separated by commas or spaces).
-- 2. Run in Supabase -> SQL Editor (role: postgres).
-- Each one gets a student ID. Anyone already on the list is skipped,
-- so you can run this again with new emails.
-- =====================================================================

insert into public.enrolments (email, source)
select distinct lower(trim(x)), 'manual'
from regexp_split_to_table($$
paste@emails.here
$$, '[\s,;]+') as x
where x like '%_@_%._%' and x <> 'paste@emails.here'
on conflict (email) do nothing;

-- Students who already signed up to Connect get their badge now
update public.profiles p
set is_student = true
from auth.users u
join public.enrolments e on lower(e.email) = lower(u.email)
where u.id = p.id and not p.is_student;

-- Everyone's ID, newest first: send each student theirs on WhatsApp
select email, student_id, source, created_at
from public.enrolments
order by created_at desc;
