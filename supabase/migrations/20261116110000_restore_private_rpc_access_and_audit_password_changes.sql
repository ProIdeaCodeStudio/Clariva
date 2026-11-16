-- Restore only the private-schema access required by authenticated RPC wrappers.
-- Internal tables remain inaccessible to API roles; only explicitly granted
-- functions can be executed after schema USAGE is restored.
GRANT USAGE ON SCHEMA private TO authenticated;

REVOKE ALL ON FUNCTION private.get_admin_dashboard_stats_internal() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.get_admin_dashboard_stats_internal() TO authenticated;

REVOKE ALL ON FUNCTION private.record_resource_view(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.record_resource_view(uuid, text) TO authenticated;

-- Authenticated users need row-level CRUD through the Resources policies, but
-- do not need table-wide TRUNCATE, REFERENCES, or TRIGGER privileges.
REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE public."Resources" FROM authenticated;

-- Store a recovery-session snapshot before Auth updates the password. Supabase
-- clears auth.users.recovery_sent_at during a successful password update, so
-- completion must use this private snapshot rather than revalidating that field.
CREATE TABLE IF NOT EXISTS private.password_reset_recovery_attempts (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id uuid NOT NULL,
  session_created_at timestamptz NOT NULL,
  recovery_sent_at timestamptz NOT NULL,
  started_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp()
);

ALTER TABLE private.password_reset_recovery_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.password_reset_recovery_attempts
  FROM PUBLIC, anon, authenticated, service_role;

-- Record an actual password-hash update. auth.users.updated_at is not a
-- password-specific signal because other user attributes can also be updated.
CREATE TABLE IF NOT EXISTS private.password_reset_password_changes (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  changed_at timestamptz NOT NULL
);

ALTER TABLE private.password_reset_password_changes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.password_reset_password_changes
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.record_password_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF OLD.encrypted_password IS DISTINCT FROM NEW.encrypted_password THEN
    INSERT INTO private.password_reset_password_changes (user_id, changed_at)
    VALUES (NEW.id, pg_catalog.clock_timestamp())
    ON CONFLICT (user_id)
    DO UPDATE SET changed_at = EXCLUDED.changed_at;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION private.record_password_change()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS on_auth_password_changed_clariva ON auth.users;
CREATE TRIGGER on_auth_password_changed_clariva
AFTER UPDATE OF encrypted_password ON auth.users
FOR EACH ROW
WHEN (OLD.encrypted_password IS DISTINCT FROM NEW.encrypted_password)
EXECUTE FUNCTION private.record_password_change();

-- Return true only for the exact recovery session previously accepted by the
-- begin RPC. This remains usable after Auth clears recovery_sent_at on update.
CREATE OR REPLACE FUNCTION public.is_required_password_reset_in_progress()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, private, pg_temp
AS $function$
  SELECT auth.uid() IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM private.password_reset_recovery_attempts AS attempt
       JOIN auth.users AS auth_user
         ON auth_user.id = attempt.user_id
       JOIN public.students AS student
         ON student.user_id = attempt.user_id
       WHERE attempt.user_id = auth.uid()
         AND attempt.session_id = NULLIF(auth.jwt() ->> 'session_id', '')::uuid
         AND student.password_reset_required IS TRUE
         AND (
           auth_user.recovery_sent_at IS NULL
           OR auth_user.recovery_sent_at = attempt.recovery_sent_at
         )
     );
$function$;

REVOKE ALL ON FUNCTION public.is_required_password_reset_in_progress()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_required_password_reset_in_progress()
  TO authenticated;

