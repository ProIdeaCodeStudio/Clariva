-- Owner-only account directory including the authoritative Supabase Auth last sign-in.
-- A separate RPC avoids changing the return type of the existing account-list function.
create or replace function private.owner_list_accounts_with_last_login()
returns table (
  user_id uuid,
  full_name text,
  email text,
  role text,
  verified boolean,
  level text,
  created_at timestamptz,
  last_login_at timestamptz
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
         s."Verified", s."Level", s.created_at, au.last_sign_in_at
  from public.students s
  left join auth.users au on au.id = s.user_id
  order by au.last_sign_in_at desc nulls last, s.created_at desc;
end;
$$;

create or replace function public.owner_list_accounts_with_last_login()
returns table (
  user_id uuid,
  full_name text,
  email text,
  role text,
  verified boolean,
  level text,
  created_at timestamptz,
  last_login_at timestamptz
)
language sql
security invoker
set search_path = pg_catalog, public, private
as $$ select * from private.owner_list_accounts_with_last_login(); $$;

revoke all on function private.owner_list_accounts_with_last_login() from public, anon;
grant execute on function private.owner_list_accounts_with_last_login() to authenticated;
revoke all on function public.owner_list_accounts_with_last_login() from public, anon;
grant execute on function public.owner_list_accounts_with_last_login() to authenticated;
