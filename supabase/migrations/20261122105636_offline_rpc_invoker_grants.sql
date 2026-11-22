-- Keep the exposed RPC wrappers SECURITY INVOKER.
-- The private SECURITY DEFINER functions perform the authorization checks themselves.
alter function public.owner_activity_overview() security invoker;

grant usage on schema private to authenticated;
grant execute on function private.owner_activity_overview() to authenticated;
grant execute on function private.save_offline_resource(uuid) to authenticated;
grant execute on function private.remove_offline_resource_save(uuid) to authenticated;

revoke all on function private.owner_activity_overview() from anon, public;
revoke all on function private.save_offline_resource(uuid) from anon, public;
revoke all on function private.remove_offline_resource_save(uuid) from anon, public;

revoke all on function public.owner_activity_overview() from anon, public;
revoke all on function public.save_offline_resource(uuid) from anon, public;
revoke all on function public.remove_offline_resource_save(uuid) from anon, public;

grant execute on function public.owner_activity_overview() to authenticated;
grant execute on function public.save_offline_resource(uuid) to authenticated;
grant execute on function public.remove_offline_resource_save(uuid) to authenticated;
