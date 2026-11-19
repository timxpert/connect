-- Pinned chats: each person can pin up to 5 chats to the top of Messages
-- (the Grand Sensei, any number). chat is a chat id, 'group', or 'g:<group id>'.
-- Safe to run more than once.
create table if not exists public.chat_pins (
  user_id   uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  chat      text not null check (char_length(chat) <= 80),
  pinned_at timestamptz not null default now(),
  primary key (user_id, chat)
);
alter table public.chat_pins enable row level security;
drop policy if exists pins_own on public.chat_pins;
create policy pins_own on public.chat_pins for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create or replace function public.pin_limit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not coalesce((select is_sensei from public.profiles where id = new.user_id), false)
     and (select count(*) from public.chat_pins where user_id = new.user_id) >= 5 then
    raise exception 'pin_limit';
  end if;
  return new;
end $$;
drop trigger if exists chat_pins_limit on public.chat_pins;
create trigger chat_pins_limit before insert on public.chat_pins
  for each row execute function public.pin_limit();
