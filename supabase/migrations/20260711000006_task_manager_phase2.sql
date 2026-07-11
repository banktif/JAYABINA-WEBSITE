-- =============================================
-- JAYACLEAN - Task Manager Phase 2
-- Tasks + task_photos + trigger + backfill
-- (ASCII only - no em dashes)
-- =============================================

-- 1. TASKS (one per booking)
CREATE TABLE IF NOT EXISTS tasks (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id   UUID NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE CASCADE,
  assigned_to  UUID REFERENCES profiles(id) ON DELETE SET NULL,
  status       TEXT NOT NULL DEFAULT 'unassigned'
               CHECK (status IN ('unassigned','assigned','in_progress','awaiting_review','completed','cancelled')),
  started_at   TIMESTAMPTZ,
  finished_at  TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tasks_booking_id ON tasks(booking_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to ON tasks(assigned_to);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);

-- 2. TASK PHOTOS (before/after)
CREATE TABLE IF NOT EXISTS task_photos (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id     UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  type        TEXT NOT NULL CHECK (type IN ('before','after')),
  url         TEXT NOT NULL,
  uploaded_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_photos_task_id ON task_photos(task_id);

-- 3. TRIGGER: create a task when a booking becomes confirmed
CREATE OR REPLACE FUNCTION public.handle_booking_confirmed()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'confirmed' THEN
    INSERT INTO public.tasks (booking_id)
    VALUES (NEW.id)
    ON CONFLICT (booking_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_booking_confirmed ON bookings;
CREATE TRIGGER on_booking_confirmed
  AFTER INSERT OR UPDATE OF status ON bookings
  FOR EACH ROW EXECUTE FUNCTION public.handle_booking_confirmed();

-- 4. BACKFILL tasks for existing confirmed bookings
INSERT INTO tasks (booking_id)
SELECT b.id FROM bookings b
WHERE b.status = 'confirmed'
  AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.booking_id = b.id);

-- 5. RLS - TASKS
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tasks admin all" ON tasks;
CREATE POLICY "tasks admin all" ON tasks
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "tasks staff read own" ON tasks;
CREATE POLICY "tasks staff read own" ON tasks
  FOR SELECT TO authenticated
  USING (assigned_to = auth.uid());

DROP POLICY IF EXISTS "tasks staff update own" ON tasks;
CREATE POLICY "tasks staff update own" ON tasks
  FOR UPDATE TO authenticated
  USING (assigned_to = auth.uid())
  WITH CHECK (assigned_to = auth.uid());

-- 6. RLS - TASK PHOTOS
ALTER TABLE task_photos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "photos admin read" ON task_photos;
CREATE POLICY "photos admin read" ON task_photos
  FOR SELECT TO authenticated
  USING (public.is_admin() OR EXISTS (
    SELECT 1 FROM tasks t WHERE t.id = task_id AND t.assigned_to = auth.uid()
  ));

DROP POLICY IF EXISTS "photos staff insert own" ON task_photos;
CREATE POLICY "photos staff insert own" ON task_photos
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM tasks t WHERE t.id = task_id AND t.assigned_to = auth.uid()
  ));

DROP POLICY IF EXISTS "photos admin manage" ON task_photos;
CREATE POLICY "photos admin manage" ON task_photos
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- 7. RLS - staff can read bookings linked to their assigned tasks
DROP POLICY IF EXISTS "bookings staff read assigned" ON bookings;
CREATE POLICY "bookings staff read assigned" ON bookings
  FOR SELECT TO authenticated
  USING (public.is_admin() OR EXISTS (
    SELECT 1 FROM tasks t WHERE t.booking_id = bookings.id AND t.assigned_to = auth.uid()
  ));

-- 8. Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
NOTIFY pgrst, 'reload config';
