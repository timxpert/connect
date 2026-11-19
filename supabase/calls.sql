-- Calls: a line in the chat for each private call ("Missed voice call",
-- "Video call · 12 min"). The call itself goes phone to phone; nothing else
-- is stored. Safe to run more than once.
alter table public.messages drop constraint if exists messages_kind_check;
alter table public.messages add constraint messages_kind_check
  check (kind in ('text', 'voice', 'image', 'video', 'file', 'join', 'call'));
alter table public.messages drop constraint if exists messages_content_check;
alter table public.messages add constraint messages_content_check check (
  char_length(body) <= 4000
  and (deleted_at is not null
       or kind = 'join'
       or (kind in ('text', 'call') and char_length(btrim(body)) > 0)
       or (kind not in ('text', 'join', 'call') and media_path is not null)));
