ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS avatar_choice text NOT NULL DEFAULT 'avatar-1';

ALTER TABLE public.students
  DROP CONSTRAINT IF EXISTS students_avatar_choice_check;

ALTER TABLE public.students
  ADD CONSTRAINT students_avatar_choice_check
  CHECK (avatar_choice IN ('avatar-1', 'avatar-2', 'avatar-3', 'avatar-4', 'avatar-5'));

DROP POLICY IF EXISTS "Students can update their own avatar choice" ON public.students;

CREATE POLICY "Students can update their own avatar choice"
ON public.students
FOR UPDATE
TO authenticated
USING ((SELECT auth.uid()) = user_id)
WITH CHECK ((SELECT auth.uid()) = user_id);

GRANT UPDATE (avatar_choice) ON TABLE public.students TO authenticated;
