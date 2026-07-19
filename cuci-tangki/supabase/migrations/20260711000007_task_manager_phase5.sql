-- =============================================
-- JAYACLEAN - Task Manager Phase 5
-- Auto-assign (round_robin / least_loaded)
-- (ASCII only)
-- =============================================

-- 1. Core auto-assign function
--    p_force = true bypasses the auto_assign_enabled flag (used by manual distribute)
CREATE OR REPLACE FUNCTION public.auto_assign_task(p_task_id UUID, p_force BOOLEAN DEFAULT false)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_enabled TEXT;
  v_rule    TEXT;
  v_staff   UUID;
BEGIN
  IF NOT p_force THEN
    SELECT value INTO v_enabled FROM app_settings WHERE key = 'auto_assign_enabled';
    IF v_enabled IS DISTINCT FROM 'true' THEN
      RETURN NULL;
    END IF;
  END IF;

  SELECT value INTO v_rule FROM app_settings WHERE key = 'auto_assign_rule';

  IF v_rule = 'least_loaded' THEN
    SELECT p.id INTO v_staff
    FROM profiles p
    LEFT JOIN tasks t ON t.assigned_to = p.id
      AND t.status IN ('assigned','in_progress','awaiting_review')
    WHERE p.role = 'staff' AND p.is_active = true
    GROUP BY p.id
    ORDER BY count(t.id) ASC, random()
    LIMIT 1;
  ELSE
    -- round_robin: least-recently assigned staff first (never-assigned staff win)
    SELECT p.id INTO v_staff
    FROM profiles p
    LEFT JOIN (
      SELECT assigned_to, max(created_at) AS last_at
      FROM tasks WHERE assigned_to IS NOT NULL
      GROUP BY assigned_to
    ) la ON la.assigned_to = p.id
    WHERE p.role = 'staff' AND p.is_active = true
    ORDER BY la.last_at ASC NULLS FIRST, random()
    LIMIT 1;
  END IF;

  IF v_staff IS NOT NULL THEN
    UPDATE tasks
    SET assigned_to = v_staff, status = 'assigned', updated_at = now()
    WHERE id = p_task_id AND assigned_to IS NULL;
  END IF;

  RETURN v_staff;
END;
$$;

-- 2. Update the booking-confirmed trigger to auto-assign the new task
CREATE OR REPLACE FUNCTION public.handle_booking_confirmed()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_task_id UUID;
BEGIN
  IF NEW.status = 'confirmed' THEN
    INSERT INTO public.tasks (booking_id)
    VALUES (NEW.id)
    ON CONFLICT (booking_id) DO NOTHING
    RETURNING id INTO v_task_id;

    IF v_task_id IS NOT NULL THEN
      PERFORM public.auto_assign_task(v_task_id, false);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- 3. Admin-only RPC: distribute all currently unassigned tasks
CREATE OR REPLACE FUNCTION public.distribute_unassigned()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
  v_staff UUID;
  n INTEGER := 0;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  FOR r IN SELECT id FROM tasks WHERE status = 'unassigned' LOOP
    v_staff := public.auto_assign_task(r.id, true);
    IF v_staff IS NOT NULL THEN
      n := n + 1;
    END IF;
  END LOOP;
  RETURN n;
END;
$$;

-- 4. Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
NOTIFY pgrst, 'reload config';
