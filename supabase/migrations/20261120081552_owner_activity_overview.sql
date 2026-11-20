-- Owner-only aggregate activity overview. No individual student identifiers
-- or direct resource-view rows are returned to the browser.
create or replace function private.owner_activity_overview()
returns table (
  views_last_7_days bigint,
  views_last_30_days bigint,
  unique_viewers_last_7_days bigint,
  daily_views jsonb
)
language plpgsql
security definer
set search_path = pg_catalog, public, private, auth
as $$
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
    select d.day_start,
      count(rv.id)::bigint as view_count
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
$$;

create or replace function public.owner_activity_overview()
returns table (
  views_last_7_days bigint,
  views_last_30_days bigint,
  unique_viewers_last_7_days bigint,
  daily_views jsonb
)
language sql
security invoker
set search_path = pg_catalog, public, private
as $$
  select * from private.owner_activity_overview();
$$;

revoke all on function private.owner_activity_overview() from public, anon;
grant execute on function private.owner_activity_overview() to authenticated;
revoke all on function public.owner_activity_overview() from public, anon;
grant execute on function public.owner_activity_overview() to authenticated;
