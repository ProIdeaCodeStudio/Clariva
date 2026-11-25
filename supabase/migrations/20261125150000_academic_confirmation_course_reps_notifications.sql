-- Clariva academic confirmation, scoped course representatives, and notifications.
-- Staged for review; this migration is not applied to the production database here.

-- 1. One-time academic-level confirmation.
alter table public.students
  add column if not exists academic_level_confirmed_at timestamptz;

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
    when new.raw_user_meta_data ->> 'level' in ('100', '200')
      then new.raw_user_meta_data ->> 'level'
    else null
  end;

  insert into public.students (
    user_id, "Name", "E-mail", "Phone No.", "Level", "Role", "Verified",
    academic_level_confirmed_at
  )
  values (
    new.id, profile_name, new.email, profile_phone, profile_level,
    'student', new.email_confirmed_at is not null,
    case when profile_level is not null then pg_catalog.now() else null end
  )
  on conflict (user_id) do nothing;

  return new;
end;
$function$;



create or replace function private.is_clariva_admin_or_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1 from public.students s
    where s.user_id = (select auth.uid())
      and s."Verified" is true
      and coalesce(s.password_reset_required, false) is false
      and lower(coalesce(s."Role", '')) in ('admin', 'owner')
  );
$function$;

revoke all on function private.is_clariva_admin_or_owner() from public, anon;
grant execute on function private.is_clariva_admin_or_owner() to authenticated, service_role;

create or replace function public.confirm_academic_level(p_level text)
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

  if p_level is null or p_level not in ('100', '200', '300', '400', '500') then
    raise exception 'Select a valid academic level.' using errcode = '22023';
  end if;

  update public.students s
     set academic_level_confirmed_at = pg_catalog.now()
   where s.user_id = (select auth.uid())
     and lower(coalesce(s."Role", '')) = 'student'
     and s."Level" = p_level
     and s.academic_level_confirmed_at is null
  returning s.academic_level_confirmed_at into confirmed_at;

  if confirmed_at is null then
    if exists (
      select 1 from public.students s
      where s.user_id = (select auth.uid())
        and s.academic_level_confirmed_at is not null
    ) then
      raise exception 'Academic level has already been confirmed.' using errcode = '23505';
    end if;
    raise exception 'The selected level does not match your registered academic level.' using errcode = '22023';
  end if;

  return confirmed_at;
end;
$function$;

revoke all on function public.confirm_academic_level(text) from public, anon;
grant execute on function public.confirm_academic_level(text) to authenticated;

-- Security-definer resource/offline RPCs must enforce the same confirmation
-- requirement as direct Resource and Storage access.
create or replace function private.record_resource_view(p_resource_id uuid, p_source_page text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  current_user_id uuid := (select auth.uid());
  resource_allowed boolean := false;
begin
  if current_user_id is null
     or p_resource_id is null
     or p_source_page is distinct from 'undergraduates' then
    return false;
  end if;

  select exists (
    select 1
    from public.students s
    join public."Resources" r on r.id = p_resource_id
    where s.user_id = current_user_id
      and s."Verified" is true
      and lower(coalesce(s."Role", '')) in ('student', 'admin', 'owner')
      and r.visibility is true
      and (
        lower(coalesce(s."Role", '')) in ('admin', 'owner')
        or (
          lower(coalesce(s."Role", '')) = 'student'
          and s.academic_level_confirmed_at is not null
          and s."Level" ~ '^[0-9]+$'
          and r.level <= s."Level"::smallint
        )
      )
  ) into resource_allowed;

  if not resource_allowed then
    return false;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(current_user_id::text || p_resource_id::text, 0)
  );

  if exists (
    select 1 from private.resource_views rv
    where rv.user_id = current_user_id
      and rv.resource_id = p_resource_id
      and rv.viewed_at >= now() - interval '30 seconds'
  ) then
    return false;
  end if;

  insert into private.resource_views (resource_id, user_id, source_page)
  values (p_resource_id, current_user_id, p_source_page);

  update public."Resources"
  set view_count = coalesce(view_count, 0) + 1
  where id = p_resource_id;

  return true;
