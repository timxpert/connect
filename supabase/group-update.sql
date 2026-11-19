-- Forwarding, group read counts and time limits on "Delete for everyone".
-- Safe to run more than once.

-- 1. Forwarding: a "Forwarded" label on messages sent on from another chat.
alter table public.messages       add column if not exists forwarded boolean not null default false;
alter table public.group_messages add column if not exists forwarded boolean not null default false;

-- 2. Read counts in the group: who has had the group open, and until when.
drop function if exists public.group_readers();
create function public.group_readers()
returns table (user_id uuid, name text, avatar_url text, last_read_at timestamptz)
language sql stable security definer set search_path = public as $$
  select r.user_id, p.name, p.avatar_url, r.last_read_at
  from public.group_reads r
  join public.profiles p on p.id = r.user_id
  where public.in_group(auth.uid())
    and public.in_group(r.user_id)
$$;
grant execute on function public.group_readers() to authenticated;

-- When a group message was first seen by someone other than the sender
alter table public.group_messages add column if not exists seen_at timestamptz;

create or replace function public.mark_group_read() returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.in_group(auth.uid()) then return; end if;
  insert into public.group_reads (user_id, last_read_at) values (auth.uid(), now())
  on conflict (user_id) do update set last_read_at = now();
  update public.group_messages set seen_at = now()
  where seen_at is null and sender_id <> auth.uid() and deleted_at is null
    and created_at <= now() and created_at > now() - interval '2 days';
end $$;
grant execute on function public.mark_group_read() to authenticated;

-- 3. Delete for everyone: within 24 hours of sending while nobody has seen it,
--    and only for 1 hour after it's been seen.
create or replace function public.delete_message(mid uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  p text; sent timestamptz; seen timestamptz;
begin
  select media_path, created_at, read_at into p, sent, seen
  from public.messages where id = mid and sender_id = auth.uid() and deleted_at is null;
  if not found then
    raise exception 'not_your_message';
  end if;
  if (seen is null and now() > sent + interval '24 hours') or (seen is not null and now() > seen + interval '1 hour') then
    raise exception 'too_late';
  end if;
  update public.messages
  set deleted_at = now(), body = '', media_path = null, file_name = null, file_size = null, duration = null
  where id = mid;
  return p;
end $$;
grant execute on function public.delete_message(uuid) to authenticated;

-- In the group the same limits apply to your own messages. The Grand Sensei
-- and moderators can still remove any message at any time.
create or replace function public.delete_group_message(mid uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  p text; sent timestamptz; seen timestamptz; who uuid;
begin
  select media_path, created_at, seen_at, sender_id into p, sent, seen, who from public.group_messages
  where id = mid and deleted_at is null and (sender_id = auth.uid() or public.is_team(auth.uid()));
  if not found then
    raise exception 'not_your_message';
  end if;
  if not public.is_team(auth.uid())
     and ((seen is null and now() > sent + interval '24 hours') or (seen is not null and now() > seen + interval '1 hour')) then
    raise exception 'too_late';
  end if;
  update public.group_messages
  set deleted_at = now(), body = '', media_path = null, file_size = null, duration = null, thumb = null
  where id = mid;
  delete from public.group_reactions where message_id = mid;
  return p;
end $$;
grant execute on function public.delete_group_message(uuid) to authenticated;
