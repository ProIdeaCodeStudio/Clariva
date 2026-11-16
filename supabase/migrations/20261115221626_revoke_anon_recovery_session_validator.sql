REVOKE ALL ON FUNCTION public.is_valid_required_password_recovery_session() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_valid_required_password_recovery_session() FROM anon;
GRANT EXECUTE ON FUNCTION public.is_valid_required_password_recovery_session() TO authenticated;
