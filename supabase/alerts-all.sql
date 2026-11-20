-- Group notifications: everyone gets every group message by default.
-- (Before, the default was "Important only", so a student's message notified no one.)
-- People can still pick "Important only" or "Off" in the menu → Notifications.
-- Run once in Supabase → SQL Editor.

alter table public.profiles alter column alert_level set default 'all';
update public.profiles set alert_level = 'all' where alert_level = 'important';
