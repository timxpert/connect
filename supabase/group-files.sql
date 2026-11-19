-- Motion Dojo Connect: documents in the group (PDFs, project files and so on).
-- Run once in the Supabase SQL Editor, after group.sql. Safe to run again.
alter table public.group_messages add column if not exists file_name text check (file_name is null or char_length(file_name) <= 200);
alter table public.group_messages drop constraint if exists group_messages_kind_check;
alter table public.group_messages add constraint group_messages_kind_check check (kind in ('text', 'voice', 'image', 'video', 'file'));

-- The reply/mention alert says "Document" for files
create or replace function public.notify_group_message() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  who text;
  txt text;
  replied uuid;
begin
  select name into who from public.profiles where id = new.sender_id;
  txt := left(case new.kind when 'voice' then 'Voice message'
                            when 'image' then coalesce(nullif(new.body, ''), 'Photo')
                            when 'video' then coalesce(nullif(new.body, ''), 'Video')
                            when 'file'  then coalesce(nullif(new.body, ''), new.file_name, 'Document')
                            else new.body end, 140);
  if new.reply_to is not null then
    select sender_id into replied from public.group_messages where id = new.reply_to;
    if replied is not null and replied <> new.sender_id then
      insert into public.notifications (user_id, kind, actor_id, snippet)
      values (replied, 'group_reply', new.sender_id, coalesce(who, 'Someone') || ': ' || txt);
    end if;
  end if;
  insert into public.notifications (user_id, kind, actor_id, snippet)
  select distinct p.id, 'group_mention', new.sender_id, coalesce(who, 'Someone') || ': ' || txt
  from regexp_matches(coalesce(new.body, ''), '@([A-Za-z0-9_]{2,30})', 'g') as m(h)
  join public.profiles p on lower(p.handle) = lower(m.h[1])
  where p.id <> new.sender_id
    and p.id is distinct from replied
    and public.in_group(p.id);
  return new;
end $$;
