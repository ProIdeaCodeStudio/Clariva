-- Clariva: required password reset, filename-based resource titles,
-- and temporary featured-resource expiry.

ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS password_reset_required boolean NOT NULL DEFAULT false;

-- Require every account that existed before this migration to update its password
-- on its next successful login. New accounts retain the default false value.
UPDATE public.students
SET password_reset_required = true
WHERE password_reset_required = false;

ALTER TABLE public."Resources"
  ADD COLUMN IF NOT EXISTS featured_until timestamptz,
  ADD COLUMN IF NOT EXISTS featured_permanent boolean NOT NULL DEFAULT false;

-- Existing featured items were explicitly featured by an administrator.
-- Preserve that decision as permanent; normalize all existing titles from file names.
UPDATE public."Resources"
SET
  title = COALESCE(
    NULLIF(
      btrim(regexp_replace(regexp_replace(file_name, '\\.[^.]+$', ''), '[_-]+', ' ', 'g')),
      ''
    ),
    title
  ),
  featured_permanent = CASE WHEN featured IS TRUE THEN true ELSE false END,
  featured_until = NULL;

-- A narrowly scoped RPC lets an authenticated user clear only their own
-- mandatory-reset flag, and only after Supabase Auth has accepted a new password.
CREATE OR REPLACE FUNCTION public.complete_required_password_reset()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication is required.';
  END IF;

  UPDATE public.students
  SET password_reset_required = false
  WHERE user_id = auth.uid()
    AND password_reset_required IS TRUE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No pending password reset was found for this account.';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_required_password_reset() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_required_password_reset() TO authenticated;

-- Install pg_cron and expire temporary featured resources automatically.
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

SELECT cron.schedule(
  'clariva-expire-temporary-featured-resources',
  '*/10 * * * *',
  $job$
    UPDATE public."Resources"
    SET featured = false,
        featured_until = NULL
    WHERE featured IS TRUE
      AND featured_permanent IS FALSE
      AND featured_until IS NOT NULL
      AND featured_until <= now();
  $job$
);
, ''), '[_-]+', ' ', 'g')),
      ''
    ),
    title
  ),
  featured_permanent = CASE WHEN featured IS TRUE THEN true ELSE false END,
  featured_until = NULL;

-- A narrowly scoped RPC lets an authenticated user clear only their own
-- mandatory-reset flag, and only after Supabase Auth has accepted a new password.
CREATE OR REPLACE FUNCTION public.complete_required_password_reset()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication is required.';
  END IF;

  UPDATE public.students
  SET password_reset_required = false
  WHERE user_id = auth.uid()
    AND password_reset_required IS TRUE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No pending password reset was found for this account.';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_required_password_reset() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_required_password_reset() TO authenticated;

-- Install pg_cron and expire temporary featured resources automatically.
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

SELECT cron.schedule(
  'clariva-expire-temporary-featured-resources',
  '*/10 * * * *',
  $job$
    UPDATE public."Resources"
    SET featured = false,
        featured_until = NULL
    WHERE featured IS TRUE
      AND featured_permanent IS FALSE
      AND featured_until IS NOT NULL
      AND featured_until <= now();
  $job$
);
