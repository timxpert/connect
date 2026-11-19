-- Likes and comments on your post: a notification for the person who posted.
-- One notification per person per post for likes (an unlike removes it).
-- Safe to run more than once.

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'community_post', 'connection_request', 'connection_accepted',
  'assignment_submitted', 'assignment_approved', 'assignment_changes',
  'group_reply', 'group_mention',
  'phase_request', 'phase_approved', 'phase_declined',
  'challenge_new', 'challenge_pick',
  'post_like', 'post_comment'));
alter table public.notifications add column if not exists snippet text;

create or replace function public.notify_like() returns trigger
language plpgsql security definer set search_path = public as $$
declare owner uuid;
begin
  select author_id into owner from public.posts where id = coalesce(new.post_id, old.post_id);
  if owner is null then return coalesce(new, old); end if;
  if tg_op = 'INSERT' then
    if owner <> new.user_id and not exists (
      select 1 from public.notifications where user_id = owner and kind = 'post_like' and actor_id = new.user_id and post_id = new.post_id
    ) then
      insert into public.notifications (user_id, kind, actor_id, post_id) values (owner, 'post_like', new.user_id, new.post_id);
    end if;
    return new;
  end if;
  delete from public.notifications where user_id = owner and kind = 'post_like' and actor_id = old.user_id and post_id = old.post_id and read_at is null;
  return old;
end $$;
drop trigger if exists likes_notify on public.likes;
create trigger likes_notify after insert or delete on public.likes
  for each row execute function public.notify_like();

create or replace function public.notify_comment() returns trigger
language plpgsql security definer set search_path = public as $$
declare owner uuid;
begin
  select author_id into owner from public.posts where id = new.post_id;
  if owner is not null and owner <> new.author_id then
    insert into public.notifications (user_id, kind, actor_id, post_id, snippet)
    values (owner, 'post_comment', new.author_id, new.post_id, left(new.body, 140));
  end if;
  return new;
end $$;
drop trigger if exists comments_notify on public.comments;
create trigger comments_notify after insert on public.comments
  for each row execute function public.notify_comment();
