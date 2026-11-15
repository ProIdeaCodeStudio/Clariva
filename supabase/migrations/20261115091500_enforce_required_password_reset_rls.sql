-- Enforce the mandatory password-reset gate at the data layer.
-- A user with a pending reset cannot read or modify Clariva resources or
-- access objects in the private resource bucket until the reset is complete.

CREATE POLICY "Require password reset before resource access"
ON public."Resources"
AS RESTRICTIVE
FOR ALL
TO authenticated
USING (
  NOT EXISTS (
    SELECT 1
    FROM public.students s
    WHERE s.user_id = (SELECT auth.uid())
      AND s.password_reset_required IS TRUE
  )
)
WITH CHECK (
  NOT EXISTS (
    SELECT 1
    FROM public.students s
    WHERE s.user_id = (SELECT auth.uid())
      AND s.password_reset_required IS TRUE
  )
);

CREATE POLICY "Require password reset before resource storage access"
ON storage.objects
AS RESTRICTIVE
FOR ALL
TO authenticated
USING (
  bucket_id <> 'clariva-resources'
  OR NOT EXISTS (
    SELECT 1
    FROM public.students s
    WHERE s.user_id = (SELECT auth.uid())
      AND s.password_reset_required IS TRUE
  )
)
WITH CHECK (
  bucket_id <> 'clariva-resources'
  OR NOT EXISTS (
    SELECT 1
    FROM public.students s
    WHERE s.user_id = (SELECT auth.uid())
      AND s.password_reset_required IS TRUE
  )
);
