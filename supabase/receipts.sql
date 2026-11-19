-- Message info like WhatsApp: for each group message, when it reached each
-- person's phone and when they first read it. Only the sender (and the
-- person themself) can see these. Safe to run more than once.

create table if not exists public.group_receipts (
  message_id   uuid not null references public.group_messages (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  delivered_at timestamptz not null default now(),
  seen_at      timestamptz,
  primary key (message_id, user_id)
);
create index if not exists group_receipts_user on public.group_receipts (user_id);
alter table public.group_receipts enable row level security;
drop policy if exists grc_read on public.group_receipts;
create policy grc_read on public.group_receipts for select to authenticated using (
  user_id = auth.uid()
  or exists (select 1 from public.group_messages m where m.id = message_id and m.sender_id = auth.uid()));

-- Connect opened: everything from the last week has reached this phone
create or replace function public.mark_group_delivered() returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return; end if;
  insert into public.group_receipts (message_id, user_id)
  select m.id, auth.uid() from public.group_messages m
  where m.created_at > now() - interval '7 days'
    and m.sender_id <> auth.uid() and m.deleted_at is null and m.kind not in ('join', 'pin')
    and case when m.group_id is null
          then public.in_group(auth.uid()) and m.created_at >= public.group_visible_from(auth.uid())
          else public.in_grp(auth.uid(), m.group_id) and m.created_at >= public.grp_visible_from(auth.uid(), m.group_id)
        end
  on conflict do nothing;
end $$;
grant execute on function public.mark_group_delivered() to authenticated;

-- Reading a group also marks each message read (first time only)
create or replace function public.receipts_read(gid uuid) returns void
language sql security definer set search_path = public as $$
  insert into public.group_receipts (message_id, user_id, delivered_at, seen_at)
  select m.id, auth.uid(), now(), now() from public.group_messages m
  where m.group_id is not distinct from gid and m.created_at > now() - interval '7 days'
    and m.created_at <= now() and m.sender_id <> auth.uid() and m.deleted_at is null and m.kind not in ('join', 'pin')
  on conflict (message_id, user_id) do update set seen_at = coalesce(public.group_receipts.seen_at, now())
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
  perform public.receipts_read(null);
end $$;

create or replace function public.grp_mark_read(gid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.in_grp(auth.uid(), gid) then return; end if;
  update public.group_people set last_read_at = now() where group_id = gid and user_id = auth.uid();
  update public.group_messages set seen_at = now()
  where group_id = gid and seen_at is null and sender_id <> auth.uid() and deleted_at is null
    and created_at <= now() and created_at > now() - interval '2 days';
  perform public.receipts_read(gid);
end $$;