end;
$function$;

create or replace function private.save_offline_resource(p_resource_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  current_user_id uuid := (select auth.uid());
  current_level smallint;
  allowed boolean := false;
begin
  if current_user_id is null or p_resource_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select s."Level"::smallint into current_level
  from public.students s
  where s.user_id = current_user_id
    and s."Verified" is true
    and s.academic_level_confirmed_at is not null
    and lower(coalesce(s."Role", '')) = 'student'
    and s."Level" ~ '^[0-9]+$';

  if current_level is null then
    raise exception 'Academic level confirmation is required before saving resources' using errcode = '42501';
  end if;

  if public.password_reset_enforcement_enabled()
     and exists (
       select 1 from public.students s
       where s.user_id = current_user_id
         and s.password_reset_required is true
     ) then
    raise exception 'Password reset required before saving resources' using errcode = '42501';
  end if;

  select exists (
    select 1 from public."Resources" r
    where r.id = p_resource_id
      and r.visibility is true
      and r.file_url is not null
      and lower(coalesce(r.file_name, '')) like '%.pdf'
      and r.level <= current_level
  ) into allowed;

  if not allowed then
    raise exception 'This resource is not available to your account' using errcode = '42501';
  end if;

  insert into private.offline_resource_saves (user_id, resource_id)
  values (current_user_id, p_resource_id)
  on conflict (user_id, resource_id) do nothing;

  return true;
end;
$function$;

-- 2. Course representatives remain students; authority is appointment-based.
create table if not exists public.course_rep_appointments (
  id uuid primary key default gen_random_uuid(),
  student_user_id uuid not null references auth.users(id) on delete cascade,
  scope_level smallint not null check (scope_level in (100, 200, 300, 400, 500)),
  scope_department text not null,
  scope_course_code text,
  start_month smallint not null check (start_month between 1 and 12),
  start_year smallint not null check (start_year between 2020 and 2200),
  end_month smallint not null check (end_month between 1 and 12),
  end_year smallint not null check (end_year between 2020 and 2200),
  permissions text[] not null default '{}',
  appointed_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id),
  revoke_reason text,
  constraint course_rep_appointment_term_order
    check (row(start_year, start_month) <= row(end_year, end_month)),
  constraint course_rep_appointment_permissions
    check (permissions <@ array['resource_upload', 'resource_update']::text[]),
  constraint course_rep_scope_text
    check (
      length(btrim(scope_department)) between 1 and 160
      and (scope_course_code is null or length(btrim(scope_course_code)) between 1 and 40)
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
    update public.course_rep_appointments
       set revoked_at = pg_catalog.now(),
           revoked_by = (select auth.uid()),
           revoke_reason = 'Academic level changed; a new appointment is required.'
     where student_user_id = new.user_id
       and revoked_at is null;
  end if;
  return new;
end;
$function$;

drop trigger if exists reset_academic_level_confirmation on public.students;
create trigger reset_academic_level_confirmation
before update of "Level" on public.students
for each row execute function private.reset_academic_level_confirmation();

revoke all on function private.reset_academic_level_confirmation() from public, anon, authenticated;

create index if not exists course_rep_appointments_student_idx
  on public.course_rep_appointments (student_user_id, revoked_at);
create index if not exists course_rep_appointments_scope_idx
  on public.course_rep_appointments (scope_level, scope_department, scope_course_code);

alter table public.course_rep_appointments enable row level security;
revoke all on public.course_rep_appointments from anon, authenticated;
grant select, insert, update on public.course_rep_appointments to authenticated;
grant all on public.course_rep_appointments to service_role;

drop policy if exists "Course representatives can view their appointments" on public.course_rep_appointments;
create policy "Course representatives can view their appointments"
  on public.course_rep_appointments for select to authenticated
  using (student_user_id = (select auth.uid()) or private.is_clariva_admin_or_owner());

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
        and s."Verified" is true
        and s.academic_level_confirmed_at is not null
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
        and s."Verified" is true
        and s.academic_level_confirmed_at is not null
        and s."Level" = scope_level::text
    )
  );

