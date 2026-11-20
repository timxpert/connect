-- Pin a post to your profile (one at a time).
-- Run once in Supabase → SQL Editor. Safe to run again.
alter table public.profiles add column if not exists pinned_post_id uuid references public.posts (id) on delete set null;

-- you can only pin your own post
create or replace function public.pin_own_post() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.pinned_post_id is not null
     and new.pinned_post_id is distinct from old.pinned_post_id
     and not exists (select 1 from public.posts where id = new.pinned_post_id and author_id = new.id) then
    raise exception 'not_your_post';
  end if;
  return new;
end $$;
drop trigger if exists profiles_pin_own on public.profiles;
create trigger profiles_pin_own before update of pinned_post_id on public.profiles
  for each row execute function public.pin_own_post();
