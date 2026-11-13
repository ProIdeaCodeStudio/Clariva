CREATE OR REPLACE VIEW public.admin_dashboard_stats
WITH (security_barrier = true)
AS
SELECT
  (SELECT COUNT(*)::bigint FROM public.students) AS total_users,
  (SELECT COUNT(*)::bigint FROM public.students WHERE lower(COALESCE("Role", '')) = 'student') AS total_students,
  (SELECT COUNT(*)::bigint FROM public.students WHERE "Verified" IS TRUE) AS verified_users,
  (SELECT COUNT(*)::bigint FROM public.students WHERE "Verified" IS NOT TRUE) AS pending_verification,
  (SELECT COUNT(*)::bigint FROM public.students WHERE lower(COALESCE("Role", '')) = 'admin') AS admin_users,
  (SELECT COUNT(*)::bigint FROM public.students WHERE lower(COALESCE("Role", '')) = 'owner') AS owner_users,
  (SELECT COUNT(*)::bigint FROM public.students WHERE created_at >= now() - interval '7 days') AS new_users_7d,
  COALESCE((
    SELECT jsonb_object_agg(level_label, total)
    FROM (
      SELECT COALESCE(NULLIF("Level", ''), 'Unassigned') AS level_label,
             COUNT(*)::bigint AS total
      FROM public.students
      GROUP BY 1
    ) AS level_totals
  ), '{}'::jsonb) AS users_by_level,
  (SELECT COUNT(*)::bigint FROM public."Resources") AS total_resources,
  (SELECT COUNT(*)::bigint FROM public."Resources" WHERE visibility IS TRUE) AS published_resources,
  (SELECT COUNT(*)::bigint FROM public."Resources" WHERE featured IS TRUE) AS featured_resources,
  (SELECT COALESCE(SUM(download_count), 0)::bigint FROM public."Resources") AS total_downloads,
  (SELECT COUNT(*)::bigint FROM public."Resources" WHERE created_at >= now() - interval '7 days') AS resources_added_7d,
  (SELECT MAX(created_at) FROM public."Resources") AS latest_resource_at,
  COALESCE((
    SELECT jsonb_object_agg(resource_type_label, total)
    FROM (
      SELECT COALESCE(NULLIF(resource_type, ''), 'Unspecified') AS resource_type_label,
             COUNT(*)::bigint AS total
      FROM public."Resources"
      GROUP BY 1
    ) AS resource_type_totals
  ), '{}'::jsonb) AS resources_by_type
WHERE EXISTS (
  SELECT 1
  FROM public.students AS current_admin
  WHERE current_admin.user_id = (SELECT auth.uid())
    AND current_admin."Verified" IS TRUE
    AND lower(COALESCE(current_admin."Role", '')) IN ('admin', 'owner')
);

REVOKE ALL ON public.admin_dashboard_stats FROM PUBLIC, anon;
GRANT SELECT ON public.admin_dashboard_stats TO authenticated;
