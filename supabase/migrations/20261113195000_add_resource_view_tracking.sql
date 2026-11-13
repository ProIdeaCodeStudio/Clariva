CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA private TO authenticated;

ALTER TABLE public."Resources"
  ADD COLUMN IF NOT EXISTS view_count bigint NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS private.resource_views (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  resource_id uuid NOT NULL REFERENCES public."Resources"(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  viewed_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE private.resource_views ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.resource_views FROM PUBLIC, anon, authenticated;
DROP POLICY IF EXISTS "No direct access to resource view events" ON private.resource_views;
CREATE POLICY "No direct access to resource view events"
  ON private.resource_views
  FOR ALL
  TO PUBLIC
  USING (false)
  WITH CHECK (false);

CREATE INDEX IF NOT EXISTS resource_views_resource_viewed_idx
  ON private.resource_views (resource_id, viewed_at DESC);
CREATE INDEX IF NOT EXISTS resource_views_user_resource_viewed_idx
  ON private.resource_views (user_id, resource_id, viewed_at DESC);

CREATE OR REPLACE FUNCTION private.record_resource_view(p_resource_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  current_user_id uuid := (SELECT auth.uid());
  resource_allowed boolean := false;
BEGIN
  IF current_user_id IS NULL OR p_resource_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.students AS s
    JOIN public."Resources" AS r ON r.id = p_resource_id
    WHERE s.user_id = current_user_id
      AND s."Verified" IS TRUE
      AND lower(COALESCE(s."Role", '')) = 'student'
      AND r.visibility IS TRUE
      AND s."Level" = r.level::text
  )
  INTO resource_allowed;

  IF NOT resource_allowed THEN
    RETURN false;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(current_user_id::text || p_resource_id::text, 0)
  );

  IF EXISTS (
    SELECT 1
    FROM private.resource_views AS rv
    WHERE rv.user_id = current_user_id
      AND rv.resource_id = p_resource_id
      AND rv.viewed_at >= now() - interval '30 seconds'
  ) THEN
    RETURN false;
  END IF;

  INSERT INTO private.resource_views (resource_id, user_id)
  VALUES (p_resource_id, current_user_id);

  UPDATE public."Resources"
  SET view_count = COALESCE(view_count, 0) + 1
  WHERE id = p_resource_id;

  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION private.record_resource_view(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.record_resource_view(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.record_resource_view(resource_id_input uuid)
RETURNS boolean
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $function$
  SELECT private.record_resource_view(resource_id_input);
$function$;

REVOKE ALL ON FUNCTION public.record_resource_view(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_resource_view(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION private.get_admin_dashboard_stats_internal()
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
    'total_views', (SELECT COALESCE(SUM(view_count), 0)::bigint FROM public."Resources"),
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
