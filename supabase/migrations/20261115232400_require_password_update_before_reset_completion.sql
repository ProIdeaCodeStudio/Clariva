-- Require a password update after the verified recovery session was created.
-- Supabase updates auth.users.updated_at when auth.updateUser({ password })
-- succeeds, including when the user chooses to retain the same password.

CREATE OR REPLACE FUNCTION public.complete_required_password_reset()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
DECLARE
  v_session_id uuid;
  v_session_created_at timestamptz;
  v_user_updated_at timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication is required.';
  END IF;

  IF NOT public.is_valid_required_password_recovery_session() THEN
    RAISE EXCEPTION 'Complete the password reset using the latest secure email recovery link.';
  END IF;

  v_session_id := NULLIF(auth.jwt() ->> 'session_id', '')::uuid;

  SELECT created_at
    INTO v_session_created_at
    FROM auth.sessions
   WHERE id = v_session_id
     AND user_id = auth.uid();

  SELECT updated_at
    INTO v_user_updated_at
    FROM auth.users
   WHERE id = auth.uid();

  IF v_session_created_at IS NULL
     OR v_user_updated_at IS NULL
     OR v_user_updated_at <= v_session_created_at THEN
    RAISE EXCEPTION 'Update your password before completing the required reset.';
  END IF;

  UPDATE public.students
     SET password_reset_required = FALSE
   WHERE user_id = auth.uid()
     AND password_reset_required IS TRUE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No pending password reset was found for this account.';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_required_password_reset() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_required_password_reset() FROM anon;
GRANT EXECUTE ON FUNCTION public.complete_required_password_reset() TO authenticated;