-- Snapshot a verified recovery session before auth.updateUser({ password }).
-- Repeated calls for the same session are safe, including after the password
-- update has cleared recovery_sent_at.
CREATE OR REPLACE FUNCTION public.begin_required_password_reset()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, private, pg_temp
AS $function$
DECLARE
  v_session_id uuid;
  v_session_created_at timestamptz;
  v_recovery_sent_at timestamptz;
  v_existing_session_id uuid;
  v_existing_recovery_sent_at timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication is required.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.students
    WHERE user_id = auth.uid()
      AND password_reset_required IS TRUE
  ) THEN
    RAISE EXCEPTION 'No pending mandatory password reset was found.';
  END IF;

  v_session_id := NULLIF(auth.jwt() ->> 'session_id', '')::uuid;

  SELECT session_id, recovery_sent_at
    INTO v_existing_session_id, v_existing_recovery_sent_at
    FROM private.password_reset_recovery_attempts
   WHERE user_id = auth.uid();

  SELECT recovery_sent_at
    INTO v_recovery_sent_at
    FROM auth.users
   WHERE id = auth.uid();

  IF v_existing_session_id = v_session_id
     AND (
       v_recovery_sent_at IS NULL
       OR v_existing_recovery_sent_at = v_recovery_sent_at
     ) THEN
    RETURN;
  END IF;

  IF NOT public.is_valid_required_password_recovery_session() THEN
    RAISE EXCEPTION 'Complete the password reset using the latest secure email recovery link.';
  END IF;

  SELECT created_at
    INTO v_session_created_at
    FROM auth.sessions
   WHERE id = v_session_id
     AND user_id = auth.uid();

  IF v_session_id IS NULL
     OR v_session_created_at IS NULL
     OR v_recovery_sent_at IS NULL
     OR v_session_created_at < v_recovery_sent_at THEN
    RAISE EXCEPTION 'The secure recovery session could not be verified.';
  END IF;

  INSERT INTO private.password_reset_recovery_attempts (
    user_id, session_id, session_created_at, recovery_sent_at, started_at
  )
  VALUES (
    auth.uid(), v_session_id, v_session_created_at,
    v_recovery_sent_at, pg_catalog.clock_timestamp()
  )
  ON CONFLICT (user_id)
  DO UPDATE SET
    session_id = EXCLUDED.session_id,
    session_created_at = EXCLUDED.session_created_at,
    recovery_sent_at = EXCLUDED.recovery_sent_at,
    started_at = EXCLUDED.started_at;
END;
$function$;

REVOKE ALL ON FUNCTION public.begin_required_password_reset()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.begin_required_password_reset()
  TO authenticated;

-- Clear the mandatory-reset flag only when the exact accepted recovery session
-- has subsequently changed auth.users.encrypted_password.
CREATE OR REPLACE FUNCTION public.complete_required_password_reset()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, private, pg_temp
AS $function$
DECLARE
  v_session_id uuid;
  v_attempt_session_id uuid;
  v_session_created_at timestamptz;
  v_attempt_recovery_sent_at timestamptz;
  v_current_recovery_sent_at timestamptz;
  v_password_changed_at timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication is required.';
  END IF;

  v_session_id := NULLIF(auth.jwt() ->> 'session_id', '')::uuid;

  SELECT session_id, session_created_at, recovery_sent_at
    INTO v_attempt_session_id, v_session_created_at, v_attempt_recovery_sent_at
    FROM private.password_reset_recovery_attempts
   WHERE user_id = auth.uid();

  IF v_attempt_session_id IS NULL
     OR v_session_id IS DISTINCT FROM v_attempt_session_id THEN
    RAISE EXCEPTION 'Complete the password reset using the accepted recovery session.';
  END IF;

  SELECT recovery_sent_at
    INTO v_current_recovery_sent_at
    FROM auth.users
   WHERE id = auth.uid();

  IF v_current_recovery_sent_at IS NOT NULL
     AND v_current_recovery_sent_at IS DISTINCT FROM v_attempt_recovery_sent_at THEN
    RAISE EXCEPTION 'A newer recovery link was requested. Use the latest email link.';
  END IF;

  SELECT changed_at
    INTO v_password_changed_at
    FROM private.password_reset_password_changes
   WHERE user_id = auth.uid();

  IF v_session_created_at IS NULL
     OR v_password_changed_at IS NULL
     OR v_password_changed_at <= v_session_created_at THEN
    RAISE EXCEPTION 'Update your password using this recovery link before completing the required reset.';
  END IF;

  UPDATE public.students
     SET password_reset_required = FALSE
   WHERE user_id = auth.uid()
     AND password_reset_required IS TRUE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No pending password reset was found for this account.';
  END IF;

  DELETE FROM private.password_reset_password_changes
   WHERE user_id = auth.uid();

  DELETE FROM private.password_reset_recovery_attempts
   WHERE user_id = auth.uid();
END;
$function$;

REVOKE ALL ON FUNCTION public.complete_required_password_reset()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_required_password_reset()
  TO authenticated;
