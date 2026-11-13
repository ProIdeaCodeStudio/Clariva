DROP VIEW IF EXISTS public.admin_dashboard_stats;

CREATE OR REPLACE FUNCTION public.get_admin_dashboard_stats()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  stats jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.students AS current_admin
    WHERE current_admin.user_id = (SELECT auth.uid())
      AND current_admin."Verified" IS TRUE
      AND lower(COALESCE(current_admin."Role", '')) IN ('admin', 'owner')
  ) THEN
    RETURN NULL;
  END IF;

  SELECT jsonb_build_object(
    'total_users', (SELECT COUNT(*)::bigint FROM public.students),
    'total_students', (SELECT COUNT(*)::bigint FROM public.students WHERE lower(COALESCE("Role", '')) = 'student'),
    'verified_users', (SELECT COUNT(*)::bigint FROM public.students WHERE "Verified" IS TRUE),
    'pending_verification', (SELECT COUNT(*)::bigint FROM public.students WHERE "Verified" IS NOT TRUE),
    'admin_users', (SELECT COUNT(*)::bigint FROM public.students WHERE lower(COALESCE("Role", '')) = 'admin'),
    'owner_users', (SELECT COUNT(*)::bigint FROM public.students WHERE lower(COALESCE("Role", '')) = 'owner'),
    'new_users_7d', (SELECT COUNT(*)::bigint FROM public.students WHERE created_at >= now() - interval '7 days'),
    'users_by_level', COALESCE((
      SELECT jsonb_object_agg(level_label, total)
      FROM (
        SELECT COALESCE(NULLIF("Level", ''), 'Unassigned') AS level_label,
               COUNT(*)::bigint AS total
        FROM public.students
        GROUP BY 1
      ) AS level_totals
    ), '{}'::jsonb),
    'total_resources', (SELECT COUNT(*)::bigint FROM public."Resources"),
    'published_resources', (SELECT COUNT(*)::bigint FROM public."Resources" WHERE visibility IS TRUE),
    'featured_resources', (SELECT COUNT(*)::bigint FROM public."Resources" WHERE featured IS TRUE),
    'total_downloads', (SELECT COALESCE(SUM(download_count), 0)::bigint FROM public."Resources"),
    'resources_added_7d', (SELECT COUNT(*)::bigint FROM public."Resources" WHERE created_at >= now() - interval '7 days'),
    'latest_resource_at', (SELECT MAX(created_at) FROM public."Resources"),
    'resources_by_type', COALESCE((
      SELECT jsonb_object_agg(resource_type_label, total)
      FROM (
        SELECT COALESCE(NULLIF(resource_type, ''), 'Unspecified') AS resource_type_label,
               COUNT(*)::bigint AS total
        FROM public."Resources"
        GROUP BY 1
      ) AS resource_type_totals
    ), '{}'::jsonb)
  )
  INTO stats;

  RETURN stats;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_admin_dashboard_stats() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_dashboard_stats() TO authenticated;
