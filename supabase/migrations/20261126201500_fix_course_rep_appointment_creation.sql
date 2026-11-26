-- Create course-representative appointments through an authenticated invoker RPC.
-- The exposed wrapper is SECURITY INVOKER; privileged insertion is isolated in
-- the private schema and performs its own authenticated administrator checks.

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.admin_create_course_rep_appointment_internal(
  p_student_user_id uuid,
  p_scope_level smallint,
  p_scope_department text,
  p_scope_course_code text,
  p_start_month smallint,
  p_start_year smallint,
  p_end_month smallint,
  p_end_year smallint,
  p_permissions text[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_appointment_id uuid;
  v_permissions text[] := coalesce(p_permissions, '{}'::text[]);
  v_course_code text := nullif(upper(btrim(coalesce(p_scope_course_code, ''))), '');
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

  if p_student_user_id is null then
    raise exception 'Select a student account.' using errcode = '22023';
  end if;

  if p_scope_level is null or p_scope_level not in (100, 200, 300, 400, 500) then
    raise exception 'Select a valid academic level.' using errcode = '22023';
  end if;

  if length(btrim(coalesce(p_scope_department, ''))) not between 1 and 160 then
    raise exception 'Enter a department within the allowed length.' using errcode = '22023';
  end if;

  if v_course_code is not null and length(v_course_code) > 40 then
    raise exception 'Enter a valid course code or leave the field empty.' using errcode = '22023';
  end if;

  if p_start_month is null or p_end_month is null
     or p_start_year is null or p_end_year is null
     or p_start_month not between 1 and 12
     or p_end_month not between 1 and 12
     or p_start_year not between 2020 and 2200
     or p_end_year not between 2020 and 2200
     or row(p_start_year, p_start_month) > row(p_end_year, p_end_month) then
    raise exception 'Choose a valid appointment term. The end month cannot be earlier than the start month.' using errcode = '22023';
  end if;

  if cardinality(v_permissions) = 0
     or not (v_permissions <@ array['resource_upload', 'resource_update']::text[]) then
    raise exception 'Select at least one valid appointment permission.' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.students s
    where s.user_id = p_student_user_id
      and lower(coalesce(s."Role", '')) = 'student'
      and s."Level" = p_scope_level::text
  ) then
    raise exception 'The selected student account does not match the chosen academic level.' using errcode = '22023';
  end if;

  insert into public.course_rep_appointments (
    student_user_id, scope_level, scope_department, scope_course_code,
    start_month, start_year, end_month, end_year, permissions, appointed_by
  )
  values (
    p_student_user_id, p_scope_level, btrim(p_scope_department), v_course_code,
    p_start_month, p_start_year, p_end_month, p_end_year, v_permissions,
    (select auth.uid())
  )
  returning id into v_appointment_id;

  return v_appointment_id;
end;
$function$;

revoke all on function private.admin_create_course_rep_appointment_internal(uuid, smallint, text, text, smallint, smallint, smallint, smallint, text[]) from public, anon;
grant execute on function private.admin_create_course_rep_appointment_internal(uuid, smallint, text, text, smallint, smallint, smallint, smallint, text[]) to authenticated;

create or replace function public.admin_create_course_rep_appointment(
  p_student_user_id uuid,
  p_scope_level smallint,
  p_scope_department text,
  p_scope_course_code text,
  p_start_month smallint,
  p_start_year smallint,
  p_end_month smallint,
  p_end_year smallint,
  p_permissions text[]
)
returns uuid
language sql
security invoker
set search_path = ''
as $function$
  select private.admin_create_course_rep_appointment_internal(
    p_student_user_id, p_scope_level, p_scope_department, p_scope_course_code,
    p_start_month, p_start_year, p_end_month, p_end_year, p_permissions
  );
$function$;

revoke all on function public.admin_create_course_rep_appointment(uuid, smallint, text, text, smallint, smallint, smallint, smallint, text[]) from public, anon;
grant execute on function public.admin_create_course_rep_appointment(uuid, smallint, text, text, smallint, smallint, smallint, smallint, text[]) to authenticated;
