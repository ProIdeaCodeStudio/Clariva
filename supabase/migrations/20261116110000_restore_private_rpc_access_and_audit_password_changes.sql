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

-- Clear the mandatory-reset flag only when the current, verified recovery
-- session was followed by a real encrypted_password update.
CREATE OR REPLACE FUNCTION public.complete_required_password_reset()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, private, pg_temp
AS $function$
DECLARE
  v_session_id uuid;
  v_session_created_at timestamptz;
  v_password_changed_at timestamptz;
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
END;
$function$;

REVOKE ALL ON FUNCTION public.complete_required_password_reset()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_required_password_reset()
  TO authenticated;
