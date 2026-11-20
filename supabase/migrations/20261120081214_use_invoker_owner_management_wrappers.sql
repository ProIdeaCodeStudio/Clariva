-- Exposed RPC wrappers run as SECURITY INVOKER. The private functions
-- perform owner validation and privileged reads/updates after checking auth.uid().
create or replace function public.owner_list_accounts()
returns table (
  user_id uuid, full_name text, email text, role text,
  verified boolean, level text, created_at timestamptz
)
language sql security invoker
set search_path = pg_catalog, public, private
as $$ select * from private.owner_list_accounts(); $$;

create or replace function public.owner_set_account_role(target_user_id uuid, requested_role text)
returns void
language sql security invoker
set search_path = pg_catalog, public, private
as $$ select private.owner_set_account_role(target_user_id, requested_role); $$;

revoke all on function public.owner_list_accounts() from public, anon;
revoke all on function public.owner_set_account_role(uuid, text) from public, anon;
grant execute on function public.owner_list_accounts() to authenticated;
grant execute on function public.owner_set_account_role(uuid, text) to authenticated;