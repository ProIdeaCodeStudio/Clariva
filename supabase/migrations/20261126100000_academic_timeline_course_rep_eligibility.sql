-- Clariva post-release corrections: academic timeline, course-rep eligibility and resource access.
-- This migration intentionally keeps course representatives as student accounts.
alter table public.students
  add column if not exists academic_level_started_month smallint,
  add column if not exists academic_level_started_year smallint,
  add column if not exists expected_level_completion_month smallint,
  add column if not exists expected_level_completion_year smallint;

alter table public.students
  drop constraint if exists students_academic_level_start_month_check,
  drop constraint if exists students_academic_level_start_year_check,
  drop constraint if exists students_expected_level_completion_month_check,
  drop constraint if exists students_expected_level_completion_year_check,
  drop constraint if exists students_academic_timeline_order_check;

alter table public.students
  add constraint students_academic_level_start_month_check
    check (academic_level_started_month is null or academic_level_started_month between 1 and 12),
  add constraint students_academic_level_start_year_check
    check (academic_level_started_year is null or academic_level_started_year between 2000 and 2200),
  add constraint students_expected_level_completion_month_check
    check (expected_level_completion_month is null or expected_level_completion_month between 1 and 12),
  add constraint students_expected_level_completion_year_check
    check (expected_level_completion_year is null or expected_level_completion_year between 2000 and 2200),
  add constraint students_academic_timeline_order_check
    check (
      academic_level_started_month is null or academic_level_started_year is null
      or expected_level_completion_month is null or expected_level_completion_year is null
      or row(academic_level_started_year, academic_level_started_month)
         <= row(expected_level_completion_year, expected_level_completion_month)
    );

drop function if exists public.confirm_academic_level(text);

create or replace function public.confirm_academic_level(
  p_level text,
  p_start_month smallint,
  p_start_year smallint,
  p_expected_completion_month smallint,
  p_expected_completion_year smallint
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $function$
declare
  confirmed_at timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if public.password_reset_enforcement_enabled()
     and exists (
       select 1 from public.students s
       where s.user_id = (select auth.uid())
         and s.password_reset_required is true
     ) then
    raise exception 'Complete your required password reset before confirming your academic profile.' using errcode = '42501';
  end if;
  if p_level is null or p_level not in ('100', '200', '300', '400', '500') then
    raise exception 'Select a valid academic level.' using errcode = '22023';
  end if;
  if p_start_month is null or p_expected_completion_month is null
     or p_start_year is null or p_expected_completion_year is null
     or p_start_month not between 1 and 12 or p_expected_completion_month not between 1 and 12
     or p_start_year not between 2000 and 2200 or p_expected_completion_year not between 2000 and 2200 then
    raise exception 'Enter valid start and expected completion month/year values.' using errcode = '22023';
  end if;
  if row(p_start_year, p_start_month) > row(p_expected_completion_year, p_expected_completion_month) then
    raise exception 'Expected completion cannot be earlier than the level start date.' using errcode = '22023';
  end if;

  update public.students s
     set "Level" = p_level
   where s.user_id = (select auth.uid())
     and lower(coalesce(s."Role", '')) = 'student'
     and s.academic_level_confirmed_at is null;

  if not found then
    if exists (select 1 from public.students s where s.user_id = (select auth.uid()) and s.academic_level_confirmed_at is not null) then
      raise exception 'Academic level has already been confirmed.' using errcode = '23505';
    end if;
    raise exception 'The academic profile could not be confirmed.' using errcode = '22023';
  end if;

  -- Save timeline fields after the level-change trigger has reset stale data.
  update public.students s
     set academic_level_started_month = p_start_month,
         academic_level_started_year = p_start_year,
         expected_level_completion_month = p_expected_completion_month,
         expected_level_completion_year = p_expected_completion_year,
         academic_level_confirmed_at = pg_catalog.now()
   where s.user_id = (select auth.uid())
     and lower(coalesce(s."Role", '')) = 'student'
  returning s.academic_level_confirmed_at into confirmed_at;
  return confirmed_at;
end;
$function$;

revoke all on function public.confirm_academic_level(text, smallint, smallint, smallint, smallint) from public, anon;
grant execute on function public.confirm_academic_level(text, smallint, smallint, smallint, smallint) to authenticated;

-- Candidate discovery includes all student accounts, including unverified accounts
-- and students who have not yet completed academic-level confirmation.
create or replace function public.admin_list_course_rep_candidates(p_search text default null)
returns table (user_id uuid, display_name text, academic_level text)
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
  select s.user_id, coalesce(nullif(s."Name", ''), 'Student')::text, s."Level"::text
  from public.students s
  where s.user_id is not null
    and lower(coalesce(s."Role", '')) = 'student'
    and s."Level" in ('100', '200', '300', '400', '500')
    and (nullif(btrim(coalesce(p_search, '')), '') is null or s."Name" ilike '%' || btrim(p_search) || '%')
  order by s."Name" nulls last
  limit 500;
end;
$function$;

drop policy if exists "Verified admins and owners insert course rep appointments" on public.course_rep_appointments;
create policy "Verified admins and owners insert course rep appointments"
on public.course_rep_appointments for insert to authenticated
with check (
  private.is_clariva_admin_or_owner()
  and appointed_by = (select auth.uid())
  and exists (
    select 1 from public.students s
    where s.user_id = student_user_id
      and lower(coalesce(s."Role", '')) = 'student'
      and s."Level" = scope_level::text
  )
);

drop policy if exists "Verified admins and owners update course rep appointments" on public.course_rep_appointments;
create policy "Verified admins and owners update course rep appointments"
on public.course_rep_appointments for update to authenticated
using (private.is_clariva_admin_or_owner())
with check (
  private.is_clariva_admin_or_owner()
  and exists (
    select 1 from public.students s
    where s.user_id = student_user_id
      and lower(coalesce(s."Role", '')) = 'student'
      and s."Level" = scope_level::text
  )
);

create or replace function private.has_active_course_rep_permission(
  p_level smallint, p_department text, p_course_code text, p_permission text
)
returns boolean
language sql stable security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.course_rep_appointments a
    join public.students s on s.user_id = a.student_user_id
    where a.student_user_id = (select auth.uid())
      and a.revoked_at is null
      and pg_catalog.make_date(a.start_year, a.start_month, 1) <= (pg_catalog.now() at time zone 'Africa/Lagos')::date
      and (pg_catalog.now() at time zone 'Africa/Lagos')::date < (pg_catalog.make_date(a.end_year, a.end_month, 1) + interval '1 month')::date
      and a.scope_level = p_level
      and lower(btrim(a.scope_department)) = lower(btrim(coalesce(p_department, '')))
      and (a.scope_course_code is null or lower(btrim(a.scope_course_code)) = lower(btrim(coalesce(p_course_code, ''))))
      and p_permission = any(a.permissions)
      and lower(coalesce(s."Role", '')) = 'student'
      and s."Level" = a.scope_level::text
  );
