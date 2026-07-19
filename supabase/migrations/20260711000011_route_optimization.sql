-- =============================================
-- JAYACLEAN - Route Optimization
-- Area-based staff assignment + service_areas config
-- =============================================

-- 1. Add service_areas setting
INSERT INTO app_settings (key, value) VALUES
  ('service_areas', '')
ON CONFLICT (key) DO NOTHING;

-- 2. Area detection helper: returns matching area or NULL
CREATE OR REPLACE FUNCTION public.detect_area(p_address TEXT)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_areas TEXT;
  v_area  TEXT;
BEGIN
  SELECT value INTO v_areas FROM app_settings WHERE key = 'service_areas';
  IF v_areas IS NULL OR trim(v_areas) = '' THEN RETURN NULL; END IF;

  FOR v_area IN SELECT trim(t.a) FROM unnest(string_to_array(v_areas, ',')) AS t(a) WHERE trim(t.a) <> '' LOOP
    IF p_address ILIKE '%' || v_area || '%' THEN RETURN v_area; END IF;
  END LOOP;

  RETURN NULL;
END;
$$;

-- 3. Updated auto_assign_task with area_based rule
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
  v_date    DATE;
BEGIN
  IF NOT p_force THEN
    SELECT value INTO v_enabled FROM app_settings WHERE key = 'auto_assign_enabled';
    IF v_enabled IS DISTINCT FROM 'true' THEN RETURN NULL; END IF;
  END IF;

  SELECT value INTO v_rule FROM app_settings WHERE key = 'auto_assign_rule';

  -- Get booking address + date for area-based routing
  SELECT b.booking_date, public.detect_area(b.customer_address) INTO v_date, v_area
  FROM tasks t JOIN bookings b ON b.id = t.booking_id
  WHERE t.id = p_task_id;

  IF v_rule = 'area_based' AND v_area IS NOT NULL THEN
    -- Priority 1: staff already working in same area on same day, least loaded first
    SELECT p.id INTO v_staff
    FROM profiles p
    LEFT JOIN tasks t ON t.assigned_to = p.id
      AND t.status IN ('assigned','in_progress','awaiting_review')
    WHERE p.role = 'staff' AND p.is_active = true
    GROUP BY p.id
    ORDER BY
      (CASE WHEN EXISTS (
        SELECT 1 FROM tasks t2 JOIN bookings b2 ON b2.id = t2.booking_id
        WHERE t2.assigned_to = p.id
          AND t2.status IN ('assigned','in_progress','awaiting_review')
          AND b2.booking_date = v_date
          AND public.detect_area(b2.customer_address) = v_area
      ) THEN 0 ELSE 1 END) ASC,
      count(t.id) ASC, random()
    LIMIT 1;
  ELSIF v_rule = 'area_based' THEN
    -- No area detected — fall back to least-loaded for that date
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

-- 4. Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
NOTIFY pgrst, 'reload config';
