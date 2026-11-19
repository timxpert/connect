-- Editing messages, and who pinned a group message.
-- 1. Edit your own text messages for as long as you could delete them for
--    everyone: 24 hours while unseen, 1 hour after it's been seen. Shows "Edited".
-- 2. Pinning a group message adds a line "Grand Sensei pinned a message" and
--    the pinned bar says who pinned it.
-- Safe to run more than once.

alter table public.messages add column if not exists edited_at timestamptz;
alter table public.group_messages add column if not exists edited_at timestamptz;

create or replace function public.edit_message(mid uuid, new_body text) returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  select sender_id, kind, deleted_at, created_at, read_at into r from public.messages where id = mid;
  if not found or r.sender_id <> auth.uid() or r.deleted_at is not null then raise exception 'not_your_message'; end if;
  if r.kind = 'text' and char_length(btrim(coalesce(new_body, ''))) = 0 then raise exception 'empty'; end if;
  if (r.read_at is null and now() > r.created_at + interval '24 hours') or (r.read_at is not null and now() > r.read_at + interval '1 hour') then
    raise exception 'too_late';
  end if;
  update public.messages set body = left(new_body, 4000), edited_at = now() where id = mid;
end $$;
grant execute on function public.edit_message(uuid, text) to authenticated;

create or replace function public.edit_group_message(mid uuid, new_body text) returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  select sender_id, kind, deleted_at, created_at, seen_at into r from public.group_messages where id = mid;
  if not found or r.sender_id <> auth.uid() or r.deleted_at is not null or r.kind in ('join', 'pin') then raise exception 'not_your_message'; end if;
  if r.kind = 'text' and char_length(btrim(coalesce(new_body, ''))) = 0 then raise exception 'empty'; end if;
  if (r.seen_at is null and now() > r.created_at + interval '24 hours') or (r.seen_at is not null and now() > r.seen_at + interval '1 hour') then
    raise exception 'too_late';
  end if;
  update public.group_messages set body = left(new_body, 4000), edited_at = now() where id = mid;
end $$;
grant execute on function public.edit_group_message(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- Who pinned it
-- ---------------------------------------------------------------------
alter table public.group_settings add column if not exists pinned_by uuid references public.profiles (id) on delete set null;
alter table public.group_settings add column if not exists pinned_at timestamptz;
alter table public.groups add column if not exists pinned_by uuid references public.profiles (id) on delete set null;
alter table public.groups add column if not exists pinned_at timestamptz;

alter table public.group_messages drop constraint if exists group_messages_kind_check;
alter table public.group_messages add constraint group_messages_kind_check
  check (kind in ('text', 'voice', 'image', 'video', 'file', 'join', 'pin'));
alter table public.group_messages drop constraint if exists group_messages_content;
alter table public.group_messages add constraint group_messages_content check (
  deleted_at is not null
  or kind in ('join', 'pin')
  or (kind = 'text' and char_length(btrim(body)) > 0)
  or (kind not in ('text', 'join', 'pin') and media_path is not null));

-- when a message is pinned: remember who, and add a line in the group
create or replace function public.note_pin() returns trigger
language plpgsql security definer set search_path = public as $$
declare gid uuid;
begin
  if new.pinned_id is distinct from old.pinned_id then
    new.pinned_by := case when new.pinned_id is null then null else auth.uid() end;
    new.pinned_at := case when new.pinned_id is null then null else now() end;
    if new.pinned_id is not null and auth.uid() is not null then
      gid := case when tg_table_name = 'groups' then new.id else null end;
      begin
        insert into public.group_messages (group_id, sender_id, kind, body, reply_to)
        values (gid, auth.uid(), 'pin', '', new.pinned_id);
      exception when others then
        raise warning 'note_pin: %', sqlerrm;
      end;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists note_pin on public.group_settings;
create trigger note_pin before update of pinned_id on public.group_settings
  for each row execute function public.note_pin();
drop trigger if exists note_pin on public.groups;
create trigger note_pin before update of pinned_id on public.groups
  for each row execute function public.note_pin();

-- your own groups: details now include who pinned
drop function if exists public.grp_info(uuid);
create function public.grp_info(gid uuid)
returns table (members int, announce_only boolean, pinned_id uuid, muted_until timestamptz, history text, name text, photo_url text, pinned_by uuid, pinned_at timestamptz)
language sql stable security definer set search_path = public as $$
  select (select count(*)::int from public.group_people p where p.group_id = g.id),
         g.announce_only, g.pinned_id,
         (select muted_until from public.group_people where group_id = g.id and user_id = auth.uid() and muted_until > now()),
         g.history, g.name, g.photo_url, g.pinned_by, g.pinned_at
  from public.groups g where g.id = gid and (public.in_grp(auth.uid(), gid) or public.is_sensei(auth.uid()))
$$;
grant execute on function public.grp_info(uuid) to authenticated;

-- pin lines don't count as unread
create policy gr_add on public.group_reactions for insert to authenticated
  with check (user_id = auth.uid() and exists (select 1 from public.group_messages m where m.id = message_id));

-- The community group's own counts leave out messages of other groups
create or replace function public.group_unread() returns int
language sql stable security definer set search_path = public as $$
  select case when not public.in_group(auth.uid()) then 0 else (
    select count(*)::int from public.group_messages m
    where m.group_id is null and m.sender_id <> auth.uid() and m.deleted_at is null and m.kind not in ('join', 'pin')
      and m.created_at > coalesce((select last_read_at from public.group_reads where user_id = auth.uid()), now() - interval '7 days')
  ) end
$$;

drop function if exists public.my_groups();
create function public.my_groups()
returns table (id uuid, name text, photo_url text, last_body text, last_kind text, last_file text, last_deleted boolean, last_sender text, last_at timestamptz, unread int, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select g.id, g.name, g.photo_url, l.body, l.kind, l.file_name, l.deleted_at is not null, l.sender_name, l.created_at,
         (select count(*)::int from public.group_messages m
          where m.group_id = g.id and m.sender_id <> auth.uid() and m.deleted_at is null and m.kind not in ('join', 'pin')
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
