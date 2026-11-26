-- Show all supported academic levels in the platform overview, including zero counts.
do $migration$
declare
  v_definition text;
  v_old text := $old$
    'resources_by_level', coalesce((
      select jsonb_object_agg(level_label, total)
      from (
        select coalesce(nullif(level::text, ''), 'Unspecified') as level_label,
               count(*)::bigint as total
        from public."Resources"
        group by 1
      ) resource_level_totals
    ), '{}'::jsonb)
$old$;
  v_new text := $new$
    'resources_by_level', coalesce((
      select jsonb_object_agg(level_label, total)
      from (
        select levels.level_label, count(r.id)::bigint as total
        from (values ('100'), ('200'), ('300'), ('400'), ('500')) as levels(level_label)
        left join public."Resources" r
          on r.level::text = levels.level_label
        group by levels.level_label
      ) resource_level_totals
    ), '{}'::jsonb)
$new$;
begin
  select pg_get_functiondef(
    'private.get_admin_dashboard_stats_internal()'::regprocedure
  ) into v_definition;

  if position(v_old in v_definition) = 0 then
    raise exception 'Could not locate the expected academic-level aggregate in the current dashboard statistics function.';
  end if;

  execute replace(v_definition, v_old, v_new);
end;
$migration$;