$function$;

create or replace function public.is_active_course_rep()
returns boolean
language sql stable security definer
set search_path = ''
as $function$
  select exists (
    select 1 from public.course_rep_appointments a
    join public.students s on s.user_id = a.student_user_id
    where a.student_user_id = (select auth.uid())
      and a.revoked_at is null
      and cardinality(a.permissions) > 0
      and pg_catalog.make_date(a.start_year, a.start_month, 1) <= (pg_catalog.now() at time zone 'Africa/Lagos')::date
      and (pg_catalog.now() at time zone 'Africa/Lagos')::date < (pg_catalog.make_date(a.end_year, a.end_month, 1) + interval '1 month')::date
      and lower(coalesce(s."Role", '')) = 'student'
      and s."Level" = a.scope_level::text
  );
$function$;

create or replace function public.get_active_course_rep_permissions()
returns text[]
language sql stable security definer
set search_path = ''
as $function$
  select coalesce(array(
    select distinct unnest(a.permissions)
    from public.course_rep_appointments a
    join public.students s on s.user_id = a.student_user_id
    where a.student_user_id = (select auth.uid())
      and a.revoked_at is null
      and pg_catalog.make_date(a.start_year, a.start_month, 1) <= (pg_catalog.now() at time zone 'Africa/Lagos')::date
      and (pg_catalog.now() at time zone 'Africa/Lagos')::date < (pg_catalog.make_date(a.end_year, a.end_month, 1) + interval '1 month')::date
      and lower(coalesce(s."Role", '')) = 'student'
      and s."Level" = a.scope_level::text
  ), '{}'::text[]);
$function$;

-- Course-rep access is appointment-based; verification and academic confirmation
-- are not prerequisites. Ordinary student library access retains both checks.
drop policy if exists "Verified confirmed students and scoped course reps read resources" on public."Resources";
create policy "Verified confirmed students and scoped course reps read resources"
on public."Resources" for select to authenticated
using (
  exists (
    select 1 from public.students s
    where s.user_id = (select auth.uid())
      and (
        (lower(coalesce(s."Role", '')) in ('admin', 'owner') and s."Verified" is true)
        or (
          lower(coalesce(s."Role", '')) = 'student'
          and (
            (
              s."Verified" is true
              and s.academic_level_confirmed_at is not null
              and s."Level" ~ '^[0-9]+$'
              and public."Resources".visibility is true
              and public."Resources".level <= s."Level"::smallint
            )
            or private.has_active_course_rep_permission(public."Resources".level, public."Resources".department, public."Resources".course_code, 'resource_upload')
            or private.has_active_course_rep_permission(public."Resources".level, public."Resources".department, public."Resources".course_code, 'resource_update')
          )
        )
      )
  )
);

