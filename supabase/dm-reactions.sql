-- Reactions on private messages (one per person per message, like the group).
-- Only the two people in the chat can see or add them. Safe to run more than once.
create table if not exists public.message_reactions (
  message_id uuid not null references public.messages (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  emoji      text not null check (char_length(emoji) between 1 and 16),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);
alter table public.message_reactions enable row level security;

create or replace function public.in_message_chat(mid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.messages m join public.conversations c on c.id = m.conversation_id
    where m.id = mid and auth.uid() in (c.user_a, c.user_b))
$$;

drop policy if exists mr_read on public.message_reactions;
create policy mr_read on public.message_reactions for select to authenticated using (public.in_message_chat(message_id));
drop policy if exists mr_add on public.message_reactions;
create policy mr_add on public.message_reactions for insert to authenticated with check (user_id = auth.uid() and public.in_message_chat(message_id));
drop policy if exists mr_change on public.message_reactions;
create policy mr_change on public.message_reactions for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists mr_remove on public.message_reactions;
create policy mr_remove on public.message_reactions for delete to authenticated using (user_id = auth.uid());

-- live updates
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'message_reactions') then
    alter publication supabase_realtime add table public.message_reactions;
  end if;
end $$;
