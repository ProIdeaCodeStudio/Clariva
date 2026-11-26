-- Keep the PostgREST-facing candidate RPC SECURITY INVOKER.
-- Privileged candidate lookup is isolated behind a private helper.

drop function if exists public.admin_list_course_rep_candidates(text);

grant usage on schema private to authenticated;

create or replace function private.admin_list_course_rep_candidates_internal(
  p_search text default null
)
returns table (
  user_id uuid,
  display_name text,
  academic_level text,
  email_address text
)
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if auth.uid() is null or not private.is_clariva_admin_or_owner() then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;

  if public.password_reset_enforcement_enabled()
     and exists (
       select 1 from public.students s
       where s.user_id = (select auth.uid())
         and s.password_reset_required is true
     ) then
    raise exception 'Complete your required password reset before managing course-representative appointments.' using errcode = '42501';
  end if;

  return query
  select
    s.user_id,
    coalesce(nullif(s."Name", ''), 'Student')::text,
    s."Level"::text,
    coalesce(s."E-mail", '')::text
  from public.students s
  where s.user_id is not null
    and lower(coalesce(s."Role", '')) = 'student'
    and s."Level" in ('100', '200', '300', '400', '500')
    and (
      nullif(btrim(coalesce(p_search, '')), '') is null
      or s."Name" ilike '%' || btrim(p_search) || '%'
      or coalesce(s."E-mail", '') ilike '%' || btrim(p_search) || '%'
      or coalesce(s."Phone No.", '') ilike '%' || btrim(p_search) || '%'
    )
  order by s."Name" nulls last
  limit 500;
end;
$function$;

revoke all on function private.admin_list_course_rep_candidates_internal(text) from public, anon;
grant execute on function private.admin_list_course_rep_candidates_internal(text) to authenticated;

create or replace function public.admin_list_course_rep_candidates(
  p_search text default null
)
returns table (
  user_id uuid,
  display_name text,
  academic_level text,
  email_address text
)
language sql
security invoker
set search_path = ''
as $function$
  select *
  from private.admin_list_course_rep_candidates_internal(p_search);
$function$;

revoke all on function public.admin_list_course_rep_candidates(text) from public, anon;
grant execute on function public.admin_list_course_rep_candidates(text) to authenticated;
