-- Owner-only full account management.
-- Hard removal deletes the student's profile and Auth identity in one transaction;
-- dependent rows with ON DELETE CASCADE are cleaned up by their declared foreign keys.
create or replace function private.owner_set_account_status(
  target_user_id uuid,
  requested_verified boolean
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private, auth
as $$
declare
  target_role text;
begin
  if not exists (
    select 1 from public.students s
    where s.user_id = (select auth.uid())
      and s."Verified" is true
      and lower(coalesce(s."Role", '')) = 'owner'
  ) then
    raise exception 'Owner access required' using errcode = '42501';
  end if;

  if target_user_id is null or target_user_id = (select auth.uid()) then
    raise exception 'You cannot change your own account status' using errcode = '22023';
  end if;
  if requested_verified is null then
    raise exception 'A valid account status is required' using errcode = '22023';
  end if;

  select lower(coalesce(s."Role", '')) into target_role
  from public.students s where s.user_id = target_user_id for update;
  if not found then raise exception 'Account not found' using errcode = 'P0002'; end if;
  if target_role = 'owner' then
    raise exception 'Owner account status is protected' using errcode = '42501';
  end if;

  update public.students set "Verified" = requested_verified where user_id = target_user_id;
end;
$$;

create or replace function private.owner_remove_account(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private, auth
as $$
declare
  target_role text;
begin
  if not exists (
    select 1 from public.students s
    where s.user_id = (select auth.uid())
      and s."Verified" is true
      and lower(coalesce(s."Role", '')) = 'owner'
  ) then
    raise exception 'Owner access required' using errcode = '42501';
  end if;

  if target_user_id is null or target_user_id = (select auth.uid()) then
    raise exception 'You cannot remove your own account' using errcode = '22023';
  end if;

  select lower(coalesce(s."Role", '')) into target_role
  from public.students s where s.user_id = target_user_id for update;
  if not found then raise exception 'Account not found' using errcode = 'P0002'; end if;
  if target_role = 'owner' then
    raise exception 'Owner accounts cannot be removed through this operation' using errcode = '42501';
  end if;

  -- Supabase Storage objects are not automatically deleted with Auth users.
  -- Refuse removal while files remain so the owner can transfer or clean them up safely.
  if exists (
    select 1 from storage.objects o
    where o.owner_id = target_user_id::text or o.owner = target_user_id
  ) then
    raise exception 'This account owns stored files. Transfer or remove those files before deleting the account.'
      using errcode = '23503';
  end if;

  -- SCIM-managed identities require deliberate deprovisioning at the identity provider.
  if exists (select 1 from auth.scim_users su where su.user_id = target_user_id) then
    raise exception 'This account is linked to SCIM. Deprovision it through the identity provider first.'
      using errcode = '23503';
  end if;

  -- Remove the profile first, then the Auth identity. Any dependent-row
  -- constraint failure aborts the whole transaction rather than leaving a partial removal.
  delete from public.students where user_id = target_user_id;
  delete from auth.users where id = target_user_id;
  if not found then
    raise exception 'Authentication account could not be removed' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function private.owner_set_account_status(uuid, boolean) from public, anon;
revoke all on function private.owner_remove_account(uuid) from public, anon;
grant execute on function private.owner_set_account_status(uuid, boolean) to authenticated;
grant execute on function private.owner_remove_account(uuid) to authenticated;

create or replace function public.owner_set_account_status(target_user_id uuid, requested_verified boolean)
returns void
language sql
security invoker
set search_path = pg_catalog, public, private
as $$ select private.owner_set_account_status(target_user_id, requested_verified); $$;

create or replace function public.owner_remove_account(target_user_id uuid)
returns void
language sql
security invoker
set search_path = pg_catalog, public, private
as $$ select private.owner_remove_account(target_user_id); $$;

revoke all on function public.owner_set_account_status(uuid, boolean) from public, anon;
revoke all on function public.owner_remove_account(uuid) from public, anon;
grant execute on function public.owner_set_account_status(uuid, boolean) to authenticated;
grant execute on function public.owner_remove_account(uuid) to authenticated;