drop policy if exists "Scoped course reps can upload resources in appointed level" on storage.objects;
create policy "Scoped course reps can upload resources in appointed level"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'clariva-resources'
  and name ~ '^resources/(100|200|300|400|500)/'
  and exists (
    select 1 from public.course_rep_appointments a
    join public.students s on s.user_id = a.student_user_id
    where a.student_user_id = (select auth.uid())
      and a.revoked_at is null
      and a.scope_level = split_part(storage.objects.name, '/', 2)::smallint
      and a.permissions @> array['resource_upload']::text[]
      and pg_catalog.make_date(a.start_year, a.start_month, 1) <= (pg_catalog.now() at time zone 'Africa/Lagos')::date
      and (pg_catalog.now() at time zone 'Africa/Lagos')::date < (pg_catalog.make_date(a.end_year, a.end_month, 1) + interval '1 month')::date
      and lower(coalesce(s."Role", '')) = 'student'
      and s."Level" = a.scope_level::text
  )
);

revoke all on function private.has_active_course_rep_permission(smallint, text, text, text) from public, anon;
grant execute on function private.has_active_course_rep_permission(smallint, text, text, text) to authenticated, service_role;
revoke all on function public.is_active_course_rep() from public, anon;
grant execute on function public.is_active_course_rep() to authenticated;
revoke all on function public.get_active_course_rep_permissions() from public, anon;
grant execute on function public.get_active_course_rep_permissions() to authenticated;


-- Ensure both existing and newly registered students complete the first-time
-- academic timeline collection, even if their level was auto-confirmed at signup.
create or replace function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  profile_name text;
  profile_phone text;
  profile_level text;
begin
  profile_name := nullif(pg_catalog.btrim(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', '')), '');
  profile_phone := nullif(pg_catalog.btrim(coalesce(new.raw_user_meta_data ->> 'phone', '')), '');
  profile_level := case
    when new.raw_user_meta_data ->> 'level' in ('100', '200') then new.raw_user_meta_data ->> 'level'
    else null
  end;
  insert into public.students (
    user_id, "Name", "E-mail", "Phone No.", "Level", "Role", "Verified",
    academic_level_confirmed_at
  )
  values (new.id, profile_name, new.email, profile_phone, profile_level, 'student',
          new.email_confirmed_at is not null, null)
  on conflict (user_id) do nothing;
  return new;
end;
$function$;

update public.students
   set academic_level_confirmed_at = null
 where lower(coalesce("Role", '')) = 'student'
   and academic_level_confirmed_at is not null
   and (
     academic_level_started_month is null
     or academic_level_started_year is null
     or expected_level_completion_month is null
     or expected_level_completion_year is null
   );

alter table public.students
  drop constraint if exists students_confirmed_requires_academic_timeline_check;
alter table public.students
  add constraint students_confirmed_requires_academic_timeline_check
  check (
    academic_level_confirmed_at is null
    or (
      academic_level_started_month is not null
      and academic_level_started_year is not null
      and expected_level_completion_month is not null
      and expected_level_completion_year is not null
    )
  );

create or replace function private.reset_academic_level_confirmation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new."Level" is distinct from old."Level" then
    new.academic_level_confirmed_at := null;
    new.academic_level_started_month := null;
    new.academic_level_started_year := null;
    new.expected_level_completion_month := null;
    new.expected_level_completion_year := null;
    update public.course_rep_appointments
       set revoked_at = pg_catalog.now(),
           revoked_by = (select auth.uid()),
           revoke_reason = 'Academic level changed; a new appointment is required.'
     where student_user_id = new.user_id and revoked_at is null;
  end if;
  return new;
end;
$function$;

create or replace function public.course_rep_list_resources()
returns setof public."Resources"
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if public.password_reset_enforcement_enabled()
     and exists (
       select 1 from public.students s
       where s.user_id = (select auth.uid())
         and s.password_reset_required is true
     ) then
    raise exception 'Complete your required password reset before using course-representative permissions.' using errcode = '42501';
  end if;
  if not public.is_active_course_rep() then
    raise exception 'An active course-representative appointment is required.' using errcode = '42501';
  end if;
  return query
  select r.*
  from public."Resources" r
  where exists (
    select 1
    from public.course_rep_appointments a
    join public.students s on s.user_id = a.student_user_id
    where a.student_user_id = (select auth.uid())
      and a.revoked_at is null
      and pg_catalog.make_date(a.start_year, a.start_month, 1) <= (pg_catalog.now() at time zone 'Africa/Lagos')::date
      and (pg_catalog.now() at time zone 'Africa/Lagos')::date < (pg_catalog.make_date(a.end_year, a.end_month, 1) + interval '1 month')::date
      and a.scope_level = r.level
      and s."Level" = a.scope_level::text
      and lower(coalesce(s."Role", '')) = 'student'
      and lower(btrim(a.scope_department)) = lower(btrim(coalesce(r.department, '')))
      and (a.scope_course_code is null or lower(btrim(a.scope_course_code)) = lower(btrim(coalesce(r.course_code, ''))))
      and (a.permissions && array['resource_upload', 'resource_update']::text[])
  );
end;
$function$;

revoke all on function public.course_rep_list_resources() from public, anon;
grant execute on function public.course_rep_list_resources() to authenticated;
