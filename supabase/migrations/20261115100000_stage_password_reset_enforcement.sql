-- Stage the database-level reset gate without locking out users of the
-- currently deployed frontend. Enable it after the updated frontend is live.
CREATE TABLE IF NOT EXISTS private.password_reset_enforcement (
  id boolean PRIMARY KEY DEFAULT true CHECK (id IS TRUE),
  enabled boolean NOT NULL DEFAULT false
);
REVOKE ALL ON TABLE private.password_reset_enforcement FROM PUBLIC, anon, authenticated;

INSERT INTO private.password_reset_enforcement (id, enabled)
VALUES (true, false)
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.password_reset_enforcement_enabled()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    (SELECT enabled FROM private.password_reset_enforcement WHERE id IS TRUE),
    false
  );
$$;

REVOKE ALL ON FUNCTION public.password_reset_enforcement_enabled() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.password_reset_enforcement_enabled() TO authenticated;

ALTER POLICY "Require password reset before resource access"
ON public."Resources"
USING (
  NOT public.password_reset_enforcement_enabled()
  OR NOT EXISTS (
    SELECT 1
    FROM public.students s
    WHERE s.user_id = (SELECT auth.uid())
      AND s.password_reset_required IS TRUE
  )
)
WITH CHECK (
  NOT public.password_reset_enforcement_enabled()
  OR NOT EXISTS (
    SELECT 1
    FROM public.students s
    WHERE s.user_id = (SELECT auth.uid())
      AND s.password_reset_required IS TRUE
  )
);

ALTER POLICY "Require password reset before resource storage access"
ON storage.objects
USING (
  bucket_id <> 'clariva-resources'
  OR NOT public.password_reset_enforcement_enabled()
  OR NOT EXISTS (
    SELECT 1
    FROM public.students s
    WHERE s.user_id = (SELECT auth.uid())
      AND s.password_reset_required IS TRUE
  )
)
WITH CHECK (
  bucket_id <> 'clariva-resources'
  OR NOT public.password_reset_enforcement_enabled()
  OR NOT EXISTS (
    SELECT 1
    FROM public.students s
    WHERE s.user_id = (SELECT auth.uid())
      AND s.password_reset_required IS TRUE
  )
);
