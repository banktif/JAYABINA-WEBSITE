-- Force PostgREST schema cache reload
-- Drop and recreate functions to trigger cache refresh
DROP FUNCTION IF EXISTS get_available_slots(DATE);
DROP FUNCTION IF EXISTS create_booking(TEXT,TEXT,TEXT,DATE,TEXT);
DROP FUNCTION IF EXISTS check_slot(DATE,TEXT);

CREATE OR REPLACE FUNCTION get_available_slots(p_date DATE)
RETURNS TABLE(time_slot TEXT, available BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = 'public'
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

CREATE OR REPLACE FUNCTION check_slot(p_date DATE, p_time TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = 'public'
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

CREATE OR REPLACE FUNCTION create_booking(
  p_name TEXT, p_phone TEXT, p_address TEXT, p_date DATE, p_time TEXT
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = 'public'
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

-- Force PostgREST to reload
NOTIFY pgrst, 'reload schema';
NOTIFY pgrst, 'reload config';
