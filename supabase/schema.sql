-- =====================================================================
-- Motion Dojo Connect: database schema
-- Run once in Supabase: Dashboard -> SQL Editor -> paste -> Run.
-- Safe to re-run: every object is created only if it doesn't exist yet.
--
-- Who can do what (enforced here by row-level security, not just the UI):
--   * Anyone, signed in or not: read profiles, posts, likes, comments, accepted connections.
--   * Any signed-in member: edit their own profile, like, comment, bookmark,
--     send and answer connection requests, report, block.
--   * Connected members (a request was accepted): message each other.
--   * Keyframe Ninjas (verified students): all of the above, plus post work.
--   * Moderators: remove any post or comment, read reports.
--   * The grand sensei: posts to the Community feed; every student is notified.
-- A member becomes a Keyframe Ninja automatically when the email they sign
-- in with is in `enrolments` (filled by the Paystack webhook) or when they
-- redeem an invite code.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------
create table if not exists public.enrolments (
  email      text primary key,
  reference  text,
  source     text not null default 'paystack',   -- 'paystack' | 'manual' | 'team'
  created_at timestamptz not null default now()
);

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

create table if not exists public.invite_codes (
  code       text primary key,
  note       text,
  used_by    uuid references auth.users (id) on delete set null,
  used_at    timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  handle        text not null unique check (handle ~ '^[a-z0-9_]{3,24}$'),
  name          text not null check (char_length(name) between 1 and 60),
  bio           text not null default '' check (char_length(bio) <= 150),
  avatar_url    text,
  cover_url     text,
  country       text not null default '' check (char_length(country) <= 60),
  skills        text[] not null default '{}',
  phase         smallint check (phase between 1 and 4),      -- Black Belt phase, students only
  instagram     text not null default '',
  youtube       text not null default '',
  website       text not null default '',
  is_student    boolean not null default false,             -- set by the database, never by the user
  is_moderator  boolean not null default false,             -- set in the dashboard
  is_sensei     boolean not null default false,             -- the grand sensei; set in the dashboard
  created_at    timestamptz not null default now()
);

-- columns added after the first release
alter table public.profiles add column if not exists cover_url text;
-- Students choose whether other students see their phase (visitors never do)
alter table public.profiles add column if not exists phase_public boolean not null default true;
-- Any links a member adds (TikTok, LinkedIn, X, portfolio...), up to 10
alter table public.profiles add column if not exists links text[] not null default '{}';
alter table public.profiles drop constraint if exists profiles_links_check;
alter table public.profiles add constraint profiles_links_check check (cardinality(links) <= 10);

create table if not exists public.posts (
  id         uuid primary key default gen_random_uuid(),
  author_id  uuid not null references public.profiles (id) on delete cascade,
  kind       text not null check (kind in ('image', 'video', 'text')),
  media_url  text,                           -- storage URL (image or uploaded video) or a video share link; empty for text posts
  caption    text not null default '' check (char_length(caption) <= 1000),
  tag        text not null default 'sharing' check (tag in ('sharing', 'feedback')),
  community  boolean not null default false,  -- a grand sensei post for the Community feed
  created_at timestamptz not null default now()
);
-- Text-only posts (like LinkedIn): media is optional, but a text post needs words.
alter table public.posts alter column media_url drop not null;
alter table public.posts drop constraint if exists posts_kind_check;
alter table public.posts add constraint posts_kind_check check (kind in ('image', 'video', 'text'));
alter table public.posts drop constraint if exists posts_has_content;
alter table public.posts add constraint posts_has_content
  check ((kind = 'text' and char_length(btrim(caption)) > 0) or (kind <> 'text' and media_url is not null));
create index if not exists posts_author_idx on public.posts (author_id, created_at desc);
create index if not exists posts_created_idx on public.posts (created_at desc);

