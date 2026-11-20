-- Optimize verified administrator resource policies by evaluating auth.uid()
-- once per statement through an initPlan rather than once per candidate row.
-- Authorization conditions are unchanged.

DROP POLICY IF EXISTS "Admins and owners can upload resources" ON public."Resources";
CREATE POLICY "Admins and owners can upload resources"
ON public."Resources"
FOR INSERT
TO authenticated
WITH CHECK (
  uploaded_by = (SELECT auth.uid())
  AND EXISTS (
    SELECT 1
    FROM public.students
    WHERE students.user_id = (SELECT auth.uid())
      AND students."Verified" = true
      AND lower(students."Role") = ANY (ARRAY['admin'::text, 'owner'::text])
  )
);

DROP POLICY IF EXISTS "Admins and owners can delete resources" ON public."Resources";
CREATE POLICY "Admins and owners can delete resources"
ON public."Resources"
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.students
    WHERE students.user_id = (SELECT auth.uid())
      AND students."Verified" = true
      AND lower(students."Role") = ANY (ARRAY['admin'::text, 'owner'::text])
  )
);

DROP POLICY IF EXISTS "Admins and owners can update resources" ON public."Resources";
CREATE POLICY "Admins and owners can update resources"
ON public."Resources"
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.students
    WHERE students.user_id = (SELECT auth.uid())
      AND students."Verified" = true
      AND lower(students."Role") = ANY (ARRAY['admin'::text, 'owner'::text])
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.students
    WHERE students.user_id = (SELECT auth.uid())
      AND students."Verified" = true
      AND lower(students."Role") = ANY (ARRAY['admin'::text, 'owner'::text])
  )
);
