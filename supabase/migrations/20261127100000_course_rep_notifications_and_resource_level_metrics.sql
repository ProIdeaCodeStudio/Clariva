-- Course-representative appointment notifications, broader candidate search,
-- and resource counts grouped by academic level.

alter table public.notifications
  drop constraint if exists notifications_event_type;

alter table public.notifications
  add constraint notifications_event_type check (
    event_type in (
      'new_registration',
      'resource_uploaded',
      'resource_deleted',
      'announcement',
      'platform',
      'course_rep_appointed'
    )
  );

create or replace function private.notify_course_rep_appointed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_student_name text;
begin
  select coalesce(nullif(s."Name", ''), 'You')
    into v_student_name
  from public.students s
  where s.user_id = new.student_user_id;

  if not found then
    return new;
  end if;

  insert into public.notifications (
    user_id, event_type, title, message, destination, metadata
  )
  values (
    new.student_user_id,
    'course_rep_appointed',
    'Course representative appointment',
    'You have been appointed as a course representative for ' ||
      new.scope_department ||
      case when nullif(new.scope_course_code, '') is not null
        then ' (' || new.scope_course_code || ')'
        else ''
      end ||
      ' at ' || new.scope_level::text || ' Level.',
    './Undergraduates.html',
    jsonb_build_object(
      'appointment_id', new.id,
      'scope_level', new.scope_level,
      'scope_department', new.scope_department,
      'scope_course_code', new.scope_course_code,
      'start_month', new.start_month,
      'start_year', new.start_year,
      'end_month', new.end_month,
      'end_year', new.end_year
    )
  );

  return new;
end;
$function$;

revoke all on function private.notify_course_rep_appointed() from public, anon, authenticated;

drop trigger if exists clariva_notify_course_rep_appointed on public.course_rep_appointments;
create trigger clariva_notify_course_rep_appointed
after insert on public.course_rep_appointments
for each row
execute function private.notify_course_rep_appointed();

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
    where n.event_type in (
      'new_registration',
      'resource_uploaded',
      'resource_deleted',
      'platform',
      'course_rep_appointed'
    )
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

drop function if exists public.admin_list_course_rep_candidates(text);

create function public.admin_list_course_rep_candidates(p_search text default null)
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

revoke all on function public.admin_list_course_rep_candidates(text) from public, anon;
grant execute on function public.admin_list_course_rep_candidates(text) to authenticated;

-- Extend the existing trusted aggregate without changing its other metrics.
do $migration$
declare
  v_definition text;
  v_old text := $old$
    'resources_by_type', coalesce((
      select jsonb_object_agg(resource_type_label, total)
      from (
        select coalesce(nullif(resource_type, ''), 'Unspecified') as resource_type_label,
               count(*)::bigint as total
        from public."Resources" group by 1
      ) resource_type_totals
    ), '{}'::jsonb)
$old$;
  v_new text := $new$
    'resources_by_type', coalesce((
      select jsonb_object_agg(resource_type_label, total)
      from (
        select coalesce(nullif(resource_type, ''), 'Unspecified') as resource_type_label,
               count(*)::bigint as total
        from public."Resources" group by 1
      ) resource_type_totals
    ), '{}'::jsonb),
    'resources_by_level', coalesce((
      select jsonb_object_agg(level_label, total)
      from (
        select coalesce(nullif(level::text, ''), 'Unspecified') as level_label,
               count(*)::bigint as total
        from public."Resources"
        group by 1
      ) resource_level_totals
    ), '{}'::jsonb)
$new$;
begin
  select pg_get_functiondef(
    'private.get_admin_dashboard_stats_internal()'::regprocedure
  ) into v_definition;

  if position(v_old in v_definition) = 0 then
    raise exception 'Could not locate the expected resource-type aggregate in the current dashboard statistics function.';
  end if;

  execute replace(v_definition, v_old, v_new);
end;
$migration$;


-- Keep the pending-push partial index aligned with the expanded event set.
drop index if exists public.notifications_push_pending_idx;
create index notifications_push_pending_idx
  on public.notifications (created_at)
  where push_sent_at is null
    and event_type in (
      'new_registration',
      'resource_uploaded',
      'resource_deleted',
      'platform',
      'course_rep_appointed'
    );
