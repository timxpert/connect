-- Every student gets a chat with the Grand Sensei, no connection needed.
-- When a student first signs in, the chat opens with a line:
--   Grand Sensei sees "Chioma Favour Oborgu joined the community"
--   the student sees "You joined the community"
-- Existing students get the chat too (without the line). Safe to run more than once.

alter table public.messages drop constraint if exists messages_kind_check;
alter table public.messages add constraint messages_kind_check
  check (kind in ('text', 'voice', 'image', 'video', 'file', 'join'));

-- the Grand Sensei can always message students, and students the Grand Sensei
create or replace function public.can_message(x uuid, y uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select not public.is_blocked_between(x, y)
     and (public.are_connected(x, y)
          or (public.in_group(x) and public.in_group(y))
          or exists (select 1 from public.profiles p where p.id in (x, y) and p.is_sensei))
$$;

-- open (or find) the chat between a student and each Grand Sensei
create or replace function public.sensei_chat(student uuid, announce boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  s record;
  a uuid;
  b uuid;
  cid uuid;
begin
  for s in select id from public.profiles where is_sensei and id <> student loop
    a := least(s.id, student);
    b := greatest(s.id, student);
    select id into cid from public.conversations where user_a = a and user_b = b;
    if cid is null then
      insert into public.conversations (user_a, user_b) values (a, b) returning id into cid;
    end if;
    if announce and not exists (select 1 from public.messages where conversation_id = cid and kind = 'join') then
      insert into public.messages (conversation_id, sender_id, body, kind)
      values (cid, student, 'joined the community', 'join');
    end if;
  end loop;
end $$;

create or replace function public.welcome_student() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.is_student and (tg_op = 'INSERT' or not coalesce(old.is_student, false)) then
    perform public.sensei_chat(new.id, true);
  end if;
  return new;
end $$;
drop trigger if exists welcome_student on public.profiles;
create trigger welcome_student after insert or update of is_student on public.profiles
  for each row execute function public.welcome_student();

-- everyone already here: open the chat quietly
do $$
declare st record;
begin
  for st in select id from public.profiles where is_student loop
    perform public.sensei_chat(st.id, false);
  end loop;
end $$;
