-- Owner-only account directory and role administration.
-- The private schema is not exposed through the Supabase Data API.
create or replace function private.owner_list_accounts()
returns table (
  user_id uuid,
  full_name text,
  email text,
  role text,
  verified boolean,
  level text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public, private, auth
as $$
begin
  if not exists (
    select 1
    from public.students s
    where s.user_id = (select auth.uid())
      and s."Verified" is true
      and lower(coalesce(s."Role", '')) = 'owner'
  ) then
    raise exception 'Owner access required' using errcode = '42501';
  end if;

  return query
  select s.user_id, s."Name", s."E-mail", s."Role",
         s."Verified", s."Level", s.created_at
  from public.students s
  order by s.created_at desc;
end;
$$;

create or replace function private.owner_set_account_role(
  target_user_id uuid,
  requested_role text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private, auth
as $$
declare
  normalized_role text := lower(trim(requested_role));
  target_role text;
begin
  if not exists (
    select 1
    from public.students s
    where s.user_id = (select auth.uid())
      and s."Verified" is true
      and lower(coalesce(s."Role", '')) = 'owner'
  ) then
    raise exception 'Owner access required' using errcode = '42501';
  end if;

  if target_user_id is null or target_user_id = (select auth.uid()) then
    raise exception 'You cannot change your own account role' using errcode = '22023';
  end if;

  if normalized_role not in ('student', 'admin') then
    raise exception 'Only student and admin roles can be assigned here' using errcode = '22023';
  end if;

  select lower(coalesce(s."Role", ''))
    into target_role
  from public.students s
  where s.user_id = target_user_id
  for update;

  if not found then
    raise exception 'Account not found' using errcode = 'P0002';
  end if;

  if target_role = 'owner' then
    raise exception 'Owner accounts cannot be changed through this operation' using errcode = '42501';
  end if;

  update public.students
  set "Role" = normalized_role
  where user_id = target_user_id;
end;
$$;

revoke all on function private.owner_list_accounts() from public, anon;
revoke all on function private.owner_set_account_role(uuid, text) from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.owner_list_accounts() to authenticated;
grant execute on function private.owner_set_account_role(uuid, text) to authenticated;
