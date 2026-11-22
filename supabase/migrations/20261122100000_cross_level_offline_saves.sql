-- Cross-level student library access, distinct offline saves, and aggregate metrics.
-- Existing password-reset enforcement remains in place through the restrictive policies.

-- Students may read published resources from their current level and any lower level.
drop policy if exists "Verified students read visible resources for their level; admin" on public."Resources";
create policy "Verified students read visible resources up to their level; admin"
on public."Resources"
for select
to authenticated
using (
  exists (
    select 1
    from public.students s
    where s.user_id = (select auth.uid())
      and s."Verified" is true
      and (
        lower(coalesce(s."Role", '')) in ('admin', 'owner')
        or (
          lower(coalesce(s."Role", '')) = 'student'
          and "Resources".visibility is true
          and s."Level" ~ '^[0-9]+$'
          and "Resources".level <= s."Level"::smallint
        )
      )
  )
);

-- Storage remains private. Only resources allowed by the same student-level rule can be read.
drop policy if exists "Verified students read only resources assigned to their level" on storage.objects;
create policy "Verified students read resources up to their level"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'clariva-resources'
  and exists (
    select 1
    from public."Resources" r
    where r.file_url = objects.name
      and (
        (
          r.visibility is true
          and exists (
            select 1
            from public.students s
            where s.user_id = (select auth.uid())
              and s."Verified" is true
              and lower(coalesce(s."Role", '')) = 'student'
              and s."Level" ~ '^[0-9]+$'
              and r.level <= s."Level"::smallint
          )
        )
        or exists (
          select 1
          from public.students s
          where s.user_id = (select auth.uid())
            and s."Verified" is true
            and lower(coalesce(s."Role", '')) in ('admin', 'owner')
        )
      )
  )
);

-- One row per student-resource pair: repeated saves do not inflate the metric.
create table if not exists private.offline_resource_saves (
  user_id uuid not null references auth.users(id) on delete cascade,
  resource_id uuid not null references public."Resources"(id) on delete cascade,
  saved_at timestamptz not null default now(),
  primary key (user_id, resource_id)
);

create index if not exists offline_resource_saves_resource_id_idx
  on private.offline_resource_saves (resource_id);

alter table private.offline_resource_saves enable row level security;
revoke all on table private.offline_resource_saves from public, anon, authenticated;

create or replace function private.save_offline_resource(p_resource_id uuid)
returns boolean
language plpgsql
security definer
set search_path to ''
as $function$
declare
  current_user_id uuid := (select auth.uid());
  current_level smallint;
  allowed boolean := false;
begin
  if current_user_id is null or p_resource_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select s."Level"::smallint
    into current_level
  from public.students s
  where s.user_id = current_user_id
    and s."Verified" is true
    and lower(coalesce(s."Role", '')) = 'student'
    and s."Level" ~ '^[0-9]+$';

  if current_level is null then
    raise exception 'Verified student access required' using errcode = '42501';
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
    select 1
    from public."Resources" r
    where r.id = p_resource_id
      and r.visibility is true
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

create or replace function private.remove_offline_resource_save(p_resource_id uuid)
returns boolean
language plpgsql
security definer
set search_path to ''
as $function$
declare
  current_user_id uuid := (select auth.uid());
begin
  if current_user_id is null or p_resource_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.students s
    where s.user_id = current_user_id
      and s."Verified" is true
      and lower(coalesce(s."Role", '')) = 'student'
  ) then
    raise exception 'Verified student access required' using errcode = '42501';
  end if;

  delete from private.offline_resource_saves
  where user_id = current_user_id
    and resource_id = p_resource_id;

  return true;
end;
$function$;

create or replace function public.save_offline_resource(resource_id_input uuid)
returns boolean
language sql
set search_path to ''
as $function$
  select private.save_offline_resource(resource_id_input);
$function$;

create or replace function public.remove_offline_resource_save(resource_id_input uuid)
returns boolean
language sql
set search_path to ''
as $function$
  select private.remove_offline_resource_save(resource_id_input);
$function$;

revoke all on function private.save_offline_resource(uuid) from public, anon, authenticated;
revoke all on function private.remove_offline_resource_save(uuid) from public, anon, authenticated;
revoke all on function public.save_offline_resource(uuid) from public, anon;
revoke all on function public.remove_offline_resource_save(uuid) from public, anon;
grant execute on function public.save_offline_resource(uuid) to authenticated;
grant execute on function public.remove_offline_resource_save(uuid) to authenticated;

-- Update resource-view authorization so analytics match the expanded library access.
create or replace function private.record_resource_view(p_resource_id uuid, p_source_page text)
returns boolean
language plpgsql
security definer
set search_path to ''
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
    select 1
    from private.resource_views rv
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

