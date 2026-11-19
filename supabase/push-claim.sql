-- Phone notifications follow whoever is signed in on that phone.
-- Before: a phone first used by one account (e.g. testing) kept sending that
-- account's notifications, and the next person to sign in on it got none.
-- Run once in Supabase → SQL Editor. Safe to run again.

create or replace function public.claim_push(endpoint text, p256dh text, auth text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  insert into public.push_subscriptions (endpoint, user_id, p256dh, auth)
  values (claim_push.endpoint, auth.uid(), claim_push.p256dh, claim_push.auth)
  on conflict on constraint push_subscriptions_pkey do update
    set user_id = auth.uid(), p256dh = excluded.p256dh, auth = excluded.auth, created_at = now();
end $$;
grant execute on function public.claim_push(text, text, text) to authenticated;
