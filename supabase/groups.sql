-- Your own groups: only the Grand Sensei creates them, adds students himself
-- or shares an invite link (valid 3 days) with a message. Each group has
-- everything the community group has: replies, reactions, files, voice
-- notes, read counts, pin, mute, announcements only and message history.
-- The community group (every student) stays as it is.
-- Run after group.sql, admin.sql, group-update.sql and group-join.sql.
-- Safe to run more than once.

create table if not exists public.groups (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (char_length(btrim(name)) between 1 and 60),
  photo_url     text,
  announce_only boolean not null default false,
  pinned_id     uuid,
  history       text not null default 'all' check (history in ('all', '14d', '100', 'none')),
  created_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now()
);

-- Who is in each group, when they joined, read up to, and any mute
create table if not exists public.group_people (
  group_id     uuid not null references public.groups (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  added_at     timestamptz not null default now(),
  last_read_at timestamptz,
  muted_until  timestamptz,
  primary key (group_id, user_id)
);
create index if not exists group_people_user on public.group_people (user_id);

-- Invite links: a random code, a message, and when it stops working
create table if not exists public.group_invites (
  token      text primary key,
  group_id   uuid not null references public.groups (id) on delete cascade,
  message    text not null default '' check (char_length(message) <= 600),
  expires_at timestamptz not null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

-- Messages: no group_id = the community group
alter table public.group_messages add column if not exists group_id uuid references public.groups (id) on delete cascade;
create index if not exists group_messages_gid_time on public.group_messages (group_id, created_at desc);

alter table public.groups        enable row level security;
alter table public.group_people  enable row level security;
alter table public.group_invites enable row level security;

create or replace function public.is_sensei(uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_sensei from public.profiles where id = uid), false)
$$;

create or replace function public.in_grp(uid uuid, gid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.group_people where group_id = gid and user_id = uid)
     and not exists (select 1 from public.profiles where id = uid and banned_at is not null)
$$;

drop policy if exists groups_read on public.groups;
create policy groups_read on public.groups for select to authenticated using (public.in_grp(auth.uid(), id) or public.is_sensei(auth.uid()));
drop policy if exists groups_sensei on public.groups;
create policy groups_sensei on public.groups for update to authenticated using (public.is_sensei(auth.uid())) with check (public.is_sensei(auth.uid()));

drop policy if exists gpeople_read on public.group_people;
create policy gpeople_read on public.group_people for select to authenticated using (user_id = auth.uid() or public.is_sensei(auth.uid()));

drop policy if exists ginv_sensei on public.group_invites;
create policy ginv_sensei on public.group_invites for select to authenticated using (public.is_sensei(auth.uid()));

-- What a member can see: history setting counts from when they joined
create or replace function public.grp_visible_from(uid uuid, gid uuid) returns timestamptz
language plpgsql stable security definer set search_path = public as $$
declare
  joined timestamptz; h text; t timestamptz;
begin
  if public.is_sensei(uid) then return '-infinity'; end if;
  select history into h from public.groups where id = gid;
  if coalesce(h, 'all') = 'all' then return '-infinity'; end if;
  select added_at into joined from public.group_people where group_id = gid and user_id = uid;
  if joined is null then return 'infinity'; end if;
  if h = 'none' then return joined; end if;
  if h = '14d' then return joined - interval '14 days'; end if;
  select created_at into t from public.group_messages where group_id = gid and created_at < joined order by created_at desc offset 99 limit 1;
  return coalesce(t, '-infinity');
end $$;

-- Reading and sending: the community group as before, your own groups by membership
drop policy if exists gm_read on public.group_messages;
create policy gm_read on public.group_messages for select to authenticated using (
  case when group_id is null
    then (select public.in_group(auth.uid())) and created_at >= (select public.group_visible_from(auth.uid()))
    else public.in_grp(auth.uid(), group_id) and created_at >= public.grp_visible_from(auth.uid(), group_id)
  end);
drop policy if exists gm_send on public.group_messages;
create policy gm_send on public.group_messages for insert to authenticated with check (
  sender_id = auth.uid() and deleted_at is null
  and case when group_id is null then
        public.in_group(auth.uid())
        and (public.is_team(auth.uid()) or not (select announce_only from public.group_settings where id = 1))
        and not exists (select 1 from public.group_mutes m where m.user_id = auth.uid() and m.until > now())
      else
        public.in_grp(auth.uid(), group_id)
        and (public.is_sensei(auth.uid()) or not (select announce_only from public.groups g where g.id = group_id))
        and not exists (select 1 from public.group_people p where p.group_id = group_messages.group_id and p.user_id = auth.uid() and p.muted_until > now())
      end);

-- Reactions follow what you can see
drop policy if exists gr_read on public.group_reactions;
create policy gr_read on public.group_reactions for select to authenticated
  using (exists (select 1 from public.group_messages m where m.id = message_id));
drop policy if exists gr_add on public.group_reactions;
create policy gr_add on public.group_reactions for insert to authenticated
  with check (user_id = auth.uid() and exists (select 1 from public.group_messages m where m.id = message_id));

-- The community group's own counts leave out messages of other groups
create or replace function public.group_unread() returns int
language sql stable security definer set search_path = public as $$
  select case when not public.in_group(auth.uid()) then 0 else (
    select count(*)::int from public.group_messages m
    where m.group_id is null and m.sender_id <> auth.uid() and m.deleted_at is null and m.kind <> 'join'
      and m.created_at > coalesce((select last_read_at from public.group_reads where user_id = auth.uid()), now() - interval '7 days')
  ) end
$$;

create or replace function public.mark_group_read() returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.in_group(auth.uid()) then return; end if;
  insert into public.group_reads (user_id, last_read_at) values (auth.uid(), now())
  on conflict (user_id) do update set last_read_at = now();
  update public.group_messages set seen_at = now()
  where group_id is null and seen_at is null and sender_id <> auth.uid() and deleted_at is null
    and created_at <= now() and created_at > now() - interval '2 days';
end $$;

-- "Last 100 messages" history counts community-group messages only
create or replace function public.group_visible_from(uid uuid) returns timestamptz
language plpgsql stable security definer set search_path = public as $$
declare
  joined timestamptz; h text; t timestamptz;
begin
  if public.is_team(uid) then return '-infinity'; end if;
  select history into h from public.group_settings where id = 1;
  if coalesce(h, 'all') = 'all' then return '-infinity'; end if;
  select coalesce(
           (select e.created_at from public.enrolments e join auth.users u on lower(u.email) = lower(e.email) where u.id = uid),
           (select created_at from public.profiles where id = uid))
    into joined;
  if joined is null then return '-infinity'; end if;
  if h = 'none' then return joined; end if;
  if h = '14d' then return joined - interval '14 days'; end if;
  select created_at into t from public.group_messages where group_id is null and created_at < joined order by created_at desc offset 99 limit 1;
  return coalesce(t, '-infinity');
end $$;

-- Deleting: your own (time limits as before); in your own groups the Grand Sensei can remove any
create or replace function public.delete_group_message(mid uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  p text; sent timestamptz; seen timestamptz; who uuid; gid uuid; boss boolean;
begin
  select media_path, created_at, seen_at, sender_id, group_id into p, sent, seen, who, gid
  from public.group_messages where id = mid and deleted_at is null;
  if not found then raise exception 'not_your_message'; end if;
  boss := case when gid is null then public.is_team(auth.uid()) else public.is_sensei(auth.uid()) end;
  if who <> auth.uid() and not boss then raise exception 'not_your_message'; end if;
  if not boss and ((seen is null and now() > sent + interval '24 hours') or (seen is not null and now() > seen + interval '1 hour')) then
    raise exception 'too_late';
  end if;
  update public.group_messages
  set deleted_at = now(), body = '', media_path = null, file_size = null, duration = null, thumb = null
  where id = mid;
  delete from public.group_reactions where message_id = mid;
  return p;
end $$;
grant execute on function public.delete_group_message(uuid) to authenticated;

-- Replies and @mentions notify people in the same group
create or replace function public.notify_group_message() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  who text; txt text; replied uuid;
begin
  if new.kind = 'join' then return new; end if;
  select name into who from public.profiles where id = new.sender_id;
  txt := left(case new.kind when 'voice' then 'Voice message'
                            when 'image' then coalesce(nullif(new.body, ''), 'Photo')
                            when 'video' then coalesce(nullif(new.body, ''), 'Video')
                            when 'file'  then coalesce(nullif(new.body, ''), new.file_name, 'Document')
                            else new.body end, 140);
  if new.reply_to is not null then
    select sender_id into replied from public.group_messages where id = new.reply_to;
    if replied is not null and replied <> new.sender_id then
      insert into public.notifications (user_id, kind, actor_id, snippet)
      values (replied, 'group_reply', new.sender_id, coalesce(who, 'Someone') || ': ' || txt);
    end if;
  end if;
  insert into public.notifications (user_id, kind, actor_id, snippet)
  select distinct p.id, 'group_mention', new.sender_id, coalesce(who, 'Someone') || ': ' || txt
  from regexp_matches(coalesce(new.body, ''), '@([A-Za-z0-9_]{2,30})', 'g') as m(h)
  join public.profiles p on lower(p.handle) = lower(m.h[1])
  where p.id <> new.sender_id and p.id is distinct from replied
    and case when new.group_id is null then public.in_group(p.id) else public.in_grp(p.id, new.group_id) end;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- Your own groups: create, details, inbox, reading
-- ---------------------------------------------------------------------
create or replace function public.create_group(gname text, photo text) returns uuid
language plpgsql security definer set search_path = public as $$
declare gid uuid;
begin
  if not public.is_sensei(auth.uid()) then raise exception 'sensei_only'; end if;
  insert into public.groups (name, photo_url, created_by) values (left(btrim(gname), 60), photo, auth.uid()) returning id into gid;
  insert into public.group_people (group_id, user_id, last_read_at) values (gid, auth.uid(), now());
  return gid;
end $$;
grant execute on function public.create_group(text, text) to authenticated;

create or replace function public.delete_group(gid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_sensei(auth.uid()) then raise exception 'sensei_only'; end if;
  delete from public.groups where id = gid;
end $$;
grant execute on function public.delete_group(uuid) to authenticated;

drop function if exists public.grp_info(uuid);
create function public.grp_info(gid uuid)
returns table (members int, announce_only boolean, pinned_id uuid, muted_until timestamptz, history text, name text, photo_url text)
language sql stable security definer set search_path = public as $$
  select (select count(*)::int from public.group_people p where p.group_id = g.id),
         g.announce_only, g.pinned_id,
         (select muted_until from public.group_people where group_id = g.id and user_id = auth.uid() and muted_until > now()),
         g.history, g.name, g.photo_url
  from public.groups g where g.id = gid and (public.in_grp(auth.uid(), gid) or public.is_sensei(auth.uid()))
$$;
grant execute on function public.grp_info(uuid) to authenticated;

-- My groups for the inbox: last message and unread count
drop function if exists public.my_groups();
create function public.my_groups()
returns table (id uuid, name text, photo_url text, last_body text, last_kind text, last_file text, last_deleted boolean, last_sender text, last_at timestamptz, unread int, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select g.id, g.name, g.photo_url, l.body, l.kind, l.file_name, l.deleted_at is not null, l.sender_name, l.created_at,
         (select count(*)::int from public.group_messages m
          where m.group_id = g.id and m.sender_id <> auth.uid() and m.deleted_at is null and m.kind <> 'join'
            and m.created_at >= public.grp_visible_from(auth.uid(), g.id)
            and m.created_at > coalesce(gp.last_read_at, gp.added_at)),
         g.created_at
  from public.group_people gp
  join public.groups g on g.id = gp.group_id
  left join lateral (
    select m.body, m.kind, m.file_name, m.deleted_at, m.created_at, pr.name as sender_name
    from public.group_messages m join public.profiles pr on pr.id = m.sender_id
    where m.group_id = g.id and m.created_at >= public.grp_visible_from(auth.uid(), g.id)
    order by m.created_at desc limit 1
  ) l on true
  where gp.user_id = auth.uid() and public.in_grp(auth.uid(), g.id)
  order by coalesce(l.created_at, g.created_at) desc
$$;
grant execute on function public.my_groups() to authenticated;

create or replace function public.grp_mark_read(gid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.in_grp(auth.uid(), gid) then return; end if;
  update public.group_people set last_read_at = now() where group_id = gid and user_id = auth.uid();
  update public.group_messages set seen_at = now()
  where group_id = gid and seen_at is null and sender_id <> auth.uid() and deleted_at is null
    and created_at <= now() and created_at > now() - interval '2 days';
end $$;
grant execute on function public.grp_mark_read(uuid) to authenticated;

drop function if exists public.grp_readers(uuid);
create function public.grp_readers(gid uuid)
returns table (user_id uuid, name text, avatar_url text, last_read_at timestamptz)
language sql stable security definer set search_path = public as $$
  select gp.user_id, p.name, p.avatar_url, gp.last_read_at
  from public.group_people gp join public.profiles p on p.id = gp.user_id
  where gp.group_id = gid and gp.last_read_at is not null and public.in_grp(auth.uid(), gid)
$$;
grant execute on function public.grp_readers(uuid) to authenticated;

create or replace function public.grp_members(gid uuid) returns setof public.profiles
language sql stable security definer set search_path = public as $$
  select p.* from public.group_people gp join public.profiles p on p.id = gp.user_id
  where gp.group_id = gid and p.banned_at is null
    and (public.in_grp(auth.uid(), gid) or public.is_sensei(auth.uid()))
  order by p.name
$$;
grant execute on function public.grp_members(uuid) to authenticated;

-- Grand Sensei: add people, take them out, mute
create or replace function public.grp_add(gid uuid, uids uuid[]) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.is_sensei(auth.uid()) then raise exception 'sensei_only'; end if;
  with added as (
    insert into public.group_people (group_id, user_id)
    select gid, u from unnest(uids) as u
    join public.profiles p on p.id = u and p.banned_at is null
    on conflict do nothing
    returning user_id
  )
  insert into public.group_messages (group_id, sender_id, kind, body)
  select gid, user_id, 'join', '' from added;
  get diagnostics n = row_count;
  return n;
end $$;
grant execute on function public.grp_add(uuid, uuid[]) to authenticated;

create or replace function public.grp_remove(gid uuid, uid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if uid <> auth.uid() and not public.is_sensei(auth.uid()) then raise exception 'sensei_only'; end if;
  if public.is_sensei(uid) then raise exception 'cant_remove_team'; end if;
  delete from public.group_people where group_id = gid and user_id = uid;
end $$;
grant execute on function public.grp_remove(uuid, uuid) to authenticated;

create or replace function public.grp_mute(gid uuid, uid uuid, hours int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_sensei(auth.uid()) then raise exception 'sensei_only'; end if;
  update public.group_people set muted_until = case when hours > 0 then now() + make_interval(hours => hours) end
  where group_id = gid and user_id = uid;
end $$;
grant execute on function public.grp_mute(uuid, uuid, int) to authenticated;

-- ---------------------------------------------------------------------
-- Invite links (3 days) with a message
-- ---------------------------------------------------------------------
create or replace function public.create_group_invite(gid uuid, msg text) returns text
language plpgsql security definer set search_path = public as $$
declare t text;
begin
  if not public.is_sensei(auth.uid()) then raise exception 'sensei_only'; end if;
  t := left(replace(gen_random_uuid()::text, '-', ''), 20);
  insert into public.group_invites (token, group_id, message, expires_at, created_by)
  values (t, gid, left(coalesce(msg, ''), 600), now() + interval '3 days', auth.uid());
  return t;
end $$;
grant execute on function public.create_group_invite(uuid, text) to authenticated;

-- What the join page shows (anyone with the link, signed in or not)
drop function if exists public.group_invite(text);
create function public.group_invite(t text)
returns table (group_id uuid, name text, photo_url text, message text, expires_at timestamptz, members int, sender text, expired boolean, joined boolean)
language sql stable security definer set search_path = public as $$
  select g.id, g.name, g.photo_url, i.message, i.expires_at,
         (select count(*)::int from public.group_people p where p.group_id = g.id),
         (select name from public.profiles where id = i.created_by),
         i.expires_at < now(),
         auth.uid() is not null and public.in_grp(auth.uid(), g.id)
  from public.group_invites i join public.groups g on g.id = i.group_id
  where i.token = t
$$;
grant execute on function public.group_invite(text) to anon, authenticated;

create or replace function public.join_group_invite(t text) returns uuid
language plpgsql security definer set search_path = public as $$
declare gid uuid; ok boolean;
begin
  select group_id, expires_at > now() into gid, ok from public.group_invites where token = t;
  if gid is null then raise exception 'invite_not_found'; end if;
  if public.in_grp(auth.uid(), gid) then return gid; end if;
  if not ok then raise exception 'invite_expired'; end if;
  if not exists (select 1 from public.profiles where id = auth.uid() and (is_student or is_sensei or is_moderator) and banned_at is null) then
    raise exception 'members_only';
  end if;
  insert into public.group_people (group_id, user_id) values (gid, auth.uid()) on conflict do nothing;
  insert into public.group_messages (group_id, sender_id, kind, body) values (gid, auth.uid(), 'join', '');
  return gid;
end $$;
grant execute on function public.join_group_invite(text) to authenticated;

-- Live updates for group details
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'groups') then
    alter publication supabase_realtime add table public.groups;
  end if;
end $$;