create or replace function private.has_active_course_rep_permission(
  p_level smallint,
  p_department text,
  p_course_code text,
  p_permission text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.course_rep_appointments a
    where a.student_user_id = (select auth.uid())
      and a.revoked_at is null
      and pg_catalog.make_date(a.start_year, a.start_month, 1) <= (pg_catalog.now() at time zone 'Africa/Lagos')::date
      and (pg_catalog.now() at time zone 'Africa/Lagos')::date < (pg_catalog.make_date(a.end_year, a.end_month, 1) + interval '1 month')::date
      and a.scope_level = p_level
      and lower(btrim(a.scope_department)) = lower(btrim(coalesce(p_department, '')))
      and (a.scope_course_code is null or lower(btrim(a.scope_course_code)) = lower(btrim(coalesce(p_course_code, ''))))
      and p_permission = any(a.permissions)
      and exists (
        select 1 from public.students s
        where s.user_id = a.student_user_id
          and s."Verified" is true
          and s.academic_level_confirmed_at is not null
          and s."Level" = a.scope_level::text
          and lower(coalesce(s."Role", '')) = 'student'
      )
  );
$function$;

revoke all on function private.has_active_course_rep_permission(smallint, text, text, text) from public, anon;
grant execute on function private.has_active_course_rep_permission(smallint, text, text, text) to authenticated, service_role;

create or replace function public.is_active_course_rep()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.course_rep_appointments a
    join public.students s on s.user_id = a.student_user_id
    where a.student_user_id = (select auth.uid())
      and a.revoked_at is null
      and cardinality(a.permissions) > 0
      and pg_catalog.make_date(a.start_year, a.start_month, 1) <= (pg_catalog.now() at time zone 'Africa/Lagos')::date
      and (pg_catalog.now() at time zone 'Africa/Lagos')::date < (pg_catalog.make_date(a.end_year, a.end_month, 1) + interval '1 month')::date
      and s."Verified" is true
      and s.academic_level_confirmed_at is not null
      and s."Level" = a.scope_level::text
      and lower(coalesce(s."Role", '')) = 'student'
  );
$function$;

revoke all on function public.is_active_course_rep() from public, anon;
grant execute on function public.is_active_course_rep() to authenticated;

create or replace function public.get_active_course_rep_permissions()
returns text[]
language sql
stable
security definer
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
      and s."Verified" is true
      and s.academic_level_confirmed_at is not null
      and lower(coalesce(s."Role", '')) = 'student'
  ), '{}'::text[]);
$function$;

revoke all on function public.get_active_course_rep_permissions() from public, anon;
grant execute on function public.get_active_course_rep_permissions() to authenticated;

create or replace function public.course_rep_list_resources()
returns setof public."Resources"
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if auth.uid() is null or not public.is_active_course_rep() then
    raise exception 'An active course-representative appointment is required.' using errcode = '42501';
  end if;

  return query
  select r.*
  from public."Resources" r
  where exists (
    select 1
    from public.course_rep_appointments a
    where a.student_user_id = (select auth.uid())
      and a.revoked_at is null
      and pg_catalog.make_date(a.start_year, a.start_month, 1) <= (pg_catalog.now() at time zone 'Africa/Lagos')::date
      and (pg_catalog.now() at time zone 'Africa/Lagos')::date < (pg_catalog.make_date(a.end_year, a.end_month, 1) + interval '1 month')::date
      and a.scope_level = r.level
      and exists (
        select 1 from public.students s
        where s.user_id = a.student_user_id
          and s."Level" = a.scope_level::text
          and s."Verified" is true
          and s.academic_level_confirmed_at is not null
      )
      and lower(btrim(a.scope_department)) = lower(btrim(coalesce(r.department, '')))
      and (a.scope_course_code is null or lower(btrim(a.scope_course_code)) = lower(btrim(coalesce(r.course_code, ''))))
      and (a.permissions && array['resource_upload', 'resource_update']::text[])
  )
  order by r.created_at desc
  limit 500;
end;
$function$;

