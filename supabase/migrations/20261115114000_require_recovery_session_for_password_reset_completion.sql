-- Require a genuine Supabase email-recovery session before clearing a
-- mandatory password-reset flag. Do not compare password hashes: Supabase
-- salts password hashes, and users are allowed to retain their old password.

CREATE OR REPLACE FUNCTION public.complete_required_password_reset()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication is required.';
  END IF;

  IF NOT COALESCE(
    (auth.jwt() -> 'amr') @> '[{"method":"recovery"}]'::jsonb,
    FALSE
  ) THEN
    RAISE EXCEPTION 'Complete the password reset using the secure email recovery link.';
  END IF;

  UPDATE public.students
  SET password_reset_required = false
  WHERE user_id = auth.uid()
    AND password_reset_required IS TRUE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No pending password reset was found for this account.';
  END IF;

  -- Retire the obsolete salted-hash fingerprint record, if present.
  DELETE FROM private.password_reset_pending
  WHERE user_id = auth.uid();
END;
$$;

REVOKE ALL ON FUNCTION public.complete_required_password_reset() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_required_password_reset() TO authenticated;

-- The fingerprint table is no longer needed. Password reuse is not prohibited.
DROP TABLE IF EXISTS private.password_reset_pending;
