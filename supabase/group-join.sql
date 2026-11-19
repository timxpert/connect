-- "Ada Okafor joined the group": a line in the group whenever a student joins
-- Motion Dojo (and so the group). Safe to run more than once.

alter table public.group_messages drop constraint if exists group_messages_kind_check;
alter table public.group_messages add constraint group_messages_kind_check
  check (kind in ('text', 'voice', 'image', 'video', 'file', 'join'));

-- the old rule needed text or a file on every message; a join line has neither
do $$
declare c text;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.group_messages'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%media_path IS NOT NULL%'
  loop
    execute format('alter table public.group_messages drop constraint %I', c);
  end loop;
end $$;
alter table public.group_messages add constraint group_messages_content check (
  deleted_at is not null
  or kind = 'join'
  or (kind = 'text' and char_length(btrim(body)) > 0)
  or (kind not in ('text', 'join') and media_path is not null));

create or replace function public.announce_join() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.is_student and (tg_op = 'INSERT' or not coalesce(old.is_student, false)) then
    insert into public.group_messages (sender_id, kind, body) values (new.id, 'join', '');
  end if;
  return new;
end $$;
drop trigger if exists announce_join on public.profiles;
create trigger announce_join after insert or update of is_student on public.profiles
  for each row execute function public.announce_join();

-- join lines don't count as unread messages
create or replace function public.group_unread() returns int
language sql stable security definer set search_path = public as $$
  select case when not public.in_group(auth.uid()) then 0 else (
    select count(*)::int from public.group_messages m
    where m.sender_id <> auth.uid() and m.deleted_at is null and m.kind <> 'join'
      and m.created_at > coalesce((select last_read_at from public.group_reads where user_id = auth.uid()), now() - interval '7 days')
  ) end
$$;
grant execute on function public.group_unread() to authenticated;