create table if not exists public.likes (
  post_id    uuid not null references public.posts (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create table if not exists public.comments (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references public.posts (id) on delete cascade,
  author_id  uuid not null references public.profiles (id) on delete cascade,
  body       text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index if not exists comments_post_idx on public.comments (post_id, created_at);

-- One row per pair. 'pending' until the addressee accepts; declining deletes the row.
create table if not exists public.connections (
  requester_id uuid not null references public.profiles (id) on delete cascade,
  addressee_id uuid not null references public.profiles (id) on delete cascade,
  status       text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at   timestamptz not null default now(),
  accepted_at  timestamptz,
  primary key (requester_id, addressee_id),
  check (requester_id <> addressee_id)
);
-- the same two people can't have two rows in opposite directions
create unique index if not exists connections_pair_idx
  on public.connections (least(requester_id, addressee_id), greatest(requester_id, addressee_id));
create index if not exists connections_addressee_idx on public.connections (addressee_id, status);

create table if not exists public.bookmarks (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  post_id    uuid not null references public.posts (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);

create table if not exists public.blocks (
  blocker_id uuid not null references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id)
);

create table if not exists public.conversations (
  id              uuid primary key default gen_random_uuid(),
  user_a          uuid not null references public.profiles (id) on delete cascade,
  user_b          uuid not null references public.profiles (id) on delete cascade,
  last_message_at timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  check (user_a < user_b),
  unique (user_a, user_b)
);

create table if not exists public.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id       uuid not null references public.profiles (id) on delete cascade,
  body            text not null check (char_length(body) between 1 and 2000),
  created_at      timestamptz not null default now()
);
create index if not exists messages_conv_idx on public.messages (conversation_id, created_at);

-- In-app notifications, written only by the triggers below
create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  kind       text not null check (kind in ('community_post', 'connection_request', 'connection_accepted')),
  actor_id   uuid references public.profiles (id) on delete cascade,
  post_id    uuid references public.posts (id) on delete cascade,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);

create table if not exists public.reports (
  id          uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  target_type text not null check (target_type in ('post', 'comment', 'profile', 'message')),
  target_id   text not null,
  reason      text not null default '' check (char_length(reason) <= 500),
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------
create or replace function public.is_student(uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_student from public.profiles where id = uid), false)
$$;

create or replace function public.is_moderator(uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_moderator from public.profiles where id = uid), false)
$$;

create or replace function public.are_connected(x uuid, y uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.connections
                 where status = 'accepted'
                   and ((requester_id = x and addressee_id = y) or (requester_id = y and addressee_id = x)))
$$;

create or replace function public.is_sensei(uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_sensei from public.profiles where id = uid), false)
$$;

create or replace function public.is_blocked_between(x uuid, y uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.blocks
                 where (blocker_id = x and blocked_id = y) or (blocker_id = y and blocked_id = x))
$$;

-- Emails that get the grand sensei role on sign-up (see update-all.sql section 11).
create table if not exists public.sensei_emails (email text primary key);
alter table public.sensei_emails enable row level security;

-- New profiles: student status comes from the enrolment list, never from the client.
create or replace function public.profiles_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  uemail text;
begin
  if tg_op = 'INSERT' then
    select lower(email) into uemail from auth.users where id = new.id;
    new.is_student   := exists (select 1 from public.enrolments where lower(email) = uemail);
    new.is_moderator := false;
    new.is_sensei    := exists (select 1 from public.sensei_emails where lower(email) = uemail);
  elsif auth.uid() is not null
        and coalesce(auth.role(), '') <> 'service_role'
        and coalesce(current_setting('connect.trusted', true), '') <> 'on' then
    -- A member editing their own profile can't touch these. Only the dashboard,
    -- the service role, or the verification functions below (which set
    -- connect.trusted for their own transaction) can change them.
    new.is_student   := old.is_student;
    new.is_moderator := old.is_moderator;
    new.is_sensei    := old.is_sensei;
  end if;
  if new.is_sensei then
    new.is_student := false;  -- the grand sensei is never listed as a student
  end if;
  if not new.is_student or new.is_sensei then
    new.phase := null;
  end if;
  return new;
end $$;

drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard before insert or update on public.profiles
for each row execute function public.profiles_guard();

-- A member who paid after signing up can ask the database to check again.
create or replace function public.refresh_student_status() returns boolean
language plpgsql security definer set search_path = public as $$
declare
  ok boolean;
begin
  select exists (
    select 1 from public.enrolments e join auth.users u on lower(u.email) = lower(e.email)
    where u.id = auth.uid()
  ) into ok;
  if ok then
    perform set_config('connect.trusted', 'on', true);
    update public.profiles set is_student = true where id = auth.uid();
  end if;
  return ok;
end $$;

