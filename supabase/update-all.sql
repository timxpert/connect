-- =====================================================================
-- Motion Dojo Connect: all updates since the first setup, in one file.
--   1. Student IDs for sign-in
--   2. Text-only posts (image or video optional)
--   3. Students can keep their phase private
-- Run once in Supabase -> SQL Editor (role: postgres). Safe to run again,
-- including if you already ran some of the separate update files.
-- =====================================================================

-- Student IDs: MD-XXXX-XXXX, used with the email to sign in.
-- 32 letters and digits (no I, O, 0, 1), so every character is equally likely.
create or replace function public.new_student_id() returns text
language plpgsql volatile as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  b bytea := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
  picks int[] := array[0, 1, 2, 3, 4, 5, 10, 11];  -- the fully random bytes of a v4 uuid
  out text := 'MD-';
begin
  for i in 1..8 loop
    if i = 5 then out := out || '-'; end if;
    out := out || substr(alphabet, (get_byte(b, picks[i]) % 32) + 1, 1);
  end loop;
  return out;
end $$;

alter table public.enrolments add column if not exists student_id text default public.new_student_id();
update public.enrolments set student_id = public.new_student_id() where student_id is null;
alter table public.enrolments alter column student_id set not null;
create unique index if not exists enrolments_student_id on public.enrolments (student_id);

-- Returns the student's ID (a new one, or the one they already have).
drop function if exists public.mark_enrolled(text, text);
create function public.mark_enrolled(student_email text, payment_reference text)
returns text language plpgsql security definer set search_path = public as $$
declare
  sid text;
begin
  insert into public.enrolments (email, reference, source)
  values (lower(trim(student_email)), payment_reference, 'paystack')
  on conflict (email) do update set reference = excluded.reference
  returning student_id into sid;
  perform set_config('connect.trusted', 'on', true);
  update public.profiles p set is_student = true
  from auth.users u
  where u.id = p.id and lower(u.email) = lower(trim(student_email));
  return sid;
end $$;
revoke all on function public.mark_enrolled(text, text) from public, anon, authenticated;
grant execute on function public.mark_enrolled(text, text) to service_role;


alter table public.posts alter column media_url drop not null;
alter table public.posts drop constraint if exists posts_kind_check;
alter table public.posts add constraint posts_kind_check check (kind in ('image', 'video', 'text'));
alter table public.posts drop constraint if exists posts_has_content;
alter table public.posts add constraint posts_has_content
  check ((kind = 'text' and char_length(btrim(caption)) > 0) or (kind <> 'text' and media_url is not null));

alter table public.profiles add column if not exists phase_public boolean not null default true;

-- See everyone's student ID (send each student theirs on WhatsApp):
select email, student_id, created_at from public.enrolments order by created_at;
