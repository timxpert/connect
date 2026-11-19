-- Fix: students couldn't sign in ("messages_content_check").
-- The "joined the community" line has no photo or file, which the old rule
-- didn't allow. Safe to run more than once.
alter table public.messages drop constraint if exists messages_content_check;
alter table public.messages add constraint messages_content_check check (
  char_length(body) <= 4000
  and (deleted_at is not null
       or kind = 'join'
       or (kind = 'text' and char_length(btrim(body)) > 0)
       or (kind not in ('text', 'join') and media_path is not null)));

-- Belt and braces: a problem with the welcome line must never stop a sign-in
create or replace function public.welcome_student() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.is_student and (tg_op = 'INSERT' or not coalesce(old.is_student, false)) then
    begin
      perform public.sensei_chat(new.id, true);
    exception when others then
      raise warning 'welcome_student: %', sqlerrm;
    end;
  end if;
  return new;
end $$;

create or replace function public.announce_join() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.is_student and (tg_op = 'INSERT' or not coalesce(old.is_student, false)) then
    begin
      insert into public.group_messages (sender_id, kind, body) values (new.id, 'join', '');
    exception when others then
      raise warning 'announce_join: %', sqlerrm;
    end;
  end if;
  return new;
end $$;

-- Students who already signed in before this fix get their chat with you now
do $$
declare st record;
begin
  for st in select id from public.profiles where is_student loop
    begin
      perform public.sensei_chat(st.id, false);
    exception when others then null;
    end;
  end loop;
end $$;
