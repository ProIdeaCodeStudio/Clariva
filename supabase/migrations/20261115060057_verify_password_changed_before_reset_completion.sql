-- Bind completion of a required reset to an actual Supabase Auth password change.
-- Keep the pre-reset password fingerprint in a non-API-exposed schema.
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS private.password_reset_pending (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  password_hash_digest text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON TABLE private.password_reset_pending FROM PUBLIC, anon, authenticated;

INSERT INTO private.password_reset_pending (user_id, password_hash_digest)
SELECT
  s.user_id,
  encode(sha256(convert_to(u.encrypted_password, 'UTF8')), 'hex')
FROM public.students s
JOIN auth.users u ON u.id = s.user_id
WHERE s.password_reset_required IS TRUE
  AND u.encrypted_password IS NOT NULL
ON CONFLICT (user_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.complete_required_password_reset()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_previous_digest text;
  v_current_digest text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication is required.';
  END IF;

  SELECT password_hash_digest
  INTO v_previous_digest
  FROM private.password_reset_pending
  WHERE user_id = auth.uid();

  SELECT encode(sha256(convert_to(encrypted_password, 'UTF8')), 'hex')
  INTO v_current_digest
  FROM auth.users
  WHERE id = auth.uid();

  IF v_previous_digest IS NULL
     OR v_current_digest IS NULL
     OR v_current_digest = v_previous_digest THEN
    RAISE EXCEPTION 'Change your password before completing this required reset.';
  END IF;

  UPDATE public.students
  SET password_reset_required = false
  WHERE user_id = auth.uid()
    AND password_reset_required IS TRUE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No pending password reset was found for this account.';
  END IF;

  DELETE FROM private.password_reset_pending
  WHERE user_id = auth.uid();
END;
$$;

REVOKE ALL ON FUNCTION public.complete_required_password_reset() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_required_password_reset() TO authenticated;