revoke all on function public.course_rep_list_resources() from public, anon;
grant execute on function public.course_rep_list_resources() to authenticated;

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

  return query
  select s.user_id, coalesce(nullif(s."Name", ''), 'Student') as display_name, s."Level"
  from public.students s
  where s.user_id is not null
    and lower(coalesce(s."Role", '')) = 'student'
    and s."Verified" is true
    and s.academic_level_confirmed_at is not null
    and s."Level" in ('100', '200', '300', '400', '500')
    and (
      nullif(btrim(coalesce(p_search, '')), '') is null
      or s."Name" ilike '%' || btrim(p_search) || '%'
    )
  order by s."Name" nulls last
  limit 100;
end;
$function$;

create or replace function public.admin_list_course_rep_appointments()
returns table (
  appointment_id uuid,
  student_user_id uuid,
  student_name text,
  scope_level smallint,
  scope_department text,
  scope_course_code text,
  start_month smallint,
  start_year smallint,
  end_month smallint,
  end_year smallint,
  permissions text[],
  created_at timestamptz,
  revoked_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if auth.uid() is null or not private.is_clariva_admin_or_owner() then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;

  return query
  select a.id, a.student_user_id, coalesce(nullif(s."Name", ''), 'Student'),
         a.scope_level, a.scope_department, a.scope_course_code,
         a.start_month, a.start_year, a.end_month, a.end_year,
         a.permissions, a.created_at, a.revoked_at
  from public.course_rep_appointments a
  left join public.students s on s.user_id = a.student_user_id
  order by a.created_at desc
  limit 200;
end;
$function$;

create or replace function public.admin_revoke_course_rep_appointment(
  p_appointment_id uuid,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if auth.uid() is null or not private.is_clariva_admin_or_owner() then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;

  update public.course_rep_appointments
     set revoked_at = pg_catalog.now(),
         revoked_by = (select auth.uid()),
         revoke_reason = nullif(left(btrim(coalesce(p_reason, '')), 300), '')
   where id = p_appointment_id
     and revoked_at is null;

  if not found then
    raise exception 'The appointment was not found or has already been revoked.' using errcode = 'P0002';
  end if;
end;
$function$;

revoke all on function public.admin_list_course_rep_candidates(text) from public, anon;
revoke all on function public.admin_list_course_rep_appointments() from public, anon;
revoke all on function public.admin_revoke_course_rep_appointment(uuid, text) from public, anon;
grant execute on function public.admin_list_course_rep_candidates(text) to authenticated;
grant execute on function public.admin_list_course_rep_appointments() to authenticated;
grant execute on function public.admin_revoke_course_rep_appointment(uuid, text) to authenticated;

-- Resource table permissions are still enforced by RLS and a field guard.
drop policy if exists "Admins and owners can upload resources" on public."Resources";
create policy "Admins owners and scoped course reps can upload resources"
on public."Resources" for insert to authenticated
with check (
  uploaded_by = (select auth.uid())
  and (
    exists (
      select 1 from public.students s
      where s.user_id = (select auth.uid())
        and s."Verified" is true
        and lower(coalesce(s."Role", '')) in ('admin', 'owner')
    )
    or (
      private.has_active_course_rep_permission(level, department, course_code, 'resource_upload')
      and visibility is true
      and featured is false
      and featured_until is null
      and featured_permanent is false
    )
  )
);

drop policy if exists "Admins and owners can update resources" on public."Resources";
create policy "Admins owners and scoped course reps can update resources"
on public."Resources" for update to authenticated
using (
  exists (
    select 1 from public.students s
    where s.user_id = (select auth.uid())
      and s."Verified" is true
      and lower(coalesce(s."Role", '')) in ('admin', 'owner')
  )
  or private.has_active_course_rep_permission(level, department, course_code, 'resource_update')
)
with check (
  exists (
    select 1 from public.students s
    where s.user_id = (select auth.uid())
      and s."Verified" is true
      and lower(coalesce(s."Role", '')) in ('admin', 'owner')
  )
  or private.has_active_course_rep_permission(level, department, course_code, 'resource_update')
);

drop policy if exists "Admins and owners can delete resources" on public."Resources";
create policy "Admins and owners can delete resources"
on public."Resources" for delete to authenticated
using (
  exists (
    select 1 from public.students s
    where s.user_id = (select auth.uid())
      and s."Verified" is true
      and lower(coalesce(s."Role", '')) in ('admin', 'owner')
  )
);

create or replace function private.protect_course_rep_resource_updates()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if private.is_clariva_admin_or_owner() then
    return new;
  end if;

  if private.has_active_course_rep_permission(old.level, old.department, old.course_code, 'resource_update') then
    if new.id is distinct from old.id
       or new.level is distinct from old.level
       or new.department is distinct from old.department
       or new.course_code is distinct from old.course_code
       or new.uploaded_by is distinct from old.uploaded_by
       or new.visibility is distinct from old.visibility
       or new.featured is distinct from old.featured
       or new.featured_until is distinct from old.featured_until
       or new.featured_permanent is distinct from old.featured_permanent
       or new.file_url is distinct from old.file_url
       or new.file_name is distinct from old.file_name
       or new.file_size is distinct from old.file_size
       or new.download_count is distinct from old.download_count
       or new.created_at is distinct from old.created_at then
      raise exception 'Course representatives cannot change resource scope, publication, featured status, ownership, or stored files.' using errcode = '42501';
    end if;
  end if;

  return new;
end;
$function$;

drop trigger if exists protect_course_rep_resource_updates on public."Resources";
create trigger protect_course_rep_resource_updates
before update on public."Resources"
for each row execute function private.protect_course_rep_resource_updates();

revoke all on function private.protect_course_rep_resource_updates() from public, anon, authenticated;

-- Replace the exact existing student SELECT policy. Students must confirm
-- once; active course reps may additionally read resources within their scope.
drop policy if exists "Verified students read visible resources up to their level; adm" on public."Resources";
drop policy if exists "Verified students read visible resources up to their level; admins and owners read all" on public."Resources";
drop policy if exists "Verified confirmed students and scoped course reps read resources" on public."Resources";
create policy "Verified confirmed students and scoped course reps read resources"
on public."Resources" for select to authenticated
using (
  exists (
    select 1 from public.students s
    where s.user_id = (select auth.uid())
      and s."Verified" is true
      and (
        lower(coalesce(s."Role", '')) in ('admin', 'owner')
        or (
          lower(coalesce(s."Role", '')) = 'student'
          and s.academic_level_confirmed_at is not null
          and (
            (
              public."Resources".visibility is true
              and s."Level" ~ '^[0-9]+$'
              and public."Resources".level <= (s."Level")::smallint
            )
            or private.has_active_course_rep_permission(public."Resources".level, public."Resources".department, public."Resources".course_code, 'resource_upload')
            or private.has_active_course_rep_permission(public."Resources".level, public."Resources".department, public."Resources".course_code, 'resource_update')
          )
        )
      )
  )
);

-- Storage must enforce the same rules; direct object access must not bypass
-- the academic confirmation gate or the course-representative appointment.
drop policy if exists "Verified students read resources up to their level" on storage.objects;
create policy "Verified students read resources up to their level"
on storage.objects for select to authenticated
using (
  bucket_id = 'clariva-resources'
  and exists (
    select 1
    from public."Resources" r
    join public.students s on s.user_id = (select auth.uid())
    where r.file_url = storage.objects.name
      and s."Verified" is true
      and lower(coalesce(s."Role", '')) = 'student'
      and s.academic_level_confirmed_at is not null
      and s."Level" ~ '^[0-9]+$'
      and r.visibility is true
      and r.level <= s."Level"::smallint
  )
);

drop policy if exists "Scoped course reps can read appointed resources" on storage.objects;
create policy "Scoped course reps can read appointed resources"
on storage.objects for select to authenticated
using (
  bucket_id = 'clariva-resources'
  and exists (
    select 1 from public."Resources" r
    where r.file_url = storage.objects.name
      and (
        private.has_active_course_rep_permission(r.level, r.department, r.course_code, 'resource_upload')
        or private.has_active_course_rep_permission(r.level, r.department, r.course_code, 'resource_update')
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
    select 1
    from public.course_rep_appointments a
    join public.students s on s.user_id = a.student_user_id
    where a.student_user_id = (select auth.uid())
      and a.revoked_at is null
      and a.scope_level = split_part(storage.objects.name, '/', 2)::smallint
      and a.permissions @> array['resource_upload']::text[]
      and pg_catalog.make_date(a.start_year, a.start_month, 1) <= (pg_catalog.now() at time zone 'Africa/Lagos')::date
      and (pg_catalog.now() at time zone 'Africa/Lagos')::date < (pg_catalog.make_date(a.end_year, a.end_month, 1) + interval '1 month')::date
      and s."Verified" is true
      and s.academic_level_confirmed_at is not null
      and s."Level" = a.scope_level::text
      and lower(coalesce(s."Role", '')) = 'student'
  )
);

-- 3. In-app notifications and manual announcements.
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null,
  title text not null check (length(btrim(title)) between 1 and 120),
  message text not null check (length(btrim(message)) between 1 and 500),
  destination text not null default './' check (
    (destination like '/%' and left(destination, 2) <> '//' and position(chr(92) in destination) = 0)
    or (destination like './%' and position(chr(92) in destination) = 0)
  ),
  announcement_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  push_attempted_at timestamptz,
  push_sent_at timestamptz,
  constraint notifications_event_type check (
    event_type in ('new_registration', 'resource_uploaded', 'resource_deleted', 'announcement', 'platform')
  )
);

create index if not exists notifications_user_created_idx
  on public.notifications (user_id, created_at desc);
create index if not exists notifications_unread_idx
  on public.notifications (user_id, created_at desc) where read_at is null;

alter table public.notifications enable row level security;
revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
grant all on public.notifications to service_role;

drop policy if exists "Users read their own notifications" on public.notifications;
create policy "Users read their own notifications"
  on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists "Users mark their own notifications as read" on public.notifications;
create policy "Users mark their own notifications as read"
  on public.notifications for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

do $publication$
begin
  if exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_catalog.pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'notifications'
     ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end;
$publication$;

create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(btrim(title)) between 1 and 100),
  message text not null check (length(btrim(message)) between 1 and 500),
  destination text not null default './' check (
    (destination like '/%' and left(destination, 2) <> '//' and position(chr(92) in destination) = 0)
    or (destination like './%' and position(chr(92) in destination) = 0)
  ),
  audience_type text not null check (audience_type in ('all', 'role', 'level')),
  audience_value text,
  published_by uuid not null references auth.users(id),
  published_at timestamptz not null default now(),
  recipient_count integer not null default 0 check (recipient_count >= 0),
  constraint announcement_audience_value check (
    (audience_type = 'all' and audience_value is null)
    or (audience_type = 'role' and audience_value is not null and audience_value in ('student', 'admin', 'owner'))
    or (audience_type = 'level' and audience_value is not null and audience_value in ('100', '200', '300', '400', '500'))
  )
);

