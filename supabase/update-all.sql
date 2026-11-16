-- =====================================================================
-- Motion Dojo Connect: all updates since the first setup, in one file.
--   1. Student IDs for sign-in
--   2. Text-only posts (image or video optional)
--   3. Students can keep their phase private
--   4. Chat: voice notes, files, delete for everyone, delivered / seen
--   5. Profile links (any platform)
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
-- Any links a member adds (TikTok, LinkedIn, X, portfolio...), up to 10
alter table public.profiles add column if not exists links text[] not null default '{}';
alter table public.profiles drop constraint if exists profiles_links_check;
alter table public.profiles add constraint profiles_links_check check (cardinality(links) <= 10);

-- ---------------------------------------------------------------------
-- Chat: voice notes, attachments, delete for everyone, delivered / seen.
-- Files go in a private 'chat' bucket under <conversation id>/..., readable
-- only by the two people in that conversation (the app uses signed links).
-- ---------------------------------------------------------------------
alter table public.messages drop constraint if exists messages_body_check;
alter table public.messages add column if not exists kind text not null default 'text';
alter table public.messages add column if not exists media_path text;
alter table public.messages add column if not exists file_name text;
alter table public.messages add column if not exists file_size bigint;
alter table public.messages add column if not exists duration real;
alter table public.messages add column if not exists delivered_at timestamptz;
alter table public.messages add column if not exists read_at timestamptz;
alter table public.messages add column if not exists deleted_at timestamptz;
alter table public.messages drop constraint if exists messages_kind_check;
alter table public.messages add constraint messages_kind_check check (kind in ('text', 'voice', 'image', 'video', 'file'));
alter table public.messages drop constraint if exists messages_content_check;
alter table public.messages add constraint messages_content_check check (
  char_length(body) <= 4000
  and (deleted_at is not null
       or (kind = 'text' and char_length(btrim(body)) > 0)
       or (kind <> 'text' and media_path is not null)));

-- The other person's app saw the message arrive
create or replace function public.mark_delivered() returns void
language sql security definer set search_path = public as $$
  update public.messages m set delivered_at = now()
  from public.conversations c
  where m.conversation_id = c.id
    and auth.uid() in (c.user_a, c.user_b)
    and m.sender_id <> auth.uid()
    and m.delivered_at is null;
$$;

-- The other person opened the chat
create or replace function public.mark_read(conv uuid) returns void
language sql security definer set search_path = public as $$
  update public.messages m
  set read_at = now(), delivered_at = coalesce(m.delivered_at, now())
  from public.conversations c
  where m.conversation_id = conv and c.id = conv
    and auth.uid() in (c.user_a, c.user_b)
    and m.sender_id <> auth.uid()
    and m.read_at is null;
$$;

-- Delete for everyone: only the sender, and only their own message.
-- Returns the file path (if any) so the app can remove the file too.
create or replace function public.delete_message(mid uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  p text;
begin
  select media_path into p from public.messages where id = mid and sender_id = auth.uid() and deleted_at is null;
  if not found then
    raise exception 'not_your_message';
  end if;
  update public.messages
  set deleted_at = now(), body = '', media_path = null, file_name = null, file_size = null, duration = null
  where id = mid;
  return p;
end $$;

revoke all on function public.mark_delivered() from public, anon;
revoke all on function public.mark_read(uuid) from public, anon;
revoke all on function public.delete_message(uuid) from public, anon;
grant execute on function public.mark_delivered() to authenticated;
grant execute on function public.mark_read(uuid) to authenticated;
grant execute on function public.delete_message(uuid) to authenticated;

insert into storage.buckets (id, name, public) values ('chat', 'chat', false) on conflict (id) do nothing;
drop policy if exists "chat files: people in the conversation upload" on storage.objects;
create policy "chat files: people in the conversation upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'chat' and exists (
    select 1 from public.conversations c
    where c.id::text = (storage.foldername(name))[1] and auth.uid() in (c.user_a, c.user_b)));
drop policy if exists "chat files: people in the conversation read" on storage.objects;
create policy "chat files: people in the conversation read" on storage.objects for select to authenticated
  using (bucket_id = 'chat' and exists (
    select 1 from public.conversations c
    where c.id::text = (storage.foldername(name))[1] and auth.uid() in (c.user_a, c.user_b)));

-- See everyone's student ID (send each student theirs on WhatsApp):
select email, student_id, created_at from public.enrolments order by created_at;
