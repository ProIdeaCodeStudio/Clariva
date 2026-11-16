-- Add defense-in-depth row-level security to the private enforcement switch.
-- No client policies or grants are added. The existing SECURITY DEFINER
-- enforcement RPC is owned by postgres (BYPASSRLS), so its read remains valid.
ALTER TABLE private.password_reset_enforcement
  ENABLE ROW LEVEL SECURITY;
