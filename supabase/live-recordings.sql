-- Live class recordings
-- After a live class, the team pastes the YouTube (Unlisted) link on the class card.
-- The card turns into "Watch recording", and it can also show on Learn.
-- Run once in Supabase → SQL Editor. Safe to run again.

create table if not exists public.live_recordings (
  message_id uuid primary key references public.group_messages (id) on delete cascade,
  group_id   uuid,
  title      text not null,
  video      text not null check (video ~ '^[A-Za-z0-9_-]{11}$'),
  held_at    timestamptz not null,
  on_learn   boolean not null default true,
  added_by   uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists live_recordings_held on public.live_recordings (held_at desc);
alter table public.live_recordings enable row level security;

-- you see a recording if you can see the class card it came from
drop policy if exists lr_read on public.live_recordings;
create policy lr_read on public.live_recordings for select to authenticated
  using (exists (select 1 from public.group_messages m where m.id = message_id and m.deleted_at is null));

-- adding or changing one goes through this function only
create or replace function public.add_live_recording(mid uuid, video text, on_learn boolean) returns void
language plpgsql security definer set search_path = public as $$
declare r record; b jsonb;
begin
  select group_id, kind, body, deleted_at into r from public.group_messages where id = mid;
  if not found or r.kind <> 'live' or r.deleted_at is not null then raise exception 'not_found'; end if;
  if not (case when r.group_id is null then public.is_team(auth.uid()) else public.is_sensei(auth.uid()) end) then
    raise exception 'team_only';
  end if;
  if video !~ '^[A-Za-z0-9_-]{11}$' then raise exception 'bad_link'; end if;
  b := r.body::jsonb;
  update public.group_messages set body = (b || jsonb_build_object('rec', video))::text where id = mid;
  insert into public.live_recordings (message_id, group_id, title, video, held_at, on_learn, added_by)
  values (mid, r.group_id, left(coalesce(b ->> 't', 'Live class'), 120), video, coalesce((b ->> 'at')::timestamptz, now()), on_learn, auth.uid())
  on conflict (message_id) do update set video = excluded.video, on_learn = excluded.on_learn, title = excluded.title;
end $$;
grant execute on function public.add_live_recording(uuid, text, boolean) to authenticated;
