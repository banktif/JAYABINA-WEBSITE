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
BEGIN
  RETURN QUERY
  SELECT t.time_slot::TEXT, COALESCE(NOT s.is_booked, true) AS available
  FROM (VALUES ('9am'),('11am'),('2pm'),('4pm')) AS t(time_slot)
  LEFT JOIN slots s ON s.date = p_date AND s.time_slot = t.time_slot::TEXT;
END;
$$;

CREATE OR REPLACE FUNCTION check_slot(p_date DATE, p_time TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  RETURN NOT EXISTS (
    SELECT 1 FROM slots
    WHERE date = p_date AND time_slot = p_time AND is_booked = true
  );
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
    RAISE EXCEPTION 'Slot not available' USING ERRCODE = '23505';
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
