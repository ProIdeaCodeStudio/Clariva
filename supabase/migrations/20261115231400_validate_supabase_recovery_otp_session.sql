-- Validate that a mandatory reset is completed from the exact Supabase
-- email-recovery session, not merely any authenticated or OTP session.
--
-- Supabase's recovery verification creates an OTP AMR session. The
-- auth.users.recovery_sent_at timestamp and auth.sessions.created_at bind
-- that session to the latest recovery request.

CREATE OR REPLACE FUNCTION public.is_valid_required_password_recovery_session()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
DECLARE
  v_session_id uuid;
  v_recovery_sent_at timestamptz;
  v_session_created_at timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN FALSE;
  END IF;

  IF NOT COALESCE(
    (auth.jwt() -> 'amr') @> '[{"method":"otp"}]'::jsonb,
    FALSE
  ) THEN
    RETURN FALSE;
  END IF;

  v_session_id := NULLIF(auth.jwt() ->> 'session_id', '')::uuid;
  IF v_session_id IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT recovery_sent_at
    INTO v_recovery_sent_at
    FROM auth.users
   WHERE id = auth.uid();

  IF v_recovery_sent_at IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT created_at
    INTO v_session_created_at
    FROM auth.sessions
   WHERE id = v_session_id
     AND user_id = auth.uid();

  RETURN v_session_created_at IS NOT NULL
     AND v_session_created_at >= v_recovery_sent_at;
EXCEPTION
  WHEN invalid_text_representation THEN
    RETURN FALSE;
END;
$$;

REVOKE ALL ON FUNCTION public.is_valid_required_password_recovery_session() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_valid_required_password_recovery_session() FROM anon;
GRANT EXECUTE ON FUNCTION public.is_valid_required_password_recovery_session() TO authenticated;

CREATE OR REPLACE FUNCTION public.complete_required_password_reset()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, private, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication is required.';
  END IF;

  IF NOT public.is_valid_required_password_recovery_session() THEN
    RAISE EXCEPTION 'Complete the password reset using the latest secure email recovery link.';
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
GRANT EXECUTE ON FUNCTION public.complete_required_password_reset() TO authenticated;
