-- Reproducible bootstrap for the resource-view objects.
-- The production table was created during implementation outside the recorded
-- migration history. Including its initial definition here allows a clean
-- deployment to replay the following recorded migration safely.
ALTER TABLE public."Resources"
  ADD COLUMN IF NOT EXISTS view_count bigint NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS private.resource_views (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  resource_id uuid NOT NULL REFERENCES public."Resources"(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  viewed_at timestamptz NOT NULL DEFAULT now(),
  source_page text NOT NULL DEFAULT 'legacy'
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

ALTER TABLE private.resource_views
  ADD COLUMN IF NOT EXISTS source_page text NOT NULL DEFAULT 'legacy';

ALTER TABLE private.resource_views
  DROP CONSTRAINT IF EXISTS resource_views_source_page_check;

ALTER TABLE private.resource_views
  ADD CONSTRAINT resource_views_source_page_check
  CHECK (source_page IN ('legacy', 'undergraduates'));

DROP FUNCTION IF EXISTS public.record_resource_view(uuid);
DROP FUNCTION IF EXISTS private.record_resource_view(uuid);

CREATE OR REPLACE FUNCTION private.record_resource_view(
  p_resource_id uuid,
  p_source_page text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  current_user_id uuid := (SELECT auth.uid());
  resource_allowed boolean := false;
BEGIN
  IF current_user_id IS NULL
     OR p_resource_id IS NULL
     OR p_source_page IS DISTINCT FROM 'undergraduates' THEN
    RETURN false;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.students AS s
    JOIN public."Resources" AS r ON r.id = p_resource_id
    WHERE s.user_id = current_user_id
      AND s."Verified" IS TRUE
      AND lower(COALESCE(s."Role", '')) IN ('student', 'admin', 'owner')
      AND r.visibility IS TRUE
      AND (
        lower(COALESCE(s."Role", '')) IN ('admin', 'owner')
        OR (
          lower(COALESCE(s."Role", '')) = 'student'
          AND s."Level" = r.level::text
        )
      )
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

  INSERT INTO private.resource_views (resource_id, user_id, source_page)
  VALUES (p_resource_id, current_user_id, p_source_page);

  UPDATE public."Resources"
  SET view_count = COALESCE(view_count, 0) + 1
  WHERE id = p_resource_id;

  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION private.record_resource_view(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.record_resource_view(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.record_resource_view(
  resource_id_input uuid,
  source_page_input text
)
RETURNS boolean
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $function$
  SELECT private.record_resource_view(resource_id_input, source_page_input);
$function$;

REVOKE ALL ON FUNCTION public.record_resource_view(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_resource_view(uuid, text) TO authenticated;