-- Invite codes for students who paid outside Paystack (bank transfer, instalments).
create or replace function public.redeem_invite(invite text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update public.invite_codes set used_by = auth.uid(), used_at = now()
  where code = upper(trim(invite)) and used_by is null;
  if not found then
    return false;
  end if;
  perform set_config('connect.trusted', 'on', true);
  update public.profiles set is_student = true where id = auth.uid();
  return true;
end $$;

-- Open (or find) the conversation with another member, respecting blocks and
-- their "who can message me" setting.
create or replace function public.open_conversation(other uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  a uuid;
  b uuid;
  cid uuid;
begin
  if me is null or other is null or me = other then
    raise exception 'invalid conversation';
  end if;
  if public.is_blocked_between(me, other) then
    raise exception 'blocked';
  end if;
  a := least(me, other);
  b := greatest(me, other);
  select id into cid from public.conversations where user_a = a and user_b = b;
  if cid is not null then
    return cid;
  end if;
  if not public.are_connected(me, other) then
    raise exception 'not connected';
  end if;
  insert into public.conversations (user_a, user_b) values (a, b) returning id into cid;
  return cid;
end $$;

create or replace function public.connections_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.status := 'pending';
    new.accepted_at := null;
    if public.is_blocked_between(new.requester_id, new.addressee_id) then
      raise exception 'blocked';
    end if;
  else
    if new.requester_id <> old.requester_id or new.addressee_id <> old.addressee_id then
      raise exception 'cannot change who is connected';
    end if;
    if new.status = 'accepted' and old.status = 'pending' then
      new.accepted_at := now();
    end if;
  end if;
  return new;
end $$;
drop trigger if exists connections_guard on public.connections;
create trigger connections_guard before insert or update on public.connections
for each row execute function public.connections_guard();

-- Blocking someone also ends any connection with them
create or replace function public.blocks_disconnect() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from public.connections
  where (requester_id = new.blocker_id and addressee_id = new.blocked_id)
     or (requester_id = new.blocked_id and addressee_id = new.blocker_id);
  return new;
end $$;
drop trigger if exists blocks_disconnect on public.blocks;
create trigger blocks_disconnect after insert on public.blocks
for each row execute function public.blocks_disconnect();

create or replace function public.notify_community_post() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.community then
    insert into public.notifications (user_id, kind, actor_id, post_id)
    select p.id, 'community_post', new.author_id, new.id
    from public.profiles p
    where p.is_student and p.id <> new.author_id;
  end if;
  return new;
end $$;
drop trigger if exists posts_notify on public.posts;
create trigger posts_notify after insert on public.posts
for each row execute function public.notify_community_post();

create or replace function public.notify_connection() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.notifications (user_id, kind, actor_id)
    values (new.addressee_id, 'connection_request', new.requester_id);
  elsif new.status = 'accepted' and old.status = 'pending' then
    insert into public.notifications (user_id, kind, actor_id)
    values (new.requester_id, 'connection_accepted', new.addressee_id);
    -- the request has been answered
    delete from public.notifications
    where user_id = new.addressee_id and actor_id = new.requester_id and kind = 'connection_request';
  end if;
  return new;
end $$;
drop trigger if exists connections_notify on public.connections;
create trigger connections_notify after insert or update on public.connections
for each row execute function public.notify_connection();

-- Declined or cancelled requests take their notification with them
create or replace function public.unnotify_connection() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from public.notifications
  where kind = 'connection_request' and user_id = old.addressee_id and actor_id = old.requester_id;
  return old;
end $$;
drop trigger if exists connections_unnotify on public.connections;
create trigger connections_unnotify after delete on public.connections
for each row execute function public.unnotify_connection();

-- No content filter on messages, comments, posts or profiles.
drop trigger if exists messages_no_payment on public.messages;
drop trigger if exists comments_no_payment on public.comments;
drop trigger if exists posts_no_payment on public.posts;
drop trigger if exists profiles_no_payment on public.profiles;
drop function if exists public.no_payment_details();
drop function if exists public.has_payment_details(text);

create or replace function public.touch_conversation() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.conversations set last_message_at = new.created_at where id = new.conversation_id;
  return new;
end $$;
drop trigger if exists messages_touch on public.messages;
create trigger messages_touch after insert on public.messages
for each row execute function public.touch_conversation();

-- Public counts for cards and profiles
create or replace view public.post_stats with (security_invoker = true) as
  select p.id as post_id,
         (select count(*) from public.likes l where l.post_id = p.id)    as likes,
         (select count(*) from public.comments c where c.post_id = p.id) as comments
  from public.posts p;

-- ---------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------
alter table public.enrolments    enable row level security;  -- no policies: server only
alter table public.invite_codes  enable row level security;  -- no policies: server only
alter table public.profiles      enable row level security;
alter table public.posts         enable row level security;
alter table public.likes         enable row level security;
alter table public.comments      enable row level security;
alter table public.connections   enable row level security;
alter table public.bookmarks     enable row level security;
alter table public.blocks        enable row level security;
alter table public.conversations enable row level security;
alter table public.messages      enable row level security;
alter table public.reports       enable row level security;
alter table public.notifications enable row level security;

do $$ begin
  -- profiles
  create policy "profiles are public"        on public.profiles for select using (true);
  create policy "create own profile"         on public.profiles for insert with check (id = auth.uid());
  create policy "edit own profile"           on public.profiles for update using (id = auth.uid());
  -- posts
  create policy "posts are public"           on public.posts for select using (true);
  create policy "students and sensei post"    on public.posts for insert
    with check (author_id = auth.uid()
                and ((not community and (public.is_student(auth.uid()) or public.is_sensei(auth.uid())))
                     or (community and public.is_sensei(auth.uid()))));
  create policy "edit own post"              on public.posts for update using (author_id = auth.uid())
    with check (author_id = auth.uid() and (not community or public.is_sensei(auth.uid())));
  create policy "remove own post or moderate" on public.posts for delete
    using (author_id = auth.uid() or public.is_moderator(auth.uid()));
  -- likes
  create policy "likes are public"           on public.likes for select using (true);
  create policy "like as yourself"           on public.likes for insert with check (user_id = auth.uid());
  create policy "unlike your own"            on public.likes for delete using (user_id = auth.uid());
  -- comments
  create policy "comments are public"        on public.comments for select using (true);
  create policy "comment as yourself"        on public.comments for insert with check (author_id = auth.uid());
  create policy "remove comment"             on public.comments for delete using (
    author_id = auth.uid()
    or public.is_moderator(auth.uid())
    or exists (select 1 from public.posts p where p.id = post_id and p.author_id = auth.uid()));
  -- connections: accepted ones are public (profile counts); requests only to the two people
  create policy "see connections"            on public.connections for select
    using (status = 'accepted' or auth.uid() in (requester_id, addressee_id));
  create policy "send a request"             on public.connections for insert
    with check (requester_id = auth.uid());
  create policy "accept a request"           on public.connections for update
    using (addressee_id = auth.uid() and status = 'pending')
    with check (addressee_id = auth.uid() and status = 'accepted');
  create policy "decline, cancel or remove"  on public.connections for delete
    using (auth.uid() in (requester_id, addressee_id));
  -- bookmarks: private to their owner
  create policy "see own bookmarks"          on public.bookmarks for select using (user_id = auth.uid());
  create policy "bookmark"                   on public.bookmarks for insert with check (user_id = auth.uid());
  create policy "remove bookmark"            on public.bookmarks for delete using (user_id = auth.uid());
  -- blocks
  create policy "see own blocks"             on public.blocks for select using (blocker_id = auth.uid());
  create policy "block"                      on public.blocks for insert with check (blocker_id = auth.uid());
  create policy "unblock"                    on public.blocks for delete using (blocker_id = auth.uid());
  -- conversations (created through open_conversation)
  create policy "see own conversations"      on public.conversations for select
    using (auth.uid() in (user_a, user_b));
  -- messages
  create policy "read own messages"          on public.messages for select using (
    exists (select 1 from public.conversations c
            where c.id = conversation_id and auth.uid() in (c.user_a, c.user_b)));
  create policy "send in own conversations"  on public.messages for insert with check (
    sender_id = auth.uid()
    and exists (select 1 from public.conversations c
                where c.id = conversation_id and auth.uid() in (c.user_a, c.user_b)
                  and public.are_connected(c.user_a, c.user_b)
                  and not public.is_blocked_between(c.user_a, c.user_b)));
  -- notifications: your own; you can only mark them read or clear them
  create policy "see own notifications"      on public.notifications for select using (user_id = auth.uid());
  create policy "mark own read"              on public.notifications for update
    using (user_id = auth.uid()) with check (user_id = auth.uid());
  create policy "clear own"                  on public.notifications for delete using (user_id = auth.uid());
  -- reports
  create policy "file a report"              on public.reports for insert with check (reporter_id = auth.uid());
  create policy "moderators read reports"    on public.reports for select using (public.is_moderator(auth.uid()));
exception when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------
-- Storage: one public bucket; members upload only into their own folder
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('media', 'media', true)
on conflict (id) do nothing;

do $$ begin
  create policy "media is public" on storage.objects for select using (bucket_id = 'media');
  create policy "upload to own folder" on storage.objects for insert to authenticated
    with check (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);
  create policy "replace own files" on storage.objects for update to authenticated
    using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);
  create policy "delete own files" on storage.objects for delete to authenticated
    using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);
exception when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------
-- Called by the Paystack webhook (server only) when a course payment
-- succeeds: records the enrolment and turns on the badge if the student
-- already has a Connect account.
-- ---------------------------------------------------------------------
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

-- Online status: "last seen" time, stamped while Connect is open
alter table public.profiles add column if not exists last_seen_at timestamptz;
create or replace function public.touch_seen() returns void
language sql security definer set search_path = public as $$
  update public.profiles set last_seen_at = now() where id = auth.uid();
$$;
grant execute on function public.touch_seen() to authenticated;
