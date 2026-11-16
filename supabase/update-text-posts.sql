-- =====================================================================
-- Motion Dojo Connect update: text posts, image or video optional.
-- For a database set up before this change. Run once in
-- Supabase -> SQL Editor (role: postgres). Safe to run again.
-- =====================================================================

alter table public.posts alter column media_url drop not null;
alter table public.posts drop constraint if exists posts_kind_check;
alter table public.posts add constraint posts_kind_check check (kind in ('image', 'video', 'text'));
alter table public.posts drop constraint if exists posts_has_content;
alter table public.posts add constraint posts_has_content
  check ((kind = 'text' and char_length(btrim(caption)) > 0) or (kind <> 'text' and media_url is not null));