create table if not exists public.announcement_recipients (
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  push_sent_at timestamptz,
  primary key (announcement_id, user_id)
);

alter table public.announcements enable row level security;
alter table public.announcement_recipients enable row level security;
revoke all on public.announcements, public.announcement_recipients from anon, authenticated;
grant select on public.announcements to authenticated;
grant all on public.announcements, public.announcement_recipients to service_role;

drop policy if exists "Verified admins and owners read announcement history" on public.announcements;
create policy "Verified admins and owners read announcement history"
  on public.announcements for select to authenticated
  using (private.is_clariva_admin_or_owner());

create or replace function public.publish_announcement(
  p_title text,
  p_message text,
  p_audience_type text,
  p_audience_value text default null,
  p_destination text default './'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_announcement_id uuid;
  recipients integer;
begin
  if auth.uid() is null or not private.is_clariva_admin_or_owner() then
    raise exception 'Only verified Clariva administrators can publish announcements.' using errcode = '42501';
  end if;

  if length(btrim(coalesce(p_title, ''))) not between 1 and 100
     or length(btrim(coalesce(p_message, ''))) not between 1 and 500 then
    raise exception 'Provide a title and message within the allowed length.' using errcode = '22023';
  end if;

  if p_destination is null
     or position(chr(92) in p_destination) > 0
     or (p_destination like '/%' and left(p_destination, 2) = '//')
     or not (p_destination like '/%' or p_destination like './%') then
    raise exception 'Announcement destination must remain within Clariva.' using errcode = '22023';
  end if;

  if p_audience_type is null or p_audience_type not in ('all', 'role', 'level') then
    raise exception 'Choose a supported announcement audience.' using errcode = '22023';
  end if;

  if (p_audience_type = 'all' and p_audience_value is not null)
     or (p_audience_type = 'role' and (p_audience_value is null or p_audience_value not in ('student', 'admin', 'owner')))
     or (p_audience_type = 'level' and (p_audience_value is null or p_audience_value not in ('100', '200', '300', '400', '500'))) then
    raise exception 'The selected audience is invalid.' using errcode = '22023';
  end if;

  insert into public.announcements (title, message, destination, audience_type, audience_value, published_by)
  values (btrim(p_title), btrim(p_message), p_destination, p_audience_type, p_audience_value, (select auth.uid()))
  returning id into v_announcement_id;

  insert into public.announcement_recipients (announcement_id, user_id)
  select v_announcement_id, s.user_id
  from public.students s
  where s.user_id is not null
    and s."Verified" is true
    and (
      p_audience_type = 'all'
      or (p_audience_type = 'role' and lower(coalesce(s."Role", '')) = p_audience_value)
      or (p_audience_type = 'level' and lower(coalesce(s."Role", '')) = 'student' and s."Level" = p_audience_value)
    )
  on conflict do nothing;

  get diagnostics recipients = row_count;

  insert into public.notifications (
    user_id, event_type, title, message, destination, announcement_id, metadata
  )
  select ar.user_id, 'announcement', btrim(p_title), btrim(p_message), p_destination,
         v_announcement_id, jsonb_build_object('announcement_id', v_announcement_id)
  from public.announcement_recipients ar
  where ar.announcement_id = v_announcement_id;

  update public.announcements
     set recipient_count = recipients
   where id = v_announcement_id;

  return v_announcement_id;
end;
$function$;

revoke all on function public.publish_announcement(text, text, text, text, text) from public, anon;
grant execute on function public.publish_announcement(text, text, text, text, text) to authenticated;

-- 4. Automatic event alerts to all verified administrators and owners.
create or replace function private.notify_clariva_admins(
  p_event_type text,
  p_title text,
  p_message text,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  insert into public.notifications (user_id, event_type, title, message, metadata)
  select s.user_id, p_event_type, p_title, p_message, coalesce(p_metadata, '{}'::jsonb)
  from public.students s
  where s.user_id is not null
    and s."Verified" is true
    and lower(coalesce(s."Role", '')) in ('admin', 'owner');
end;
$function$;

create or replace function private.notify_new_student_registration()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if lower(coalesce(new."Role", '')) = 'student' then
    perform private.notify_clariva_admins(
      'new_registration',
      'New student registration',
      coalesce(nullif(new."Name", ''), 'A new student') || ' has registered on Clariva.',
      jsonb_build_object('student_user_id', new.user_id, 'level', new."Level")
    );
  end if;
  return new;
end;
$function$;

create or replace function private.notify_resource_uploaded()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  perform private.notify_clariva_admins(
    'resource_uploaded',
    'New resource uploaded',
    coalesce(nullif(new.title, ''), 'A resource') || ' was added to the Clariva library.',
    jsonb_build_object('resource_id', new.id, 'level', new.level, 'course_code', new.course_code)
  );
  return new;
end;
$function$;

create or replace function private.notify_resource_deleted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  perform private.notify_clariva_admins(
    'resource_deleted',
    'Resource deleted',
    coalesce(nullif(old.title, ''), 'A resource') || ' was removed from the Clariva library.',
    jsonb_build_object('resource_id', old.id, 'level', old.level, 'course_code', old.course_code)
  );
  return old;
end;
$function$;

drop trigger if exists clariva_notify_new_student_registration on public.students;
create trigger clariva_notify_new_student_registration
after insert on public.students
for each row execute function private.notify_new_student_registration();

drop trigger if exists clariva_notify_resource_uploaded on public."Resources";
create trigger clariva_notify_resource_uploaded
after insert on public."Resources"
for each row execute function private.notify_resource_uploaded();

drop trigger if exists clariva_notify_resource_deleted on public."Resources";
create trigger clariva_notify_resource_deleted
after delete on public."Resources"
for each row execute function private.notify_resource_deleted();

revoke all on function private.notify_clariva_admins(text, text, text, jsonb) from public, anon, authenticated;
revoke all on function private.notify_new_student_registration() from public, anon, authenticated;
revoke all on function private.notify_resource_uploaded() from public, anon, authenticated;
revoke all on function private.notify_resource_deleted() from public, anon, authenticated;


-- 5. Server-side push dispatch for notification events.
-- pg_net sends asynchronously so resource/auth transactions are not held open.
create extension if not exists pg_net with schema extensions;

alter table public.notifications
  add column if not exists push_attempted_at timestamptz;

create index if not exists notifications_push_pending_idx
  on public.notifications (created_at)
  where push_sent_at is null
    and event_type in ('new_registration', 'resource_uploaded', 'resource_deleted', 'platform');

create or replace function public.claim_clariva_push_notifications(p_limit integer default 200)
returns table (
  notification_id uuid,
  user_id uuid,
  title text,
  message text,
  destination text
)
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;

  return query
  with candidates as (
    select n.id
    from public.notifications n
    where n.event_type in ('new_registration', 'resource_uploaded', 'resource_deleted', 'platform')
      and n.push_sent_at is null
      and (
        n.push_attempted_at is null
        or n.push_attempted_at < pg_catalog.now() - interval '15 minutes'
      )
    order by n.created_at asc
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 200), 500))
  ),
  claimed as (
    update public.notifications n
       set push_attempted_at = pg_catalog.now()
      from candidates c
     where n.id = c.id
    returning n.id, n.user_id, n.title, n.message, n.destination
  )
  select c.id, c.user_id, c.title, c.message, c.destination
  from claimed c;
