-- Keep the reset-completion RPC callable only by signed-in users.
-- It is SECURITY DEFINER because it updates the user's protected student row,
-- but it must never be callable anonymously.
REVOKE ALL ON FUNCTION public.complete_required_password_reset()
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_required_password_reset()
TO authenticated;

REVOKE ALL ON FUNCTION public.password_reset_enforcement_enabled()
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.password_reset_enforcement_enabled()
TO authenticated;

-- Recreate the completion RPC without references to the retired fingerprint
-- table. The only accepted completion path is an Auth recovery session.
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
END;
$$;

REVOKE ALL ON FUNCTION public.complete_required_password_reset()
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_required_password_reset()
TO authenticated;

REVOKE ALL ON FUNCTION public.password_reset_enforcement_enabled()
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.password_reset_enforcement_enabled()
TO authenticated;
