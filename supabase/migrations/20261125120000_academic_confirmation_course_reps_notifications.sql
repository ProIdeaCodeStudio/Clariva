-- Clariva academic confirmation, scoped course representatives, and notification foundation.
-- This migration is staged on the feature branch. It is not applied to production here.

-- Existing students must explicitly confirm their stored academic level once.
-- New registrations with a valid level are confirmed as part of registration.
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
    select 1
    from public.students s
    where s.user_id = (select auth.uid())
      and s."Verified" is true
      and lower(coalesce(s."Role", '')) in ('admin', 'owner')
  );
$function$;

revoke all on function private.is_clariva_admin_or_owner() from public, anon;
grant execute on function private.is_clariva_admin_or_owner() to authenticated, service_role;

-- One-time confirmation is performed through this narrow RPC; clients cannot
-- directly update the confirmation timestamp or change their stored level.
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

  if p_level not in ('100', '200', '300', '400', '500') then
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

-- Course representatives remain student accounts. Their authority exists only
-- through an active, scoped appointment and explicitly assigned permissions.
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
    check (permissions <@ array['resource_upload', 'resource_update', 'resource_delete']::text[]),
  constraint course_rep_scope_text
    check (
      length(btrim(scope_department)) between 1 and 160
      and (scope_course_code is null or length(btrim(scope_course_code)) between 1 and 40)
    )
);

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
        and s."Level" = scope_level::text
    )
  );

drop policy if exists "Verified admins and owners update course rep appointments" on public.course_rep_appointments;
create policy "Verified admins and owners update course rep appointments"
  on public.course_rep_appointments for update to authenticated
  using (private.is_clariva_admin_or_owner())
  with check (private.is_clariva_admin_or_owner());

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
          and lower(coalesce(s."Role", '')) = 'student'
      )
  );
$function$;

revoke all on function private.has_active_course_rep_permission(smallint, text, text, text) from public, anon;
grant execute on function private.has_active_course_rep_permission(smallint, text, text, text) to authenticated, service_role;

-- Extend the existing resource policies without changing global admin/owner access.
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
    or private.has_active_course_rep_permission(level, department, course_code, 'resource_upload')
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
create policy "Admins owners and scoped course reps can delete resources"
on public."Resources" for delete to authenticated
using (
  exists (
    select 1 from public.students s
    where s.user_id = (select auth.uid())
      and s."Verified" is true
      and lower(coalesce(s."Role", '')) in ('admin', 'owner')
  )
  or private.has_active_course_rep_permission(level, department, course_code, 'resource_delete')
);

-- Existing students must confirm before student resource access. Admins and
-- owners retain their existing access regardless of this confirmation.
drop policy if exists "Verified students read visible resources up to their level; adm" on public."Resources";
drop policy if exists "Verified students read visible resources up to their level; admins and owners read all" on public."Resources";
drop policy if exists "Verified confirmed students read visible resources up to their level; admins and owners read all" on public."Resources";
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
              and s."Level" ~ '^[0-9]+

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
      and lower(coalesce(s."Role", '')) = 'student'
  );
$function$;

revoke all on function public.is_active_course_rep() from public, anon;
grant execute on function public.is_active_course_rep() to authenticated;

-- Dashboard RPCs expose only the course-rep directory fields needed by
-- administrators; student contact details are deliberately excluded.
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

-- In-app notifications. Inserts are trusted-server-only; users can read their
-- own items and mark only their own items as read.
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

create policy "Users read their own notifications"
  on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));
create policy "Users mark their own notifications as read"
  on public.notifications for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Announcements are created through publish_announcement(), which calculates
-- recipients on the server rather than trusting a client-supplied user ID list.
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
    or (audience_type = 'role' and audience_value in ('student', 'admin', 'owner'))
    or (audience_type = 'level' and audience_value in ('100', '200', '300', '400', '500'))
  )
);

