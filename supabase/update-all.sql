-- =====================================================================
-- Motion Dojo Connect: all updates since the first setup, in one file.
--   1. Student IDs for sign-in
--   2. Text-only posts (image or video optional)
--   3. Students can keep their phase private
--   4. Chat: voice notes, files, delete for everyone, delivered / seen
--   5. Profile links (any platform)
--   6. Speed: one-request feed and inbox, live updates
--   7. Blurred previews for chat photos and videos
--   8. Scam filter catches 'send your account', 'bank acct', payment apps
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
-- Chat photos and videos carry a tiny blurred preview (a few hundred bytes),
-- shown behind the download button before the real file is fetched
alter table public.messages add column if not exists thumb text;
alter table public.messages drop constraint if exists messages_thumb_check;
alter table public.messages add constraint messages_thumb_check check (thumb is null or char_length(thumb) <= 6000);
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

-- ---------------------------------------------------------------------
-- Speed: each screen in one request, and live updates.
-- posts_feed: a post with its author, like and comment counts, and whether
--   I liked / saved it / am connected to the author.
-- inbox: my conversations with the other person, the last message and my
--   unread count.
-- Both run with the caller's permissions (security_invoker), so every
-- row-level rule above still applies.
-- ---------------------------------------------------------------------
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

drop view if exists public.inbox;
create view public.inbox with (security_invoker = true) as
  select c.id,
         c.last_message_at,
         to_jsonb(o.*) as other,
         lm.body       as last_body,
         lm.kind       as last_kind,
         lm.file_name  as last_file_name,
         lm.sender_id  as last_sender,
         lm.delivered_at as last_delivered_at,
         lm.read_at    as last_read_at,
         lm.deleted_at as last_deleted_at,
         (select count(*) from public.messages m
          where m.conversation_id = c.id and m.sender_id <> auth.uid() and m.read_at is null and m.deleted_at is null)::int as unread
  from public.conversations c
  join public.profiles o on o.id = case when c.user_a = auth.uid() then c.user_b else c.user_a end
  left join lateral (
    select * from public.messages m where m.conversation_id = c.id order by m.created_at desc limit 1
  ) lm on true
  where auth.uid() in (c.user_a, c.user_b);

grant select on public.posts_feed to anon, authenticated;
grant select on public.inbox to authenticated;

-- Live updates: new messages, ticks, comments and notifications arrive at once
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['messages', 'comments', 'notifications'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

-- Remove the bank-details filter
drop trigger if exists messages_no_payment on public.messages;
drop trigger if exists comments_no_payment on public.comments;
drop trigger if exists posts_no_payment on public.posts;
drop trigger if exists profiles_no_payment on public.profiles;
drop function if exists public.no_payment_details();
drop function if exists public.has_payment_details(text);

-- See everyone's student ID (send each student theirs on WhatsApp):
select email, student_id, created_at from public.enrolments order by created_at;
