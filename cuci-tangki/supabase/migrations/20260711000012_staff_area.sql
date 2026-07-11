-- =============================================
-- JAYACLEAN - Staff Area Assignment
-- Each staff has a fixed service_area.
-- Area-based auto-assign matches staff.service_area to booking area.
-- =============================================

-- 1. Add service_area column to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS service_area TEXT DEFAULT '';

-- 2. Update auto_assign_task: area_based now uses staff.service_area matching
CREATE OR REPLACE FUNCTION public.auto_assign_task(p_task_id UUID, p_force BOOLEAN DEFAULT false)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_enabled TEXT;
  v_rule    TEXT;
  v_staff   UUID;
  v_area    TEXT;
BEGIN
  IF NOT p_force THEN
    SELECT value INTO v_enabled FROM app_settings WHERE key = 'auto_assign_enabled';
    IF v_enabled IS DISTINCT FROM 'true' THEN RETURN NULL; END IF;
  END IF;

  SELECT value INTO v_rule FROM app_settings WHERE key = 'auto_assign_rule';

  -- Detect area from booking address
  SELECT public.detect_area(b.customer_address) INTO v_area
  FROM tasks t JOIN bookings b ON b.id = t.booking_id
  WHERE t.id = p_task_id;

  IF v_rule = 'area_based' AND v_area IS NOT NULL THEN
    -- Priority 1: staff whose service_area matches the detected booking area, least loaded
    SELECT p.id INTO v_staff
    FROM profiles p
    LEFT JOIN tasks t ON t.assigned_to = p.id
      AND t.status IN ('assigned','in_progress','awaiting_review')
    WHERE p.role = 'staff' AND p.is_active = true
      AND lower(trim(p.service_area)) = lower(trim(v_area))
    GROUP BY p.id
    ORDER BY count(t.id) ASC, random()
    LIMIT 1;

    -- Priority 2: if no matching-area staff, fallback to any least loaded
    IF v_staff IS NULL THEN
      SELECT p.id INTO v_staff
      FROM profiles p
      LEFT JOIN tasks t ON t.assigned_to = p.id
        AND t.status IN ('assigned','in_progress','awaiting_review')
      WHERE p.role = 'staff' AND p.is_active = true
      GROUP BY p.id
      ORDER BY count(t.id) ASC, random()
      LIMIT 1;
    END IF;
  ELSIF v_rule = 'area_based' THEN
    -- No area detected — fallback to least-loaded
    SELECT p.id INTO v_staff
    FROM profiles p
    LEFT JOIN tasks t ON t.assigned_to = p.id
      AND t.status IN ('assigned','in_progress','awaiting_review')
    WHERE p.role = 'staff' AND p.is_active = true
    GROUP BY p.id
    ORDER BY count(t.id) ASC, random()
    LIMIT 1;
  ELSIF v_rule = 'least_loaded' THEN
    SELECT p.id INTO v_staff
    FROM profiles p
    LEFT JOIN tasks t ON t.assigned_to = p.id
      AND t.status IN ('assigned','in_progress','awaiting_review')
    WHERE p.role = 'staff' AND p.is_active = true
    GROUP BY p.id
    ORDER BY count(t.id) ASC, random()
    LIMIT 1;
  ELSE
    -- round_robin
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

-- 3. Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
NOTIFY pgrst, 'reload config';
