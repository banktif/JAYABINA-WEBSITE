-- =============================================
-- JAYACLEAN - Dynamic Slots
-- Remove hardcoded 4-slot limit. Slots from app_settings.
-- Multi-booking per slot. Limit per day via max_slots_per_day.
-- =============================================

-- 1. Drop CHECK constraints on time_slot values
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_booking_time_check;
ALTER TABLE slots DROP CONSTRAINT IF EXISTS slots_time_slot_check;

-- 2. Drop UNIQUE constraint on slots (allow multiple bookings per slot)
ALTER TABLE slots DROP CONSTRAINT IF EXISTS slots_date_time_slot_key;

-- 3. Update check_slot: limit by max_slots_per_day (total per day), not per time slot
CREATE OR REPLACE FUNCTION public.check_slot(p_date DATE, p_time TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_max INTEGER;
  v_cnt  INTEGER;
BEGIN
  SELECT COALESCE(NULLIF(value,'')::INTEGER, 999) INTO v_max FROM app_settings WHERE key = 'max_slots_per_day';
  SELECT COUNT(*) INTO v_cnt FROM slots WHERE date = p_date AND is_booked = true;
  RETURN v_cnt < v_max;
END;
$$;

-- 4. Update get_available_slots: dynamic slot list from app_settings
CREATE OR REPLACE FUNCTION public.get_available_slots(p_date DATE)
RETURNS TABLE(time_slot TEXT, available BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_slots TEXT;
  v_max   INTEGER;
  v_cnt   INTEGER;
BEGIN
  SELECT value INTO v_slots FROM app_settings WHERE key = 'slots';
  SELECT COALESCE(NULLIF(value,'')::INTEGER, 999) INTO v_max FROM app_settings WHERE key = 'max_slots_per_day';
  SELECT COUNT(*) INTO v_cnt FROM slots WHERE date = p_date AND is_booked = true;

  RETURN QUERY
  SELECT trim(t.slot), (v_cnt < v_max)
  FROM unnest(string_to_array(v_slots, ',')) AS t(slot)
  WHERE trim(t.slot) <> '';
END;
$$;

-- 5. Update create_booking: remove per-slot uniqueness, keep atomic insert
CREATE OR REPLACE FUNCTION public.create_booking(
  p_name    TEXT,
  p_phone   TEXT,
  p_address TEXT,
  p_date    DATE,
  p_time    TEXT
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking_id UUID;
BEGIN
  IF NOT check_slot(p_date, p_time) THEN
    RAISE EXCEPTION 'No slots available for this date' USING ERRCODE = '23505';
  END IF;

  INSERT INTO bookings (customer_name, customer_phone, customer_address, booking_date, booking_time)
  VALUES (p_name, p_phone, p_address, p_date, p_time)
  RETURNING id INTO v_booking_id;

  INSERT INTO slots (date, time_slot, is_booked, booking_id)
  VALUES (p_date, p_time, true, v_booking_id);

  RETURN v_booking_id;
END;
$$;

-- 6. Public config RPC: anon-safe read of non-sensitive settings
CREATE OR REPLACE FUNCTION public.get_public_config()
RETURNS JSON
LANGUAGE sql SECURITY DEFINER
SET search_path = public
AS $$
  SELECT json_object_agg(key, value)
  FROM app_settings
  WHERE key IN ('slots', 'max_slots_per_day', 'price_total', 'price_deposit', 'price_balance', 'business_name', 'coverage_area');
$$;

-- 7. Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
NOTIFY pgrst, 'reload config';
