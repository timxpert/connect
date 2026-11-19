-- Team roles: the Grand Sensei can make a student part of the team with a
-- role, e.g. "Community manager". They keep their belt; the role shows next to
-- it, and they get moderator powers. Safe to run more than once.

alter table public.profiles add column if not exists team_role text check (team_role is null or char_length(team_role) between 1 and 40);

-- the role can only be set through set_team_role below
create or replace function public.profiles_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  uemail text;
  trusted boolean := coalesce(current_setting('connect.trusted', true), '') = 'on';
begin
  if tg_op = 'INSERT' then
    select lower(email) into uemail from auth.users where id = new.id;
    new.is_student   := exists (select 1 from public.enrolments where lower(email) = uemail);
    new.is_moderator := false;
    new.is_sensei    := exists (select 1 from public.sensei_emails where lower(email) = uemail);
    if auth.uid() is not null and coalesce(auth.role(), '') <> 'service_role' and not trusted then
      new.phase := null;
      new.phase_request := null;
      new.phase_request_at := null;
      new.phase_declined_at := null;
      new.team_role := null;
    end if;
  elsif auth.uid() is not null
        and coalesce(auth.role(), '') <> 'service_role'
        and not trusted then
    -- A member editing their own profile can't touch these. Only the dashboard,
    -- the service role, or the functions that set connect.trusted can.
    new.is_student        := old.is_student;
    new.is_moderator      := old.is_moderator;
    new.is_sensei         := old.is_sensei;
    new.phase             := old.phase;
    new.phase_request     := old.phase_request;
    new.phase_request_at  := old.phase_request_at;
    new.phase_declined_at := old.phase_declined_at;
    new.team_role         := old.team_role;
  end if;
  if new.is_sensei then
    new.is_student := false;  -- the grand sensei is never listed as a student
  end if;
  if not new.is_student or new.is_sensei then
    new.phase := null;
    new.phase_request := null;
  end if;
  return new;
end $$;

create or replace function public.set_team_role(uid uuid, role text) returns void
language plpgsql security definer set search_path = public as $$
declare r text := nullif(btrim(coalesce(role, '')), '');
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_sensei) then
    raise exception 'sensei_only';
  end if;
  if r is not null and char_length(r) > 40 then
    raise exception 'role_too_long';
  end if;
  perform set_config('connect.trusted', 'on', true);
  update public.profiles set team_role = r, is_moderator = (r is not null) where id = uid and not is_sensei;
end $$;
grant execute on function public.set_team_role(uuid, text) to authenticated;