end;
$function$;

revoke all on function public.claim_clariva_push_notifications(integer) from public, anon, authenticated;
grant execute on function public.claim_clariva_push_notifications(integer) to service_role;

create or replace function private.request_clariva_push_dispatch()
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_project_url text;
  v_service_key text;
begin
  select ds.decrypted_secret
    into v_project_url
    from vault.decrypted_secrets ds
   where ds.name = 'clariva_project_url'
   limit 1;

  select ds.decrypted_secret
    into v_service_key
    from vault.decrypted_secrets ds
   where ds.name = 'clariva_dispatch_secret'
   limit 1;

  if coalesce(v_project_url, '') = '' or coalesce(v_service_key, '') = '' then
    return;
  end if;

  perform net.http_post(
    url := pg_catalog.rtrim(v_project_url, '/') || '/functions/v1/clariva-push',
    body := '{"action":"dispatch_pending"}'::jsonb,
    headers := pg_catalog.jsonb_build_object(
      'Content-Type', 'application/json',
      'x-clariva-dispatch-secret', v_service_key
    ),
    timeout_milliseconds := 10000
  );
end;
$function$;

revoke all on function private.request_clariva_push_dispatch() from public, anon, authenticated;

create or replace function private.enqueue_clariva_push_dispatch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  perform private.request_clariva_push_dispatch();
  return null;
end;
$function$;

revoke all on function private.enqueue_clariva_push_dispatch() from public, anon, authenticated;

drop trigger if exists clariva_enqueue_push_dispatch on public.notifications;
create trigger clariva_enqueue_push_dispatch
after insert on public.notifications
for each statement execute function private.enqueue_clariva_push_dispatch();

do $schedule$
begin
  if not exists (
    select 1 from cron.job where jobname = 'clariva-push-dispatch'
  ) then
    perform cron.schedule(
      'clariva-push-dispatch',
      '* * * * *',
      'select private.request_clariva_push_dispatch();'
    );
  end if;
end;
$schedule$;
