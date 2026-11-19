-- Message info: when a voice note was played (like WhatsApp's blue mic).
-- One row per person per voice note, private chats and groups.
-- Safe to run more than once.
create table if not exists public.voice_plays (
  message_id uuid not null,
  user_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  played_at  timestamptz not null default now(),
  primary key (message_id, user_id)
);
alter table public.voice_plays enable row level security;

-- who can see a message can see who played it
create or replace function public.can_see_message(mid uuid) returns boolean
language sql stable security invoker set search_path = public as $$
  select exists (select 1 from public.messages where id = mid)
      or exists (select 1 from public.group_messages where id = mid)
$$;

drop policy if exists vp_read on public.voice_plays;
create policy vp_read on public.voice_plays for select to authenticated using (public.can_see_message(message_id));
drop policy if exists vp_add on public.voice_plays;
create policy vp_add on public.voice_plays for insert to authenticated with check (user_id = auth.uid() and public.can_see_message(message_id));