-- Add Offline Saves to the admin aggregate without exposing student-level records.
create or replace function private.get_admin_dashboard_stats_internal()
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  stats jsonb;
begin
  if not exists (
    select 1
    from public.students current_admin
    where current_admin.user_id = (select auth.uid())
      and current_admin."Verified" is true
      and lower(coalesce(current_admin."Role", '')) in ('admin', 'owner')
  ) then
    return null;
  end if;

  select jsonb_build_object(
    'total_users', (select count(*)::bigint from public.students),
    'total_students', (select count(*)::bigint from public.students where lower(coalesce("Role", '')) = 'student'),
    'verified_users', (select count(*)::bigint from public.students where "Verified" is true),
    'pending_verification', (select count(*)::bigint from public.students where "Verified" is not true),
    'admin_users', (select count(*)::bigint from public.students where lower(coalesce("Role", '')) = 'admin'),
    'owner_users', (select count(*)::bigint from public.students where lower(coalesce("Role", '')) = 'owner'),
    'new_users_7d', (select count(*)::bigint from public.students where created_at >= now() - interval '7 days'),
    'users_by_level', coalesce((
      select jsonb_object_agg(level_label, total)
      from (
        select coalesce(nullif("Level", ''), 'Unassigned') as level_label, count(*)::bigint as total
        from public.students group by 1
      ) level_totals
    ), '{}'::jsonb),
    'total_resources', (select count(*)::bigint from public."Resources"),
    'published_resources', (select count(*)::bigint from public."Resources" where visibility is true),
    'featured_resources', (select count(*)::bigint from public."Resources" where featured is true),
    'total_downloads', (select coalesce(sum(download_count), 0)::bigint from public."Resources"),
    'total_offline_saves', (select count(*)::bigint from private.offline_resource_saves),
    'total_views', (select coalesce(sum(view_count), 0)::bigint from public."Resources"),
    'resources_added_7d', (select count(*)::bigint from public."Resources" where created_at >= now() - interval '7 days'),
    'latest_resource_at', (select max(created_at) from public."Resources"),
    'resources_by_type', coalesce((
      select jsonb_object_agg(resource_type_label, total)
      from (
        select coalesce(nullif(resource_type, ''), 'Unspecified') as resource_type_label,
               count(*)::bigint as total
        from public."Resources" group by 1
      ) resource_type_totals
    ), '{}'::jsonb)
  ) into stats;

  return stats;
end;
$function$;

-- The owner activity RPC gains one aggregate metric. No individual student records are returned.
drop function if exists public.owner_activity_overview();
drop function if exists private.owner_activity_overview();

create function private.owner_activity_overview()
returns table (
  views_last_7_days bigint,
  views_last_30_days bigint,
  unique_viewers_last_7_days bigint,
  total_offline_saves bigint,
  daily_views jsonb
)
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'auth'
as $function$
begin
  if not exists (
    select 1 from public.students s
    where s.user_id = (select auth.uid())
      and s."Verified" is true
      and lower(coalesce(s."Role", '')) = 'owner'
  ) then
    raise exception 'Owner access required' using errcode = '42501';
  end if;

  return query
  with activity as (
    select
      count(*) filter (where rv.viewed_at >= now() - interval '7 days')::bigint as last_7,
      count(*) filter (where rv.viewed_at >= now() - interval '30 days')::bigint as last_30,
      count(distinct rv.user_id) filter (where rv.viewed_at >= now() - interval '7 days')::bigint as unique_7
    from private.resource_views rv
  ),
  days as (
    select generate_series(
      date_trunc('day', now()) - interval '6 days',
      date_trunc('day', now()),
      interval '1 day'
    ) as day_start
  ),
  daily as (
    select d.day_start, count(rv.id)::bigint as view_count
    from days d
    left join private.resource_views rv
      on rv.viewed_at >= d.day_start
     and rv.viewed_at < d.day_start + interval '1 day'
    group by d.day_start
  )
  select
    a.last_7,
    a.last_30,
    a.unique_7,
    (select count(*)::bigint from private.offline_resource_saves),
    coalesce(
      (select jsonb_agg(
        jsonb_build_object(
          'date', d.day_start::date,
          'label', to_char(d.day_start, 'Dy'),
          'views', d.view_count
        ) order by d.day_start
      ) from daily d),
      '[]'::jsonb
    )
  from activity a;
end;
$function$;

create function public.owner_activity_overview()
returns table (
  views_last_7_days bigint,
  views_last_30_days bigint,
  unique_viewers_last_7_days bigint,
  total_offline_saves bigint,
  daily_views jsonb
)
language sql
security definer
set search_path to ''
as $function$
  select * from private.owner_activity_overview();
$function$;

revoke all on function private.owner_activity_overview() from public, anon, authenticated;
revoke all on function public.owner_activity_overview() from public, anon;
grant execute on function public.owner_activity_overview() to authenticated;