create table if not exists public.announcement_recipients (
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  delivered_at timestamptz,
  primary key (announcement_id, user_id)
);
alter table public.announcements enable row level security;
alter table public.announcement_recipients enable row level security;
revoke all on public.announcements, public.announcement_recipients from anon, authenticated;
grant select on public.announcements to authenticated;
grant all on public.announcements, public.announcement_recipients to service_role;

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
  announcement_id uuid;
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

  if p_audience_type not in ('all', 'role', 'level') then
    raise exception 'Choose a supported announcement audience.' using errcode = '22023';
  end if;

  if (p_audience_type = 'all' and p_audience_value is not null)
     or (p_audience_type = 'role' and (p_audience_value is null or p_audience_value not in ('student', 'admin', 'owner')))
     or (p_audience_type = 'level' and (p_audience_value is null or p_audience_value not in ('100', '200', '300', '400', '500'))) then
    raise exception 'The selected audience is invalid.' using errcode = '22023';
  end if;

  insert into public.announcements (title, message, destination, audience_type, audience_value, published_by)
  values (btrim(p_title), btrim(p_message), p_destination, p_audience_type, p_audience_value, (select auth.uid()))
  returning id into announcement_id;

  insert into public.announcement_recipients (announcement_id, user_id)
  select announcement_id, s.user_id
  from public.students s
  where s.user_id is not null
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
         announcement_id, jsonb_build_object('announcement_id', announcement_id)
  from public.announcement_recipients ar
  where ar.announcement_id = announcement_id;

  update public.announcements
     set recipient_count = recipients
   where id = announcement_id;

  return announcement_id;
end;
$function$;

revoke all on function public.publish_announcement(text, text, text, text, text) from public, anon;
grant execute on function public.publish_announcement(text, text, text, text, text) to authenticated;

-- Event-generated in-app alerts go to verified administrators and owners.
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


              and public."Resources".level <= (s."Level")::smallint
            )
            or private.has_active_course_rep_permission(public."Resources".level, public."Resources".department, public."Resources".course_code, 'resource_upload')
            or private.has_active_course_rep_permission(public."Resources".level, public."Resources".department, public."Resources".course_code, 'resource_update')
            or private.has_active_course_rep_permission(public."Resources".level, public."Resources".department, public."Resources".course_code, 'resource_delete')
          )
        )
      )
  )
);

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
      and lower(coalesce(s."Role", '')) = 'student'
  );
$function$;

revoke all on function public.is_active_course_rep() from public, anon;
grant execute on function public.is_active_course_rep() to authenticated;

-- Dashboard RPCs expose only the course-rep directory fields needed by
-- administrators; student contact details are deliberately excluded.
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

-- In-app notifications. Inserts are trusted-server-only; users can read their
-- own items and mark only their own items as read.
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

create policy "Users read their own notifications"
  on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));
create policy "Users mark their own notifications as read"
  on public.notifications for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Announcements are created through publish_announcement(), which calculates
-- recipients on the server rather than trusting a client-supplied user ID list.
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
    or (audience_type = 'role' and audience_value in ('student', 'admin', 'owner'))
    or (audience_type = 'level' and audience_value in ('100', '200', '300', '400', '500'))
  )
);

create table if not exists public.announcement_recipients (
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  delivered_at timestamptz,
  primary key (announcement_id, user_id)
);
alter table public.announcements enable row level security;
alter table public.announcement_recipients enable row level security;
revoke all on public.announcements, public.announcement_recipients from anon, authenticated;
grant select on public.announcements to authenticated;
grant all on public.announcements, public.announcement_recipients to service_role;

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
  announcement_id uuid;
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

  if p_audience_type not in ('all', 'role', 'level') then
    raise exception 'Choose a supported announcement audience.' using errcode = '22023';
  end if;

  if (p_audience_type = 'all' and p_audience_value is not null)
     or (p_audience_type = 'role' and (p_audience_value is null or p_audience_value not in ('student', 'admin', 'owner')))
     or (p_audience_type = 'level' and (p_audience_value is null or p_audience_value not in ('100', '200', '300', '400', '500'))) then
    raise exception 'The selected audience is invalid.' using errcode = '22023';
  end if;

  insert into public.announcements (title, message, destination, audience_type, audience_value, published_by)
  values (btrim(p_title), btrim(p_message), p_destination, p_audience_type, p_audience_value, (select auth.uid()))
  returning id into announcement_id;

  insert into public.announcement_recipients (announcement_id, user_id)
  select announcement_id, s.user_id
  from public.students s
  where s.user_id is not null
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
         announcement_id, jsonb_build_object('announcement_id', announcement_id)
  from public.announcement_recipients ar
  where ar.announcement_id = announcement_id;

  update public.announcements
     set recipient_count = recipients
   where id = announcement_id;

  return announcement_id;
end;
$function$;

revoke all on function public.publish_announcement(text, text, text, text, text) from public, anon;
grant execute on function public.publish_announcement(text, text, text, text, text) to authenticated;

-- Event-generated in-app alerts go to verified administrators and owners.
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

